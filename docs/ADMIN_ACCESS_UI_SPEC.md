# Admin Access UI Specification

## Purpose
- Define the first implementation-ready UI specification for `hushub.se/admin/access`.
- Replace the current long card-per-user layout with a scalable user access admin.
- Keep the normalized access model in the database while simplifying the admin UI per product.

## Current product decisions
This specification follows the currently agreed product rules.

### RenoApp
- Keep the current role and scope model.
- Valid active roles in the UI:
  - `board_member`
  - `renoapp_admin`
- Access is scoped to BRF.
- The UI must support multiple RenoApp assignments for the same user when they belong to multiple BRFs.

### Dashboard
- Dashboard access is module-driven in the UI.
- All Dashboard users are treated as `inspector` in the first implementation.
- The UI must not expose a Dashboard role picker in the first implementation.
- Personal settings must be available to all Dashboard users as part of the product experience, not as a separate admin permission.

### HusHub Admin
- HusHub Admin is a global system-maintenance permission.
- The UI should treat it as on/off only.
- The UI must not expose module-level choices for HusHub Admin in the first implementation.

## Scope of the first build
The first build covers:
- a scalable user list
- product status per user
- product-specific edit dialogs
- basic user profile editing
- a simple user history placeholder or initial event list

The first build does not need:
- generic assignment editing for every product in one shared form
- bulk edit flows
- advanced audit tooling
- a fully generic role/module/scope matrix editor

## Page structure
Route:
- `/admin/access`

Page title:
- `Users and access`

Top controls:
- search input
- status filter: active, inactive, all
- product filter: RenoApp, Dashboard, HusHub Admin
- optional quick filter: users without product access
- primary action: `Add user`

## Main view
Use a compact table or dense list. Do not use one large card per user.

### Columns
- Name
- Email
- Status
- RenoApp
- Dashboard
- HusHub Admin
- Actions

### Row rules
- Clicking the user name opens the user dialog.
- Clicking a product cell opens the product-specific dialog for that user.
- Product cells must show a clear active or inactive state.
- The product cell is a summary, not the full editor.

### Product summary states
RenoApp:
- active if the user has at least one active `renoapp` assignment
- inactive if the user has no active `renoapp` assignments

Dashboard:
- active if the user has at least one active `dashboard` assignment
- inactive if the user has no active `dashboard` assignments

HusHub Admin:
- active if the user has active `hushub_admin` access
- inactive if the user has no active `hushub_admin` access

## Dialog model
Use separate dialogs for product access and user profile details.

### Dialog A: User details
Open trigger:
- click on the user name

Title:
- user full name

Layout:
- left menu
- right content area

Menu items:
- `User details`
- `User history`

#### User details tab
Fields:
- full name
- email
- active or inactive user status
- optional internal note

Actions:
- `Save`
- `Close`

#### User history tab
Initial version can show:
- access granted
- access removed
- profile updated
- active status changed
- timestamp
- actor if available

If no event backend exists yet:
- show a placeholder state with the intended sections
- keep the layout stable so the tab can be implemented later without redesign

### Dialog B: RenoApp access
Open trigger:
- click the RenoApp cell for a user

Title:
- `RenoApp for {user}`

Purpose:
- manage RenoApp assignments by BRF

Presentation:
- table or stacked rows
- one row per active or editable BRF assignment

Each row must support:
- BRF selector
- role selector
- active or inactive state
- optional comment
- optional expiration date

Allowed role values:
- `board_member`
- `renoapp_admin`

Important:
- this dialog must support multiple BRF assignments for the same user
- this dialog must not collapse all RenoApp access into one boolean

Primary actions:
- `Add BRF access`
- `Save`
- `Close`

### Dialog C: Dashboard access
Open trigger:
- click the Dashboard cell for a user

Title:
- `Dashboard for {user}`

Purpose:
- manage which Dashboard modules the user can access

Presentation:
- module list
- one row per currently active Dashboard module or available module

Each module row must support:
- active or inactive toggle
- optional organization selector if scope is required
- optional expiration date
- optional comment

Do not show in the first implementation:
- Dashboard role picker

Implementation rule:
- saving a Dashboard module creates or updates a normalized assignment with:
  - `product = dashboard`
  - `role = inspector`
  - selected module
  - organization scope where needed

Current module behavior:
- the UI should only expose modules that are relevant today
- if a Dashboard module is inactive in product configuration, do not show it here

Settings note:
- personal settings are not managed as a separate Dashboard admin permission in this UI
- they are part of the normal Dashboard user experience

Primary actions:
- `Save`
- `Close`

