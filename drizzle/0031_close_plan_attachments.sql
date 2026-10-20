-- PDF files attached to tasks on a Close Plan (app/lib/close-plan-attachments.ts). Removed with the plan.
CREATE TABLE IF NOT EXISTS close_plan_attachments (
  id text PRIMARY KEY,
  plan_id text NOT NULL REFERENCES close_plan_documents(id) ON DELETE CASCADE,
  task_id text NOT NULL,
  name text NOT NULL,
  size integer NOT NULL,
  content_type text NOT NULL DEFAULT 'application/pdf',
  -- Visible to the customer (also needs the task itself to be shared). Files a customer uploads are always shared.
  shared boolean NOT NULL DEFAULT true,
  -- "u:<user id>" for the iSEEit team, "p:<person id>" for a customer on a personal link.
  uploaded_by text NOT NULL,
  uploaded_by_name text NOT NULL,
  uploaded_by_side text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  data bytea NOT NULL
);
CREATE INDEX IF NOT EXISTS close_plan_attachments_plan_idx ON close_plan_attachments (plan_id, task_id);
