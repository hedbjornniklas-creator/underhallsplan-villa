# Tidsuppskattningar i Uppgifter

## Beslut 2026-10-30

- Varje uppgift kan ha en frivillig uppskattad aktiv arbetstid i hela minuter.
  Snabbval ar 5, 10, 15, 30 och 60 minuter. Egen tid och tomt falt stods.
- Tid ar inte slutdatum, vantetid, tidrapportering eller en avtalad ersattning.
- Listan visar Tid och kan sorteras kortast/langst. Okand tid ligger sist i bada riktningar.
- Jag har-filter visar enskilda oppna uppgifter med bollen hos den inloggade
  personen. Vantande och avslutade uppgifter undantas. Varje visad uppgift ska
  rymmas i tiden, inte hela resultatlistan tillsammans.
- Filtrering efter tid anvander en platt lista aven om normalvyn ar grupperad,
  sa att en kort underuppgift inte doljs i ett stort huvuduppdrag.
- Kandidater utan uppskattning visas separat under Tid ej angiven. Ingen tid gissas.
- Deadline, status, uppfoljning, utskick, projektkalkyler och avtal paverkas inte.

## Implementerat

Tid lagras separat i `task_time_estimates`, med egen revision, andringstid och
verklig intern aktor. En tidsandring skriver inte till `operational_tasks`, dess
historik, aktivitetsdatum, statusversion eller notifieringskoer. API:ts opportunistiska
uppfoljning kors inte for denna atgard.

Uppdragsansvarig och intern mottagare kan andra en oppen uppgifts uppskattning.
Organisationsadministratorer far inte redigera andras tidsuppskattning enbart
genom sin roll. Externa lankar och kunder far inget nytt granssnitt eller behorighet.
Databaslas och kontroller av organisation, aktor, uppgiftsversion och tidsrevision
skyddar mot gamla flikar, samtidiga andringar och stangda uppgifter.

Skapande med uppskattning anvander en atomisk wrapper runt de befintliga
skapandefunktionerna. Utan uppskattning anvands de ursprungliga funktionerna.
Ett misslyckat skapande av uppskattningen rullar tillbaka hela den nya uppgiften.
En tom uppskattning vid andring bevarar en revisionsrad sa gamla flikar avvisas.
Nasta aterkommande forekomst far ingen gissad tid; dess vanliga skapande ar oforandrat.

SQL: `docs/db/2026-10-30_04_task_time_estimates.sql`. Migreringen ar additiv och
uppdaterar inga befintliga uppgifter. Funktionen visas forst nar tabellen finns.

## Avgransning

Ingen tidtagning, kalenderbokning, automatisk paketplanering eller kostnadsberakning.
Filtervalet for tillganglig tid ar tillfalligt. Listans befintliga sorteringspreferenser
sparas som tidigare, aven sortering pa Tid.
