-- ── Database Verification & Schema Migrations ──────────────────────────────────

-- Verify database connectivity (Simulating SELECT 1)
SELECT 1;

-- Add new columns to products table if they do not exist
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_cuttable boolean NOT NULL DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS unit_length_inches numeric;

-- Note: The admin seeding logic (seedAdmin()) typically handles data insertion 
-- and password hashing which is managed by your application script layer.