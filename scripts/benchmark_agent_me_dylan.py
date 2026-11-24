#!/usr/bin/env python3
"""Offline public-data comparison; no network or Agent Me private corpus required."""

import argparse
import hashlib
import importlib.util
import json
import math
import sqlite3
import struct
import subprocess
import tempfile
import time
from pathlib import Path

parser = argparse.ArgumentParser(
    description="Offline Agent Me FTS versus DYLAN on pooled LongMemEval"
)
parser.add_argument("--dylan", type=Path, required=True)
parser.add_argument("--embeddings", type=Path, required=True)
parser.add_argument("--corpus", type=Path, required=True)
parser.add_argument("--agent-me", type=Path, required=True)
parser.add_argument("--builder", type=Path, required=True)
args = parser.parse_args()
temp = tempfile.TemporaryDirectory(prefix="agent-me-dylan-")
work = Path(temp.name)
embedpath = args.embeddings
sourcepath = args.corpus
emb = json.loads(embedpath.read_text())
questions = json.loads(sourcepath.read_text())
sessions = {}
for q in questions:
    for sid, turns in zip(q["haystack_session_ids"], q["haystack_sessions"]):
        sessions.setdefault(
            sid, "\n".join(f"{t['role']}: {t['content']}" for t in turns)
        )
ids = sorted(sessions)
assert set(ids) == set(emb["sessions"]) and {
    q["question_id"] for q in questions
} == set(emb["queries"])
spec = importlib.util.spec_from_file_location(
    "corpus", str(args.agent_me / "backend/app/corpus.py")
)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
dbpath = work / "fixture.sqlite"
if dbpath.exists():
    raise SystemExit("refusing to overwrite existing fixture")
with sqlite3.connect(dbpath) as db:
    builder_spec = importlib.util.spec_from_file_location("builder", args.builder)
    builder = importlib.util.module_from_spec(builder_spec)
    builder_spec.loader.exec_module(builder)
    builder._database_schema(db)
    metadata = {
        "schema": "hsm.ai_corpus_semantic_index.v1",
        "trust": "untrusted_corpus",
        "read_only_intent": True,
        "promotion_side_effects": False,
        "document_scope": "all_events",
    }
    db.executemany(
        "INSERT INTO metadata VALUES(?,?)",
        [(k, json.dumps(v)) for k, v in metadata.items()],
    )
    for i, sid in enumerate(ids):
        text = sessions[sid]
        db.execute(
            "INSERT INTO conversations VALUES(?,?,?,?,?,?,?)",
            (sid, "benchmark", None, None, None, 1, "{}"),
        )
        db.execute(
            "INSERT INTO documents VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            (
                i + 1,
                sid,
                0,
                0,
                "message",
                "user",
                None,
                None,
                hashlib.sha256(text.encode()).hexdigest(),
                len(text),
                text,
            ),
        )
        db.execute("INSERT INTO document_fts(rowid,text) VALUES(?,?)", (i + 1, text))
dbpath.chmod(0o600)
idx = mod.CorpusIndex(
    str(dbpath), hashlib.sha256(dbpath.read_bytes()).hexdigest(), include_work=True
)
truth = [set(q["answer_session_ids"]) for q in questions]


def metrics(ranks):
    recalls = [
        len(set(row[:10]) & target) / len(target)
        for row, target in zip(ranks, truth)
        if target
    ]
    return {
        "recall_at_10": sum(recalls) / len(recalls),
        "hit_at_10": sum(
            bool(set(row[:10]) & target) for row, target in zip(ranks, truth)
        )
        / len(truth),
    }


start = time.perf_counter()
fts = []
for q in questions:
    fts.append(
        [item["conversation_id"] for item in idx.search(q["question"], limit=10)]
    )
fts_time = time.perf_counter() - start
print(
    "Agent Me fixed-builder FTS measured:",
    json.dumps({"seconds": fts_time, **metrics(fts)}),
    flush=True,
)


