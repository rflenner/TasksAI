CREATE TABLE IF NOT EXISTS task_update_tokens (
  id serial PRIMARY KEY,
  task_id integer NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  recipient_name text NOT NULL,
  recipient_email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS task_update_tokens_hash_unique ON task_update_tokens(token_hash);
CREATE INDEX IF NOT EXISTS task_update_tokens_task_idx ON task_update_tokens(task_id);
