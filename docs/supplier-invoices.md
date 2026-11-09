# Leverantörsfakturor i Uppgifter

Första versionen, 5 november 2026. Manuell registrering och uppföljning av leverantörskostnader i Uppgifter (`/uppdrag`). Registrering, granskning och manuellt noterad betalning är separata uppgifter. Funktionen bokför eller betalar inte fakturor och ansluter inte till Fortnox.

## Projektflöde, etapp 1 den 7 november 2026

Beslutat: projektets fakturor samlas under **Betalning och fakturering → Leverantörsfakturor**. Det gemensamma registret återanvänds; den gamla projektplaceringen under Projektarbete tas bort. Det globala registret behålls.

- Släpp PDF eller JPG/PNG/WebP i projektvyn, eller välj filer. Flera filer registreras som separata fakturor i en kö. Originalet visas i en bred sidopanel. Gräns: 4 MiB per fil, 20 bilagor per faktura.
- Fyll i leverantör, fakturanummer, fakturadatum, nettobelopp och momsbelopp. Bruttobelopp räknas fram. Projektflödet kräver inte förfallodag eller betalningsnotering. Äldre uppgifter om dessa fält bevaras.
- Metadata och fördelning autosparas när uppgifterna är giltiga. Sparfel behåller utkastet och kan återförsökas. Filer laddas upp efter bekräftad registrering; osparade filer måste väljas igen efter omladdning.
- En ny faktura räknas först helt som **Gemensamt / ej momentfördelat**. Fördela hela beloppet eller dela det på moment och ÄTA. Hela nettobeloppet ska vara fördelat innan ett ändrat projektutkast sparas; befintliga fördelningar till andra projekt lämnas kvar. En tillfälligt ofullständig fördelning skriver inte bort den sparade projektkostnaden.
- ÄTA avser alternativ med `offer.kind='change'` i Val och tillval. Att fördela en kostnad dit är inte ett godkännande av ÄTA:n.
- **Till fakturaunderlag** kräver originalfil, sparad faktura, uttryckligt urval och granskning av påslag, kundmoms och hänvisning till avtal/överenskommelse. För ÄTA anges även hänvisning till kundens godkännande, till exempel ett mejl. Detta är manuell dokumentation, inte ett nytt digitalt godkännandeflöde.
- Prisvillkor läses från låst avtalsversion när sådan finns, annars från momentets kundpris. Arbete och material väljs uttryckligen om momentets prisvillkor är uppdelade. Fastprisdelens kostnad får inte omvandlas till extra kunddebitering. Saknade villkor fylls inte med ett gissat standardpåslag.
- Fakturaunderlaget innehåller kundbeloppet, inte intern kalkyl, intern anteckning eller leverantörens original. Det är en bilaga till den faktura som skapas manuellt i ekonomisystemet, inte själva fakturan.
- Varje fördelningsrad har stabil identitet. Kopplingen till fakturaunderlaget skapas atomiskt och samma kostnadsrad kan inte hämtas igen. En kopplad kostnad och dess kundrad kan inte skrivas över eller tas bort; rättning sker via separat kredit. Andra manuella rader och underlagets rubrik/period kan redigeras.
- Krediter registreras som egna poster med positiva inmatningsbelopp och räknas negativt i projektkostnad och kundunderlag. Ingen betalning eller kvittning antas.

Migration: `docs/db/2026-11-07_02_project_supplier_invoices.sql`, efter de två migrationerna som anges överst i filen. Ingen automatisk omskrivning av befintliga fakturor, avtal, kundpriser eller kalkyler. Fortnox, OCR, automatisk ÄTA-attest och betalningsavstämning ligger utanför etappen. Kostnadsutfallet är leverantörskostnader, inte en fullständig prognos som även omfattar eget arbete.

Beslutslogg: 2026-11-07 godkände användaren etapp 1 med projektplacering, fördelning på moment/ÄTA och koppling till fakturaunderlag. Avtal och kalkyl ska vara oförändrade. Fortnox tas senare.

Lokala kontroller: `node scripts/preview-project-supplier-invoices.mjs --test` och `node --experimental-strip-types --test test/supplier-invoices-*.test.mjs`. Förhandsvisningen använder endast fiktiva data.

## Ursprungligt Registerflöde