### Dialog D: HusHub Admin access
Open trigger:
- click the HusHub Admin cell for a user

Title:
- `HusHub Admin for {user}`

Purpose:
- manage exclusive internal system admin access

Presentation:
- one clear on or off control
- optional comment

Do not show in the first implementation:
- module list
- role selector
- scope selector

Implementation rule:
- turning access on should create or reactivate the required normalized `hushub_admin` assignments for the internal admin area
- turning access off should deactivate all active `hushub_admin` assignments for that user

The UI should feel like a single entitlement even if the underlying model still uses multiple assignments.

## Data mapping to the normalized access model

### RenoApp mapping
UI input:
- BRF
- role
- optional expiration
- optional comment

Normalized write shape:
- `product = renoapp`
- `module = board_portal`
- `role = board_member` or `renoapp_admin`
- `scope_type = brf`
- `scope_id = selected BRF`

### Dashboard mapping
UI input:
- module on or off
- organization scope if required
- optional expiration
- optional comment

Normalized write shape:
- `product = dashboard`
- `module = selected module`
- `role = inspector`
- `scope_type = organization`
- `scope_id = selected organization`

### HusHub Admin mapping
UI input:
- on or off
- optional comment

Normalized write shape:
- `product = hushub_admin`
- `role = hushub_superadmin`
- `scope_type = global`
- `scope_id = null`

Internal behavior:
- the implementation may create one assignment per required admin module
- the UI must still behave as a single on or off switch

## Recommended component structure

### Page-level
- `AccessManagementPage`
- `AccessUsersTable`
- `AccessToolbar`

### User dialogs
- `UserDetailsDialog`
- `UserHistoryPanel`

### Product dialogs
- `RenoAppAccessDialog`
- `DashboardAccessDialog`
- `HushubAdminAccessDialog`

### Shared UI helpers
- `ProductAccessBadge`
- `AccessStatusCell`
- `ModuleToggleRow`
- `ScopedAssignmentRow`

## Recommended client state

### Page state
- search query
- active filters
- selected user id
- selected product dialog
- loading and saving states

### Dialog state
Each dialog should keep an isolated draft state so editing one product does not mutate the main list until save completes.

Examples:
- `renoAppDraftAssignments`
- `dashboardDraftModules`
- `hushubAdminDraftEnabled`
- `userProfileDraft`

## API expectations
The current normalized access API can remain the base, but the UI should consume a shaped response that is easier to render.

### Recommended response shape for the list page
Each user item should contain:
- profile id
- full name
- email
- user active status
- per-product summary:
  - `renoapp.active`
  - `renoapp.assignmentCount`
  - `dashboard.active`
  - `dashboard.activeModules`
  - `hushubAdmin.active`

### Recommended response shape for dialogs
RenoApp dialog:
- list of BRF assignments
- available BRFs
- allowed RenoApp roles

Dashboard dialog:
- list of available Dashboard modules
- list of active Dashboard assignments grouped by module
- available organizations if scope is required

HusHub Admin dialog:
- current enabled state
- optional comment

User details dialog:
- editable profile fields
- history entries or placeholder payload

## Interaction rules

### Search
Search must match:
- full name
- email

### Filters
Filters must support:
- active users
- inactive users
- users with RenoApp access
- users with Dashboard access
- users with HusHub Admin access
- users without any product access

### Save behavior
- saving a dialog updates only that dialog's domain
- after save, refresh the table row summary
- preserve scroll position in the main list

### Errors
- show inline errors inside the dialog
- do not drop unsaved draft changes silently

### Empty states
List empty:
- show `No users found`

No product access:
- show inactive product cells for all products

No history:
- show a stable placeholder, not a broken empty panel

## Visual direction
- dense and calm admin UI
- high information density without becoming noisy
- clear active/inactive product cells
- dialogs sized for real editing, not tiny popovers
- avoid large stacked cards in the main list

## First implementation checklist
- replace current card layout with a compact table
- add product summary cells
- add name-triggered user details dialog
- add RenoApp product dialog with BRF and role editing
- add Dashboard product dialog with module toggles only
- add HusHub Admin on or off dialog
- keep normalized access writes under the hood
- do not reintroduce generic `profiles.is_admin` rules

## Acceptance criteria
- the page remains usable with 200 users
- one screen gives a fast overview of product access per user
- RenoApp access can be managed per BRF
- Dashboard access can be managed by module without exposing unnecessary role complexity
- HusHub Admin can be granted and revoked as one exclusive entitlement
- user profile editing is separated from product access editing
- the UI maps cleanly onto the normalized access model already in the codebase
