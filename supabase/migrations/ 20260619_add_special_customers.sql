-- Special customers table: admin-managed list of VIP/named customers
-- Staff can select from this list when recording sales

CREATE TABLE IF NOT EXISTS special_customers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(150) NOT NULL,
  phone       VARCHAR(30),
  email       VARCHAR(254),
  address     TEXT,
  notes       TEXT,
  created_by  UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_special_customers_name ON special_customers(name);
CREATE INDEX idx_special_customers_active ON special_customers(is_active);
