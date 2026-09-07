# Föreningens renoveringsregler

## Driftsättning

1. Kör hela `docs/db/2026-09-07_02_renoapp_renovation_rules.sql` i Supabase SQL Editor innan den nya koden driftsätts. Migrationen kan köras igen och skapar även den privata lagringsbehållaren `renoapp-brf-rules`.
2. Driftsätt koden. Inga nya miljövariabler behövs.
3. Markera kryssrutan för godkännande och publicera text eller PDF under RenoApp > BRF > Föreningens renoveringsregler.
4. Kontrollera en ny ansökan utan och med godkännande, och öppna sedan den sparade versionen i styrelseportalen.

## Beteende

- En publicerad version per BRF, antingen ren text med radbrytningar (högst 50 000 tecken) eller PDF (högst 15 MB).
- Kryssrutan styr om reglerna ska godkännas vid nya ansökningar. Valet gäller först när styrelsen sparar. Befintliga publicerade regler visas som aktiverade; utan publicerade regler är valet avmarkerat.
- När kravet stängs av behålls den senast sparade texten eller PDF-filen för återaktivering. Återaktivering publicerar en ny version; sparad PDF kopieras till en ny versionssökväg utan att styrelsen behöver ladda upp filen igen. Ingen ytterligare SQL-migration behövs för kryssrutan.
- Publicering kräver samma aktiva BRF-åtkomst som redigering av BRF-information. Innehållet får en ny, oföränderlig version. Samtidiga ändringar skyddas med kontroll av föregående versions-id.
- Utkast och autosparning registrerar inget godkännande. Första inskickningen kontrollerar aktuell version och kräver en uttrycklig bekräftelse när regler finns. Servern sparar sökandens då angivna namn och e-post; det är inte en separat identitetsverifiering.
- Databastriggern låser BRF-raden vid första inskickningen. Publicering låser samma rad. En ny version kan därför inte smyga in mellan versionskontroll och sparande av inskickningsstatus/godkännande.
- Kompletteringar behåller den version och bekräftelse som sparades vid första inskickningen. Äldre inskickade ärenden får inget fabricerat godkännande. Reglernas godkännande påverkar inte styrelsens beslut om renoveringen.
- Avpublicering tar bort kravet för framtida första inskickningar. Historiska versioner och bekräftelser bevaras. Ett öppet utkast med gamla regler får besked om ändringen och behåller formulärinnehållet.
- Reglerna är separata från HusHubs villkor för BRF:ens användning av RenoApp och från föreningens introduktionstext.

## PDF och åtkomst

PDF laddas först upp direkt till privat lagring med en signerad uppladdningslänk. Servern kontrollerar storlek och PDF-signatur/filslut och skapar sedan en separat kopia under `BRF-id/published/`. En gammal uppladdningslänk kan alltså inte skriva över den publicerade filen. Kontrollen är formatkontroll, inte antivirus eller fullständig PDF-validering.

Gränssnittet har endast länken Öppna PDF. Filen returneras efter behörighetskontroll med `application/pdf` och `Content-Disposition: inline` för visning i en ny flik. Webbläsarens PDF-visare erbjuder normalt nedladdning; egna webbläsarinställningar kan fortfarande välja att spara PDF-filer. Äldre länkar med `download=1` fungerar fortsatt.

Aktuella publicerade PDF-regler kan läsas på den öppna ansökningssidan. Historiska filer kräver en aktiv ärendelänk knuten till rätt BRF och regelversion, eller inloggad åtkomst till den aktuella BRF:en. Nedladdningslänkar är kortlivade och cachas inte. Historiska texter lämnas ut genom ärendets behörighetskontrollerade läsning och den senast sparade versionen kan även hämtas av behörig styrelse på BRF-sidan.

Publicerade filer ska inte raderas manuellt: äldre ansökningar refererar till dem. Avbrutna uppladdningar kan lämna filer under `BRF-id/uploads/`. Dessa är inte publicerade och kan städas efter att uppladdningslänkarnas giltighet gått ut. Rör inte `published/` vid sådan städning.

## Verifiering

- `npm run test:renoapp-rules`: kör den faktiska SQL-migrationen i PGlite samt API- och filhanteringstester.
- `node scripts/test-renoapp-rules-ui.mjs`: testar kryssrutan, sparande, omladdning, text/PDF, återaktivering och felhantering i tre skärmbredder med mockade API-svar.
- `npm run test:renoapp-brf`: befintliga tester för BRF-åtkomst och livscykel.
- `npx tsc --noEmit --incremental false`: typkontroll.

Gränssnittet bör kontrolleras med text och PDF, även på mobil, samt vid versionskonflikt och avbruten uppladdning. Tester får använda mockade API-svar och ska inte skicka riktiga ansökningar eller mejl.
