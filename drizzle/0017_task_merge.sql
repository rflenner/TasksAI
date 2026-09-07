ALTER TABLE tasks ADD COLUMN IF NOT EXISTS merged_into_task_id integer REFERENCES tasks(id);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS merged_at timestamptz;
