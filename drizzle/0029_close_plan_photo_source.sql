-- Where a plan photo came from: "upload" (set in Closeplan, never replaced by a sync), "salesforce" or "salesai".
ALTER TABLE close_plan_photos ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'salesforce';
