-- When a follower was last emailed about a hop. Hop emails are spaced out per follower.
ALTER TABLE follows ADD COLUMN hop_mail_at INTEGER;