Den följande etappen beskrivs i [Gizmos faktureringsflöde](gizmo-billing-flow.md).
När ett projekt
uttryckligen börjar använda den, går **Till fakturering** till kostnads- och
faktureringsregistret. Det äldre underlagsflödet ovan bevaras som historik;
befintliga fakturor eller kalkyler migreras inte automatiskt.

1. Öppna fliken **Leverantörsfakturor** i Uppgifter. Projektets förenklade flöde finns enligt avsnittet ovan under **Betalning och fakturering**.
2. Registrera leverantör, organisationsnummer om det finns, fakturanummer, fakturadatum, förfallodatum, belopp exklusive moms och momsbelopp i SEK.
3. Vid behov: klistra in fakturatext och fyll fält med förslag. Extraktionen använder uttryckliga etiketter. Den gissar inte leverantör från sidhuvud, räknar inte fram netto från ett totalbelopp och antar ingen momssats. Kontrollera förslagen före sparning.
4. Bifoga PDF eller JPG/PNG/WebP. Filer sparas separat från projektets delade dokument och visas inte i kund- eller UE-portalen. Den direkta uppladdningen tillåter högst 4 MiB per fil och 20 bilagor per faktura.
5. Fördela nettobeloppet på ett eller flera åtgärdsärenden och valfria åtgärder. En rad utan åtgärd hör till hela projektet. Varje rad har kostnadsslag, beskrivning och belopp. Delvis fördelning är tillåten; det som återstår syns som ofördelat. Fördelningen får aldrig överstiga fakturans nettobelopp.
6. Ange granskning och betalning var för sig. **Granskad** innebär inte **Betald**. Betald kräver datum och är en manuell notering om betalning/reglering.
7. Registrera en kreditfaktura som en egen post med positiva belopp. Dokumenttypen vänder tecknet i summeringen. En kredit kan hänvisa till en vanlig faktura i samma organisation.

Projekt i denna version är Uppgifter-modulens åtgärdsärenden (`action_cases`). Fördelning till andra modulers EB-/TU-projekt eller fristående operativa uppgifter ingår inte.

Fakturaregistret använder en kompakt tabell med en rad per faktura, cirka 32 pixlar hög. Leverantör, fakturanummer, datum, projekt, status och belopp visas i kolumner; fullständiga uppgifter öppnas från raden. Tabellen har 50 rader per sida som standard och val för 25 eller 100. Sökning och filter gäller hela registret och återgår till första sidan. Smala skärmar kan rulla tabellen i sidled. Ekonomisummeringen beräknas över samtliga relevanta fakturor, oberoende av sidindelningen.

## Beräkningar och gränser

- Belopp lagras som heltal i öre, med positiva magnituder. Dokumenttypen styr tecknet. Fakturor i andra valutor än SEK stöds inte i denna etapp.
- Registertotalen räknar varje faktura en gång. Projektkostnad räknar endast projektets fördelade andel exklusive moms. En faktura delad på två projekt får därmed inte räknas i sin helhet i båda.
- Väljs ett projekt i fakturaregistrets projektfilter visas projektets ekonomi och respektive fakturas fördelade andel. Välj **Alla projekt** för organisationens hela fakturabelopp. Sökning och statusfilter avgränsar fakturalistan; projektets ekonomisummering visar samtliga registrerade projektkostnader.
- Registrerade, granskade och bestridda fakturor ingår i registrerade kostnader. Makulerade poster bevaras, men räknas inte in. Granskade kostnader kan även summeras separat.
- Obetalt saldo visas inklusive moms och efter avdrag för oreglerade krediter. Förfallna debetfakturor visas utan automatiskt avdrag för oreglerade krediter: en kredit antas inte ha betalat en annan faktura.
- Ofördelat belopp är en arbetskö i absoluta belopp, även för krediter. En ofördelad kredit kan inte dölja att en annan faktura behöver fördelas.
- Projektvyn jämför registrerade leverantörskostnader med befintlig intern kalkyl. Eget arbete, beställda men ännu inte fakturerade kostnader och återstående arbete måste tillkomma för en fullständig prognos. Skillnaden är därför **inte** en slutkostnadsprognos, marginal eller fritt disponibelt belopp.
- Okända kalkylbelopp förblir okända. De omvandlas inte till noll. Kundpris och accepterad kundoffert ändras inte av fakturaregistrering.
- Dubblettnyckeln omfattar organisation, normaliserat leverantörsnummer/organisationsnummer (namn används när nummer saknas) och fakturanummer. Makulerade fakturor omfattas. Byt inte leverantörsidentitet för att registrera samma dokument igen. En framtida leverantörsmaster behövs för säkrare matchning av namnvarianter och poster som saknar organisationsnummer.
- Samma normaliserade namn och fakturanummer stoppas också när den ena posten saknar organisationsnummer. Att komplettera det valfria numret ska inte öppna för dubbelregistrering. Två kompletta, olika organisationsnummer kan däremot ha samma företagsnamn.
- En vanlig faktura med aktiva krediter kan inte makuleras eller ändras till kredit. Makulera berörda krediter först. Historiska makulerade krediter behåller sin referens och kan fortfarande redigeras.

