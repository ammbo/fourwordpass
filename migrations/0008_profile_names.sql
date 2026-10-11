-- Real names stay private except in invitations sent by this participant.
-- Older accounts finish their profile after signing in; pen names remain public signatures.
ALTER TABLE users ADD COLUMN first_name TEXT;
ALTER TABLE users ADD COLUMN last_name TEXT;
ALTER TABLE auth_challenges ADD COLUMN first_name TEXT;
ALTER TABLE auth_challenges ADD COLUMN last_name TEXT;

-- Snapshot the authorized sender at handoff time; old invitations stay anonymous.
ALTER TABLE passes ADD COLUMN sender_name TEXT;
