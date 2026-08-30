# Stage 2: Menu and Table Management

## Scope

Stage 2 adds the management foundation needed before order/cart/KOT work:

- category and menu-item management
- PKR-safe menu-item prices stored as integer minor units
- menu-item variants and sizes
- reusable modifier groups and modifiers/add-ons
- menu-item to modifier-group associations
- dining areas and restaurant tables
- persisted floor-layout positions and table shapes
- table status foundation: `AVAILABLE`, `OCCUPIED`, `RESERVED`, `CLEANING`, and `DISABLED`
- validation, role permissions, audit logging, tests, and a management UI

Stage 3 order, cart, KOT, and table-order workflow changes are intentionally not part of this implementation.

## Database

Migration `015_stage2_menu_tables.sql` follows the existing migrations `001` through `014`.
It extends the existing `categories`, `menu_items`, and `tables` tables in place to preserve
legacy records, adding timestamps, an integer `price_minor` mirror, active state, dining-area
assignment, status, and floor-layout fields. Existing decimal prices are converted to minor
PKR units during migration.

New tables:

- `menu_item_variants`
- `modifier_groups`
- `modifiers`
- `menu_item_modifier_groups`
- `dining_areas`
- `audit_logs`

Foreign keys, checks, indexes, and uniqueness constraints protect relationships and prevent
duplicate active table identifiers inside one dining area. Management operations deactivate
records instead of physically deleting menu items, modifiers, dining areas, or tables. This
keeps the schema ready for historical order references.

The migration creates a `Main Floor` area and assigns existing tables to it. It does not add
new production menu or order data.

## Backend architecture

`backend/src/services/stage2.ts` contains the application/service operations. Every operation
validates names, identifiers, prices, statuses, capacities, selection rules, and layout
bounds before touching SQLite. Stage 2 writes are authorized through the existing
`backend/src/services/authz.ts` role model and recorded in `audit_logs` through
`backend/src/services/audit.ts`.

`backend/src/ipc/stage2.ts` exposes the operations through the existing isolated Electron
preload bridge. Existing menu and table IPC endpoints remain available; their write paths now
use the Stage 2 permissions and legacy item/table deletes are soft deactivations.

### Permissions

The following permissions are available to the existing roles:

- `menu_viewing`, `menu_creation`, `menu_editing`, `menu_deactivation`
- `category_management`, `variant_management`, `modifier_management`
- `table_viewing`, `table_management`, `dining_area_management`
- `table_status_management`, `floor_layout_management`

Administrators and managers receive all Stage 2 permissions. Cashiers receive menu/table view
access. Waiters receive menu/table view plus table-status access. Kitchen users receive menu
and table view access only.

## Frontend

The existing Menu page keeps its core menu, scheduling, recipe, and category/item views. A
second **Variants & modifiers** view adds Stage 2 management for categories, items, variants,
modifier groups, modifiers, and associations, including search, active/inactive controls,
availability controls, and PKR display.

The Tables page now provides:

- dining-area management
- table identifiers, display names, capacities, statuses, shapes, and active state
- duplicate-safe table editing
- a draggable floor canvas with saved positions
- nudge controls for precise position changes
- explicit status controls without creating fake orders
- an existing-order-screen link for compatibility; no new order/cart logic is added

## Pakistanization safeguards

Stage 2 uses the existing `toMinorUnits`/`fromMinorUnits` money utilities and retains PKR as the
currency. It does not replace configurable tax fields, `Asia/Karachi`, Pakistanized receipt
settings, or payment provider code. JazzCash and Easypaisa remain environment-configured
adapters and are not represented as production-ready integrations without official merchant
configuration.

## Verification

Backend tests cover validation, migration schema/data conversion, uniqueness/foreign-key
protection, existing Pakistanization behavior, and role permissions. Frontend tests continue
to cover the existing UI test suite. TypeScript checks, lint, frontend build, backend build,
and migration verification should be run from the repository root or their respective
package directories.

Electron packaging depends on native `better-sqlite3` rebuilds. The package attempt in this
session ran both backend and frontend production builds successfully, then stopped with:

```text
sh: 1: electron-builder: not found
```

The dependency installation path also could not download the native rebuild prerequisites:
`better-sqlite3` could not verify its prebuild certificate and `node-gyp` could not download
Node 22 headers because the TLS connection reset; an offline `electron-builder` attempt also
reported a missing cached `ansi-regex` tarball. No installer was generated or treated as
production-ready.
