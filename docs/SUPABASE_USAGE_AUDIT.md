# Supabase Usage Audit

## Summary

| Name | Type | Operations | Files |
| --- | --- | --- | --- |
| basic_fields | table | select,upsert | C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\buildings\[buildingsId]\page.tsx, C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\page.tsx |
| building_basic_values | table | delete,insert,select,update,upsert | C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\buildings\[buildingsId]\page.tsx, C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\page.tsx |
| building_disclosures | table | delete,insert,select,upsert | C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\buildings\[buildingsId]\page.tsx |
| building_media | table | delete,insert,select | C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\buildings\page.tsx |
| buildings | table | delete,insert,select,update,upsert | C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\buildings\[buildingsId]\page.tsx, C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\buildings\page.tsx, C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\page.tsx |
| component_types | table | delete,insert,select,update | C:\Users\hedbj\underhallsplan-villa\src\app\(app)\admin\AdminClient.tsx, C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\insida\page.tsx, C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\utsida\page.tsx |
| document_types | table | delete,insert,select,update | C:\Users\hedbj\underhallsplan-villa\src\app\(app)\admin\AdminClient.tsx, C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\handlingar-upplysningar\page.tsx, C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepHandlingar.tsx |
| inspection_conditions | table | delete,insert,select,update | C:\Users\hedbj\underhallsplan-villa\src\app\utlatande\[propertyId]\[inspectionId]\page.tsx, C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepForutsattningar.tsx |
| inspection_control_items | table | delete,insert,select,update | C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepInsida.tsx, C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepUtsida.tsx |
| inspection_disclosures | table | insert,select,update | C:\Users\hedbj\underhallsplan-villa\src\app\utlatande\[propertyId]\[inspectionId]\page.tsx, C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepHandlingar.tsx |
| inspection_documents | table | insert,select,update | C:\Users\hedbj\underhallsplan-villa\src\app\utlatande\[propertyId]\[inspectionId]\page.tsx, C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepHandlingar.tsx |
| inspection_exterior_observations | table | delete,insert,select,update | C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepUtsida.tsx |
| inspection_images | table | delete,insert,select,update | C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepInsida.tsx, C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepUtsida.tsx |
| inspection_interior_rooms | table | delete,insert,select,update | C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepInsida.tsx |
| inspection_overview_selections | table | delete,insert,select,update | C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\forutsattningar\page.tsx, C:\Users\hedbj\underhallsplan-villa\src\app\utlatande\[propertyId]\[inspectionId]\page.tsx, C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepForutsattningar.tsx, C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepInsida.tsx |
| inspections | table | delete,insert,select,update | C:\Users\hedbj\underhallsplan-villa\src\app\(app)\inspections\page.tsx, C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\ob\[inspectionId]\page.tsx, C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\ob\page.tsx, C:\Users\hedbj\underhallsplan-villa\src\app\utlatande\[propertyId]\[inspectionId]\page.tsx, C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepGrunddata.tsx, C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepHandlingar.tsx |
| profiles | table | select,update | C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\page.tsx, C:\Users\hedbj\underhallsplan-villa\src\app\utlatande\[propertyId]\[inspectionId]\page.tsx, C:\Users\hedbj\underhallsplan-villa\src\hooks\useProfile.ts |
| properties | table | delete,insert,select,update | C:\Users\hedbj\underhallsplan-villa\src\app\(app)\inspections\page.tsx, C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\ob\[inspectionId]\page.tsx, C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\ob\page.tsx, C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\page.tsx, C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\page.tsx, C:\Users\hedbj\underhallsplan-villa\src\app\utlatande\[propertyId]\[inspectionId]\page.tsx, C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepGrunddata.tsx |
| property-media | table | delete,insert,select,update | C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\buildings\page.tsx, C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\page.tsx, C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\page.tsx |
| settings_control_point_outcomes | table | select | C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepUtsida.tsx |
| settings_control_points | table | insert,select,update | C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\ob-control-points\page.tsx, C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepInsida.tsx, C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepUtsida.tsx |
| settings_exterior_groups | table | delete,insert,select,update | C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\ob-utsida\page.tsx, C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepUtsida.tsx |
| settings_exterior_items | table | delete,insert,select,update | C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\ob-control-points\page.tsx, C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\ob-utsida\page.tsx, C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepUtsida.tsx |
| settings_exterior_options | table | delete,insert,select,update | C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\ob-utsida\page.tsx, C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepUtsida.tsx |
| settings_interior_groups | table | delete,insert,select,update | C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\ob-insida\page.tsx, C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepInsida.tsx |
| settings_interior_options | table | delete,insert,select,update | C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\ob-insida\page.tsx, C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepInsida.tsx |
| settings_interior_room_types | table | delete,insert,select,update | C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\ob-control-points\page.tsx, C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\ob-insida\page.tsx, C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepInsida.tsx |
| settings_overview_groups | table | delete,insert,select,update | C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\forutsattningar\page.tsx, C:\Users\hedbj\underhallsplan-villa\src\app\utlatande\[propertyId]\[inspectionId]\page.tsx, C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepForutsattningar.tsx |
| settings_overview_items | table | delete,insert,select,update | C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\forutsattningar\page.tsx, C:\Users\hedbj\underhallsplan-villa\src\app\utlatande\[propertyId]\[inspectionId]\page.tsx, C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepForutsattningar.tsx, C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepInsida.tsx |
| settings_overview_options | table | delete,insert,select,update | C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\forutsattningar\page.tsx, C:\Users\hedbj\underhallsplan-villa\src\app\utlatande\[propertyId]\[inspectionId]\page.tsx, C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepForutsattningar.tsx |
| spaces | table | insert | C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\page.tsx |
| property-media | bucket | createSignedUrl,delete,eq,error,getPublicUrl,insert,map,now,order,pop,preventDefault,push,randomUUID,remove,select,split,toLowerCase,update,upload | C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\buildings\page.tsx, C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\page.tsx |

## Details

### Tables

#### basic_fields

- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\buildings\[buildingsId]\page.tsx:88
  - operation: select, select, upsert, select
  - select: 'id, key, label, field_type, options, field_group, is_critical, order_index'; 'id, field_id, value_text'; 'id, field_id, value_text'
  - filters: eq('is_active', true); eq('building_id', buildingId)
  - order: order('field_group', { ascending: true }); order('order_index', { ascending: true })
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: upsert: payload=payload
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\page.tsx:120
  - operation: select, select
  - select: 'id,key,label'; 'building_id,field_id,value_text'
  - filters: in('key', [...BUILDING_SUMMARY_KEYS]); eq('is_active', true); in('building_id', buildingIds); in('field_id', fieldIds)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: (none)

#### building_basic_values

- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\buildings\[buildingsId]\page.tsx:105
  - operation: select, upsert, select, insert, select
  - select: 'id, field_id, value_text'; 'id, field_id, value_text'; '*'
  - filters: eq('building_id', buildingId)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single, single
  - payload keys: upsert: payload=payload; insert: building_id, content, title
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\buildings\[buildingsId]\page.tsx:135
  - operation: upsert, select, insert, select, delete
  - select: 'id, field_id, value_text'; '*'
  - filters: eq('id', buildingId)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single, single
  - payload keys: upsert: payload=payload; insert: building_id, content, title
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\page.tsx:145
  - operation: select, update
  - select: 'building_id,field_id,value_text'
  - filters: in('building_id', buildingIds); in('field_id', fieldIds); eq('id', property.id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: update: cover_path

#### building_disclosures

- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\buildings\[buildingsId]\page.tsx:78
  - operation: select, select, select, upsert, select
  - select: '*'; 'id, key, label, field_type, options, field_group, is_critical, order_index'; 'id, field_id, value_text'; 'id, field_id, value_text'
  - filters: eq('building_id', buildingId); eq('is_active', true); eq('building_id', buildingId)
  - order: order('created_at', { ascending: false }); order('field_group', { ascending: true }); order('order_index', { ascending: true })
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: upsert: payload=payload
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\buildings\[buildingsId]\page.tsx:197
  - operation: insert, select, delete
  - select: '*'
  - filters: eq('id', buildingId)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: insert: building_id, content, title

#### building_media

- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\buildings\page.tsx:150
  - operation: select, insert, delete
  - select: 'id, building_id, path, caption, sort_order, created_at'
  - filters: eq('building_id', building.id); eq('id', m.id)
  - order: order('sort_order', { ascending: true }); order('created_at', { ascending: true })
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: insert: building_id
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\buildings\page.tsx:175
  - operation: insert, delete
  - select: (none)
  - filters: eq('id', m.id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: insert: building_id
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\buildings\page.tsx:189
  - operation: delete
  - select: (none)
  - filters: eq('id', m.id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: (none)

#### buildings

- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\buildings\[buildingsId]\page.tsx:69
  - operation: select, select, select, select, upsert, select
  - select: 'id,name'; '*'; 'id, key, label, field_type, options, field_group, is_critical, order_index'; 'id, field_id, value_text'; 'id, field_id, value_text'
  - filters: eq('id', buildingId); eq('building_id', buildingId); eq('is_active', true); eq('building_id', buildingId)
  - order: order('created_at', { ascending: false }); order('field_group', { ascending: true }); order('order_index', { ascending: true })
  - pagination: (none)
  - single/maybeSingle: single, single
  - payload keys: upsert: payload=payload
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\buildings\[buildingsId]\page.tsx:224
  - operation: delete
  - select: (none)
  - filters: eq('id', buildingId)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: (none)
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\buildings\page.tsx:59
  - operation: select, insert, delete, update, select, insert, delete
  - select: 'id, property_id, name, built_year, notes, cover_path'; 'id, building_id, path, caption, sort_order, created_at'
  - filters: eq('property_id', propertyId); eq('id', b.id); eq('id', building.id); eq('building_id', building.id); eq('id', m.id)
  - order: order('created_at', { ascending: true }); order('sort_order', { ascending: true }); order('created_at', { ascending: true })
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: insert: payload=payload; update: cover_path; insert: building_id
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\buildings\page.tsx:83
  - operation: insert, delete, update, select, insert, delete
  - select: 'id, building_id, path, caption, sort_order, created_at'
  - filters: eq('id', b.id); eq('id', building.id); eq('building_id', building.id); eq('id', m.id)
  - order: order('sort_order', { ascending: true }); order('created_at', { ascending: true })
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: insert: payload=payload; update: cover_path; insert: building_id
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\buildings\page.tsx:99
  - operation: delete, update, select, insert, delete
  - select: 'id, building_id, path, caption, sort_order, created_at'
  - filters: eq('id', b.id); eq('id', building.id); eq('building_id', building.id); eq('id', m.id)
  - order: order('sort_order', { ascending: true }); order('created_at', { ascending: true })
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: update: cover_path; insert: building_id
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\buildings\page.tsx:126
  - operation: update, select, insert, delete
  - select: 'id, building_id, path, caption, sort_order, created_at'
  - filters: eq('id', building.id); eq('building_id', building.id); eq('id', m.id)
  - order: order('sort_order', { ascending: true }); order('created_at', { ascending: true })
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: update: cover_path; insert: building_id
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\page.tsx:181
  - operation: select, update
  - select: 'id,name,cover_path,created_at'
  - filters: eq('property_id', id); eq('id', property.id)
  - order: order('created_at', { ascending: false })
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: update: cover_path
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\page.tsx:275
  - operation: update, update, delete, select, insert, select
  - select: '*'; 'id,name,cover_path,created_at'
  - filters: eq('id', buildingId); eq('id', property.id); eq('id', property.id); eq('property_id', property.id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: update: cover_path; update: payload=form; insert: name, property_id
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\page.tsx:368
  - operation: select, insert, select, insert
  - select: '*'; 'id,name,cover_path,created_at'
  - filters: eq('property_id', property.id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: insert: name, property_id; insert: payload=seeds
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\page.tsx:381
  - operation: insert, select, insert
  - select: 'id,name,cover_path,created_at'
  - filters: (none)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: insert: name, property_id; insert: payload=seeds

#### component_types

- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\admin\AdminClient.tsx:76
  - operation: select, update, insert, select, delete, update, insert, select, delete
  - select: 'id, code, name, category, technical_lifespan_years, maintenance_interval_years, notes'; 'id, code, label, category, scope, description, is_default'; 'id, code, name, category, technical_lifespan_years, maintenance_interval_years, notes'
  - filters: eq('id', id); eq('id', id); eq('id', id); eq('id', id)
  - order: order('category', { ascending: true }); order('name', { ascending: true })
  - pagination: (none)
  - single/maybeSingle: single, single
  - payload keys: update: payload=patch; insert: is_default, label, scope; update: payload=patch; insert: name
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\admin\AdminClient.tsx:133
  - operation: update, insert, select, delete
  - select: 'id, code, name, category, technical_lifespan_years, maintenance_interval_years, notes'
  - filters: eq('id', id); eq('id', id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: update: payload=patch; insert: name
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\admin\AdminClient.tsx:140
  - operation: insert, select, delete
  - select: 'id, code, name, category, technical_lifespan_years, maintenance_interval_years, notes'
  - filters: eq('id', id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: insert: name
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\admin\AdminClient.tsx:149
  - operation: delete
  - select: (none)
  - filters: eq('id', id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: (none)
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\insida\page.tsx:33
  - operation: select, insert, select, update, delete
  - select: 'id, code, name, scope, category, default_lifespan_years, maintenance_interval_years, notes, is_active'; 'id, code, name, scope, category, default_lifespan_years, maintenance_interval_years, notes, is_active'
  - filters: or('scope.eq.interior,scope.is.null'); eq('id', id); eq('id', id)
  - order: order('category', { ascending: true }); order('name', { ascending: true })
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: insert: is_active, name, scope; update: payload=patch
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\insida\page.tsx:51
  - operation: insert, select, update, delete
  - select: 'id, code, name, scope, category, default_lifespan_years, maintenance_interval_years, notes, is_active'
  - filters: eq('id', id); eq('id', id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: insert: is_active, name, scope; update: payload=patch
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\insida\page.tsx:73
  - operation: update, delete
  - select: (none)
  - filters: eq('id', id); eq('id', id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: update: payload=patch
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\insida\page.tsx:90
  - operation: delete
  - select: (none)
  - filters: eq('id', id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: (none)
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\utsida\page.tsx:33
  - operation: select, insert, select, update, delete
  - select: 'id, code, name, scope, category, default_lifespan_years, maintenance_interval_years, notes, is_active'; 'id, code, name, scope, category, default_lifespan_years, maintenance_interval_years, notes, is_active'
  - filters: or('scope.eq.exterior,scope.is.null'); eq('id', id); eq('id', id)
  - order: order('category', { ascending: true }); order('name', { ascending: true })
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: insert: is_active, name, scope; update: payload=patch
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\utsida\page.tsx:51
  - operation: insert, select, update, delete
  - select: 'id, code, name, scope, category, default_lifespan_years, maintenance_interval_years, notes, is_active'
  - filters: eq('id', id); eq('id', id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: insert: is_active, name, scope; update: payload=patch
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\utsida\page.tsx:73
  - operation: update, delete
  - select: (none)
  - filters: eq('id', id); eq('id', id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: update: payload=patch
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\utsida\page.tsx:90
  - operation: delete
  - select: (none)
  - filters: eq('id', id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: (none)

#### document_types

- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\admin\AdminClient.tsx:63
  - operation: select, select, update, insert, select, delete, update, insert, select
  - select: 'id, code, label, category, scope, description, is_default'; 'id, code, name, category, technical_lifespan_years, maintenance_interval_years, notes'; 'id, code, label, category, scope, description, is_default'; 'id, code, name, category, technical_lifespan_years, mainte
  - filters: eq('id', id); eq('id', id); eq('id', id)
  - order: order('category', { ascending: true }); order('label', { ascending: true }); order('category', { ascending: true }); order('name', { ascending: true })
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: update: payload=patch; insert: is_default, label, scope; update: payload=patch; insert: name
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\admin\AdminClient.tsx:111
  - operation: update, insert, select, delete, update, insert, select, delete
  - select: 'id, code, label, category, scope, description, is_default'; 'id, code, name, category, technical_lifespan_years, maintenance_interval_years, notes'
  - filters: eq('id', id); eq('id', id); eq('id', id); eq('id', id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single, single
  - payload keys: update: payload=patch; insert: is_default, label, scope; update: payload=patch; insert: name
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\admin\AdminClient.tsx:118
  - operation: insert, select, delete, update, insert, select, delete
  - select: 'id, code, label, category, scope, description, is_default'; 'id, code, name, category, technical_lifespan_years, maintenance_interval_years, notes'
  - filters: eq('id', id); eq('id', id); eq('id', id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single, single
  - payload keys: insert: is_default, label, scope; update: payload=patch; insert: name
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\admin\AdminClient.tsx:127
  - operation: delete, update, insert, select, delete
  - select: 'id, code, name, category, technical_lifespan_years, maintenance_interval_years, notes'
  - filters: eq('id', id); eq('id', id); eq('id', id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: update: payload=patch; insert: name
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\handlingar-upplysningar\page.tsx:39
  - operation: select, insert, select, update, delete
  - select: 'id, code, label, category, scope, description, is_default, result_label, result_unit, validity_years, recommended_interval_years, interval_note, is_active'; 'id, code, label, category, scope, description, is_default, result_label, result_unit, validity_years, recommended_interval_years, interval_note, is_active'
  - filters: eq('id', id); eq('id', id)
  - order: order('category', { ascending: true }); order('label', { ascending: true })
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: insert: category, is_active, is_default, label, scope; update: payload=patch
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\handlingar-upplysningar\page.tsx:58
  - operation: insert, select, update, delete
  - select: 'id, code, label, category, scope, description, is_default, result_label, result_unit, validity_years, recommended_interval_years, interval_note, is_active'
  - filters: eq('id', id); eq('id', id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: insert: category, is_active, is_default, label, scope; update: payload=patch
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\handlingar-upplysningar\page.tsx:82
  - operation: update, delete
  - select: (none)
  - filters: eq('id', id); eq('id', id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: update: payload=patch
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\handlingar-upplysningar\page.tsx:99
  - operation: delete
  - select: (none)
  - filters: eq('id', id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: (none)
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepHandlingar.tsx:63
  - operation: select, select, insert, select, insert, select, select
  - select: 'id,label,description,scope,is_active'; '*'; '*'; '*'; 'defect_disclosures'
  - filters: in('scope', ['building', 'property']); eq('is_active', true); eq('inspection_id', inspection.id); eq('inspection_id', inspection.id); eq('id', inspection.id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single, single
  - payload keys: insert: payload=payload; insert: inspection_id, note, title

#### inspection_conditions

- C:\Users\hedbj\underhallsplan-villa\src\app\utlatande\[propertyId]\[inspectionId]\page.tsx:119
  - operation: select, select, select, select, select
  - select: 'furnishing_level, weather, weather_note, building_type, building_form, building_year, foundation, frame, joists, facade, windows, roof, heating, ventilation, water, sewer'; 'overview_item_id, floor_key, set_index, values, note'; 'id, key, label, sort_order'; 'id, overview_item_id, key, label, sort_order'; 'group_id, value, label'
  - filters: eq('inspection_id', resolvedParams.inspectionId); eq('inspection_id', resolvedParams.inspectionId); in('key', overviewItemKeys); eq('is_active', true); in('overview_item_id', overviewItemIds); eq('is_active', true); in('group_id', overviewGroupIds); eq('is_active', true)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: maybeSingle
  - payload keys: (none)
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepForutsattningar.tsx:99
  - operation: select, insert, select, select, select, select, select, update, select, update, select, insert, select, delete
  - select: '*'; '*'; '*'; '*'; '*'; '*'; '*'; '*'; '*'
  - filters: eq('inspection_id', inspection.id); eq('is_active', true); in('overview_item_id', itemIds); eq('is_active', true); in('group_id', groupIds); eq('is_active', true); eq('inspection_id', inspection.id); eq('id', condRow.id); eq('id', sel.id); eq('id', target.id)
  - order: order('sort_order', { ascending: true }); order('sort_order', { ascending: true }); order('sort_order', { ascending: true }); order('set_index', { ascending: true })
  - pagination: (none)
  - single/maybeSingle: maybeSingle, single, single, single, single
  - payload keys: insert: furnishing_level, inspection_id; update: furnishing_level; update: note, values; insert: floor_key, inspection_id, note, overview_item_id, set_index, values
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepForutsattningar.tsx:112
  - operation: insert, select, select, select, select, select, update, select, update, select, insert, select, delete
  - select: '*'; '*'; '*'; '*'; '*'; '*'; '*'; '*'
  - filters: eq('is_active', true); in('overview_item_id', itemIds); eq('is_active', true); in('group_id', groupIds); eq('is_active', true); eq('inspection_id', inspection.id); eq('id', condRow.id); eq('id', sel.id); eq('id', target.id)
  - order: order('sort_order', { ascending: true }); order('sort_order', { ascending: true }); order('sort_order', { ascending: true }); order('set_index', { ascending: true })
  - pagination: (none)
  - single/maybeSingle: single, single, single, single
  - payload keys: insert: furnishing_level, inspection_id; update: furnishing_level; update: note, values; insert: floor_key, inspection_id, note, overview_item_id, set_index, values
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepForutsattningar.tsx:226
  - operation: update, select, update, select, insert, select, delete
  - select: '*'; '*'; '*'
  - filters: eq('id', condRow.id); eq('id', sel.id); eq('id', target.id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single, single, single
  - payload keys: update: furnishing_level; update: note, values; insert: floor_key, inspection_id, note, overview_item_id, set_index, values

#### inspection_control_items

- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepInsida.tsx:275
  - operation: select, select
  - select: '*'; '*'
  - filters: in('interior_room_id', roomIds); eq('inspection_id', inspection.id); not('control_item_id', 'is', null)
  - order: order('sort_order', { ascending: true }); order('sort_order', { ascending: true }); order('created_at', { ascending: true })
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: (none)
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepInsida.tsx:394
  - operation: update, select, insert, select, delete, select
  - select: '*'; '*'; 'id, key, title, label, description, tags, trigger_room_types'
  - filters: eq('id', item.id); eq('id', itemId); eq('scope', 'interior'); eq('is_active', true)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single, single
  - payload keys: update: note, sort_order, status, title; insert: control_point_id, inspection_id, interior_room_id, note, sort_order, status, title
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepInsida.tsx:409
  - operation: insert, select, delete, select
  - select: '*'; 'id, key, title, label, description, tags, trigger_room_types'
  - filters: eq('id', itemId); eq('scope', 'interior'); eq('is_active', true)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: insert: control_point_id, inspection_id, interior_room_id, note, sort_order, status, title
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepInsida.tsx:456
  - operation: delete, select, insert, select
  - select: 'id, key, title, label, description, tags, trigger_room_types'; '*'
  - filters: eq('id', itemId); eq('scope', 'interior'); eq('is_active', true)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: insert: payload=payload
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepInsida.tsx:535
  - operation: insert, select
  - select: '*'
  - filters: (none)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: insert: payload=payload
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepUtsida.tsx:294
  - operation: insert, select, select
  - select: '*'; 'id, control_point_id, label, severity, risk_template, ftu_tem
  - filters: in('exterior_observation_id', obsIds)
  - order: order('sort_order', { ascending: true })
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: insert: payload=payload
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepUtsida.tsx:349
  - operation: select, select, select
  - select: '*'; 'id, control_point_id, label, severity, risk_template, ftu_template, sort_order, is_active'; 'id, title, label, description'
  - filters: in('exterior_observation_id', obsIds); in('control_point_id', cpIds); eq('is_active', true); in('id', cpIds); eq('is_active', true)
  - order: order('sort_order', { ascending: true }); order('sort_order', { ascending: true })
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: (none)
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepUtsida.tsx:605
  - operation: update, select, insert, select
  - select: '*'; '*'
  - filters: eq('id', item.id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single, single
  - payload keys: update: note, selected_outcome_id, sort_order, status, title, updated_at; insert: control_point_id, exterior_observation_id, inspection_id, note, selected_outcome_id, sort_order, status, title
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepUtsida.tsx:622
  - operation: insert, select
  - select: '*'
  - filters: (none)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: insert: control_point_id, exterior_observation_id, inspection_id, note, selected_outcome_id, sort_order, status, title

#### inspection_disclosures

- C:\Users\hedbj\underhallsplan-villa\src\app\utlatande\[propertyId]\[inspectionId]\page.tsx:108
  - operation: select, select, select, select, select, select
  - select: 'note'; 'furnishing_level, weather, weather_note, building_type, building_form, building_year, foundation, frame, joists, facade, windows, roof, heating, ventilation, water, sewer'; 'overview_item_id, floor_key, set_index, values, note'; 'id, key, label, sort_order'; 'id, overview_item_id, key, label, sort_order'; 'group_id, value, label'
  - filters: eq('inspection_id', resolvedParams.inspectionId); is('disclosure_item_id', null); eq('inspection_id', resolvedParams.inspectionId); eq('inspection_id', resolvedParams.inspectionId); in('key', overviewItemKeys); eq('is_active', true); in('overview_item_id', overviewItemIds); eq('is_active', true); in('group_id', overviewGroupIds); eq('is_active', true)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: maybeSingle, maybeSingle
  - payload keys: (none)
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepHandlingar.tsx:123
  - operation: select, insert, select, select, update
  - select: '*'; '*'; 'defect_disclosures'
  - filters: eq('inspection_id', inspection.id); eq('id', inspection.id); eq('id', inspection.id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single, single
  - payload keys: insert: inspection_id, note, title; update: defect_disclosures
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepHandlingar.tsx:133
  - operation: insert, select, select, update
  - select: '*'; 'defect_disclosures'
  - filters: eq('id', inspection.id); eq('id', inspection.id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single, single
  - payload keys: insert: inspection_id, note, title; update: defect_disclosures
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepHandlingar.tsx:325
  - operation: update, update
  - select: (none)
  - filters: eq('id', disclosure.id); eq('id', inspection.id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: update: note; update: defect_disclosures

#### inspection_documents

- C:\Users\hedbj\underhallsplan-villa\src\app\utlatande\[propertyId]\[inspectionId]\page.tsx:89
  - operation: select, select, select, select, select, select, select
  - select: 'title, status, note'; 'note'; 'furnishing_level, weather, weather_note, building_type, building_form, building_year, foundation, frame, joists, facade, windows, roof, heating, ventilation, water, sewer'; 'overview_item_id, floor_key, set_index, values, note'; 'id, key, label, sort_order'; 'id, overview_item_id, key, label, sort_order'; 'group_id, value, label'
  - filters: eq('inspection_id', resolvedParams.inspectionId); eq('inspection_id', resolvedParams.inspectionId); is('disclosure_item_id', null); eq('inspection_id', resolvedParams.inspectionId); eq('inspection_id', resolvedParams.inspectionId); in('key', overviewItemKeys); eq('is_active', true); in('overview_item_id', overviewItemIds); eq('is_active', true); in('group_id', overviewGroupIds); eq('is_active', true)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: maybeSingle, maybeSingle
  - payload keys: (none)
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepHandlingar.tsx:74
  - operation: select, insert, select, insert, select, select, update
  - select: '*'; '*'; '*'; 'defect_disclosures'
  - filters: eq('inspection_id', inspection.id); eq('inspection_id', inspection.id); eq('id', inspection.id); eq('id', inspection.id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single, single
  - payload keys: insert: payload=payload; insert: inspection_id, note, title; update: defect_disclosures
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepHandlingar.tsx:117
  - operation: insert, select, insert, select, select, update
  - select: '*'; '*'; 'defect_disclosures'
  - filters: eq('inspection_id', inspection.id); eq('id', inspection.id); eq('id', inspection.id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single, single
  - payload keys: insert: payload=payload; insert: inspection_id, note, title; update: defect_disclosures
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepHandlingar.tsx:258
  - operation: update, insert, select, update, update
  - select: '*'
  - filters: eq('id', id); eq('id', disclosure.id); eq('id', inspection.id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: update: payload=patch; insert: payload=insertPayload as any; update: note; update: defect_disclosures
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepHandlingar.tsx:296
  - operation: insert, select, update, update
  - select: '*'
  - filters: eq('id', disclosure.id); eq('id', inspection.id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: insert: payload=insertPayload as any; update: note; update: defect_disclosures

#### inspection_exterior_observations

- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepUtsida.tsx:220
  - operation: select, insert, select, select, insert
  - select: '*'; '*'; 'id, key, title, label, tags, exterior_item_key'
  - filters: eq('inspection_id', inspection.id); eq('scope', 'exterior'); eq('is_active', true); eq('exterior_item_key', it.key)
  - order: order('created_at', { ascending: true })
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: insert: exterior_item_id, inspection_id, note, part_label, values; insert: payload=payload
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepUtsida.tsx:243
  - operation: insert, select, select, insert
  - select: '*'; 'id, key, title, label, tags, exterior_item_key'
  - filters: eq('scope', 'exterior'); eq('is_active', true); eq('exterior_item_key', it.key)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: insert: exterior_item_id, inspection_id, note, part_label, values; insert: payload=payload
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepUtsida.tsx:487
  - operation: update, select, insert, select, delete
  - select: '*'; '*'
  - filters: eq('id', row.id); eq('id', rowId)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single, single
  - payload keys: update: note, part_label, values; insert: exterior_item_id, inspection_id, note, part_label, values
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepUtsida.tsx:502
  - operation: insert, select, delete, update
  - select: '*'
  - filters: eq('id', rowId)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: insert: exterior_item_id, inspection_id, note, part_label, values; update: payload={
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepUtsida.tsx:579
  - operation: delete, update, select, insert, select
  - select: '*'; '*'
  - filters: eq('id', rowId); eq('id', item.id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single, single
  - payload keys: update: note, selected_outcome_id, sort_order, status, title, updated_at; insert: control_point_id, exterior_observation_id, inspection_id, note, selected_outcome_id, sort_order, status, title

#### inspection_images

- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepInsida.tsx:288
  - operation: select
  - select: '*'
  - filters: eq('inspection_id', inspection.id); not('control_item_id', 'is', null)
  - order: order('sort_order', { ascending: true }); order('created_at', { ascending: true })
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: (none)
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepInsida.tsx:653
  - operation: insert, select, delete, update, select
  - select: '*'; '*'
  - filters: eq('id', imageId); eq('id', room.id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single, single
  - payload keys: insert: control_item_id, exterior_observation_id, file_path, inspection_id, interior_room_id, label, sort_order; update: floor_label, note, order_index, room_label, room_type_key, values
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepInsida.tsx:710
  - operation: delete, update, select, insert, select
  - select: '*'; '*'
  - filters: eq('id', imageId); eq('id', room.id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single, single
  - payload keys: update: floor_label, note, order_index, room_label, room_type_key, values; insert: floor_label, inspection_id, note, order_index, room_label, room_type_key, values
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepUtsida.tsx:438
  - operation: select, update, select, insert, select
  - select: '*'; '*'; '*'
  - filters: eq('inspection_id', inspection.id); not('control_item_id', 'is', null); eq('id', row.id)
  - order: order('sort_order', { ascending: true }); order('created_at', { ascending: true })
  - pagination: (none)
  - single/maybeSingle: single, single
  - payload keys: update: note, part_label, values; insert: exterior_item_id, inspection_id, note, part_label, values
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepUtsida.tsx:733
  - operation: insert, select, delete
  - select: '*'
  - filters: eq('id', imageId)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: insert: control_item_id, exterior_observation_id, file_path, inspection_id, interior_room_id, label, sort_order
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepUtsida.tsx:788
  - operation: delete
  - select: (none)
  - filters: eq('id', imageId)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: (none)

#### inspection_interior_rooms

- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepInsida.tsx:214
  - operation: select, select, select, select, select
  - select: '*'; 'id, key'; 'values'; '*'; '*'
  - filters: eq('inspection_id', inspection.id); eq('key', 'building_type'); eq('is_active', true); eq('inspection_id', inspection.id); eq('overview_item_id', buildingItem.id); in('interior_room_id', roomIds); eq('inspection_id', inspection.id); not('control_item_id', 'is', null)
  - order: order('floor_label', { ascending: true }); order('order_index', { ascending: true }); order('set_index', { ascending: true }); order('sort_order', { ascending: true }); order('sort_order', { ascending: true }); order('created_at', { ascending: true })
  - pagination: (none)
  - single/maybeSingle: maybeSingle
  - payload keys: (none)
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepInsida.tsx:743
  - operation: update, select, insert, select, delete
  - select: '*'; '*'
  - filters: eq('id', room.id); eq('id', id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single, single
  - payload keys: update: floor_label, note, order_index, room_label, room_type_key, values; insert: floor_label, inspection_id, note, order_index, room_label, room_type_key, values
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepInsida.tsx:761
  - operation: insert, select, delete
  - select: '*'
  - filters: eq('id', id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: insert: floor_label, inspection_id, note, order_index, room_label, room_type_key, values
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepInsida.tsx:834
  - operation: delete
  - select: (none)
  - filters: eq('id', id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: (none)

#### inspection_overview_selections

- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\forutsattningar\page.tsx:96
  - operation: select, select, select, insert, select
  - select: 'id'; '*'; '*'; '*'
  - filters: eq('overview_item_id', it.id); eq('overview_item_id', overviewItemId); eq('group_id', groupId)
  - order: order('sort_order', { ascending: true }); order('sort_order', { ascending: true })
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: insert: is_active, label, note_enabled, selection_mode, sort_order
- C:\Users\hedbj\underhallsplan-villa\src\app\utlatande\[propertyId]\[inspectionId]\page.tsx:152
  - operation: select, select, select, select
  - select: 'overview_item_id, floor_key, set_index, values, note'; 'id, key, label, sort_order'; 'id, overview_item_id, key, label, sort_order'; 'group_id, value, label'
  - filters: eq('inspection_id', resolvedParams.inspectionId); in('key', overviewItemKeys); eq('is_active', true); in('overview_item_id', overviewItemIds); eq('is_active', true); in('group_id', overviewGroupIds); eq('is_active', true)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: (none)
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepForutsattningar.tsx:162
  - operation: select, update, select, update, select, insert, select, delete
  - select: '*'; '*'; '*'; '*'
  - filters: eq('inspection_id', inspection.id); eq('id', condRow.id); eq('id', sel.id); eq('id', target.id)
  - order: order('set_index', { ascending: true })
  - pagination: (none)
  - single/maybeSingle: single, single, single
  - payload keys: update: furnishing_level; update: note, values; insert: floor_key, inspection_id, note, overview_item_id, set_index, values
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepForutsattningar.tsx:251
  - operation: update, select, insert, select, delete
  - select: '*'; '*'
  - filters: eq('id', sel.id); eq('id', target.id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single, single
  - payload keys: update: note, values; insert: floor_key, inspection_id, note, overview_item_id, set_index, values
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepForutsattningar.tsx:264
  - operation: insert, select, delete
  - select: '*'
  - filters: eq('id', target.id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: insert: floor_key, inspection_id, note, overview_item_id, set_index, values
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepForutsattningar.tsx:334
  - operation: delete
  - select: (none)
  - filters: eq('id', target.id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: (none)
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepInsida.tsx:251
  - operation: select, select, select
  - select: 'values'; '*'; '*'
  - filters: eq('inspection_id', inspection.id); eq('overview_item_id', buildingItem.id); in('interior_room_id', roomIds); eq('inspection_id', inspection.id); not('control_item_id', 'is', null)
  - order: order('set_index', { ascending: true }); order('sort_order', { ascending: true }); order('sort_order', { ascending: true }); order('created_at', { ascending: true })
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: (none)

#### inspections

- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\inspections\page.tsx:48
  - operation: select, select
  - select: `
            id,
            property_id,
            date,
            type,
            status,
            inspector_name,
            created_at,
            client_name,
            client_contact,
            assignment_number
          `; `
              id,
              name,
              address,
              postal_code,
              city
            `
  - filters: in('id', propertyIds)
  - order: order('created_at', { ascending: false })
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: (none)
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\ob\[inspectionId]\page.tsx:54
  - operation: select, select
  - select: `
            id,
            property_id,
            date,
            type,
            status,
            inspector_name,
            created_at,
            client_name,
            client_contact,
            assignment_number,
            assignment_confirmation_delivered_date,
            scope,
            inspection_time,
            attendees,
            attendees_other,
            inspection_side,
            defect_disclosures
          `; `
            id,
            name,
            address,
            postal_code,
            city,
            municipality,
            cadastral_id,
            owner_name,
            tenure_type,
            dwelling_type
          `
  - filters: eq('id', inspectionId); eq('id', propertyId)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single, single
  - payload keys: (none)
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\ob\page.tsx:62
  - operation: select, insert, select, delete
  - select: 'id, property_id, date, type, status, inspector_name, created_at'; 'id'
  - filters: eq('property_id', propertyId); eq('id', inspectionId)
  - order: order('date', { ascending: false })
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: insert: property_id, status, type
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\ob\page.tsx:88
  - operation: insert, select, delete
  - select: 'id'
  - filters: eq('id', inspectionId)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: insert: property_id, status, type
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\ob\page.tsx:114
  - operation: delete
  - select: (none)
  - filters: eq('id', inspectionId)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: (none)
- C:\Users\hedbj\underhallsplan-villa\src\app\utlatande\[propertyId]\[inspectionId]\page.tsx:53
  - operation: select, select, select, select, select, select, select, select, select
  - select: 'id, property_id, date, inspection_time, assignment_number, client_name, client_contact, defect_disclosures, scope, attendees, attendees_other, assignment_confirmation_delivered_date'; 'full_name, sbr_group, sbr_status, membership_number, phone, email, company_name, company_orgno, company_address, company_postal_code, company_city, logo_path'; 'title, status, note'; 'note'; 'furnishing_level, weather, weather_note, building_type, building_form, building_year, foundation, frame, joists, facade, windows, roof, heating, ventilation, water, sewer'; 'overview_item_id, floor_key, set_index, values, note'; 'id, key, label, sort_order'; 'id, overview_item_id, key, label, sort_order'; 'group_id, value, label'
  - filters: eq('id', resolvedParams.inspectionId); eq('id', userId); eq('inspection_id', resolvedParams.inspectionId); eq('inspection_id', resolvedParams.inspectionId); is('disclosure_item_id', null); eq('inspection_id', resolvedParams.inspectionId); eq('inspection_id', resolvedParams.inspectionId); in('key', overviewItemKeys); eq('is_active', true); in('overview_item_id', overviewItemIds); eq('is_active', true); in('group_id', overviewGroupIds); eq('is_active', true)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: maybeSingle, maybeSingle, maybeSingle, maybeSingle
  - payload keys: (none)
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepGrunddata.tsx:202
  - operation: update, select, select
  - select: '*'; 'assignment_number, date'
  - filters: eq('id', inspection.id); eq('date', baseDate)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: update: payload=patch
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepGrunddata.tsx:238
  - operation: select
  - select: 'assignment_number, date'
  - filters: eq('date', baseDate)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: (none)
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepHandlingar.tsx:151
  - operation: select, update
  - select: 'defect_disclosures'
  - filters: eq('id', inspection.id); eq('id', inspection.id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: update: defect_disclosures
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepHandlingar.tsx:165
  - operation: update
  - select: (none)
  - filters: eq('id', inspection.id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: update: defect_disclosures
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepHandlingar.tsx:362
  - operation: update
  - select: (none)
  - filters: eq('id', inspection.id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: update: defect_disclosures

#### profiles

- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\page.tsx:85
  - operation: select, update
  - select: 'id, full_name, sbr_group, sbr_status, membership_number, phone, email, company_name, company_orgno, company_address, company_postal_code, company_city, avatar_path, logo_path'
  - filters: eq('id', user.id); eq('id', profile.id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: update: payload=updatePayload
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\page.tsx:168
  - operation: update
  - select: (none)
  - filters: eq('id', profile.id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: update: payload=updatePayload
- C:\Users\hedbj\underhallsplan-villa\src\app\utlatande\[propertyId]\[inspectionId]\page.tsx:76
  - operation: select, select, select, select, select, select, select, select
  - select: 'full_name, sbr_group, sbr_status, membership_number, phone, email, company_name, company_orgno, company_address, company_postal_code, company_city, logo_path'; 'title, status, note'; 'note'; 'furnishing_level, weather, weather_note, building_type, building_form, building_year, foundation, frame, joists, facade, windows, roof, heating, ventilation, water, sewer'; 'overview_item_id, floor_key, set_index, values, note'; 'id, key, label, sort_order'; 'id, overview_item_id, key, label, sort_order'; 'group_id, value, label'
  - filters: eq('id', userId); eq('inspection_id', resolvedParams.inspectionId); eq('inspection_id', resolvedParams.inspectionId); is('disclosure_item_id', null); eq('inspection_id', resolvedParams.inspectionId); eq('inspection_id', resolvedParams.inspectionId); in('key', overviewItemKeys); eq('is_active', true); in('overview_item_id', overviewItemIds); eq('is_active', true); in('group_id', overviewGroupIds); eq('is_active', true)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: maybeSingle, maybeSingle, maybeSingle
  - payload keys: (none)
- C:\Users\hedbj\underhallsplan-villa\src\hooks\useProfile.ts:24
  - operation: select
  - select: 'id,full_name,org_name,logo_url,is_admin'
  - filters: eq('id', user.id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: maybeSingle
  - payload keys: (none)

#### properties

- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\inspections\page.tsx:83
  - operation: select
  - select: `
              id,
              name,
              address,
              postal_code,
              city
            `
  - filters: in('id', propertyIds)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: (none)
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\ob\[inspectionId]\page.tsx:79
  - operation: select
  - select: `
            id,
            name,
            address,
            postal_code,
            city,
            municipality,
            cadastral_id,
            owner_name,
            tenure_type,
            dwelling_type
          `
  - filters: eq('id', propertyId)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: (none)
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\ob\page.tsx:46
  - operation: select, select, insert, select, delete
  - select: 'id, name, address, postal_code, city'; 'id, property_id, date, type, status, inspector_name, created_at'; 'id'
  - filters: eq('id', propertyId); eq('property_id', propertyId); eq('id', inspectionId)
  - order: order('date', { ascending: false })
  - pagination: (none)
  - single/maybeSingle: single, single
  - payload keys: insert: property_id, status, type
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\page.tsx:179
  - operation: select, select, update
  - select: '*'; 'id,name,cover_path,created_at'
  - filters: eq('id', id); eq('property_id', id); eq('id', property.id)
  - order: order('created_at', { ascending: false })
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: update: cover_path
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\page.tsx:236
  - operation: update, update, update
  - select: (none)
  - filters: eq('id', property.id); eq('id', buildingId); eq('id', property.id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: update: cover_path; update: cover_path; update: payload=form
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\page.tsx:319
  - operation: update, delete, select, insert, select, insert
  - select: '*'; 'id,name,cover_path,created_at'
  - filters: eq('id', property.id); eq('id', property.id); eq('property_id', property.id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: update: payload=form; insert: name, property_id; insert: payload=seeds
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\page.tsx:344
  - operation: delete, select, insert, select, insert
  - select: '*'; 'id,name,cover_path,created_at'
  - filters: eq('id', property.id); eq('property_id', property.id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: insert: name, property_id; insert: payload=seeds
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\page.tsx:45
  - operation: select, insert, select
  - select: 'id,owner,name,address,client_name,status,created_at'; 'id'
  - filters: eq('owner', auth.user.id)
  - order: order('created_at', { ascending: false })
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: insert: name, owner, status
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\page.tsx:97
  - operation: insert, select
  - select: 'id'
  - filters: (none)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: insert: name, owner, status
- C:\Users\hedbj\underhallsplan-villa\src\app\utlatande\[propertyId]\[inspectionId]\page.tsx:43
  - operation: select, select, select, select, select, select, select, select, select, select
  - select: 'id, address, postal_code, city, municipality, cadastral_id, owner_name, cover_path'; 'id, property_id, date, inspection_time, assignment_number, client_name, client_contact, defect_disclosures, scope, attendees, attendees_other, assignment_confirmation_delivered_date'; 'full_name, sbr_group, sbr_status, membership_number, phone, email, company_name, company_orgno, company_address, company_postal_code, company_city, logo_path'; 'title, status, note'; 'note'; 'furnishing_level, weather, weather_note, building_type, building_form, building_year, foundation, frame, joists, facade, windows, roof, heating, ventilation, water, sewer'; 'overview_item_id, floor_key, set_index, values, note'; 'id, key, label, sort_order'; 'id, overview_item_id, key, label, sort_order'; 'group_id, value, label'
  - filters: eq('id', resolvedParams.propertyId); eq('id', resolvedParams.inspectionId); eq('id', userId); eq('inspection_id', resolvedParams.inspectionId); eq('inspection_id', resolvedParams.inspectionId); is('disclosure_item_id', null); eq('inspection_id', resolvedParams.inspectionId); eq('inspection_id', resolvedParams.inspectionId); in('key', overviewItemKeys); eq('is_active', true); in('overview_item_id', overviewItemIds); eq('is_active', true); in('group_id', overviewGroupIds); eq('is_active', true)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: maybeSingle, maybeSingle, maybeSingle, maybeSingle, maybeSingle
  - payload keys: (none)
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepGrunddata.tsx:177
  - operation: update, select, update, select, select
  - select: '*'; '*'; 'assignment_number, date'
  - filters: eq('id', property.id); eq('id', inspection.id); eq('date', baseDate)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single, single
  - payload keys: update: payload=patch; update: payload=patch

#### property-media

- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\buildings\page.tsx:72
  - operation: insert, delete, update, select, insert, delete
  - select: 'id, building_id, path, caption, sort_order, created_at'
  - filters: eq('id', b.id); eq('id', building.id); eq('building_id', building.id); eq('id', m.id)
  - order: order('sort_order', { ascending: true }); order('created_at', { ascending: true })
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: insert: payload=payload; update: cover_path; insert: building_id
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\buildings\page.tsx:120
  - operation: update, select, insert, delete
  - select: 'id, building_id, path, caption, sort_order, created_at'
  - filters: eq('id', building.id); eq('building_id', building.id); eq('id', m.id)
  - order: order('sort_order', { ascending: true }); order('created_at', { ascending: true })
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: update: cover_path; insert: building_id
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\buildings\page.tsx:170
  - operation: insert, delete
  - select: (none)
  - filters: eq('id', m.id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: insert: building_id
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\buildings\page.tsx:193
  - operation: select
  - select: (none)
  - filters: (none)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: (none)
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\page.tsx:228
  - operation: update, update, update
  - select: (none)
  - filters: eq('id', property.id); eq('id', buildingId); eq('id', property.id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: update: cover_path; update: cover_path; update: payload=form
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\page.tsx:232
  - operation: update, update, update
  - select: (none)
  - filters: eq('id', property.id); eq('id', buildingId); eq('id', property.id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: update: cover_path; update: cover_path; update: payload=form
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\page.tsx:264
  - operation: update, update, delete, select
  - select: '*'
  - filters: eq('id', buildingId); eq('id', property.id); eq('id', property.id); eq('property_id', property.id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: update: cover_path; update: payload=form
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\page.tsx:270
  - operation: update, update, delete, select
  - select: '*'
  - filters: eq('id', buildingId); eq('id', property.id); eq('id', property.id); eq('property_id', property.id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: update: cover_path; update: payload=form
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\page.tsx:195
  - operation: select
  - select: (none)
  - filters: (none)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: (none)
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\page.tsx:201
  - operation: select
  - select: (none)
  - filters: (none)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: (none)

#### settings_control_point_outcomes

- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepUtsida.tsx:380
  - operation: select, select, select
  - select: 'id, control_point_id, label, severity, risk_template, ftu_template, sort_order, is_active'; 'id, title, label, description'; '*'
  - filters: in('control_point_id', cpIds); eq('is_active', true); in('id', cpIds); eq('is_active', true); eq('inspection_id', inspection.id); not('control_item_id', 'is', null)
  - order: order('sort_order', { ascending: true }); order('sort_order', { ascending: true }); order('created_at', { ascending: true })
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: (none)

#### settings_control_points

- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\ob-control-points\page.tsx:94
  - operation: select, select, select
  - select: '*'; '*'; '*'
  - filters: eq('is_active', true); eq('is_active', true)
  - order: order('scope', { ascending: true }); order('sort_order', { ascending: true }); order('title', { ascending: true }); order('sort_order', { ascending: true }); order('sort_order', { ascending: true })
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: (none)
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\ob-control-points\page.tsx:207
  - operation: insert, select, update, select
  - select: '*'; '*'
  - filters: eq('id', p.id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single, single
  - payload keys: insert: description, exterior_item_key, is_active, key, label, question, risk_tags, room_type_key, scope, sort_order, tags, title, trigger_room_types; update: description, exterior_item_key, is_active, label, question, risk_tags, room_type_key, scope, sort_order, tags, title, trigger_room_types
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\ob-control-points\page.tsx:257
  - operation: update, select, update
  - select: '*'
  - filters: eq('id', p.id); eq('id', p.id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: update: description, exterior_item_key, is_active, label, question, risk_tags, room_type_key, scope, sort_order, tags, title, trigger_room_types; update: is_active
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\ob-control-points\page.tsx:315
  - operation: update
  - select: (none)
  - filters: eq('id', p.id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: update: is_active
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepInsida.tsx:482
  - operation: select, insert, select
  - select: 'id, key, title, label, description, tags, trigger_room_types'; '*'
  - filters: eq('scope', 'interior'); eq('is_active', true)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: insert: payload=payload
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepInsida.tsx:1321
  - operation: select
  - select: 'id, key, title, label, description, tags'
  - filters: eq('is_active', true); or(`title.ilike.${like},label.ilike.${like},key.ilike.${like},description.ilike.${like}`)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: (none)
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepUtsida.tsx:268
  - operation: select, insert, select
  - select: 'id, key, title, label, tags, exterior_item_key'; '*'
  - filters: eq('scope', 'exterior'); eq('is_active', true); eq('exterior_item_key', it.key); in('exterior_observation_id', obsIds)
  - order: order('sort_order', { ascending: true })
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: insert: payload=payload
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepUtsida.tsx:410
  - operation: select, select, update, select
  - select: 'id, title, label, description'; '*'; '*'
  - filters: in('id', cpIds); eq('is_active', true); eq('inspection_id', inspection.id); not('control_item_id', 'is', null); eq('id', row.id)
  - order: order('sort_order', { ascending: true }); order('created_at', { ascending: true })
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: update: note, part_label, values
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepUtsida.tsx:1290
  - operation: select
  - select: 'id, key, title, label, description, tags, exterior_item_key'
  - filters: eq('scope', 'exterior'); eq('is_active', true); or(`title.ilike.${like},label.ilike.${like},key.ilike.${like},description.ilike.${like}`)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: (none)

#### settings_exterior_groups

- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\ob-utsida\page.tsx:84
  - operation: select, select, insert, select, update, delete
  - select: '*'; '*'; '*'
  - filters: eq('item_id', itemId); eq('group_id', groupId); eq('id', id); eq('id', id)
  - order: order('sort_order', { ascending: true }); order('sort_order', { ascending: true })
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: insert: is_active, label, sort_order; update: payload=patch
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\ob-utsida\page.tsx:196
  - operation: insert, select, update, delete, insert, select, update, delete
  - select: '*'; '*'
  - filters: eq('id', id); eq('id', id); eq('id', id); eq('id', id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single, single
  - payload keys: insert: field_type, is_active, item_id, label, sort_order; update: payload=patch; insert: group_id, is_active, label, sort_order, trigger_tags; update: payload=patch
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\ob-utsida\page.tsx:220
  - operation: update, delete, insert, select, update, delete
  - select: '*'
  - filters: eq('id', id); eq('id', id); eq('id', id); eq('id', id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: update: payload=patch; insert: group_id, is_active, label, sort_order, trigger_tags; update: payload=patch
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\ob-utsida\page.tsx:231
  - operation: delete, insert, select, update, delete
  - select: '*'
  - filters: eq('id', id); eq('id', id); eq('id', id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: insert: group_id, is_active, label, sort_order, trigger_tags; update: payload=patch
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepUtsida.tsx:189
  - operation: select, select, select, insert, select, select
  - select: '*'; '*'; '*'; '*'; 'id, key, title, label, tags, exterior_item_key'
  - filters: in('item_id', itemIds); eq('is_active', true); in('group_id', groupIds); eq('is_active', true); eq('inspection_id', inspection.id); eq('scope', 'exterior'); eq()
  - order: order('sort_order', { ascending: true }); order('sort_order', { ascending: true }); order('created_at', { ascending: true })
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: insert: exterior_item_id, inspection_id, note, part_label, values

#### settings_exterior_items

- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\ob-control-points\page.tsx:105
  - operation: select, insert
  - select: '*'
  - filters: eq('is_active', true)
  - order: order('sort_order', { ascending: true })
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: insert: key, scope
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\ob-utsida\page.tsx:66
  - operation: select, select, select, insert, select, update, delete
  - select: '*'; '*'; '*'; '*'
  - filters: eq('item_id', itemId); eq('group_id', groupId); eq('id', id); eq('id', id)
  - order: order('sort_order', { ascending: true }); order('sort_order', { ascending: true }); order('sort_order', { ascending: true })
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: insert: is_active, label, sort_order; update: payload=patch
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\ob-utsida\page.tsx:145
  - operation: insert, select, update, delete, insert, select, update, delete
  - select: '*'; '*'
  - filters: eq('id', id); eq('id', id); eq('id', id); eq('id', id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single, single
  - payload keys: insert: is_active, label, sort_order; update: payload=patch; insert: field_type, is_active, item_id, label, sort_order; update: payload=patch
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\ob-utsida\page.tsx:166
  - operation: update, delete, insert, select, update, delete, insert, select
  - select: '*'; '*'
  - filters: eq('id', id); eq('id', id); eq('id', id); eq('id', id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single, single
  - payload keys: update: payload=patch; insert: field_type, is_active, item_id, label, sort_order; update: payload=patch; insert: group_id, is_active, label, sort_order, trigger_tags
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\ob-utsida\page.tsx:177
  - operation: delete, insert, select, update, delete, insert, select, update
  - select: '*'; '*'
  - filters: eq('id', id); eq('id', id); eq('id', id); eq('id', id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single, single
  - payload keys: insert: field_type, is_active, item_id, label, sort_order; update: payload=patch; insert: group_id, is_active, label, sort_order, trigger_tags; update: payload=patch
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepUtsida.tsx:164
  - operation: select, select, select, select, insert
  - select: '*'; '*'; '*'; '*'
  - filters: eq('is_active', true); in('item_id', itemIds); eq('is_active', true); in('group_id', groupIds); eq('is_active', true); eq('inspection_id', inspection.id)
  - order: order('sort_order', { ascending: true }); order('sort_order', { ascending: true }); order('sort_order', { ascending: true }); order('created_at', { ascending: true })
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: insert: exterior_item_id, inspection_id, part_label

#### settings_exterior_options

- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\ob-utsida\page.tsx:104
  - operation: select, insert, select, update, delete, insert, select
  - select: '*'; '*'; '*'
  - filters: eq('group_id', groupId); eq('id', id); eq('id', id)
  - order: order('sort_order', { ascending: true })
  - pagination: (none)
  - single/maybeSingle: single, single
  - payload keys: insert: is_active, label, sort_order; update: payload=patch; insert: field_type, is_active, item_id, label, sort_order
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\ob-utsida\page.tsx:250
  - operation: insert, select, update, delete
  - select: '*'
  - filters: eq('id', id); eq('id', id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: insert: group_id, is_active, label, sort_order, trigger_tags; update: payload=patch
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\ob-utsida\page.tsx:273
  - operation: update, delete
  - select: (none)
  - filters: eq('id', id); eq('id', id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: update: payload=patch
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\ob-utsida\page.tsx:284
  - operation: delete
  - select: (none)
  - filters: eq('id', id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: (none)
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepUtsida.tsx:205
  - operation: select, select, insert, select, select
  - select: '*'; '*'; '*'; 'id, key, title, label, tags, exterior_item_key'
  - filters: in('group_id', groupIds); eq('is_active', true); eq('inspection_id', inspection.id); eq('scope', 'exterior'); eq('is_active', true); eq('exterior_item_key', it.key)
  - order: order('sort_order', { ascending: true }); order('created_at', { ascending: true })
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: insert: exterior_item_id, inspection_id, note, part_label, values

#### settings_interior_groups

- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\ob-insida\page.tsx:66
  - operation: select, select, insert, select, update, delete, insert, select, update, delete, insert, select, update, delete
  - select: '*'; '*'; '*'; '*'; '*'
  - filters: eq('id', id); eq('id', id); eq('id', id); eq('id', id); eq('id', id); eq('id', id)
  - order: order('sort_order', { ascending: true }); order('sort_order', { ascending: true })
  - pagination: (none)
  - single/maybeSingle: single, single, single
  - payload keys: insert: is_active, label, sort_order; update: payload=patch; insert: field_type, is_active, label, sort_order; update: payload=patch; insert: group_id, is_active, label, sort_order; update: payload=patch
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\ob-insida\page.tsx:154
  - operation: insert, select, update, delete, insert, select, update, delete
  - select: '*'; '*'
  - filters: eq('id', id); eq('id', id); eq('id', id); eq('id', id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single, single
  - payload keys: insert: field_type, is_active, label, sort_order; update: payload=patch; insert: group_id, is_active, label, sort_order; update: payload=patch
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\ob-insida\page.tsx:181
  - operation: update, delete, insert, select, update, delete
  - select: '*'
  - filters: eq('id', id); eq('id', id); eq('id', id); eq('id', id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: update: payload=patch; insert: group_id, is_active, label, sort_order; update: payload=patch
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\ob-insida\page.tsx:193
  - operation: delete, insert, select, update, delete
  - select: '*'
  - filters: eq('id', id); eq('id', id); eq('id', id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: insert: group_id, is_active, label, sort_order; update: payload=patch
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepInsida.tsx:204
  - operation: select, select, select, select, select, select
  - select: '*'; '*'; '*'; 'id, key'; 'values'; '*'
  - filters: eq('is_active', true); eq('is_active', true); eq('inspection_id', inspection.id); eq('key', 'building_type'); eq('is_active', true); eq('inspection_id', inspection.id); eq('overview_item_id', buildingItem.id); in('interior_room_id', roomIds)
  - order: order('sort_order', { ascending: true }); order('sort_order', { ascending: true }); order('floor_label', { ascending: true }); order('order_index', { ascending: true }); order('set_index', { ascending: true }); order('sort_order', { ascending: true })
  - pagination: (none)
  - single/maybeSingle: maybeSingle
  - payload keys: (none)

#### settings_interior_options

- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\ob-insida\page.tsx:70
  - operation: select, insert, select, update, delete, insert, select, update, delete, insert, select, update, delete
  - select: '*'; '*'; '*'; '*'
  - filters: eq('id', id); eq('id', id); eq('id', id); eq('id', id); eq('id', id); eq('id', id)
  - order: order('sort_order', { ascending: true })
  - pagination: (none)
  - single/maybeSingle: single, single, single
  - payload keys: insert: is_active, label, sort_order; update: payload=patch; insert: field_type, is_active, label, sort_order; update: payload=patch; insert: group_id, is_active, label, sort_order; update: payload=patch
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\ob-insida\page.tsx:217
  - operation: insert, select, update, delete
  - select: '*'
  - filters: eq('id', id); eq('id', id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: insert: group_id, is_active, label, sort_order; update: payload=patch
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\ob-insida\page.tsx:242
  - operation: update, delete
  - select: (none)
  - filters: eq('id', id); eq('id', id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: update: payload=patch
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\ob-insida\page.tsx:254
  - operation: delete
  - select: (none)
  - filters: eq('id', id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: (none)
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepInsida.tsx:209
  - operation: select, select, select, select, select, select
  - select: '*'; '*'; 'id, key'; 'values'; '*'; '*'
  - filters: eq('is_active', true); eq('inspection_id', inspection.id); eq('key', 'building_type'); eq('is_active', true); eq('inspection_id', inspection.id); eq('overview_item_id', buildingItem.id); in('interior_room_id', roomIds); eq('inspection_id', inspection.id); not('control_item_id', 'is', null)
  - order: order('sort_order', { ascending: true }); order('floor_label', { ascending: true }); order('order_index', { ascending: true }); order('set_index', { ascending: true }); order('sort_order', { ascending: true }); order('sort_order', {)
  - pagination: (none)
  - single/maybeSingle: maybeSingle
  - payload keys: (none)

#### settings_interior_room_types

- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\ob-control-points\page.tsx:100
  - operation: select, select
  - select: '*'; '*'
  - filters: eq('is_active', true); eq('is_active', true)
  - order: order('sort_order', { ascending: true }); order('sort_order', { ascending: true })
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: (none)
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\ob-insida\page.tsx:62
  - operation: select, select, select, insert, select, update, delete, insert, select, update, delete, insert, select, update, delete
  - select: '*'; '*'; '*'; '*'; '*'; '*'
  - filters: eq('id', id); eq('id', id); eq('id', id); eq('id', id); eq('id', id); eq('id', id)
  - order: order('sort_order', { ascending: true }); order('sort_order', { ascending: true }); order('sort_order', { ascending: true })
  - pagination: (none)
  - single/maybeSingle: single, single, single
  - payload keys: insert: is_active, label, sort_order; update: payload=patch; insert: field_type, is_active, label, sort_order; update: payload=patch; insert: group_id, is_active, label, sort_order; update: payload=patch
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\ob-insida\page.tsx:100
  - operation: insert, select, update, delete, insert, select, update, delete, insert, select, update, delete
  - select: '*'; '*'; '*'
  - filters: eq('id', id); eq('id', id); eq('id', id); eq('id', id); eq('id', id); eq('id', id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single, single, single
  - payload keys: insert: is_active, label, sort_order; update: payload=patch; insert: field_type, is_active, label, sort_order; update: payload=patch; insert: group_id, is_active, label, sort_order; update: payload=patch
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\ob-insida\page.tsx:124
  - operation: update, delete, insert, select, update, delete, insert, select, update, delete
  - select: '*'; '*'
  - filters: eq('id', id); eq('id', id); eq('id', id); eq('id', id); eq('id', id); eq('id', id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single, single
  - payload keys: update: payload=patch; insert: field_type, is_active, label, sort_order; update: payload=patch; insert: group_id, is_active, label, sort_order; update: payload=patch
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\ob-insida\page.tsx:136
  - operation: delete, insert, select, update, delete, insert, select, update, delete
  - select: '*'; '*'
  - filters: eq('id', id); eq('id', id); eq('id', id); eq('id', id); eq('id', id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single, single
  - payload keys: insert: field_type, is_active, label, sort_order; update: payload=patch; insert: group_id, is_active, label, sort_order; update: payload=patch
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepInsida.tsx:199
  - operation: select, select, select, select, select, select, select
  - select: '*'; '*'; '*'; '*'; 'id, key'; 'values'; '*'
  - filters: eq('is_active', true); eq('is_active', true); eq('is_active', true); eq('inspection_id', inspection.id); eq('key', 'building_type'); eq('is_active', true); eq('inspection_id', inspection.id); eq('overview_item_id', buildingItem.id); in('interior_room_id', roomIds)
  - order: order('sort_order', { ascending: true }); order('sort_order', { ascending: true }); order('sort_order', { ascending: true }); order('floor_label', { ascending: true }); order('order_index', { ascending: true }); order('set_index', { ascending: true }); order('sort_order', { ascending: true })
  - pagination: (none)
  - single/maybeSingle: maybeSingle
  - payload keys: (none)

#### settings_overview_groups

- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\forutsattningar\page.tsx:112
  - operation: select, select, insert, select, update
  - select: '*'; '*'; '*'
  - filters: eq('overview_item_id', overviewItemId); eq('group_id', groupId); eq('id', id)
  - order: order('sort_order', { ascending: true }); order('sort_order', { ascending: true })
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: insert: is_active, label, note_enabled, selection_mode, sort_order; update: payload=patch
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\forutsattningar\page.tsx:243
  - operation: insert, select, update, update, delete, insert, select
  - select: '*'; '*'
  - filters: eq('id', id); eq('id', id); eq('id', id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single, single
  - payload keys: insert: conditional_on_group_key, conditional_on_values, is_active, label, overview_item_id, sort_order; update: payload=patch; update: is_active; insert: group_id, is_active, label, sort_order, trigger_tags
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\forutsattningar\page.tsx:268
  - operation: update, update, delete, insert, select, update, update
  - select: '*'
  - filters: eq('id', id); eq('id', id); eq('id', id); eq('id', id); eq('id', id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: update: payload=patch; update: is_active; insert: group_id, is_active, label, sort_order, trigger_tags; update: payload=patch; update: is_active
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\forutsattningar\page.tsx:282
  - operation: update, delete, insert, select, update, update, delete
  - select: '*'
  - filters: eq('id', id); eq('id', id); eq('id', id); eq('id', id); eq('id', id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: update: is_active; insert: group_id, is_active, label, sort_order, trigger_tags; update: payload=patch; update: is_active
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\forutsattningar\page.tsx:295
  - operation: delete, insert, select, update, update, delete
  - select: '*'
  - filters: eq('id', id); eq('id', id); eq('id', id); eq('id', id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: insert: group_id, is_active, label, sort_order, trigger_tags; update: payload=patch; update: is_active
- C:\Users\hedbj\underhallsplan-villa\src\app\utlatande\[propertyId]\[inspectionId]\page.tsx:173
  - operation: select, select
  - select: 'id, overview_item_id, key, label, sort_order'; 'group_id, value, label'
  - filters: in('overview_item_id', overviewItemIds); eq('is_active', true); in('group_id', overviewGroupIds); eq('is_active', true)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: (none)
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepForutsattningar.tsx:139
  - operation: select, select, select, update, select, update, select, insert, select, delete
  - select: '*'; '*'; '*'; '*'; '*'; '*'
  - filters: in('overview_item_id', itemIds); eq('is_active', true); in('group_id', groupIds); eq('is_active', true); eq('inspection_id', inspection.id); eq('id', condRow.id); eq('id', sel.id); eq('id', target.id)
  - order: order('sort_order', { ascending: true }); order('sort_order', { ascending: true }); order('set_index', { ascending: true })
  - pagination: (none)
  - single/maybeSingle: single, single, single
  - payload keys: update: furnishing_level; update: note, values; insert: floor_key, inspection_id, note, overview_item_id, set_index, values

#### settings_overview_items

- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\forutsattningar\page.tsx:81
  - operation: select, select, select, select, insert, select
  - select: '*'; 'id'; '*'; '*'; '*'
  - filters: eq('overview_item_id', it.id); eq('overview_item_id', overviewItemId); eq('group_id', groupId)
  - order: order('sort_order', { ascending: true }); order('sort_order', { ascending: true }); order('sort_order', { ascending: true })
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: insert: is_active, label, note_enabled, selection_mode, sort_order
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\forutsattningar\page.tsx:175
  - operation: insert, select, update, update, delete, insert, select
  - select: '*'; '*'
  - filters: eq('id', id); eq('id', id); eq('id', id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single, single
  - payload keys: insert: is_active, label, note_enabled, selection_mode, sort_order; update: payload=patch; update: is_active; insert: conditional_on_group_key, conditional_on_values, is_active, label, overview_item_id, sort_order
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\forutsattningar\page.tsx:199
  - operation: update, update, delete, insert, select, update, update
  - select: '*'
  - filters: eq('id', id); eq('id', id); eq('id', id); eq('id', id); eq('id', id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: update: payload=patch; update: is_active; insert: conditional_on_group_key, conditional_on_values, is_active, label, overview_item_id, sort_order; update: payload=patch; update: is_active
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\forutsattningar\page.tsx:212
  - operation: update, delete, insert, select, update, update, delete
  - select: '*'
  - filters: eq('id', id); eq('id', id); eq('id', id); eq('id', id); eq('id', id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: update: is_active; insert: conditional_on_group_key, conditional_on_values, is_active, label, overview_item_id, sort_order; update: payload=patch; update: is_active
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\forutsattningar\page.tsx:225
  - operation: delete, insert, select, update, update, delete, insert
  - select: '*'
  - filters: eq('id', id); eq('id', id); eq('id', id); eq('id', id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: insert: conditional_on_group_key, conditional_on_values, is_active, label, overview_item_id, sort_order; update: payload=patch; update: is_active; insert: group_id, label, sort_order
- C:\Users\hedbj\underhallsplan-villa\src\app\utlatande\[propertyId]\[inspectionId]\page.tsx:161
  - operation: select, select, select
  - select: 'id, key, label, sort_order'; 'id, overview_item_id, key, label, sort_order'; 'group_id, value, label'
  - filters: in('key', overviewItemKeys); eq('is_active', true); in('overview_item_id', overviewItemIds); eq('is_active', true); in('group_id', overviewGroupIds); eq('is_active', true)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: (none)
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepForutsattningar.tsx:128
  - operation: select, select, select, select, update, select, update, select, insert, select, delete
  - select: '*'; '*'; '*'; '*'; '*'; '*'; '*'
  - filters: eq('is_active', true); in('overview_item_id', itemIds); eq('is_active', true); in('group_id', groupIds); eq('is_active', true); eq('inspection_id', inspection.id); eq('id', condRow.id); eq('id', sel.id); eq('id', target.id)
  - order: order('sort_order', { ascending: true }); order('sort_order', { ascending: true }); order('sort_order', { ascending: true }); order('set_index', { ascending: true })
  - pagination: (none)
  - single/maybeSingle: single, single, single
  - payload keys: update: furnishing_level; update: note, values; insert: floor_key, inspection_id, note, overview_item_id, set_index, values
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepInsida.tsx:241
  - operation: select, select, select, select
  - select: 'id, key'; 'values'; '*'; '*'
  - filters: eq('key', 'building_type'); eq('is_active', true); eq('inspection_id', inspection.id); eq('overview_item_id', buildingItem.id); in('interior_room_id', roomIds); eq('inspection_id', inspection.id); not('control_item_id', 'is', null)
  - order: order('set_index', { ascending: true }); order('sort_order', { ascending: true }); order('sort_order', { ascending: true }); order('created_at', { ascending: true })
  - pagination: (none)
  - single/maybeSingle: maybeSingle
  - payload keys: (none)

#### settings_overview_options

- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\forutsattningar\page.tsx:131
  - operation: select, insert, select, update, update, delete
  - select: '*'; '*'
  - filters: eq('group_id', groupId); eq('id', id); eq('id', id); eq('id', id)
  - order: order('sort_order', { ascending: true })
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: insert: is_active, label, note_enabled, selection_mode, sort_order; update: payload=patch; update: is_active
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\forutsattningar\page.tsx:313
  - operation: insert, select, update, update, delete
  - select: '*'
  - filters: eq('id', id); eq('id', id); eq('id', id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: single
  - payload keys: insert: group_id, is_active, label, sort_order, trigger_tags; update: payload=patch; update: is_active
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\forutsattningar\page.tsx:336
  - operation: update, update, delete
  - select: (none)
  - filters: eq('id', id); eq('id', id); eq('id', id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: update: payload=patch; update: is_active
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\forutsattningar\page.tsx:350
  - operation: update, delete
  - select: (none)
  - filters: eq('id', id); eq('id', id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: update: is_active
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\forutsattningar\page.tsx:363
  - operation: delete
  - select: (none)
  - filters: eq('id', id)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: (none)
- C:\Users\hedbj\underhallsplan-villa\src\app\utlatande\[propertyId]\[inspectionId]\page.tsx:186
  - operation: select
  - select: 'group_id, value, label'
  - filters: in('group_id', overviewGroupIds); eq('is_active', true)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: (none)
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepForutsattningar.tsx:151
  - operation: select, select, update, select, update, select, insert, select, delete
  - select: '*'; '*'; '*'; '*'; '*'
  - filters: in('group_id', groupIds); eq('is_active', true); eq('inspection_id', inspection.id); eq('id', condRow.id); eq('id', sel.id); eq('id', target.id)
  - order: order('sort_order', { ascending: true }); order('set_index', { ascending: true })
  - pagination: (none)
  - single/maybeSingle: single, single, single
  - payload keys: update: furnishing_level; update: note, values; insert: floor_key, inspection_id, note, overview_item_id, set_index, values

#### spaces

- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\page.tsx:405
  - operation: insert
  - select: (none)
  - filters: (none)
  - order: (none)
  - pagination: (none)
  - single/maybeSingle: (none)
  - payload keys: insert: payload=seeds

### RPC Functions

No rpc() usage found.

### Storage Buckets

#### property-media

- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\buildings\page.tsx:72 - ops: createSignedUrl, preventDefault, insert, delete, eq, error, split, pop, toLowerCase, upload, update, eq, select, eq, order, order, split, pop, toLowerCase, randomUUID, upload, insert, delete, eq, remove; paths: createSignedUrl: path; upload: path; remove: [m.path]
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\buildings\page.tsx:120 - ops: upload, update, eq, select, eq, order, order, split, pop, toLowerCase, randomUUID, upload, insert, delete, eq, remove; paths: upload: path; remove: [m.path]
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\buildings\page.tsx:170 - ops: upload, insert, delete, eq, remove; paths: upload: path; remove: [m.path]
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\buildings\page.tsx:193 - ops: remove; paths: remove: [m.path]
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\page.tsx:228 - ops: upload, getPublicUrl, now, update, eq, error, split, pop, toLowerCase, upload, getPublicUrl, now, update, eq, map, error, update, eq; paths: upload: filePath; getPublicUrl: filePath
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\page.tsx:232 - ops: getPublicUrl, now, update, eq, error, split, pop, toLowerCase, upload, getPublicUrl, now, update, eq, map, error, update, eq; paths: getPublicUrl: filePath; upload: filePath
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\page.tsx:264 - ops: upload, getPublicUrl, now, update, eq, map, error, update, eq, delete, eq, error, push, error, select, eq; paths: upload: filePath; getPublicUrl: filePath

### Auth and Realtime

#### Auth

- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\page.tsx:37 - getUser
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\page.tsx:88 - getUser
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\settings\page.tsx:76 - getUser
- C:\Users\hedbj\underhallsplan-villa\src\app\(auth)\login\page.tsx:13 - getSession
- C:\Users\hedbj\underhallsplan-villa\src\app\(auth)\login\page.tsx:17 - onAuthStateChange
- C:\Users\hedbj\underhallsplan-villa\src\app\utlatande\_components\ClientSessionDebug.tsx:25 - getSession
- C:\Users\hedbj\underhallsplan-villa\src\app\utlatande\_components\SessionBridge.tsx:30 - token
- C:\Users\hedbj\underhallsplan-villa\src\app\utlatande\_components\SessionBridge.tsx:61 - getSession
- C:\Users\hedbj\underhallsplan-villa\src\app\utlatande\_components\SessionBridge.tsx:69 - setSession
- C:\Users\hedbj\underhallsplan-villa\src\app\utlatande\[propertyId]\[inspectionId]\page.tsx:71 - getUser
- C:\Users\hedbj\underhallsplan-villa\src\components\Protected.tsx:21 - getSession
- C:\Users\hedbj\underhallsplan-villa\src\components\Protected.tsx:33 - onAuthStateChange
- C:\Users\hedbj\underhallsplan-villa\src\components\Topbar.tsx:15 - getUser
- C:\Users\hedbj\underhallsplan-villa\src\components\Topbar.tsx:19 - signOut
- C:\Users\hedbj\underhallsplan-villa\src\hooks\useProfile.ts:20 - getUser

No realtime usage found.

### Client Initialization and Environment Variables

#### Client Initialization

- C:\Users\hedbj\underhallsplan-villa\src\app\utlatande\_components\SessionBridge.tsx:4 - createClient
- C:\Users\hedbj\underhallsplan-villa\src\app\utlatande\_components\SessionBridge.tsx:59 - createClient
- C:\Users\hedbj\underhallsplan-villa\src\lib\supabase\server.ts:2 - createServerClient
- C:\Users\hedbj\underhallsplan-villa\src\lib\supabase\server.ts:20 - createServerClient
- C:\Users\hedbj\underhallsplan-villa\src\lib\supabaseClient.ts:2 - createBrowserClient
- C:\Users\hedbj\underhallsplan-villa\src\lib\supabaseClient.ts:8 - createBrowserClient
- C:\Users\hedbj\underhallsplan-villa\src\types\supabase.ts:10 - createClient
- C:\Users\hedbj\underhallsplan-villa\src\types\supabase.ts:11 - createClient

#### Environment Variable References

- C:\Users\hedbj\underhallsplan-villa\docs\AI_PLAYBOOK.md:5 - SUPABASE_SCHEMA
- C:\Users\hedbj\underhallsplan-villa\src\app\(app)\properties\[id]\page.tsx:68 - NEXT_PUBLIC_SUPABASE_URL
- C:\Users\hedbj\underhallsplan-villa\src\app\utlatande\_components\SessionBridge.tsx:54 - NEXT_PUBLIC_SUPABASE_URL
- C:\Users\hedbj\underhallsplan-villa\src\app\utlatande\_components\SessionBridge.tsx:55 - NEXT_PUBLIC_SUPABASE_ANON_KEY
- C:\Users\hedbj\underhallsplan-villa\src\app\utlatande\[propertyId]\[inspectionId]\page.tsx:212 - NEXT_PUBLIC_SUPABASE_URL
- C:\Users\hedbj\underhallsplan-villa\src\lib\supabase\server.ts:8 - NEXT_PUBLIC_SUPABASE_URL
- C:\Users\hedbj\underhallsplan-villa\src\lib\supabase\server.ts:9 - NEXT_PUBLIC_SUPABASE_ANON_KEY
- C:\Users\hedbj\underhallsplan-villa\src\lib\supabase\server.ts:12 - NEXT_PUBLIC_SUPABASE_ANON_KEY
- C:\Users\hedbj\underhallsplan-villa\src\lib\supabase\server.ts:12 - NEXT_PUBLIC_SUPABASE_URL
- C:\Users\hedbj\underhallsplan-villa\src\lib\supabaseClient.ts:9 - NEXT_PUBLIC_SUPABASE_URL
- C:\Users\hedbj\underhallsplan-villa\src\lib\supabaseClient.ts:10 - NEXT_PUBLIC_SUPABASE_ANON_KEY

### Raw SQL / Migrations

No .sql files found in the scanned paths.

### RLS / Policy References

- C:\Users\hedbj\underhallsplan-villa\docs\TECH_OVERVIEW.md:8
- C:\Users\hedbj\underhallsplan-villa\docs\TECH_OVERVIEW.md:51
- C:\Users\hedbj\underhallsplan-villa\docs\TECH_OVERVIEW.md:53
- C:\Users\hedbj\underhallsplan-villa\docs\TECH_OVERVIEW.md:53
- C:\Users\hedbj\underhallsplan-villa\docs\TECH_OVERVIEW.md:53
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepForutsattningar.tsx:700
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepForutsattningar.tsx:700
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepForutsattningar.tsx:701
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepInsida.tsx:916
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepInsida.tsx:916
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepUtsida.tsx:924
- C:\Users\hedbj\underhallsplan-villa\src\components\ob\ObStepUtsida.tsx:924

## Inferred Schema Hints

- basic_fields: building_id, field_group, field_id, field_type, id, is_critical, key, label, options, order_index, value_text
- building_basic_values: building_id, content, cover_path, field_id, id, title, value_text
- building_disclosures: building_id, content, field_group, field_id, field_type, id, is_critical, key, label, options, order_index, title, value_text
- building_media: building_id, caption, created_at, id, path, sort_order
- buildings: building_id, built_year, caption, cover_path, created_at, field_group, field_id, field_type, id, is_critical, key, label, name, notes, options, order_index, path, property_id, sort_order, value_text
- component_types: category, code, default_lifespan_years, description, id, is_active, is_default, label, maintenance_interval_years, name, notes, scope, technical_lifespan_years
- document_types: 'id, category, code, defect_disclosures, description, id, inspection_id, interval_note, is_active, is_default, label, mainte, maintenance_interval_years, name, note, notes, recommended_interval_years, result_label, result_unit, scope, technical_lifespan_years, title, validity_years
- inspection_conditions: building_form, building_type, building_year, facade, floor_key, foundation, frame, furnishing_level, group_id, heating, id, inspection_id, joists, key, label, note, overview_item_id, roof, set_index, sewer, sort_order, value, values, ventilation, water, weather, weather_note, windows
- inspection_control_items: 'id, control_point_id, description, exterior_observation_id, ftu_tem, ftu_template, id, inspection_id, interior_room_id, is_active, key, label, note, risk_template, selected_outcome_id, severity, sort_order, status, tags, title, trigger_room_types, updated_at
- inspection_disclosures: building_form, building_type, building_year, defect_disclosures, facade, floor_key, foundation, frame, furnishing_level, group_id, heating, id, inspection_id, joists, key, label, note, overview_item_id, roof, set_index, sewer, sort_order, title, value, values, ventilation, water, weather, weather_note, windows
- inspection_documents: building_form, building_type, building_year, defect_disclosures, facade, floor_key, foundation, frame, furnishing_level, group_id, heating, id, inspection_id, joists, key, label, note, overview_item_id, roof, set_index, sewer, sort_order, status, title, value, values, ventilation, water, weather, weather_note, windows
- inspection_exterior_observations: control_point_id, exterior_item_id, exterior_item_key, exterior_observation_id, id, inspection_id, key, label, note, part_label, selected_outcome_id, sort_order, status, tags, title, updated_at, values
- inspection_images: control_item_id, exterior_item_id, exterior_observation_id, file_path, floor_label, inspection_id, interior_room_id, label, note, order_index, part_label, room_label, room_type_key, sort_order, values
- inspection_interior_rooms: floor_label, id, inspection_id, key, note, order_index, room_label, room_type_key, values
- inspection_overview_selections: floor_key, furnishing_level, group_id, id, inspection_id, is_active, key, label, note, note_enabled, overview_item_id, selection_mode, set_index, sort_order, value, values
- inspections: address, assignment_confirmation_delivered_date, assignment_number, attendees, attendees_other, building_form, building_type, building_year, cadastral_id, city, client_contact, client_name, company_address, company_city, company_name, company_orgno, company_postal_code, created_at, date, defect_disclosures, dwelling_type, email, facade, floor_key, foundation, frame, full_name, furnishing_level, group_id, heating, id, inspection_side, inspection_time, inspector_name, joists, key, label, logo_path, membership_number, municipality, name, note, overview_item_id, owner_name, phone, postal_code, property_id, roof, sbr_group, sbr_status, scope, set_index, sewer, sort_order, status, tenure_type, title, type, value, values, ventilation, water, weather, weather_note, windows
- profiles: avatar_path, building_form, building_type, building_year, company_address, company_city, company_name, company_orgno, company_postal_code, email, facade, floor_key, foundation, frame, full_name, furnishing_level, group_id, heating, id, is_admin, joists, key, label, logo_path, logo_url, membership_number, note, org_name, overview_item_id, phone, roof, sbr_group, sbr_status, set_index, sewer, sort_order, status, title, value, values, ventilation, water, weather, weather_note, windows
- properties: address, assignment_confirmation_delivered_date, assignment_number, attendees, attendees_other, building_form, building_type, building_year, cadastral_id, city, client_contact, client_name, company_address, company_city, company_name, company_orgno, company_postal_code, cover_path, created_at, date, defect_disclosures, dwelling_type, email, facade, floor_key, foundation, frame, full_name, furnishing_level, group_id, heating, id, inspection_time, inspector_name, joists, key, label, logo_path, membership_number, municipality, name, note, overview_item_id, owner, owner_name, phone, postal_code, property_id, roof, sbr_group, sbr_status, scope, set_index, sewer, sort_order, status, tenure_type, title, type, value, values, ventilation, water, weather, weather_note, windows
- property-media: building_id, caption, cover_path, created_at, id, path, sort_order
- settings_control_point_outcomes: control_point_id, description, ftu_template, id, is_active, label, risk_template, severity, sort_order, title
- settings_control_points: description, exterior_item_key, id, is_active, key, label, note, part_label, question, risk_tags, room_type_key, scope, sort_order, tags, title, trigger_room_types, values
- settings_exterior_groups: exterior_item_id, exterior_item_key, field_type, group_id, id, inspection_id, is_active, item_id, key, label, note, part_label, sort_order, tags, title, trigger_tags, values
- settings_exterior_items: exterior_item_id, field_type, group_id, inspection_id, is_active, item_id, key, label, part_label, scope, sort_order, trigger_tags
- settings_exterior_options: exterior_item_id, exterior_item_key, field_type, group_id, id, inspection_id, is_active, item_id, key, label, note, part_label, sort_order, tags, title, trigger_tags, values
- settings_interior_groups: field_type, group_id, id, is_active, key, label, sort_order, values
- settings_interior_options: field_type, group_id, id, is_active, key, label, sort_order, values
- settings_interior_room_types: field_type, group_id, id, is_active, key, label, sort_order, values
- settings_overview_groups: conditional_on_group_key, conditional_on_values, floor_key, furnishing_level, group_id, id, inspection_id, is_active, key, label, note, note_enabled, overview_item_id, selection_mode, set_index, sort_order, trigger_tags, value, values
- settings_overview_items: conditional_on_group_key, conditional_on_values, floor_key, furnishing_level, group_id, id, inspection_id, is_active, key, label, note, note_enabled, overview_item_id, selection_mode, set_index, sort_order, value, values
- settings_overview_options: floor_key, furnishing_level, group_id, inspection_id, is_active, label, note, note_enabled, overview_item_id, selection_mode, set_index, sort_order, trigger_tags, value, values
- spaces: (none observed)