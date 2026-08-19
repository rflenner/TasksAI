ALTER TABLE users ADD COLUMN IF NOT EXISTS last_email_id text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_status text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_status_detail text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_status_at timestamptz;
CREATE INDEX IF NOT EXISTS users_last_email_id_idx ON users(last_email_id);
