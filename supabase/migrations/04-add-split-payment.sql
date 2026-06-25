-- Add 'split' payment method for cash+POS combined payments
ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'split';

-- Store the individual cash and POS amounts for split payments
ALTER TABLE sales ADD COLUMN IF NOT EXISTS cash_amount NUMERIC(12,2);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS pos_amount  NUMERIC(12,2);