## Teknisk grund och drift

Migration: `docs/db/2026-11-05_01_supplier_invoices.sql`.

Den skapar tre serverprivata tabeller: `supplier_invoices`, `supplier_invoice_attachments` och `supplier_invoice_events`. Fakturans verksamhetsdata ligger i ett validerat JSON-kontrakt; källsystem, extern identitet, organisation, revision och revisionshistorik ligger separat. Endast serverns service-roll har direkt åtkomst. API-rutterna kontrollerar aktiv organisation och modulbehörighet före läsning och ändring.

`write_supplier_invoice` sparar faktura och revisionshändelse atomiskt. Klientgenererat UUID och förväntad revision gör exakta återförsök idempotenta och stoppar gamla flikar från att skriva över nya ändringar. Kontroller mellan fakturor serialiseras per organisation. Funktionen kontrollerar att fördelningsprojekt och åtgärder tillhör rätt organisation och varandra. Bilagans metadata och historikhändelse sparas atomiskt efter privat filuppladdning. Ett bekräftat registreringsfel försöker ta bort det nyuppladdade objektet. Vid osäkert RPC-svar kontrolleras metadata före eventuell städning; ett redan registrerat eller osäkert objekt raderas inte.

Lagringshinken `supplier-invoice-files` är privat. En restriktiv policy avgränsad till hinken blockerar även äldre generösa lagringspolicyer för `anon` och `authenticated`. Inloggade användare får kortlivade nedladdningslänkar först efter organisationskontroll i servern. Fakturor och bilagor ska inte kopieras till kundens projektbilagor.

API:

- `GET /api/supplier-invoices` läser organisationens fakturor och bilagemetadata. Servern hämtar samtliga sidor så att äldre fakturor inte försvinner vid Supabases standardgräns.
- `POST /api/supplier-invoices` tar `{ operation: 'save', id, expectedRevision, invoice }` enligt `SupplierInvoiceSaveRequest`. Ny post använder revision 0. Svaret innehåller fakturalistan och `saved: { id, revision }` från själva skrivkommandot. Editorn använder denna revision, eftersom en efterföljande listläsning redan kan innehålla en annan användares nyare ändring. Bilageuppladdning flyttar inte editorns fakturarevision. Manuella anrop kan inte ange Fortnox-källa eller externa ID:n.
- `POST /api/supplier-invoices/[invoiceId]/attachments` tar multipartfältet `file`.
- `GET /api/supplier-invoices/[invoiceId]/attachments/[attachmentId]` kontrollerar åtkomst och omdirigerar till en kortlivad nedladdningslänk.

Inför aktivering: kör migrationen i ordinarie Supabase-flöde och publicera applikationsändringarna tillsammans. Migrationen ändrar inte befintliga projekt eller Fortnox-anslutningar. Den kan köras om. Lokala tester tillämpar den enbart i en isolerad PGlite-databas och utgör inte en produktionsaktivering.

Validering:

```powershell
node --experimental-strip-types --test test/supplier-invoices-domain.test.mjs test/supplier-invoices-sql.test.mjs test/supplier-invoices-server.test.mjs
node scripts/preview-supplier-invoices.mjs --test
```

Gränssnittstestet använder riktiga React-komponenter med syntetiska data och ett lokalt API i minnet. Det kontrollerar mobil/dator, projektandelar, inklistrad text med granskning, fördelning, bilagefel och återförsök, bevarat utkast vid konflikt samt samtidig ändring mellan sparning och listläsning. Ingen produktionsdata eller extern tjänst används. Utan `--test` startar samma skript en lokal förhandsvisning. Bilder sparas i `tmp/supplier-invoices-preview/`.

