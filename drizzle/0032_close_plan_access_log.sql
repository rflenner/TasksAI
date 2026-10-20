-- Who logged in or opened a Close Plan (team and customer links), what they viewed and what they changed. Admin only
-- (Admin → Close Plan activity). Plan and task names are copied in, so the history stays readable if a plan is deleted.
CREATE TABLE IF NOT EXISTS close_plan_access_log (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  plan_id text,
  plan_title text,
  user_id integer,
  person_id text,
  person_name text NOT NULL,
  side text NOT NULL,
  via text NOT NULL,
  event text NOT NULL,
  task_id text,
  task_title text,
  detail text
);
CREATE INDEX IF NOT EXISTS close_plan_access_log_at_idx ON close_plan_access_log (at DESC);
CREATE INDEX IF NOT EXISTS close_plan_access_log_plan_idx ON close_plan_access_log (plan_id, at DESC);
CREATE INDEX IF NOT EXISTS close_plan_access_log_user_idx ON close_plan_access_log (user_id, at DESC);
