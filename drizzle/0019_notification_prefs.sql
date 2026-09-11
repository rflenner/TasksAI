ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_prefs jsonb NOT NULL DEFAULT '{"newAssignment":"both","overdue":"both","weeklyDigest":"both","statusUpdateSlack":true}';
