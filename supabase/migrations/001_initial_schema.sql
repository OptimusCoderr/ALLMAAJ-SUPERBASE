-- ============================================================
--  BizTrack Pro — Supabase Migration
--  Run this in Supabase SQL Editor or via supabase db push
-- ============================================================

-- ── Enums ─────────────────────────────────────────────────────────────────────
CREATE TYPE user_role      AS ENUM ('admin', 'manager', 'staff');
CREATE TYPE payment_method AS ENUM ('cash', 'pos', 'unpaid');
CREATE TYPE report_status  AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE product_unit   AS ENUM ('piece','kg','litre','box','carton','bag','roll','pair','set','dozen');
CREATE TYPE expense_category AS ENUM ('transport','utilities','supplies','maintenance','other');

-- ── Branches ──────────────────────────────────────────────────────────────────
CREATE TABLE branches (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  location    TEXT,
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Warehouses ────────────────────────────────────────────────────────────────
CREATE TABLE warehouses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  location    TEXT,
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Users (custom auth — passwords hashed by bcrypt in Express) ───────────────
-- NOTE: We intentionally do NOT use Supabase Auth so that the existing
--       JWT/bcrypt flow in Express is preserved exactly.
CREATE TABLE users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL UNIQUE,
  password    TEXT NOT NULL,          -- bcrypt hash
  full_name   TEXT NOT NULL,
  phone       TEXT,
  role        user_role NOT NULL DEFAULT 'staff',
  branch_id   UUID REFERENCES branches(id) ON DELETE SET NULL,
  is_verified BOOLEAN NOT NULL DEFAULT false,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Products ──────────────────────────────────────────────────────────────────
CREATE TABLE products (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  sku            TEXT UNIQUE,
  description    TEXT,
  unit_price     NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  previous_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  current_price  NUMERIC(12,2) NOT NULL CHECK (current_price >= 0),
  unit           product_unit NOT NULL DEFAULT 'piece',
  category       TEXT,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Branch Stock ──────────────────────────────────────────────────────────────
CREATE TABLE branch_stock (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id  UUID NOT NULL REFERENCES branches(id)  ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity   NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (branch_id, product_id)
);

-- ── Warehouse Stock ───────────────────────────────────────────────────────────
CREATE TABLE warehouse_stock (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  product_id   UUID NOT NULL REFERENCES products(id)   ON DELETE CASCADE,
  quantity     NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (warehouse_id, product_id)
);

-- ── Sales ─────────────────────────────────────────────────────────────────────
CREATE TABLE sales (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id       UUID NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  staff_id        UUID NOT NULL REFERENCES users(id)    ON DELETE RESTRICT,
  staff_name      TEXT NOT NULL,
  customer_name   TEXT,
  customer_phone  TEXT,
  payment_method  payment_method NOT NULL,
  total_amount    NUMERIC(12,2) NOT NULL CHECK (total_amount >= 0),
  notes           TEXT,
  sale_date       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sale line items stored as JSONB for flexibility (mirrors Mongoose embedded array)
-- Schema per element: { product_id, product_name, quantity, unit_price, subtotal }
ALTER TABLE sales ADD COLUMN items JSONB NOT NULL DEFAULT '[]';

-- ── Debtors ───────────────────────────────────────────────────────────────────
CREATE TABLE debtors (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id        UUID NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  name             TEXT NOT NULL,
  phone            TEXT NOT NULL,
  amount_owed      NUMERIC(12,2) NOT NULL CHECK (amount_owed >= 0),
  created_by       UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_by_name  TEXT NOT NULL,
  sale_id          UUID REFERENCES sales(id) ON DELETE SET NULL,
  is_cleared       BOOLEAN NOT NULL DEFAULT false,
  cleared_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  cleared_by_name  TEXT,
  cleared_at       TIMESTAMPTZ,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Expenses ──────────────────────────────────────────────────────────────────
CREATE TABLE expenses (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id        UUID NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  description      TEXT NOT NULL,
  amount           NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  category         expense_category NOT NULL DEFAULT 'other',
  recorded_by      UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recorded_by_name TEXT NOT NULL,
  expense_date     TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Daily Reports ─────────────────────────────────────────────────────────────
CREATE TABLE daily_reports (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id           UUID NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  submitted_by        UUID NOT NULL REFERENCES users(id)    ON DELETE RESTRICT,
  submitted_by_name   TEXT NOT NULL,
  report_date         DATE NOT NULL,
  total_cash_sales    NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_pos_sales     NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_unpaid_sales  NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_sales         NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_expenses      NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_income          NUMERIC(12,2) NOT NULL DEFAULT 0,
  debtor_count        INT NOT NULL DEFAULT 0,
  total_debtor_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes               TEXT,
  status              report_status NOT NULL DEFAULT 'pending',
  reviewed_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by_name    TEXT,
  reviewed_at         TIMESTAMPTZ,
  review_notes        TEXT,
  -- Array of sale UUIDs linked to this report
  sale_ids            UUID[] NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (branch_id, report_date)
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX idx_sales_branch_date    ON sales(branch_id, sale_date DESC);
CREATE INDEX idx_sales_staff          ON sales(staff_id);
CREATE INDEX idx_sales_payment        ON sales(payment_method);
CREATE INDEX idx_debtors_branch       ON debtors(branch_id, is_cleared);
CREATE INDEX idx_expenses_branch_date ON expenses(branch_id, expense_date DESC);
CREATE INDEX idx_reports_branch_date  ON daily_reports(branch_id, report_date DESC);
CREATE INDEX idx_reports_status       ON daily_reports(status);
CREATE INDEX idx_products_active      ON products(is_active);
CREATE INDEX idx_users_email          ON users(email);

-- ── updated_at trigger (auto-maintains updated_at on every table) ─────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DO $$ DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'branches','warehouses','users','products',
    'branch_stock','warehouse_stock','sales',
    'debtors','expenses','daily_reports'
  ]) LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%I_updated_at
       BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
  END LOOP;
END $$;

-- ── Row Level Security (optional — enable if using Supabase client directly) ──
-- These are disabled by default because the app uses Express + custom JWT,
-- not the Supabase JS client.  Uncomment to enable if you switch to direct
-- Supabase client access in the future.
--
-- ALTER TABLE branches       ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE users          ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE products       ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE sales          ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE daily_reports  ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE debtors        ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE expenses       ENABLE ROW LEVEL SECURITY;
