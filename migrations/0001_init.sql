-- Four Word Pass: core schema.
-- Times are unix epoch milliseconds.

-- A bill is one traveling dollar and the story it carries.
CREATE TABLE bills (
  id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL UNIQUE,
  serial TEXT NOT NULL UNIQUE,
  -- in_transit: a payout is in flight | holding: someone owes 4 words | wild: claimable
  -- complete: creator wrote the finale | eulogized: stalled out, closed by the bill
  status TEXT NOT NULL,
  theme TEXT,
  goal_hops INTEGER,
  personality TEXT NOT NULL DEFAULT '{}',
  creator_email TEXT,
  origin_city TEXT,
  origin_lat REAL,
  origin_lng REAL,
  forked_from_bill_id TEXT,
  forked_at_hop INTEGER,
  holder_pass_id TEXT,          -- the pass that delivered the bill to its current holder
  holder_since INTEGER,
  held_via_wild INTEGER NOT NULL DEFAULT 0,
  wild_since INTEGER,
  nag_level INTEGER NOT NULL DEFAULT 0,
  hop_count INTEGER NOT NULL DEFAULT 0,
  word_count INTEGER NOT NULL DEFAULT 0,
  follower_count INTEGER NOT NULL DEFAULT 0,
  finale_text TEXT,
  finale_by TEXT,               -- 'creator' (human) | 'bill' (AI, always labeled)
  eulogy TEXT,
  goal_notified INTEGER NOT NULL DEFAULT 0,
  featured INTEGER NOT NULL DEFAULT 0,
  is_seed INTEGER NOT NULL DEFAULT 0,
  checkout_order_id TEXT UNIQUE,
  version INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  ended_at INTEGER
);
CREATE INDEX bills_status ON bills(status, holder_since);
CREATE INDEX bills_wild ON bills(status, wild_since);
CREATE INDEX bills_parent ON bills(forked_from_bill_id);

-- A pass is one $1 payout from the platform to a person. Money only; no words.
CREATE TABLE passes (
  id TEXT PRIMARY KEY,
  bill_id TEXT NOT NULL,
  kind TEXT NOT NULL,           -- mint | fork | pass | claim
  recipient_email TEXT NOT NULL,
  from_hop_id TEXT,             -- the pending hop that lands when this payout lands
  status TEXT NOT NULL,         -- pending | delivered | failed
  paypal_mode TEXT NOT NULL,    -- sandbox | mock
  payout_batch_id TEXT,
  payout_item_id TEXT,
  transaction_id TEXT,
  paypal_status TEXT,
  error TEXT,
  poll_count INTEGER NOT NULL DEFAULT 0,
  next_poll_at INTEGER,
  holder_notified INTEGER NOT NULL DEFAULT 0,
  suggest_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  settled_at INTEGER
);
CREATE INDEX passes_bill ON passes(bill_id, created_at);
CREATE INDEX passes_poll ON passes(status, next_poll_at);
CREATE INDEX passes_item ON passes(payout_item_id);

-- A hop is one contribution: exactly four content words.
CREATE TABLE hops (
  id TEXT PRIMARY KEY,
  bill_id TEXT NOT NULL,
  idx INTEGER,                  -- assigned at confirmation, never at submission
  status TEXT NOT NULL,         -- pending | confirmed | void | removed
  words TEXT NOT NULL,
  content_words INTEGER NOT NULL,
  note TEXT,
  pen_name TEXT,
  city TEXT,
  region TEXT,
  country TEXT,
  lat REAL,
  lng REAL,
  writer_email TEXT,            -- private, never rendered
  received_pass_id TEXT,        -- the payout that put the bill in the writer's hands
  ai_assisted INTEGER NOT NULL DEFAULT 0,   -- private analytics only
  inherited_from_hop_id TEXT,   -- set on hops copied into a fork
  stamp_key TEXT,
  stamp_status TEXT NOT NULL DEFAULT 'pending',  -- pending | ready | failed | none
  diary_done INTEGER NOT NULL DEFAULT 0,
  followers_notified INTEGER NOT NULL DEFAULT 0,
  fx_attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  confirmed_at INTEGER
);
CREATE UNIQUE INDEX hops_bill_idx ON hops(bill_id, idx);
CREATE INDEX hops_status ON hops(bill_id, status);
CREATE INDEX hops_fx ON hops(status, diary_done, stamp_status);

-- The bill's first-person diary. Always AI, always the bill's voice, never story text.
CREATE TABLE diary (
  id TEXT PRIMARY KEY,
  bill_id TEXT NOT NULL,
  hop_id TEXT,
  kind TEXT NOT NULL,           -- birth | hop | stall | wild | goal | finale | death
  day_label TEXT,
  text TEXT NOT NULL,
  ai_meta TEXT,                 -- JSON {model, promptVersion}
  created_at INTEGER NOT NULL
);
CREATE INDEX diary_bill ON diary(bill_id, created_at);

CREATE TABLE follows (
  id TEXT PRIMARY KEY,
  bill_id TEXT NOT NULL,
  email TEXT NOT NULL,
  preference TEXT NOT NULL,     -- every_hop | on_end
  created_at INTEGER NOT NULL,
  UNIQUE(bill_id, email)
);

CREATE TABLE payout_events (
  id TEXT PRIMARY KEY,
  pass_id TEXT,
  event_type TEXT NOT NULL,
  paypal_item_id TEXT,
  raw TEXT NOT NULL,
  received_at INTEGER NOT NULL
);

CREATE TABLE emails (
  id TEXT PRIMARY KEY,
  to_email TEXT NOT NULL,
  kind TEXT NOT NULL,
  subject TEXT NOT NULL,
  bill_id TEXT,
  status TEXT NOT NULL,         -- sent | logged | failed
  message_id TEXT,
  body_text TEXT,               -- stored only in EMAIL_MODE=log (dev)
  error TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX emails_created ON emails(created_at);

-- Rejected contributions, for tuning the stopword list (PRD §21).
CREATE TABLE rejections (
  id TEXT PRIMARY KEY,
  words TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
