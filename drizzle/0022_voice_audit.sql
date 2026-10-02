-- Voice audit trail (requested 2026-10-02, "what was created, changed and
-- done by voice live and what did not ... good to debug"). One row per
-- thing that happened in a voice session: what was heard, what Task AI
-- did with it (or why it didn't), what the assistant said back, and how a
-- confirmation (notify/delete) turned out. Covers both the Live Voice
-- Assistant and the Deepgram-based Ask Task AI via `source`. Voice
-- transcripts are sensitive, so rows are pruned after a retention window
-- (see app/lib/voice-audit.ts) and the viewer is site-admin only.
CREATE TABLE IF NOT EXISTS voice_audit (
  id serial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id integer REFERENCES users(id) ON DELETE SET NULL,
  actor_name text NOT NULL,
  session_id text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'ask',
  event text NOT NULL,
  utterance text NOT NULL DEFAULT '',
  mode text,
  outcome text,
  task_ids jsonb NOT NULL DEFAULT '[]',
  spoken_answer text NOT NULL DEFAULT '',
  detail jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS voice_audit_created_idx ON voice_audit (created_at);
CREATE INDEX IF NOT EXISTS voice_audit_session_idx ON voice_audit (session_id);
