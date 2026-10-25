-- The company logo of an org chart's account, read from Sales AI (enrichment profile picture) when the chart is imported or pulled.
-- Only the web address is kept; empty = no logo known.
ALTER TABLE org_charts ADD COLUMN IF NOT EXISTS logo text NOT NULL DEFAULT '';
