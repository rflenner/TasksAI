-- The roles people can have on a Close Plan, defined by Site Admins (Admin → Close Plan roles). One row; see app/lib/close-plan-roles.ts.
CREATE TABLE IF NOT EXISTS close_plan_role_settings (
  id text PRIMARY KEY DEFAULT 'default',
  roles jsonb NOT NULL,
  updated_by integer REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
