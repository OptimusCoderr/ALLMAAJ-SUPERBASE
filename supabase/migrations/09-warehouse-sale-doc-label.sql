-- Add optional custom document label to warehouse_sales.
-- doc_type stays as the layout selector (invoice vs waybill controls price display).
-- doc_label is the free-text title printed on the document header.
ALTER TABLE warehouse_sales
  ADD COLUMN IF NOT EXISTS doc_label TEXT;
