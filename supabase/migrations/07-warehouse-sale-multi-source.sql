-- Add per-item source warehouse, external source support
ALTER TABLE warehouse_sale_items
  ADD COLUMN IF NOT EXISTS source_warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_external         BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS external_source     TEXT;

-- Make warehouse_id on the sale nullable (multi-source sales may not have one primary warehouse)
ALTER TABLE warehouse_sales ALTER COLUMN warehouse_id DROP NOT NULL;
