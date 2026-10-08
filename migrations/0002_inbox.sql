-- Inbound mail to any @fourwordpass.com address (Email Routing catch-all → Worker).
-- Used as a real inbox for end-to-end tests, and later for replies to the bill.
CREATE TABLE inbox (
  id TEXT PRIMARY KEY,
  to_email TEXT NOT NULL,
  from_email TEXT NOT NULL,
  subject TEXT,
  text TEXT,
  html TEXT,
  links TEXT,                   -- JSON array of URLs found in the message
  received_at INTEGER NOT NULL
);
CREATE INDEX inbox_to ON inbox(to_email, received_at);
