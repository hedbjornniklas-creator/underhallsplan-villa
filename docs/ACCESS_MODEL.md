# Access Model for HusHub, RenoApp and Future Modules

## Purpose
- Define a long-term access model that supports multiple products, multiple modules, and multiple login entry points.
- Keep RenoApp and Dashboard as separate systems even when the same person uses the same email address in both.
- Make future expansion predictable so new products, modules, and logins can be added without redesigning access from scratch.

## Core principles
- Identity is shared. A person can have one account and one email address.
- Access is separate. Being able to log in does not automatically give access to every product.
- Products are separate. `renoapp` and `dashboard` must each validate access independently.
- Modules are separate. Access inside a product must be granted per module, not only per product.
- Scope matters. Access can apply to a BRF, an organization, a property, a case, or another business object.
- Integrations must be explicit. Future cross-product workflows must grant specific rights, not implicit full access.

## Terms
- `Identity`: the authenticated user, usually backed by `profiles` and Supabase Auth.
- `Product`: a top-level application such as RenoApp or Dashboard.
- `Module`: a sub-area inside a product, such as RenoApp cases or Dashboard inspections.
- `Role`: the business role inside a scope, such as board member or inspector.
- `Assignment`: the row that grants a user access to a product/module/role within a specific scope.
- `Scope`: the object the access belongs to, such as BRF, organization, property, or case.

## Product model
Current and expected products:

| Product key | Meaning |
|---|---|
| `renoapp` | BRF renovation application and decision flow |
| `dashboard` | Property, inspection, and operational modules |
| `hushub_admin` | Internal HusHub admin area under `/admin` |

Future products can be added in the same model without changing the principles above.

## Module model
Modules live under a product. Examples:

| Product | Module key | Meaning |
|---|---|---|
| `renoapp` | `board_portal` | Board workspace and case handling |
| `renoapp` | `case_review` | Review access to cases and documents |
| `renoapp` | `admin` | RenoApp admin settings |
| `dashboard` | `home` | Dashboard start page |
| `dashboard` | `inspections` | Inspection workflow |
| `dashboard` | `maintenance_plan` | Maintenance planning |
| `dashboard` | `reports` | Reports and exports |
| `dashboard` | `admin` | Dashboard administration |
| `hushub_admin` | `landing` | Admin landing page under `/admin` |
| `hushub_admin` | `besiktapp_admin` | Admin for BesiktApp settings and data |
| `hushub_admin` | `renoapp_admin` | Admin for RenoApp settings and data |
| `hushub_admin` | `access_management` | Future user and entitlement administration |

Important:
- A user can have access to one module without having access to all modules in the same product.
- New modules must be added as data, not as hardcoded booleans on the profile.

## Role model
Roles describe what the user is inside a specific scope.

Suggested standard roles:

| Product | Role key | Meaning |
|---|---|---|
| `renoapp` | `board_member` | Normal board member in a BRF |
| `renoapp` | `renoapp_admin` | BRF-level admin for RenoApp |
| `renoapp` | `external_reviewer` | Limited reviewer for specific cases |
| `dashboard` | `inspector` | Normal dashboard user for inspections |
| `dashboard` | `dashboard_admin` | Admin inside dashboard modules |
| `dashboard` | `maintenance_editor` | Editor for maintenance plan module |
| `hushub_admin` | `hushub_superadmin` | Full internal HusHub admin access |
| `hushub_admin` | `product_admin` | Internal admin for one or more admin modules |

Rules:
- Roles are product-specific unless explicitly shared by design.
- Never assume that `board_member` means anything inside Dashboard.
- Never assume that `inspector` means anything inside RenoApp.

## Scope model
Access assignments must be scoped. The same user may have different roles in different scopes.

Suggested standard scope types:

| Scope type | Example |
|---|---|
| `global` | Platform-level admin or internal staff |
| `brf` | One BRF in RenoApp |
| `organization` | One Dashboard organization |
| `property` | One property inside Dashboard |
| `case` | One RenoApp case |

Examples:
- `Admin` -> product entry for internal HusHub admin
- A board member gets access to `renoapp.board_portal` within `scope_type = brf`.
- An inspector gets access to `dashboard.inspections` within `scope_type = organization`.
- A future external reviewer gets access to `renoapp.case_review` within `scope_type = case`.

