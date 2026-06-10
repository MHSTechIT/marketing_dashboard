-- Page Visit / User Activity Tracking
-- Additive only — creates two new tables; does not touch any existing table.

CREATE TABLE IF NOT EXISTS user_activity_logs (
  id               BIGSERIAL PRIMARY KEY,
  user_id          TEXT,
  user_name        TEXT,
  user_email       TEXT,
  user_role        TEXT,
  page_name        TEXT,
  page_url         TEXT,
  session_id       TEXT,
  device_type      TEXT,
  browser          TEXT,
  ip_address       TEXT,
  duration_seconds INTEGER DEFAULT 0,
  visited_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_user_id    ON user_activity_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_activity_visited_at ON user_activity_logs (visited_at);
CREATE INDEX IF NOT EXISTS idx_activity_session    ON user_activity_logs (session_id);
CREATE INDEX IF NOT EXISTS idx_activity_page       ON user_activity_logs (page_name);

CREATE TABLE IF NOT EXISTS user_sessions (
  id               BIGSERIAL PRIMARY KEY,
  user_id          TEXT,
  user_name        TEXT,
  user_email       TEXT,
  session_id       TEXT UNIQUE,
  login_time       TIMESTAMPTZ NOT NULL DEFAULT now(),
  logout_time      TIMESTAMPTZ,
  session_duration INTEGER,             -- seconds
  last_activity    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address       TEXT,
  device_type      TEXT,
  browser          TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id    ON user_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_login_time ON user_sessions (login_time);
CREATE INDEX IF NOT EXISTS idx_sessions_session_id ON user_sessions (session_id);
