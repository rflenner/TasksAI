-- Influence lines on an org chart copy: who influences whom (one direction), kept in Task AI only for now. Separate from `data`
-- and `edited` so pulling the chart from Salesforce again, or resetting edits, does not throw them away.
ALTER TABLE org_charts ADD COLUMN IF NOT EXISTS influences jsonb NOT NULL DEFAULT '[]'::jsonb;
