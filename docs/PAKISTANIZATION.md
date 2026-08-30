# Pakistanization

This document describes the Kitchen-POS adaptation for restaurants operating in Pakistan. It is not legal, tax, banking, or accounting advice. Restaurant owners must confirm tax/payment requirements with their advisers and official provider documentation.

## What changed from the India-oriented version

- Default country/currency is now Pakistan / PKR.
- Receipts use `Rs` formatting and no longer print GSTIN, CGST, SGST, or HSN by default.
- The legacy GST calculation module is retained as a compatibility shim, but new code uses a configurable tax service.
- Legacy GST/HSN columns are preserved for historical data; new tax snapshot columns were added instead of destructively deleting data.
- Payment methods are configuration/database driven with defaults: Cash, Card, JazzCash, Easypaisa, Bank Transfer, Other, and Customer Credit.
- UPI/complimentary legacy payment values are migrated to generic `other` in new payment rows.
- Default timezone is Asia/Karachi; restaurant city/province/address remain configurable.

## Pakistani restaurant configuration

Settings include restaurant name, address, city, province, phone, email, website, currency, timezone, receipt footer, invoice prefix, tax enabled/name/rate/mode, service charge, and delivery charge.

Defaults:

- Country: Pakistan
- Currency: PKR
- Currency symbol: Rs
- Locale: en-PK
- Time zone: Asia/Karachi
- Tax: disabled until configured

## Tax architecture

Tax is configurable and snapshot-based:

- Tax can be enabled or disabled.
- Tax name and rate are configurable.
- Exclusive and inclusive calculation modes are supported in the service layer.
- Rounding is performed using integer minor units to avoid floating-point total drift.
- Service charge and delivery charge are configurable.
- Each order item and bill stores the tax name/rate/mode used at creation time, so historical invoices do not change when current settings change.

Legacy GST fields (`cgst_rate`, `sgst_rate`, `hsn_code`, `cgst_amount`, `sgst_amount`) are retained for compatibility and migration history.

## Payment architecture

Payments include provider, method, amount, currency, transaction reference, provider reference, status, timestamps, failure reason, and metadata. Supported statuses are:

- PENDING
- AUTHORIZED
- PAID
- FAILED
- CANCELLED
- REFUNDED
- EXPIRED

A state-transition validator prevents invalid transitions such as FAILED -> PAID. Duplicate provider callbacks are protected by a unique `(provider, transaction_reference)` index when the transaction reference exists.

Provider abstractions are implemented for JazzCash and Easypaisa. The POS does not mark provider payments as PAID simply because a request was created; provider payments remain pending until verified through provider-supported status/callback flows.

## JazzCash setup requirements

No production endpoint, hash algorithm, or credential value is invented in this repository. The restaurant owner must obtain merchant/developer credentials from official JazzCash channels and configure:

- `JAZZCASH_MERCHANT_ID`
- `JAZZCASH_PASSWORD`
- `JAZZCASH_INTEGRITY_SALT`
- `JAZZCASH_API_URL`
- `JAZZCASH_MODE` (`sandbox` or `production`)

Merchant secrets are backend-only environment variables and must never be placed in React renderer code or committed to Git.

## Easypaisa setup requirements

No production endpoint, hash algorithm, or credential value is invented in this repository. The restaurant owner must obtain merchant/developer credentials from official Easypaisa channels and configure:

- `EASYPAISA_STORE_ID`
- `EASYPAISA_HASH_KEY`
- `EASYPAISA_API_URL`
- `EASYPAISA_MODE` (`sandbox` or `production`)

Secrets remain backend-only.

## QR payments

The payment schema and provider abstraction support future QR payload metadata. Displaying a QR code must keep the payment/order pending until the provider confirms payment. QR generation alone is never proof of payment.

## Database migration

Migration `014_pakistanization.sql`:

- Creates migration backup marker rows and copies `payments` and `staff` to legacy backup tables before recreating constrained tables.
- Recreates `payments` with provider/status/currency/reference metadata fields.
- Adds `payment_methods` seed rows.
- Recreates `staff` role checks to include Kitchen.
- Adds tax snapshot/minor-unit columns to menu items, order items, and bills.
- Preserves legacy GST fields.

Backups should still be taken through the app backup feature before running production migrations.

## Security notes

- `.env.example` contains placeholder variable names only.
- No real credentials are committed.
- Payment secrets are kept out of frontend/preload APIs.
- Payment status changes go through backend IPC and a state validator.
- Logs should not include merchant passwords, salts, card numbers, CVV, or sensitive metadata.
- The app does not store card PAN/CVV.

## Limitations

- JazzCash and Easypaisa adapters are safe skeletons until completed against current official provider specifications and tested with real merchant sandbox credentials.
- This customization does not certify tax compliance.
- Some legacy UI/model fields remain for backward compatibility and migration safety.

## Packaging known issue

Electron packaging currently fails because of a native dependency download/TLS issue. Production Windows installer generation remains pending.
