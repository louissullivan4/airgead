-- ============================================================================
-- DESTRUCTIVE / DATA-DEPENDENT - do not run until db/schema.sql is committed.
-- Converts existing expenses.receipt_image_url values from full public GCS URLs
-- into bare object paths (e.g. "ids/abc.jpg"), matching the new storage scheme
-- in src/middlewares/imageUpload.js (Task 6).
--
-- NOTE: the GCS objects themselves remain PUBLIC until you run
-- scripts/lockdown-bucket.js manually. This migration only rewrites the DB.
-- ============================================================================
--
-- DRY RUN (run manually first; review what will change):
--   SELECT id, receipt_image_url,
--          regexp_replace(receipt_image_url, '^https?://storage\.googleapis\.com/[^/]+/', '') AS new_path
--   FROM expenses
--   WHERE receipt_image_url ~ '^https?://storage\.googleapis\.com/';

-- Up Migration
UPDATE expenses
SET receipt_image_url = regexp_replace(receipt_image_url, '^https?://storage\.googleapis\.com/[^/]+/', '')
WHERE receipt_image_url ~ '^https?://storage\.googleapis\.com/';

-- Down Migration
-- LOSSY: the original full URL included the bucket name, which is not stored in
-- the object path. To reverse, set GCS_BUCKET_NAME below to your bucket and run.
-- This only re-expands bare object paths (no scheme) back into public URLs.
-- Edit the bucket name before relying on this.
UPDATE expenses
SET receipt_image_url = 'https://storage.googleapis.com/REPLACE_WITH_BUCKET_NAME/' || receipt_image_url
WHERE receipt_image_url !~ '^https?://'
  AND receipt_image_url IS NOT NULL
  AND receipt_image_url <> '';
