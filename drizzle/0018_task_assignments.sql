CREATE TABLE IF NOT EXISTS task_assignments (
  task_id integer NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  person_name text NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS task_assignments_task_person_unique ON task_assignments (task_id, person_name);
