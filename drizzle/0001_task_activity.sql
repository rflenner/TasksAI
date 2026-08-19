ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_by text;
CREATE TABLE IF NOT EXISTS task_activity (id serial PRIMARY KEY, task_id integer NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, actor_name text, detail text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS task_activity_task_idx ON task_activity(task_id);
CREATE TABLE IF NOT EXISTS task_views (task_id integer NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, actor_name text NOT NULL, viewed_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS task_views_task_actor_unique ON task_views(task_id, actor_name);
