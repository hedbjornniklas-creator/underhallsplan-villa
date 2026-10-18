# Word-export av ÖB-utlåtanden

På **Skicka utlåtande** finns **Ladda ner Word** för en redigerbar `.docx`-kopia.

- Finns ett publicerat utlåtande väljer knappen den senaste aktiva publicerade versionen. Versionens sparade `reportSpec` och `reportData` används, inte dagens besiktningsdata, noteringsbibliotek eller företagsprofil.
- Saknas publicerat utlåtande kan ansvarig besiktningsman exportera ett öppet utkast. Filnamn och omslag märks som utkast. Låsta eller arkiverade besiktningar kan inte exporteras som aktuella utkast.
- En saknad, återkallad eller ofullständig historisk version ersätts aldrig med aktuell data. Exporten avbryts med ett felmeddelande.
- Exporten skriver inte till databasen eller lagringen, publicerar inget och skickar inga mejl. Ändringar i en nedladdad Word-fil förs inte tillbaka till HusHub. Arkiverade PDF-filer och digitala utlåtanden förblir oförändrade.
- Samma modul hanterar ÖB och statusbesiktning. Extrabyggnader, noteringar, respektive risk/FTU eller rekommendation/kommentar samt rapportens bilagor ingår.
- Befintliga PDF-originalbilagor till exempelvis radon redovisas som filförteckning, inte som redigerbara Word-sidor.

`GET /api/ob/inspections/[id]/word` kräver antingen `report=<rapportversions-id>` eller `draft=1`. Organisationen verifieras via besiktningens bindning. Publicerade versioner använder samma läsbehörighet som det interna digitala utlåtandet; utkast kräver ansvarigs behörighet.

Rapportens text och fotografier blir riktiga Word-element. Fotografier bäddas in med bibehållna proportioner. Bilder hämtas bara från fasta lokala rapportresurser eller den konfigurerade Supabase-lagringen, utan omdirigeringar. Saknade bilder ger fel i stället för en ofullständig export. Storlek, antal och hämtningstid är begränsade.

Word har eget textflöde och egna sidbrytningar. PDF är fortsatt den fastställda rapportversionen; Word är en redigerbar kopia, inte en garanti för identisk paginering.

## Verifiering

- `node --experimental-strip-types --test test/ob-word-export.test.ts`
- `node scripts/preview-ob-brand.mjs --forms --test-word`
- `scripts/test-ob-word-export.mjs` genererar syntetiska ÖB- och statusrapporter för visuell kontroll. Kör med dokumentverktygens Node-runtime och `DOCUMENT_NODE_MODULES` satt till deras paketskatalog.
- Provrapporterna är öppnade och paginerade i Microsoft Word, inklusive extrabyggnader, långa noteringar, stående/liggande/kvadratiska bilder och bilagor. Den paketerade LibreOffice-renderaren finns inte på denna Windows-värd; Word-export till PDF och paketerad Poppler används för sidbilderna.
