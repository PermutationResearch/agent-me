CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  receipt_hash TEXT NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  offers_json TEXT NOT NULL DEFAULT '[]',
  notes_json TEXT NOT NULL DEFAULT '[]',
  contributor_note TEXT NOT NULL DEFAULT '',
  pack_bytes INTEGER NOT NULL CHECK(pack_bytes >= 0),
  quota INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS submission_chunks (
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  chunk_index INTEGER NOT NULL,
  content_base64 TEXT NOT NULL,
  PRIMARY KEY (submission_id, chunk_index)
);
CREATE TRIGGER IF NOT EXISTS submissions_storage_quota BEFORE INSERT ON submissions
BEGIN
  SELECT CASE WHEN COALESCE((SELECT SUM(pack_bytes) FROM submissions), 0) + NEW.pack_bytes > NEW.quota
    THEN RAISE(ABORT, 'intake_storage_quota') END;
END;
