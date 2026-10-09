-- Couple reservations to the exact pass being settled, including interrupted old handoffs.
ALTER TABLE bills ADD COLUMN active_pass_id TEXT;
ALTER TABLE bills ADD COLUMN checkout_mode TEXT;
UPDATE bills SET checkout_mode = CASE WHEN checkout_order_id LIKE 'MOCKORDER-%' THEN 'mock' ELSE 'sandbox' END
 WHERE checkout_order_id IS NOT NULL;
UPDATE bills SET active_pass_id = (SELECT id FROM passes WHERE bill_id = bills.id ORDER BY created_at DESC LIMIT 1)
 WHERE status = 'in_transit';
ALTER TABLE hops ADD COLUMN fx_lease_until INTEGER NOT NULL DEFAULT 0;
ALTER TABLE follows ADD COLUMN verified INTEGER NOT NULL DEFAULT 1;
ALTER TABLE follows ADD COLUMN confirmation_sent_at INTEGER;
ALTER TABLE passes ADD COLUMN resend_at INTEGER;

-- At-least-once delivery with a lease and exponential retry. Successful rows deduplicate retries.
CREATE TABLE mail_outbox (
 id TEXT PRIMARY KEY,
 payload TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending',
 attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at INTEGER NOT NULL,
 lease_until INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL,
 sent_at INTEGER
);
CREATE INDEX mail_outbox_due ON mail_outbox(status, next_attempt_at, lease_until);

CREATE TABLE mint_attempts (
 order_id TEXT PRIMARY KEY,
 recovery_hash TEXT NOT NULL,
 input_json TEXT NOT NULL,
 place_json TEXT NOT NULL,
 bill_id TEXT NOT NULL UNIQUE,
 paypal_mode TEXT NOT NULL,
 created_at INTEGER NOT NULL
);

CREATE TABLE notification_jobs (
 id TEXT PRIMARY KEY,
 bill_id TEXT NOT NULL,
 kind TEXT NOT NULL,
 details TEXT NOT NULL,
 cursor TEXT NOT NULL DEFAULT '',
 done INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX notification_jobs_pending ON notification_jobs(done);

ALTER TABLE follows ADD COLUMN opted_out INTEGER NOT NULL DEFAULT 0;

CREATE TABLE checkout_orders (
 order_id TEXT PRIMARY KEY,
 recovery_hash TEXT NOT NULL,
 paypal_mode TEXT NOT NULL,
 purpose TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
