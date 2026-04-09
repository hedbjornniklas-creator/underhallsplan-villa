# Access Implementation Plan

## Purpose
- Turn the target access model in `docs/ACCESS_MODEL.md` into an implementation plan that can be executed in the codebase.
- Ensure that RenoApp, Dashboard, and `hushub.se/admin` become separate systems with separate access checks.
- Provide future developers with a repeatable method for adding new products, modules, and login entries.

## Scope
This plan covers:
- shared identity
- separate product access
- separate module access
- explicit handling of `/admin`
- migration from current RenoApp and Dashboard access
- future expansion with more products and more links from `hushub.se`

This plan does not define detailed UI design. It defines data, sequence, and coding rules.

## Target products
The system must treat these as separate products:

| Product key | Route area | Notes |
|---|---|---|
| `renoapp` | `/renoapp/**` | BRF renovation workflow |
| `dashboard` | `/dashboard-v1`, `/ob`, `/inspections`, `/properties`, `/settings` | Property and inspection system |
| `hushub_admin` | `/admin/**` | Internal admin area, must get its own permission model |

Important:
- `/admin` must not inherit access from RenoApp or Dashboard.
- A user can have one, two, or all three product accesses.

## Current known state
Current codebase behavior, simplified:

- RenoApp:
  - already has product-specific membership logic through `brf_members`
  - server functions commonly use `requireRenoAppViewerContext()`

- Dashboard:
  - route shell mostly checks whether the user is logged in
  - product-specific access is not enforced consistently at the route level

- `/admin`:
  - currently appears tied to existing admin behavior and legacy assumptions
  - must be split into its own access domain under `hushub_admin`

This means the first job is not UI. The first job is access normalization.

## Implementation order
The work should be done in this exact order.

### Phase 1: Lock the route-to-product map
Define and document which route belongs to which product and module.

Deliverables:
- a single route map document or typed config
- route owners for every protected area

Minimum mapping:

| Route prefix | Product | Module |
|---|---|---|
| `/renoapp/app` | `renoapp` | `board_portal` |
| `/renoapp/app/cases` | `renoapp` | `board_portal` |
| `/renoapp/app/users` | `renoapp` | `board_portal` |
| `/renoapp/app/brf` | `renoapp` | `board_portal` |
| `/dashboard-v1` | `dashboard` | `home` |
| `/ob` | `dashboard` | `inspections` |
| `/inspections` | `dashboard` | `inspections` |
| `/properties` | `dashboard` | `inspections` or another chosen dashboard module |
| `/settings` | `dashboard` | `admin` or another chosen dashboard admin module |
| `/admin` | `hushub_admin` | `landing` |
| `/admin/besiktapp` | `hushub_admin` | `besiktapp_admin` |
| `/admin/renoapp` | `hushub_admin` | `renoapp_admin` |

Acceptance criteria:
- every protected route has a product and module owner
- `/admin` is explicitly placed under `hushub_admin`

### Phase 2: Add normalized access data
Implement the core access tables described in `docs/ACCESS_MODEL.md`.

Required tables:
- `platform_products`
- `platform_modules`
- `platform_roles`
- `platform_access_assignments`

Recommended initial seed:

Products:
- `renoapp`
- `dashboard`
- `hushub_admin`

Modules:
- `renoapp.board_portal`
- `renoapp.case_review`
- `renoapp.admin`
- `dashboard.home`
- `dashboard.inspections`
- `dashboard.maintenance_plan`
- `dashboard.reports`
- `dashboard.admin`
- `hushub_admin.landing`
- `hushub_admin.besiktapp_admin`
- `hushub_admin.renoapp_admin`
- `hushub_admin.access_management`

Roles:
- `renoapp.board_member`
- `renoapp.renoapp_admin`
- `renoapp.external_reviewer`
- `dashboard.inspector`
- `dashboard.dashboard_admin`
- `dashboard.maintenance_editor`
- `hushub_admin.hushub_superadmin`
- `hushub_admin.product_admin`

Acceptance criteria:
- schema exists
- product/module/role seeds exist
- data model supports both global and scoped access

### Phase 3: Create a shared access service in code
Create one shared service that answers:
- what products can this user access?
- what modules can this user access?
- in which scope?

Suggested service responsibilities:
- resolve active profile from session
- list assignments
- answer boolean checks such as:
  - `hasProductAccess(...)`
  - `hasModuleAccess(...)`
  - `hasScopedAccess(...)`

Suggested location:
- `src/lib/access/`

Important:
- do not let product code read access tables in five different ways
- all route guards should eventually use the same access service

Acceptance criteria:
- one shared access API exists in code
- both RenoApp and Dashboard can consume it

### Phase 4: Backfill current access into the new model
Map current business-specific access into the normalized access model.

Backfill sources:
- `brf_members` -> `renoapp`
- Dashboard org membership logic -> `dashboard`
- current admin model (`profiles.is_admin` or equivalent) -> `hushub_admin`

Important:
- keep current tables as business tables
- do not delete old access sources during the first migration
- normalized assignments become the new control plane

Acceptance criteria:
- existing RenoApp users get RenoApp assignments
- existing Dashboard users get Dashboard assignments
- existing `/admin` users get `hushub_admin` assignments

### Phase 5: Put `/admin` under its own access guard
This is a critical step and must happen before the new admin UI is expanded.

Goal:
- `/admin/**` checks `hushub_admin` access, not just session and not RenoApp/Dashboard rights

Rules:
- RenoApp users must not get `/admin` by default
- Dashboard users must not get `/admin` by default
- only users with explicit `hushub_admin` assignments may enter

Acceptance criteria:
- `/admin` access is denied without `hushub_admin`
- current admin users continue to work after backfill

