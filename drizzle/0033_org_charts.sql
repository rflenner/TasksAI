-- Org charts copied from Salesforce (an account's or an opportunity's), listed under Org charts in Task AI.
-- Re-importing the same account or opportunity replaces its row. Deleting removes only this copy, never anything in Salesforce.
CREATE TABLE IF NOT EXISTS org_charts (
  id text PRIMARY KEY,
  kind text NOT NULL,
  sfdc_id text NOT NULL,
  name text NOT NULL,
  account_id text NOT NULL DEFAULT '',
  account_name text NOT NULL DEFAULT '',
  data jsonb NOT NULL,
  people integer NOT NULL DEFAULT 0,
  imported_by integer REFERENCES users(id) ON DELETE SET NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT org_charts_kind_check CHECK (kind IN ('account', 'opportunity')),
  CONSTRAINT org_charts_source_unique UNIQUE (kind, sfdc_id)
);
