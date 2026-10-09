-- Optional accounts. Playing never needs one: a stranger who signs up later sees their whole
-- history, because every role is also recorded under a participant id (pid), a keyed hash of
-- the email (HMAC with TOKEN_SECRET). History follows the pid, not the raw address, so private
-- emails can be scrubbed later without orphaning anyone's hops.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,          -- verified at sign-in, lowercase
  pid TEXT NOT NULL UNIQUE,
  handle TEXT COLLATE NOCASE UNIQUE,   -- a claimed pen name: only its owner can sign with it
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER
);

-- The cookie carries a random token; only its SHA-256 is stored.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

-- One emailed sign-in: a six-digit code and a link, either one works once.
CREATE TABLE auth_challenges (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,             -- HMAC, so a leaked row can't be brute-forced offline
  link_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX auth_challenges_email ON auth_challenges(email, created_at);

ALTER TABLE bills ADD COLUMN creator_pid TEXT;
ALTER TABLE bills ADD COLUMN comped_by TEXT;    -- the admin who minted it without checkout
ALTER TABLE passes ADD COLUMN recipient_pid TEXT;
ALTER TABLE hops ADD COLUMN writer_pid TEXT;
ALTER TABLE hops ADD COLUMN pen_verified INTEGER NOT NULL DEFAULT 0;  -- signed with the writer's claimed pen name
ALTER TABLE follows ADD COLUMN pid TEXT;
CREATE INDEX bills_creator_pid ON bills(creator_pid);
CREATE INDEX passes_recipient_pid ON passes(recipient_pid);
CREATE INDEX hops_writer_pid ON hops(writer_pid, status);
CREATE INDEX follows_pid ON follows(pid);
-- Existing rows get their pid from the cron backfill (D1 can't compute an HMAC). These partial
-- indexes hold only the rows still waiting, so the per-minute check reads nothing once it's done.
CREATE INDEX bills_pid_todo ON bills(creator_email) WHERE creator_pid IS NULL AND creator_email IS NOT NULL;
CREATE INDEX passes_pid_todo ON passes(recipient_email) WHERE recipient_pid IS NULL;
CREATE INDEX hops_pid_todo ON hops(writer_email) WHERE writer_pid IS NULL AND writer_email IS NOT NULL;
CREATE INDEX follows_pid_todo ON follows(email) WHERE pid IS NULL;
