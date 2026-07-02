-- Up Migration
--
-- Phase 2 / Camera-first capture: split receipts from expense line items so one
-- photographed receipt can produce MANY expense rows (1 receipt -> N expenses).
-- Previously `expenses.receipt_image_url` tied a single image to a single
-- expense. This migration is ADDITIVE, idempotent, and reversible. It does NOT
-- migrate or rewrite existing `expenses` rows - old rows keep working through
-- `receipt_image_url` (kept for backward compatibility) with a null `receipt_id`.
--
-- `receipts.image_object_path` stores the storage OBJECT KEY (e.g.
-- "org_<id>/2026/<receiptId>.png"), never a public URL - reads go through
-- short-lived signed URLs (see storage.js / signedUrl.js).
--
-- `parsed_data`/`ocr_confidence` are reserved for the future (currently dormant)
-- OCR auto-fill path and stay null while the user fills everything in manually.
-- `receipt_status` defaults to 'reviewed' for that manual flow; 'pending' is
-- reserved for the future OCR path where a receipt exists but isn't yet confirmed.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- provides gen_random_uuid()

CREATE TABLE IF NOT EXISTS receipts (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            uuid NOT NULL,
    image_object_path  text,
    parsed_data        jsonb,
    ocr_confidence     numeric,
    receipt_status     text NOT NULL DEFAULT 'reviewed',
    merchant_name      text,
    receipt_date       date,
    total_amount       numeric,
    tax_amount         numeric,
    currency           text,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Expense line items reference the receipt they were captured from. Nullable -
-- manual expenses with no photo (and all pre-existing rows) carry no receipt_id.
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS receipt_id uuid;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS merchant_name text;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS tax_amount numeric;

-- Constraints added separately (guarded) so re-runs are safe. receipts.user_id
-- references users(id) (uuid); expenses.receipt_id references receipts(id).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'receipts_user_id_fkey') THEN
        ALTER TABLE receipts
            ADD CONSTRAINT receipts_user_id_fkey
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'receipts_receipt_status_check') THEN
        ALTER TABLE receipts
            ADD CONSTRAINT receipts_receipt_status_check
            CHECK (receipt_status IN ('pending','reviewed','none'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_receipt_id_fkey') THEN
        ALTER TABLE expenses
            ADD CONSTRAINT expenses_receipt_id_fkey
            FOREIGN KEY (receipt_id) REFERENCES receipts(id) ON DELETE SET NULL;
    END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_expenses_receipt_id ON expenses(receipt_id);
CREATE INDEX IF NOT EXISTS idx_receipts_user_id ON receipts(user_id);

-- Down Migration
DROP INDEX IF EXISTS idx_receipts_user_id;
DROP INDEX IF EXISTS idx_expenses_receipt_id;

ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_receipt_id_fkey;

ALTER TABLE expenses DROP COLUMN IF EXISTS tax_amount;
ALTER TABLE expenses DROP COLUMN IF EXISTS merchant_name;
ALTER TABLE expenses DROP COLUMN IF EXISTS receipt_id;

DROP TABLE IF EXISTS receipts;
