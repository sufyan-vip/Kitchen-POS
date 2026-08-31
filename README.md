# Kitchen POS Pakistan

A modern, offline-first Restaurant POS for Pakistan-focused restaurant workflows, built with Electron, React, TypeScript, and SQLite.

> This project is a customization of the existing Kitchen-POS architecture. It was not rebuilt from scratch. Legacy Indian GST fields are preserved for historical compatibility, but the active billing flow now uses configurable Pakistan-oriented settings.

## Highlights

- Restaurant settings: name, logo-ready details, address, city, province, phone, email, website, currency, timezone, receipt footer, invoice prefix.
- Default country/currency/timezone: Pakistan, PKR (`Rs`), Asia/Karachi.
- Configurable tax architecture: tax enabled/disabled, tax name, rate, inclusive/exclusive mode in service layer, service charge, delivery charge, and historical tax snapshots.
- Payment methods: Cash, Card, JazzCash, Easypaisa, Bank Transfer, Other, and Customer Credit.
- Payment provider abstraction for JazzCash and Easypaisa without exposing secrets to frontend code.
- Receipt printing redesigned for Pakistan: no GSTIN/CGST/SGST/HSN unless specifically supported through legacy/configuration paths.
- Table management, KOT/KDS, inventory, staff, reports, backups, and Electron packaging retained.

## Important compliance note

This software does **not** claim automatic legal, tax, payment, or invoice compliance in Pakistan. Tax names/rates and payment-provider requirements vary by business, province, service model, and current law. Configure settings with a qualified adviser and official provider documentation.

## Development

```bash
npm install
npm install --prefix backend
npm install --prefix frontend
npm run build
npm run dev
```

## Testing and checks

```bash
npm test --prefix backend
npm test --prefix frontend
npm run lint --prefix backend
npm run lint --prefix frontend
npm run build
npm run package
```

Only claim a Windows installer/EXE is production-ready after packaging succeeds in the target environment.

## Configuration

Copy `.env.example` for local/backend environment configuration. Do not commit real secrets.

JazzCash placeholders:

- `JAZZCASH_MODE`
- `JAZZCASH_MERCHANT_ID`
- `JAZZCASH_PASSWORD`
- `JAZZCASH_INTEGRITY_SALT`
- `JAZZCASH_API_URL`

Easypaisa placeholders:

- `EASYPAISA_MODE`
- `EASYPAISA_STORE_ID`
- `EASYPAISA_HASH_KEY`
- `EASYPAISA_API_URL`

Merchant credentials must be obtained from official JazzCash/Easypaisa merchant/developer channels. The included adapters are safe skeletons until completed and tested against current official APIs.

## Documentation

- `ARCHITECTURE.md` — original architecture reference retained.
- `docs/PAKISTANIZATION.md` — details of Pakistanization changes, migrations, payment architecture, security notes, and limitations.

## Data safety

This is an existing application. Migration `014_pakistanization.sql` preserves legacy GST/HSN columns and creates backup copies of constrained staff/payment tables before recreating them. Use the built-in backup/export flow before applying migrations to production data.
