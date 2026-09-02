ALTER TABLE tasks ADD COLUMN IF NOT EXISTS account_id text;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS account_name text;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS opportunity_id text;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS opportunity_name text;
CREATE INDEX IF NOT EXISTS tasks_account_idx ON tasks(account_id);
