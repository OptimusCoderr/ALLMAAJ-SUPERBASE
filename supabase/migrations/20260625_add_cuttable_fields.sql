-- Add cuttable material support to products
-- is_cuttable: marks a product as a material sold by length
-- inches_per_piece: how many inches make one "piece" (used for conversion)

ALTER TABLE products
  ADD COLUMN is_cuttable     BOOLEAN        NOT NULL DEFAULT false,
  ADD COLUMN inches_per_piece NUMERIC(10,4)  NULL CHECK (inches_per_piece > 0);
