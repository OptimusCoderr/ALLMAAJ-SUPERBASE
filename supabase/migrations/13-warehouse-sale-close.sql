-- Allow a warehouse sale (invoice/waybill) to be permanently closed so it
-- can no longer be edited. Closing is only permitted once fully paid;
-- deletion remains available regardless of closed status.
ALTER TABLE warehouse_sales
  ADD COLUMN IF NOT EXISTS is_closed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
