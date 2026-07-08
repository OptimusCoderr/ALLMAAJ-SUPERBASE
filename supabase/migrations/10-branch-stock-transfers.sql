-- Allow stock requests to be sourced from another branch (staff-initiated
-- transfer, still subject to admin approval like the existing warehouse/
-- others sources).
ALTER TYPE stock_source ADD VALUE IF NOT EXISTS 'branch';

-- The branch stock is being pulled FROM. NULL for the existing
-- warehouse/others request types; set at request time for transfers
-- (the requester picks which branch to draw from).
ALTER TABLE stock_requests
  ADD COLUMN IF NOT EXISTS from_branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT;

ALTER TABLE stock_requests
  ADD CONSTRAINT chk_stock_req_from_branch_diff CHECK (from_branch_id IS NULL OR from_branch_id <> branch_id);

CREATE INDEX IF NOT EXISTS idx_stock_req_from_branch ON stock_requests(from_branch_id, status);
