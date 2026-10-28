# Trace submissions and buyer review

For the hosted service, production reviewer access, and public upload limits, see
[Public launch](PUBLIC_LAUNCH.md). The local runtime below remains available for
private use and has a separate buyer key.

Agent-Me now supports selected trace intake, private contributor receipts, buyer review, and priced proposals. A contributor must explicitly confirm the send. The original pack remains a sealed `agent-me.trace-pack.v1` draft; its submission and proposal lifecycle lives separately in the intake database.

## Use the flow

1. Open `/traces`, import files locally, review redactions, select records, choose **Sale offer** and permitted uses, then confirm review.
2. Choose **Send selected pack** to inspect the exact pack. Enter a title, optionally an alias, and confirm the send. Alternatively, export a draft and open `/submit` to load it.
3. Save the private receipt JSON after submission. At `/submissions`, load the receipt or enter its ID and code, then open the submission. Receipts are not automatically saved in browser storage. No email or account recovery is provided.
4. An operator opens `/buyer` and enters their separate buyer key. They can inspect selected records, search and paginate, add private notes, mark reviewing or decline, and publish a price/use proposal.
5. The contributor refreshes their receipt, reviews the amount and proposed uses, then accepts or declines. An accepted proposal is **pending agreement**, with payment **not started**. A contract, payment, identity checks, and a final license are not implemented by this local flow.
6. A contributor can withdraw. The active database removes pack content and further pack/event access returns 410. Minimal receipt metadata, hash, notes, and proposal history remain. External backups are not purged automatically.

Uses in a buyer proposal must be a nonempty subset of the contributor's selected uses. Traces are untrusted data: opening a pack does not execute tools, optimize skills, train models, or grant instruction authority.

## Local runtime

Install frontend dependencies and the backend `.venv` first. From the project root:

```bash
python3 scripts/start_trace_market.py
```

The script starts a loopback-only backend on 8001 and frontend on 5181, leaving the personal archive runtime's 8000/5173 ports available. It creates `private/trace-market/market.env`, a private `buyer-access-key.txt`, logs, a runtime PID receipt, and a separate SQLite database. Keep the buyer key private; it belongs only in the buyer sign-in form, never a URL or a `VITE_*` value. Re-running preserves credentials and refuses occupied ports. Use the recorded PIDs to stop only the processes you own.

For durable encrypted storage outside a disposable checkout:

```bash
python3 scripts/start_trace_market.py --state-dir '/Volumes/EncryptedVault/agent-me/trace-market'
```

The vault must be mounted. `runtime.json` records the URL and private key-file location, without the key itself. Personal workspace and external answer providers are disabled in this runtime. The old example agent UI remains at `/workspace`; it does not load the private archive here.

## Configuration and limits

- `TRACE_SUBMISSIONS_ENABLED=false` by default; intake also requires a buyer key at least 32 characters long.
- `TRACE_SUBMISSION_DATA_DIR=private/trace-market/data`: separate private SQLite intake (`submissions.sqlite3`, mode 0600).
- `TRACE_BUYER_TOKEN`: operator bearer key; distinct from contributor receipt codes.
- `TRACE_SUBMISSION_MAX_BYTES=26214400`: up to 25 MiB per pretty-printed pack and 50,000 selected events.
- `MAX_TRACE_SUBMISSION_BODY_BYTES=27262976`: 26 MiB only for the exact submission POST. Other routes retain their existing smaller body limit.
- `TRACE_SUBMISSION_STORAGE_LIMIT_BYTES=536870912`: 512 MiB of logical pack content; admission and retry are transaction-bound. This is not a complete disk-usage or public abuse quota.
- `VITE_API_PROXY_TARGET`: development proxy destination, default `http://127.0.0.1:8000`. No secret belongs in this value.

The backend validates the complete selected-pack structure, event/file/conversation counts, content SHA-256 values, and the canonical pack checksum before storing data. A checksum detects changes; it does not prove provenance or sufficient redaction. A client-generated 256-bit receipt code is sent only in the Authorization header. Only its SHA-256 hash is stored. Retrying identical data with the same code returns the same submission; different data with that code returns 409. Keep an unconfirmed send page open and retry there if the network response is lost.

Buyer and contributor responses use `Cache-Control: no-store`. Reviewer notes are excluded from contributor responses. Neither role has a public listing endpoint. A contributor sees only the submission matching their private code; the buyer key grants the private inbox. This local service does not provide public deployment hardening, accounts, rate limiting, billing, notifications, or a negotiated legal agreement.

## API

All endpoints start with `/api/v1` and use JSON:

| Endpoint | Access | Result |
| --- | --- | --- |
| `GET /trace-market/status` | Public | Availability and pack limits |
| `POST /trace-submissions` | New private receipt code | Explicit pack intake; 201 new or 200 retry |
| `GET /trace-submissions/{id}` | Receipt | Status and proposals |
| `GET /trace-submissions/{id}/pack` | Receipt | Exact submitted pack |
| `POST /trace-submissions/{id}/respond` | Receipt | Accept or decline current offer |
| `POST /trace-submissions/{id}/withdraw` | Receipt | Remove active pack content |
| `GET /buyer/trace-submissions` | Buyer | Filtered, paginated private inbox |
| `GET /buyer/trace-submissions/{id}` | Buyer | Detail and private notes |
| `GET /buyer/trace-submissions/{id}/events` | Buyer | Search and paginate selected records |
| `GET /buyer/trace-submissions/{id}/pack` | Buyer | Exact submitted pack |
| `POST /buyer/trace-submissions/{id}/review` | Buyer | Reviewing/declined state plus optional note |
| `POST /buyer/trace-submissions/{id}/offers` | Buyer | Integer minor-unit price, currency, subset uses, public message |

No payment, sale, third-party notification, model optimization, or license transfer is triggered by these endpoints.
