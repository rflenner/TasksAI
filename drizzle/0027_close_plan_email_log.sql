-- What Close Plan emailed to whom, for invitation reminders, the weekly cap per customer and de-duplication.
CREATE TABLE IF NOT EXISTS close_plan_email_log (
  id serial PRIMARY KEY,
  kind text NOT NULL,
  plan_id text NOT NULL,
  person_id text NOT NULL DEFAULT '',
  email text NOT NULL,
  task_id text,
  sent_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS close_plan_email_log_plan_idx ON close_plan_email_log (plan_id, person_id, kind, sent_at);
CREATE INDEX IF NOT EXISTS close_plan_email_log_email_idx ON close_plan_email_log (email, sent_at);
