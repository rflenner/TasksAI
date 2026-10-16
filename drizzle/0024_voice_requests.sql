-- Product requests heard by the voice assistants (docs/close-plan.md, "Voice
-- requests"): something a person asked for that the assistant can't do yet,
-- or an explicit "I wish you could…". Kept apart from voice_audit, which is
-- deleted after 90 days: this is a product backlog. voice_request_status holds
-- what the team decided per request name.
CREATE TABLE IF NOT EXISTS voice_request_asks (
  id serial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id integer REFERENCES users(id) ON DELETE SET NULL,
  actor_name text NOT NULL DEFAULT '',
  session_id text NOT NULL DEFAULT '',
  surface text NOT NULL,
  request_name text NOT NULL,
  kind text NOT NULL,
  utterance text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS voice_request_asks_name_idx ON voice_request_asks (request_name);
CREATE TABLE IF NOT EXISTS voice_request_status (
  request_name text PRIMARY KEY,
  status text NOT NULL DEFAULT 'new',
  note text NOT NULL DEFAULT '',
  updated_by integer REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
