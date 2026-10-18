-- Close Plan notification rules (one row, edited by Site Admins) and the people who asked not to get Close Plan emails.
CREATE TABLE IF NOT EXISTS close_plan_notification_rules (
  id text PRIMARY KEY DEFAULT 'default',
  rules jsonb NOT NULL,
  updated_by integer REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS notification_optouts (
  email text PRIMARY KEY,
  source text NOT NULL DEFAULT 'admin',
  reason text,
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
