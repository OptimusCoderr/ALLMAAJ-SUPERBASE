
/*
  # Add Product Pricing History Fields

  ## Overview
  Adds previous_price and current_price fields to the products table
  to track pricing history. The unit_price becomes the selling price
  while current_price and previous_price track price changes.

  ## Changes
  1. `products` table
    - Add `previous_price` (numeric) - stores the previous price before update
    - Add `current_price` (numeric) - stores the current active price
    - `unit_price` remains as the default selling price at POS

  2. Security
    - RLS already enabled, policies unchanged
*/

ALTER TABLE products 
ADD COLUMN IF NOT EXISTS previous_price numeric(12,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS current_price numeric(12,2) DEFAULT 0;

-- Update existing products to set current_price equal to unit_price where it's 0
UPDATE products 
SET current_price = unit_price, previous_price = unit_price 
WHERE current_price = 0 OR current_price IS NULL;


