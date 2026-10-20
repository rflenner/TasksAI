-- Contact photos shown on a plan, copied from Salesforce (the newest "Profile_Picture.jpg" Attachment on the Contact).
CREATE TABLE IF NOT EXISTS close_plan_photos (
  plan_id text NOT NULL REFERENCES close_plan_documents(id) ON DELETE CASCADE,
  person_id text NOT NULL,
  source_id text NOT NULL,
  content_type text NOT NULL,
  data_base64 text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (plan_id, person_id)
);
