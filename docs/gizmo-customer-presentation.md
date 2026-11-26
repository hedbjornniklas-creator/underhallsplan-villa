# Bestallare och momsvisning i Gizmo

## Beslut 2026-11-26

- Projektet har ett gemensamt val under Oversikt: Privatperson, Foretag eller Forening / BRF.
- Privatperson visas inklusive moms. Foretag foreslas exklusive moms. Forening foreslas inklusive moms och kan valja exklusive. Foretag kan ocksa valja inklusive.
- En redan sparad bestallare klassificeras inte om automatiskt. Aldre projekt behaller tidigare visning tills ett uttryckligt projektval sparas.
- Avtalsgrund valjs separat. Kundtypen valjer inte automatiskt mellan AB 04 och ABT 06 och byter aldrig ett befintligt formular.
- Valet galler kundpris, offert, avtalsutkast, ATA och betalningsplan. Den interna kalkylen och leverantorskostnadernas nettobas ar separata.
- Befintliga kundprisfalt lagras fortfarande inklusive moms i ore. B2B-offertdelarnas `amountExVatOre` ar fortsatt exklusive moms. Ingen migrering av belopp gors.
- Kundprismodellens befintliga standardsats 25 procent anvands for dokumentens visningsomrakning. Interna kalkylrader behaller sina egna momssatser; deras nettosummering beraknas fran raderna, inte genom att dividera en blandad bruttosumma med 1,25. Momsvisning ar inte ett val av momssats, avdragsratt, momsbefrielse eller omvand byggmoms.

## Lagring och skydd

`action_case_customer_presentations` ar projektets kalla. Valet kopieras till `CustomerOfferDraft.customerPresentation` i bade offert- och avtalsutkastet, med revisionskontroll och atomisk skrivning. En request-tabell gor aterforsok idempotenta.

Inga befintliga dokument eller utkast uppdateras vid installation. En gammal flik kan inte ta bort eller andra ett infort projektval. Vid oklara svar hamtas sparat projektval uttryckligen; lokala utkast far inte skrivas over tyst.

Redigering sparras vid lasning for signering, accepterat avtal eller registrerad signerad kopia. Ett redan publicerat avtal maste aterkallas fore andring. Befintliga PDF-arkiv och dokument-snapshots skrivs aldrig om. Kunddokument renderas med sin egen sparade visning, inte projektets nuvarande standard. Nya delningar av val och tillval far en egen fryst momsvisning.

Val av registerkund ateranvander den befintliga bestallar-skrivaren. Byte av faktisk kund kraver bekraftelse, skyddar historik och aterkallar den tidigare kundens lankar och delningar. Fler bestallare eller personnummer tas inte bort automatiskt nar ett privatprojekt byter typ.

## Kontroll fore publicering

- Kor `docs/db/2026-11-26_01_project_customer_presentation.sql` fore applikationsandringen.
- Regressionstester omfattar respektive kundtyp, noll/saknat belopp, tillbakabyte, redan nettoforda B2B-priser, sparfel/aterforsok, gamla flikar, organisationsgrans, kundregister, lasning och oforandrade pris-/kalkylfalt.
- `scripts/test-customer-presentation-ui.mjs` anvander riktiga komponenter och enbart fiktiva uppgifter. Den provar desktop/mobil, vybyten, aterlasning, gammalt dokument och PDF-rendering.
- Jamfor skyddade projektdata fore och efter SQL/publicering. Andra inte ett verkligt projekts kundtyp eller priser som en del av ett verifieringsprov.
