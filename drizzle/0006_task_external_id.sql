ALTER TABLE tasks ADD COLUMN IF NOT EXISTS external_source text;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS external_id text;
CREATE UNIQUE INDEX IF NOT EXISTS tasks_external_unique ON tasks(external_source, external_id) WHERE external_source IS NOT NULL AND external_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS pasted_minutes (content_hash text PRIMARY KEY, pasted_by text, task_count integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now());
