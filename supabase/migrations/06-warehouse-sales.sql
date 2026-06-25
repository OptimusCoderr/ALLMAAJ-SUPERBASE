-- Global invoice sequence (never resets, guarantees uniqueness)
CREATE SEQUENCE IF NOT EXISTS warehouse_invoice_seq START 1;

CREATE TABLE IF NOT EXISTS warehouse_sales (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number   TEXT        NOT NULL UNIQUE
                               DEFAULT ('WH-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('warehouse_invoice_seq')::TEXT, 4, '0')),
  warehouse_id     UUID        NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  created_by       UUID        NOT NULL REFERENCES users(id)      ON DELETE RESTRICT,
  customer_name    TEXT        NOT NULL,
  customer_phone   TEXT,
  customer_address TEXT,
  payment_method   TEXT        NOT NULL DEFAULT 'cash'
                               CHECK (payment_method IN ('cash','pos','transfer','credit')),
  total_amount     NUMERIC(12,2) NOT NULL,
  amount_paid      NUMERIC(12,2) NOT NULL DEFAULT 0,
  balance_due      NUMERIC(12,2) GENERATED ALWAYS AS (total_amount - amount_paid) STORED,
  doc_type         TEXT        NOT NULL DEFAULT 'invoice'
                               CHECK (doc_type IN ('invoice','waybill')),
  notes            TEXT,
  sale_date        DATE        NOT NULL DEFAULT CURRENT_DATE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS warehouse_sale_items (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id      UUID          NOT NULL REFERENCES warehouse_sales(id) ON DELETE CASCADE,
  product_id   UUID          REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT          NOT NULL,
  quantity     NUMERIC(12,4) NOT NULL CHECK (quantity > 0),
  unit_price   NUMERIC(12,2) NOT NULL,
  subtotal     NUMERIC(12,2) NOT NULL,
  unit         TEXT          NOT NULL DEFAULT 'pcs'
);

CREATE INDEX IF NOT EXISTS idx_wsi_sale        ON warehouse_sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_ws_warehouse_id ON warehouse_sales(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_ws_sale_date    ON warehouse_sales(sale_date);
CREATE INDEX IF NOT EXISTS idx_ws_created_by   ON warehouse_sales(created_by);
