-- Bills: integer minor-unit discount column.
--
-- Every other money field on `bills` was converted to integer paise by
-- migration 014 (taxable_amount_minor, tax_amount_minor, service_charge_minor,
-- delivery_charge_minor, total_amount_minor), but the discount was left as the
-- legacy REAL rupee column `discount_amount`. The sales report already queries
-- `discount_amount_minor`, so that report failed at runtime with
-- "no such column: discount_amount_minor".
--
-- This adds the missing column and backfills it from the legacy rupee value.
-- The legacy column is preserved for historical compatibility and is kept in
-- sync by the billing service.

ALTER TABLE bills ADD COLUMN discount_amount_minor INTEGER DEFAULT 0;

UPDATE bills
SET discount_amount_minor = CAST(ROUND(COALESCE(discount_amount, 0) * 100) AS INTEGER)
WHERE discount_amount_minor IS NULL OR discount_amount_minor = 0;
