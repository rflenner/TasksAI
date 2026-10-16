-- Close Plan personal links for customer contacts (docs/close-plan.md,
-- "Personal links"). Only a hash of each link's token is stored. person_id is
-- the contact's id inside the plan document; a link stops working when it
-- expires, is revoked, the plan is deleted, or the person is no longer a
-- customer contact on the plan.
CREATE TABLE IF NOT EXISTS close_plan_links (
  id serial PRIMARY KEY,
  plan_id text NOT NULL REFERENCES close_plan_documents(id) ON DELETE CASCADE,
  person_id text NOT NULL,
  token_hash text NOT NULL,
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_used_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS close_plan_links_hash_unique ON close_plan_links (token_hash);
CREATE INDEX IF NOT EXISTS close_plan_links_plan_idx ON close_plan_links (plan_id, person_id);
