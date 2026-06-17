-- ============================================================
--  STEP 1: WIPE EVERYTHING
-- ============================================================
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO public;

-- ============================================================
--  STEP 2: ENUMS
-- ============================================================
CREATE TYPE user_role            AS ENUM ('admin', 'manager', 'staff');
CREATE TYPE payment_method       AS ENUM ('cash', 'pos', 'unpaid', 'part');
CREATE TYPE report_status        AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE product_unit         AS ENUM ('piece','kg','litre','box','carton','bag','roll','pair','set','dozen');
CREATE TYPE expense_category     AS ENUM ('transport','utilities','supplies','maintenance','other');
CREATE TYPE stock_request_status AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE stock_source         AS ENUM ('warehouse', 'others');

-- ============================================================
--  STEP 3: TABLES
-- ============================================================

-- ── Branches ──────────────────────────────────────────────
CREATE TABLE branches (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  location    TEXT,
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Warehouses ────────────────────────────────────────────
CREATE TABLE warehouses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  location    TEXT,
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Users (custom Express/bcrypt auth — NOT Supabase Auth) ─
CREATE TABLE users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL UNIQUE,
  password    TEXT NOT NULL,
  full_name   TEXT NOT NULL,
  phone       TEXT,
  role        user_role NOT NULL DEFAULT 'staff',
  branch_id   UUID REFERENCES branches(id) ON DELETE SET NULL,
  is_verified BOOLEAN NOT NULL DEFAULT false,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Products ──────────────────────────────────────────────
CREATE TABLE products (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  sku            TEXT UNIQUE,
  description    TEXT,
  unit_price     NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  previous_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  current_price  NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (current_price >= 0),
  unit           product_unit NOT NULL DEFAULT 'piece',
  category       TEXT,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Branch Stock (composite PK — no separate id column) ───
CREATE TABLE branch_stock (
  branch_id  UUID NOT NULL REFERENCES branches(id)  ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id)  ON DELETE CASCADE,
  quantity   NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (branch_id, product_id)
);

-- ── Warehouse Stock (composite PK) ────────────────────────
CREATE TABLE warehouse_stock (
  warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  product_id   UUID NOT NULL REFERENCES products(id)   ON DELETE CASCADE,
  quantity     NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (warehouse_id, product_id)
);

-- ── Daily Reports (defined BEFORE sales so FK can reference it) ─
CREATE TABLE daily_reports (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id           UUID NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  submitted_by        UUID NOT NULL REFERENCES users(id)    ON DELETE RESTRICT,
  report_date         DATE NOT NULL,
  total_cash_sales    NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_pos_sales     NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_unpaid_sales  NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_sales         NUMERIC(12,2) GENERATED ALWAYS AS (
                        total_cash_sales + total_pos_sales + total_unpaid_sales
                      ) STORED,
  total_expenses      NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_income          NUMERIC(12,2) NOT NULL DEFAULT 0,
  debtor_count        INT NOT NULL DEFAULT 0,
  total_debtor_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes               TEXT,
  status              report_status NOT NULL DEFAULT 'pending',
  reviewed_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at         TIMESTAMPTZ,
  review_notes        TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (branch_id, report_date)
);

-- ── Sales ─────────────────────────────────────────────────
CREATE TABLE sales (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id      UUID NOT NULL REFERENCES branches(id)      ON DELETE RESTRICT,
  staff_id       UUID NOT NULL REFERENCES users(id)         ON DELETE RESTRICT,
  staff_name     TEXT NOT NULL,
  customer_name  TEXT,
  customer_phone TEXT,
  payment_method payment_method NOT NULL,
  total_amount   NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  amount_paid    NUMERIC(12,2) NOT NULL DEFAULT 0,
  balance_due    NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes          TEXT,
  items          JSONB NOT NULL DEFAULT '[]',
  sale_date      TIMESTAMPTZ NOT NULL DEFAULT now(),
  report_id      UUID REFERENCES daily_reports(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Debtors ───────────────────────────────────────────────
-- created_by_name / cleared_by_name are NOT stored here;
-- they are resolved via JOIN users in every query.
CREATE TABLE debtors (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id   UUID NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  name        TEXT NOT NULL,
  phone       TEXT NOT NULL,
  amount_owed NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (amount_owed >= 0),
  created_by  UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  sale_id     UUID REFERENCES sales(id) ON DELETE SET NULL,
  is_cleared  BOOLEAN NOT NULL DEFAULT false,
  cleared_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  cleared_at  TIMESTAMPTZ,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Expenses ──────────────────────────────────────────────
-- recorded_by_name is resolved via JOIN users in every query.
CREATE TABLE expenses (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id    UUID NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  description  TEXT NOT NULL,
  amount       NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  category     expense_category NOT NULL DEFAULT 'other',
  recorded_by  UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  expense_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Stock Requests ────────────────────────────────────────
CREATE TABLE stock_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id         UUID NOT NULL REFERENCES branches(id)   ON DELETE RESTRICT,
  product_id        UUID NOT NULL REFERENCES products(id)   ON DELETE RESTRICT,
  quantity          NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  requested_by      UUID NOT NULL REFERENCES users(id)      ON DELETE RESTRICT,
  requested_by_name TEXT NOT NULL,
  notes             TEXT,
  status            stock_request_status NOT NULL DEFAULT 'pending',
  source_type       stock_source,
  warehouse_id      UUID REFERENCES warehouses(id) ON DELETE SET NULL,
  approved_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_by_name  TEXT,
  approved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
--  STEP 4: INDEXES
-- ============================================================
CREATE INDEX idx_users_email           ON users(email);
CREATE INDEX idx_products_active       ON products(is_active);
CREATE INDEX idx_sales_branch_date     ON sales(branch_id, sale_date DESC);
CREATE INDEX idx_sales_staff           ON sales(staff_id);
CREATE INDEX idx_sales_payment         ON sales(payment_method);
CREATE INDEX idx_sales_report          ON sales(report_id);
CREATE INDEX idx_debtors_branch        ON debtors(branch_id, is_cleared);
CREATE INDEX idx_debtors_sale          ON debtors(sale_id);
CREATE INDEX idx_expenses_branch_date  ON expenses(branch_id, expense_date DESC);
CREATE INDEX idx_reports_branch_date   ON daily_reports(branch_id, report_date DESC);
CREATE INDEX idx_reports_status        ON daily_reports(status);
CREATE INDEX idx_stock_req_branch      ON stock_requests(branch_id, status);

-- ============================================================
--  STEP 5: auto updated_at TRIGGER
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$ DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'branches', 'warehouses', 'users', 'products',
    'branch_stock', 'warehouse_stock', 'sales',
    'debtors', 'daily_reports', 'stock_requests'
  ]) LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%I_updated_at
       BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
  END LOOP;
END $$;

-- ============================================================
--  STEP 6: SEED — first admin user
--  Password is: Admin1234  (bcrypt hash below)
--  CHANGE THIS PASSWORD immediately after first login.
-- ============================================================
INSERT INTO users (email, password, full_name, role, is_verified, is_active)
VALUES (
  'admin@allmaaj.com',
  '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
  'System Admin',
  'admin',
  true,
  true
);