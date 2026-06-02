# TU multi-organization visitkort plan

Date: 2026-06-02

## Goal

Allow one logged-in inspector profile to work for multiple organizations in TU, with the correct company-specific business card, logo, signature and report metadata used in TU reports.

This plan is intentionally scoped to TU first. No behavior changes should be made in OB, EB or other modules unless explicitly requested later.

## Current foundation

- `organizations` and `org_members` already exist.
- A profile can be a member of multiple organizations.
- Assignments, TU details, TU images and TU documents are already scoped by `org_id`.
- RLS helpers such as `is_org_member(org_id)` and `is_org_admin(org_id)` already exist.
- Profile certifications and addon services are already stored per `org_id + profile_id`.
- Platform access already supports organization scope.

## Current gap

The inspector business card is currently stored globally on `profiles`, including company fields, logo and signature. That means the same inspector cannot reliably produce TU reports for different companies with different branding.

TU should instead resolve the inspector's report identity from the active TU organization.

## Recommended model

Keep one user/profile per person.

Use organizations for each company the inspector works for.

Add an organization-specific business card table, for example `profile_org_cards`, with one row per `org_id + profile_id`.

Suggested fields:

- `org_id`
- `profile_id`
- `display_name`
- `title`
- `phone`
- `email`
- `company_name`
- `company_orgno`
- `company_address`
- `company_postal_code`
- `company_city`
- `avatar_path`
- `logo_path`
- `signature_path`
- `report_footer_text`
- `created_at`
- `updated_at`

Use `profiles` as fallback when no organization-specific card exists.

## Implementation steps

1. Add a migration for `profile_org_cards`.
2. Add RLS so the inspector can manage their own card in organizations where they are a member, and org admins can manage cards in their organization.
3. Update TU server logic to resolve inspector profile data in this order:
   - `profile_org_cards` for current `org_id + profile_id`
   - fallback to `profiles`
4. Add a TU-specific settings page, for example `/tu/settings/profile`, for editing the active organization's business card.
5. Update the TU start page visitkort card to open the TU settings page.
6. Add a TU-only organization selector.
7. Freeze the resolved business card data into the TU report snapshot when the report is locked.
8. Keep locked reports immutable even if the inspector later changes organization card details.

## Later additions

- Organization invite flow for Dashboard/TU users.
- More organization roles if needed, for example external consultant or reviewer.
- Shared organization-level branding fields if several inspectors in the same company should inherit the same company logo and footer.

## Non-goals for first implementation

- Do not create separate user profiles per company.
- Do not change OB settings or OB report logic.
- Do not change global org context behavior for all modules.
- Do not change existing TU report content logic beyond resolving the correct inspector/card data.
