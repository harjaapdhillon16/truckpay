-- Test-money mode: payouts checked by Agent Connect without moving funds.
ALTER TABLE payments ADD COLUMN test INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payments ADD COLUMN policy_check TEXT;