def write_vectors(name, keys, source):
    with (
        (work / f"{name}.fvecs").open("wb") as f,
        (work / f"{name}.csv").open("w") as labels,
    ):
        for key in keys:
            row = source[key]
            n = math.sqrt(sum(x * x for x in row))
            assert n > 0 and math.isfinite(n)
            f.write(struct.pack("<i", len(row)))
            f.write(struct.pack(f"<{len(row)}f", *(v / n for v in row)))
            labels.write("1\n")


write_vectors("base", ids, emb["sessions"])
write_vectors("queries", [q["question_id"] for q in questions], emb["queries"])
exe = str(args.dylan.resolve(strict=True))
index = work / "index.ind3"


def run(command):
    start = time.perf_counter()
    subprocess.run(command, check=True, capture_output=True, text=True)
    return time.perf_counter() - start


build = run(
    [
        exe,
        "build",
        "--vectors",
        str(work / "base.fvecs"),
        "--labels",
        str(work / "base.csv"),
        "--label-num",
        "1",
        "--capacity",
        str(len(ids)),
        "--output",
        str(index),
    ]
)
allresults = {
    "fts": {"seconds": fts_time, **metrics(fts)},
    "dylan_build_seconds": build,
    "index_bytes": index.stat().st_size,
}
for name, opts in [
    ("exact", ["--exact", "1"]),
    ("ef32", ["--ef", "32"]),
    ("ef128", ["--ef", "128"]),
]:
    output = work / f"{name}.tsv"
    cmd = [
        exe,
        "search",
        "--index",
        str(index),
        "--vectors",
        str(work / "queries.fvecs"),
        "--labels",
        str(work / "queries.csv"),
        "--match",
        "containment",
        "--k",
        "10",
        *opts,
        "--output",
        str(output),
    ]
    times = [run(cmd) for _ in range(4)]
    ranks = [[] for _ in questions]
    for line in output.read_text().splitlines():
        a = line.split("\t")
        if len(a) >= 3 and a[0].isdigit():
            ranks[int(a[0])].append(ids[int(a[1])])
    assert all(len(row) == 10 for row in ranks)
    allresults[name] = {
        "seconds": times[1:],
        "median_seconds": sorted(times[1:])[1],
        **metrics(ranks),
    }
    if name == "exact":
        exact = ranks
    else:
        allresults[name]["neighbor_recall_at_10"] = sum(
            len(set(a) & set(b)) / 10 for a, b in zip(ranks, exact)
        ) / len(exact)
print(json.dumps(allresults, indent=2), flush=True)
(work / "report.json").write_text(json.dumps(allresults, indent=2))

import hashlib
import importlib.util
import json
import sqlite3
import time
from pathlib import Path

w = work
p = w / "control.sqlite"
if p.exists():
    raise SystemExit("refusing to overwrite")
with sqlite3.connect(w / "fixture.sqlite") as src, sqlite3.connect(p) as dst:
    src.backup(dst)
with sqlite3.connect(p) as db:
    db.execute("DROP TABLE document_fts")
    db.execute(
        "CREATE VIRTUAL TABLE document_fts USING fts5(text, content='', detail=column, tokenize='unicode61 remove_diacritics 2')"
    )
    db.execute(
        "INSERT INTO document_fts(rowid,text) SELECT document_id,excerpt FROM documents"
    )
p.chmod(0o600)
spec = importlib.util.spec_from_file_location(
    "corpus", str(args.agent_me / "backend/app/corpus.py")
)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
idx = mod.CorpusIndex(
    str(p), hashlib.sha256(p.read_bytes()).hexdigest(), include_work=True
)
qs = json.loads(sourcepath.read_text())
t = time.perf_counter()
ranks = [
    [x["conversation_id"] for x in idx.search(q["question"], limit=10)] for q in qs
]
elapsed = time.perf_counter() - t
recalls = [
    len(set(r) & set(q["answer_session_ids"])) / len(q["answer_session_ids"])
    for r, q in zip(ranks, qs)
]
print(
    json.dumps(
        {
            "condition": "same Agent Me code and data; legacy FTS detail=column control",
            "seconds": elapsed,
            "recall_at_10": sum(recalls) / len(recalls),
            "hit_at_10": sum(r > 0 for r in recalls) / len(recalls),
        }
    )
)
