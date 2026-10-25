-- Edits made to an org chart copy in Task AI. `data` stays the copy read from Salesforce; `edited` holds the chart as changed here
-- (NULL = not edited). Nothing here is written to Salesforce. Re-importing the chart replaces `data` and clears the edits.
ALTER TABLE org_charts ADD COLUMN IF NOT EXISTS edited jsonb;
ALTER TABLE org_charts ADD COLUMN IF NOT EXISTS edited_at timestamptz;
ALTER TABLE org_charts ADD COLUMN IF NOT EXISTS edited_by integer REFERENCES users(id) ON DELETE SET NULL;
