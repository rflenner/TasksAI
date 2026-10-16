-- Close Plan, step A: each plan stored whole as one JSON document so the
-- iSEEit team can share it (see docs/close-plan.md, "Shared storage").
-- member_emails is derived on the server from the plan's iSEEit members and
-- decides who sees the plan; version guards against silent overwrites.
CREATE TABLE IF NOT EXISTS close_plan_documents (
  id text PRIMARY KEY,
  title text NOT NULL,
  account text NOT NULL DEFAULT '',
  data jsonb NOT NULL,
  member_emails jsonb NOT NULL DEFAULT '[]',
  version integer NOT NULL DEFAULT 1,
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  updated_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS close_plan_documents_updated_idx ON close_plan_documents (updated_at);
