-- In-app notifications: admins get pinged when a stock request/transfer or
-- daily report needs approval; staff get pinged when their submission is
-- approved or rejected.
CREATE TYPE notification_type AS ENUM (
  'stock_request_pending', 'stock_request_approved', 'stock_request_rejected',
  'daily_report_pending',  'daily_report_approved',  'daily_report_rejected'
);

CREATE TABLE notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       notification_type NOT NULL,
  title      TEXT NOT NULL,
  message    TEXT,
  link       TEXT,
  is_read    BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user ON notifications(user_id, is_read, created_at DESC);
