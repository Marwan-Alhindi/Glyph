-- Add plan tier to profiles (free / pro / builder).
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'free'
    CHECK (plan IN ('free', 'pro', 'max'));

-- Per-user monthly token usage counters.
CREATE TABLE IF NOT EXISTS usage_tracking (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period_start date        NOT NULL,
  tokens_used  bigint      NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, period_start)
);

ALTER TABLE usage_tracking ENABLE ROW LEVEL SECURITY;

-- Users can only read their own rows (backend writes via service key, bypassing RLS).
CREATE POLICY "usage_tracking_read_own"
  ON usage_tracking FOR SELECT
  USING (auth.uid() = user_id);

-- Atomic upsert helper used by the backend to increment token counts.
CREATE OR REPLACE FUNCTION increment_usage(p_user_id uuid, p_period date, p_tokens bigint)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO usage_tracking (user_id, period_start, tokens_used)
  VALUES (p_user_id, p_period, p_tokens)
  ON CONFLICT (user_id, period_start)
  DO UPDATE SET
    tokens_used = usage_tracking.tokens_used + EXCLUDED.tokens_used,
    updated_at  = now();
$$;