Vid verifieringen passerade 48 domän-, server-, API- och databastester samt gränssnittstesterna. En riktad TypeScriptkontroll av den nya funktionen och dess integreringskomponenter passerade. Full kontroll av arbetskopian stoppades av det befintliga orelaterade felet `src/app/api/dashboard/travel/route.ts:6`: saknad modul `@/lib/organizations/companyProfile`. Ingen produktionsmigration eller publicering genomfördes under arbetet.

## Förebilder och val

Samordnad leverans 2026-11-05: fakturafunktionen har kopplats till den aktuella
projektvyn och registret utan att ersätta dess befintliga projektarbetsredigerare.
En omladdning startas från uppdateringsknappen; den återställer inte fakturans
redigeringsutkast. Funktionen ingår i samma release som förbättrad frågedialog.
De två migreringarna ändrar inte befintliga avtal, kundpriser eller kalkylrader.

Följande lästes den 5 november 2026. Mönstren inspirerar utformningen; HusHub har sin egen implementation.

- [Fieldly: koppla leverantörsfaktura till arbete](https://support.fieldly.com/sv/articles/5385690-koppla-leverantorsfaktura-eller-edi-orderbekraftelse-till-ett-arbete) beskriver fördelning av hela fakturor eller enskilda poster till projekt/arbetsorder. HusHub använder ett gemensamt register och visar ofördelat belopp.
- [Bygglet: leverantörsfakturor](https://bygglet.com/funktion/leverantorsfakturor/) beskriver projekttilldelning på faktura- och radnivå samt attestflöde. HusHubs första etapp skiljer granskning från betalningsnotering. Ett flerstegsflöde för attest är inte implementerat.
- [NEXT: budget med aktivitet och läge](https://helpdesk.next-tech.com/hc/sv/articles/15993751560476-Budget-med-aktivitet-och-l%C3%A4ge-i-Next-Project) jämför budget, bokfört och prognos. HusHub visar intern kalkyl och registrerade leverantörskostnader; en fullständig prognos återstår.
- [Vercels funktionsgränser](https://vercel.com/docs/functions/limitations) begränsar förfrågans kropp till 4,5 MB. Gränsen 4 MiB ger utrymme för multipart. Större underlag kräver senare direkt, signerad lagringsuppladdning.

## Fortnox senare

Fortnox-anslutningen som redan finns i HusHub har scopekontraktet `companyinformation`, `customer`, `invoice`. Det ska inte beskrivas som stöd för leverantörsfakturor. Det kontraktet ändras inte av denna leverans.

[Fortnox API](https://api.fortnox.se/apidocs) har leverantörsfakturor med en egen intern identitet (`GivenNumber`), leverantörsnummer, fakturanummer, kreditreferens, datum, valuta, moms, total, saldo och projekt på faktura/rader. [Fortnox scopes](https://www.fortnox.se/developer/guides-and-good-to-know/scopes) skiljer bland annat på `supplierinvoice`, `supplier`, `project`, `connectfile` och `payment`.

Rekommenderad fortsättning, inte implementerad funktion:

1. Utöka och testa anslutningskontraktet för valda leverantörsfakturascopes. Begär omauktorisering där det krävs.
2. Bygg serverhämtning av fakturor och underlag. Använd `source='fortnox'` och `external_id=GivenNumber`; den förberedda unika nyckeln för organisation/källa/externt ID skyddar mot dubbelimport.
3. Matcha befintliga manuella poster före import, med organisationsnummer, fakturanummer, valuta och belopp. Låt en användare granska osäker matchning. Import får inte ge dubbla projektkostnader.
4. Behåll HusHubs projektfördelning som egen information. Definiera vilka fält Fortnox äger och hur rättningar, krediter, bokföringsstatus, delbetalningar och saldo synkroniseras. Den manuella booleska betalningsnoteringen i denna etapp räcker inte som integrationsmodell för delbetalningar.
5. Inför först därefter eventuella skrivflöden till Fortnox som egna uttryckliga kommandon. Funktionen för manuell registrering ska inte börja betala eller bokföra när en koppling aktiveras.
