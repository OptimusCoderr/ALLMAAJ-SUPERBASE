-- Track original sale total directly on debtor (no relying on linked sale)
ALTER TABLE debtors ADD COLUMN IF NOT EXISTS total_amount NUMERIC(12,2);

-- Optional payment deadline
ALTER TABLE debtors ADD COLUMN IF NOT EXISTS due_date DATE;

-- Instalment payment log
CREATE TABLE IF NOT EXISTS debtor_payments (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  debtor_id   UUID        NOT NULL REFERENCES debtors(id) ON DELETE CASCADE,
  amount      NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  method      TEXT        NOT NULL DEFAULT 'cash' CHECK (method IN ('cash','pos','transfer')),
  recorded_by UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  notes       TEXT,
  paid_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_debtor_payments_debtor ON debtor_payments(debtor_id);
