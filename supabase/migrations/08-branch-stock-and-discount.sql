-- Allow warehouse sales items to be sourced from branch stock
ALTER TABLE warehouse_sale_items
  ADD COLUMN IF NOT EXISTS source_branch_id UUID REFERENCES branches(id) ON DELETE SET NULL;

-- Add sale-level optional discounted total (shown on invoice alongside normal total)
ALTER TABLE warehouse_sales
  ADD COLUMN IF NOT EXISTS discounted_total NUMERIC(12,2) NULL;
