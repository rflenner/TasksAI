ALTER TABLE tasks ADD COLUMN IF NOT EXISTS owner_contact_id text;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recipient_contact_ids jsonb NOT NULL DEFAULT '{}';
