CREATE TABLE IF NOT EXISTS passkeys (id serial PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE, credential_id text NOT NULL, public_key text NOT NULL, counter integer NOT NULL DEFAULT 0, transports jsonb NOT NULL DEFAULT '[]', device_label text, created_at timestamptz NOT NULL DEFAULT now(), last_used_at timestamptz);
CREATE UNIQUE INDEX IF NOT EXISTS passkeys_credential_id_unique ON passkeys(credential_id);
CREATE INDEX IF NOT EXISTS passkeys_user_idx ON passkeys(user_id);
