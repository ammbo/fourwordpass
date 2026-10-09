-- Sending a bill back. A holder who doesn't want it returns it to whoever passed it
-- to them (a claimer puts it back in the wild), and that sender picks someone else.

-- Who sent this payout: the holder's own pass. NULL means the creator, or the wild for a claim.
ALTER TABLE passes ADD COLUMN sender_pass_id TEXT;
-- When the recipient sent the bill back.
ALTER TABLE passes ADD COLUMN declined_at INTEGER;
-- Set while a bill is back with its sender: the pass that was declined. Cleared when it moves on.
ALTER TABLE bills ADD COLUMN returned_pass_id TEXT;