## Recommended data model
The target model should separate identity from access.

### 1. Identities
Use the existing user identity tables as the source of truth for who the user is.

Existing:
- `profiles`
- Supabase Auth user

### 2. Products
Suggested table: `platform_products`

Columns:
- `id`
- `key` unique, example `renoapp`
- `label`
- `is_active`
- `sort_order`
- `created_at`

### 3. Modules
Suggested table: `platform_modules`

Columns:
- `id`
- `product_id` -> `platform_products.id`
- `key` unique within product, example `inspections`
- `label`
- `is_active`
- `sort_order`
- `created_at`

Constraint:
- unique `(product_id, key)`

### 4. Roles
Suggested table: `platform_roles`

Columns:
- `id`
- `product_id` -> `platform_products.id`
- `key`
- `label`
- `description`
- `is_active`
- `created_at`

Constraint:
- unique `(product_id, key)`

### 5. Access assignments
Suggested table: `platform_access_assignments`

This is the central entitlement table.

Columns:
- `id`
- `profile_id` -> `profiles.id`
- `product_id` -> `platform_products.id`
- `module_id` -> `platform_modules.id`, nullable if access applies to all modules in the product
- `role_id` -> `platform_roles.id`
- `scope_type` text, example `brf`, `organization`, `property`, `case`, `global`
- `scope_id` uuid or text depending on scope model
- `is_active` boolean
- `granted_by_profile_id` nullable
- `granted_reason` nullable
- `created_at`
- `updated_at`
- `expires_at` nullable

Recommended constraints:
- unique `(profile_id, product_id, module_id, role_id, scope_type, scope_id)`
- check that `module_id` belongs to the same `product_id`
- check that `role_id` belongs to the same `product_id`

### 6. Optional route mapping
Suggested table: `platform_route_access`

Purpose:
- maps route prefixes to required product/module combinations
- avoids scattering access rules through the codebase

Columns:
- `id`
- `product_id`
- `module_id` nullable
- `route_prefix`, example `/renoapp/app/cases`
- `label`
- `is_active`

This table is optional at first. The code can start with a typed config object, then move to data later.

## How current systems should map into the target model
Current RenoApp access:
- `brf_members` is effectively a RenoApp access table today.
- It should be treated as a legacy source for `renoapp` entitlements until a unified model is in place.

Current Dashboard access:
- Dashboard currently appears to rely mostly on logged-in session plus existing product-specific membership logic.
- This must be replaced or wrapped by explicit Dashboard entitlements.

Target mapping:
- `brf_members` -> equivalent to `platform_access_assignments` for `product = renoapp`, `scope_type = brf`
- Dashboard organization membership table -> equivalent to `platform_access_assignments` for `product = dashboard`, `scope_type = organization`
- Current `/admin` access -> equivalent to `platform_access_assignments` for `product = hushub_admin`, usually `scope_type = global`

Important:
- Do not merge `brf_members` and Dashboard memberships into one business table.
- If a unified access table is introduced, product-specific business tables should remain business tables, not become the only access model.

## Authorization logic
Every protected product route must follow the same pattern:

1. Validate session
- user must be authenticated

2. Resolve identity
- load `profile_id`

3. Resolve access
- check whether the user has an active assignment for the requested `product`
- check module access if the route belongs to a specific module
- check scope access if the route is scoped to BRF, organization, property, or case

4. Deny safely
- if the user lacks access, show a clear `du saknar åtkomst` state
- do not silently send the user into another product

### Example decisions
- RenoApp board user:
  - has `renoapp.board_portal` in one BRF
  - does not automatically get Dashboard access

- Dashboard inspector:
  - has `dashboard.inspections` in one organization
  - does not automatically get RenoApp access

- Dual-role user:
  - can have assignments in both products
  - each route still validates independently

- Future external reviewer:
  - can get `renoapp.case_review` for one case
  - should not get full board portal access

## Login model
Recommended approach:
- one shared authentication provider
- separate authorization checks per product

This means:
- same email can exist in both products
- same session can be reused
- access is still separated

Do not build separate identity silos unless there is a legal or security reason to do so.

## Landing page and future entry points
`hushub.se` will likely get more entry points over time. The landing page must not assume only two static systems forever.

