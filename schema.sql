-- StudyAI Tutor — database schema
-- Run this once against your Postgres database before starting the server:
--   psql "$DATABASE_URL" -f schema.sql

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  premium BOOLEAN NOT NULL DEFAULT FALSE,
  auto_speak BOOLEAN NOT NULL DEFAULT FALSE,
  pricing_tier TEXT,               -- 'nigeria' | 'africa' | 'row'
  billing_country TEXT,            -- ISO-2 country code detected at checkout time
  flw_tx_ref TEXT,                 -- Flutterwave transaction reference for the initial checkout
  flw_subscription_id TEXT,        -- Flutterwave subscription id, used to cancel later
  questions_today INT NOT NULL DEFAULT 0,
  last_question_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  question TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_user ON activity(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_user_created ON activity(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_user_subject ON chat_messages(user_id, subject, created_at ASC);

-- If you're migrating an EXISTING database from the earlier Paystack schema
-- rather than starting fresh, run these instead of the CREATE TABLE above:
--   ALTER TABLE users ADD COLUMN IF NOT EXISTS flw_tx_ref TEXT;
--   ALTER TABLE users ADD COLUMN IF NOT EXISTS flw_subscription_id TEXT;
--   ALTER TABLE users DROP COLUMN IF EXISTS stripe_customer_id;
--   ALTER TABLE users DROP COLUMN IF EXISTS stripe_subscription_id;
--   ALTER TABLE users DROP COLUMN IF EXISTS paystack_customer_code;
--   ALTER TABLE users DROP COLUMN IF EXISTS paystack_subscription_code;
--   ALTER TABLE users DROP COLUMN IF EXISTS paystack_email_token;
--   ALTER TABLE users DROP COLUMN IF EXISTS reset_token;
--   ALTER TABLE users DROP COLUMN IF EXISTS reset_token_expires;