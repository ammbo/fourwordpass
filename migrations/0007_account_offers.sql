-- An account can start wherever someone types their own email: they pick a pen name, and the email
-- we were sending anyway (follow confirmation, creator key, claim) carries a link that proves the
-- address and finishes the account. Nothing is created until that link or its code is used.
ALTER TABLE auth_challenges ADD COLUMN handle TEXT;       -- the pen name to claim once the address is proven
ALTER TABLE auth_challenges ADD COLUMN follow_id TEXT;    -- a follow to confirm in the same tap
ALTER TABLE auth_challenges ADD COLUMN failures INTEGER NOT NULL DEFAULT 0;  -- wrong codes; capped per address per day