Recommended approach:
- each entry point represents a product or a module entry
- each entry point has its own access rule
- public routes stay public
- protected routes must validate product/module access after session check

Examples:
- `Starta RenoApp` -> product entry for RenoApp
- `Gå till Dashboard` -> product entry for Dashboard
- future entry: `Rapporter`
- future entry: `Extern granskning`

The landing page should remain a navigation layer, not a source of truth for authorization.

## Rules for future coding
These rules should be followed whenever new products, modules, or logins are added.

### Rule 1: Never gate a product only by session
Bad:
- “if logged in, allow Dashboard”

Good:
- “if logged in and has active Dashboard assignment, allow Dashboard”

### Rule 2: Never reuse another product's role by assumption
Bad:
- “board_member can open dashboard because they are logged in”

Good:
- create an explicit Dashboard role or assignment

### Rule 3: New products must be added as data
When a new product is added:
- add a product key
- define modules
- define roles
- define route guard rules
- define scope types

Do not add new product access as standalone booleans on `profiles`.

### Rule 4: New modules must be independently grantable
If Dashboard gets a new module:
- do not assume all Dashboard users should see it
- create a module key
- decide which roles can access it
- add or update route guards

### Rule 5: Cross-product integration must use explicit limited assignments
If Dashboard users later need to review RenoApp material:
- create a dedicated RenoApp reviewer module or role
- scope it to case or BRF as needed
- log who granted it and why

Do not grant generic RenoApp board access to all inspectors.

### Rule 6: Menus must reflect real access
Navigation should only show links the user can actually open.

Examples:
- a RenoApp-only user should not see Dashboard module links
- a Dashboard-only user should not see RenoApp board links
- a dual-role user can see both

### Rule 7: “No access” should be explicit
If a user reaches a route without the right assignment:
- return 403 or equivalent denied state
- do not redirect to another product unless the product owner explicitly wants that

## Recommended implementation path
The system does not need to be fully rebuilt in one step.

### Phase 1: Formalize the model in code
- Keep current business tables.
- Add a shared access service in code that answers:
  - does user have RenoApp access?
  - does user have Dashboard access?
  - which modules can the user open?
- Refactor route guards to use that service.

### Phase 2: Introduce normalized product/module/role records
- Add `platform_products`
- Add `platform_modules`
- Add `platform_roles`
- Seed `renoapp`, `dashboard`, and `hushub_admin`

### Phase 3: Introduce unified access assignments
- Add `platform_access_assignments`
- Backfill from `brf_members`, Dashboard memberships, and current `/admin` access
- Keep backward compatibility during migration

### Phase 4: Route-level access configuration
- Move route access into shared config or table
- Remove scattered hardcoded checks where possible

## Concrete examples
### Example A: RenoApp board member
- identity: `profile = Anna`
- assignment:
  - `product = renoapp`
  - `module = board_portal`
  - `role = board_member`
  - `scope_type = brf`
  - `scope_id = BRF-123`

Result:
- Anna can open `/renoapp/app`
- Anna cannot open `/dashboard-v1` unless she also has Dashboard assignment

### Example B: Inspector
- identity: `profile = Niklas`
- assignment:
  - `product = dashboard`
  - `module = inspections`
  - `role = inspector`
  - `scope_type = organization`
  - `scope_id = ORG-45`

Result:
- Niklas can open inspection pages
- Niklas cannot open RenoApp board routes unless separately granted

### Example C: Future case reviewer
- identity: `profile = Eva`
- assignment:
  - `product = renoapp`
  - `module = case_review`
  - `role = external_reviewer`
  - `scope_type = case`
  - `scope_id = CASE-999`

Result:
- Eva can view and review one case
- Eva cannot administer BRF settings
- Eva does not become a general RenoApp board user

## What to document whenever a new login is added
Every new login or entry point must document:
- which product it belongs to
- which modules it opens
- which roles are valid
- which scope types it needs
- which route guard checks are required
- whether it is public or protected
- what should happen on missing access

This must be documented before the implementation is considered complete.

## Summary
The long-term model is:
- shared identity
- separate product access
- separate module access
- separate scoped roles
- explicit cross-product integration

That is the model that will support:
- RenoApp board users
- Dashboard inspectors
- rare dual-role users
- future modules in Dashboard
- future new product links on `hushub.se`
- future controlled collaboration between RenoApp and Dashboard
