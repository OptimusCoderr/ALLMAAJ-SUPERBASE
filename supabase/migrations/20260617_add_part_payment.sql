-- Add 'part' payment method to enum
ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'part';

-- Add amount_paid and balance_due to sales table
ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS amount_paid  NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS balance_due  NUMERIC(12,2) NOT NULL DEFAULT 0;


  