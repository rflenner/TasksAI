-- One more switch per person (Admin > Users): may open the Voice audit trail, so a Collaborator or Area Admin can
-- read how the voice assistants were used without becoming a Site Admin. Site Admins always can.
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_view_voice_audit boolean NOT NULL DEFAULT false;
