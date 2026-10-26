-- Two extra switches per person (Admin > Users), so a Collaborator can get these without becoming an admin:
-- may create Close Plans, may open the Org charts page. Admins (Site / Area) keep both through their role.
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_create_plans boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_view_org_charts boolean NOT NULL DEFAULT false;
