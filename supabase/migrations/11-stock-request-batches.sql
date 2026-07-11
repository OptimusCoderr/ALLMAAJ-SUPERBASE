-- Group multiple product line-items (each still a row in stock_requests)
-- into a single batch so staff can request/transfer several products at
-- once and admins approve or reject the whole batch in one action.
ALTER TABLE stock_requests
  ADD COLUMN IF NOT EXISTS batch_id UUID NOT NULL DEFAULT gen_random_uuid();

CREATE INDEX IF NOT EXISTS idx_stock_req_batch ON stock_requests(batch_id);