### Phase 6: Replace RenoApp route guards
Refactor RenoApp guarded areas to require:
- active session
- active RenoApp product access
- correct RenoApp module access
- correct BRF or case scope where needed

Examples:
- `/renoapp/app` requires `renoapp.board_portal`
- future limited review route can require `renoapp.case_review`

Acceptance criteria:
- session alone does not unlock RenoApp
- non-RenoApp users are blocked cleanly

### Phase 7: Replace Dashboard route guards
Refactor Dashboard guarded areas to require:
- active session
- active Dashboard product access
- correct Dashboard module access
- correct organization or property scope where needed

Acceptance criteria:
- session alone does not unlock Dashboard
- RenoApp-only users are blocked from Dashboard

### Phase 8: Update login and entry behavior
After product guards exist, update the entry logic.

Recommended behavior:
- if the user has only one product, send them to that product's home
- if the user has multiple products, show a chooser
- if the user is authenticated but lacks access to a route, show a clear denied state

Do not:
- redirect users into unrelated products just because they have a session

Acceptance criteria:
- multi-product users get predictable entry behavior
- single-product users get a clean fast path

### Phase 9: Build the new admin user management page
Only now should the user/admin management UI be rebuilt or expanded.

Place it under:
- `/admin`
- most likely module `hushub_admin.access_management`

This page should manage:
- users
- product assignments
- module assignments
- roles
- scopes
- activation/deactivation

Minimum capabilities:
- view all users
- see which products each user can access
- grant/remove RenoApp access
- grant/remove Dashboard access
- grant/remove `hushub_admin` access
- assign scoped roles

Acceptance criteria:
- admin UI uses the normalized access model
- no new user management UI is built on legacy one-off rules

### Phase 10: Clean up legacy assumptions
After new guards and admin UI are stable:
- remove access assumptions based only on session
- reduce scattered uses of `profiles.is_admin`
- keep compatibility layers only where still needed for business flows

Acceptance criteria:
- one clear access path remains
- legacy fallback behavior is minimized and documented

## Ticket structure
Use these epics and tickets.

### Epic A: Access foundations
- A1. Document route-to-product/module mapping
- A2. Add normalized access tables
- A3. Seed products/modules/roles
- A4. Build shared access service

### Epic B: Migration and backfill
- B1. Backfill RenoApp users into normalized assignments
- B2. Backfill Dashboard users into normalized assignments
- B3. Backfill `/admin` users into `hushub_admin`
- B4. Verify dual-role users

### Epic C: Guard hardening
- C1. Protect `/admin` with `hushub_admin`
- C2. Protect RenoApp routes with normalized access
- C3. Protect Dashboard routes with normalized access
- C4. Add explicit denied states

### Epic D: Login and entry flow
- D1. Build access-aware product chooser
- D2. Update `/login`
- D3. Update `/renoapp/login`
- D4. Update `hushub.se` landing entry behavior where needed

### Epic E: Admin UI
- E1. Define admin modules and scopes
- E2. Build access management list view
- E3. Build grant/revoke flows
- E4. Build scope assignment flows
- E5. Audit logging for access changes

## Concrete coding rules
These rules are mandatory for future work.

### Rule 1
Never guard a product route with session only.

### Rule 2
Never assume that access to one product implies access to another.

### Rule 3
Never add new product access as a new boolean on `profiles`.

### Rule 4
Never add a new module without:
- product key
- module key
- role mapping
- route guard rule

### Rule 5
Every new login entry must answer these questions in documentation:
- which product does it enter?
- which module does it target?
- what access check is required?
- what should happen if the user has no access?
- what should happen if the user has multiple product accesses?

### Rule 6
Every new admin area must belong to `hushub_admin` or another explicitly modeled admin product. It must never piggyback on RenoApp or Dashboard access.

### Rule 7
Cross-product collaboration must be modeled as explicit assignments.

Example:
- a Dashboard inspector reviewing RenoApp case material must get a RenoApp reviewer assignment
- not generic board access

## How to add a new product in the future
When a new product or login is added, follow this checklist:

1. Add a product key to `platform_products`
2. Add module keys to `platform_modules`
3. Add product roles to `platform_roles`
4. Define valid scope types
5. Define route map entries
6. Add access guard logic using the shared access service
7. Update navigation so users only see links they can open
8. Update `docs/ACCESS_MODEL.md`
9. Update this plan or its successor if the rollout order changes

## How to add a new module in Dashboard or RenoApp
Use this checklist:

1. Define the module key
2. Decide which product it belongs to
3. Decide which roles can access it
4. Decide which scope type it uses
5. Add route guard mapping
6. Add navigation visibility rules
7. Add admin management support if assignments must be granted manually

## How to add a new login entry
Example: a future landing page link such as `Reports` or `External Review`.

Checklist:
1. Decide whether the route is public or protected
2. Map it to a product and module
3. Define which roles can access it
4. Define redirect behavior after authentication
5. Define denied-state behavior
6. Add it to the route map and shared access checks

## Recommended first implementation batch
If the work must be chunked into a first practical batch, do this first:

1. Add normalized access tables
2. Seed `renoapp`, `dashboard`, `hushub_admin`
3. Build shared access service
4. Backfill current RenoApp, Dashboard, and `/admin`
5. Put `/admin` behind `hushub_admin`
6. Put Dashboard behind Dashboard access
7. Keep RenoApp on current checks until the shared service is proven

This gives the biggest security and architecture win quickly.

## Definition of done
The migration is complete only when:
- RenoApp access is explicit
- Dashboard access is explicit
- `/admin` has its own explicit access
- session alone never unlocks any protected product area
- dual-role users work correctly
- users without assignments get denied states
- future modules can be added without new ad hoc auth logic
