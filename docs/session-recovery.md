# Återinloggning i HusHubs moduler

Skyddade sidor i ÖB, EB, TU, Fuktsäkerhet, Uppdrag, fastigheter, inställningar,
administration, ÖB:s autentiserade utlåtande-/utskriftsvy,
RenoApps styrelseportal/konsultgranskning och Mina uppdrag
förnyar sessionen i `src/proxy.ts` innan sidan kontrollerar behörigheten.
Förnyade eller raderade cookies följer både den efterföljande serverrenderingen
och webbläsarens svar. Produkt-, modul-, organisations-, BRF- och uppdragskontroller
behålls; en session eller returadress ger ingen ytterligare behörighet.

Publika startsidor, ansökningar, personliga tokenlänkar, inbjudningar,
inloggning, återställning, API:er och statiska resurser får inte sessionstvång.
Publika tokenflöden behåller sina egna befintliga återgångsregler.

## Samma sida efter inloggning

`safeAuthReturnPath` tillåter bara kända lokala, skyddade sidor. Detaljsidans
sökväg, säkra frågeparametrar (exempelvis `orgId`, `brfId`, flik eller filter)
och enkla ankare bevaras. Externa adresser, alternativa protokoll,
sökvägsmanipulation, kodade avskiljare och kontrolltecken avvisas.
Omdirigeringsparametrar och autentiseringshemligheter följer inte med.

Proxyn skriver över `x-hushub-return-path` med den kontrollerade originaladressen.
Serverlayouter och sidor använder den när de visar återhämtning eller skickar
vidare till inloggningen. `authLoginUrl` väljer HusHubs, RenoApps eller
mottagarportalens inloggning. Efter inloggningen kontrolleras sidans behörigheter
på nytt. Återgången sparar adressen, inte osparade formulärfält.

## Tydlig väg vidare

Tillfälliga autentiseringsfel ger en privat återhämtningssida med status 503,
utan cachelagring och utan inloggningsloop. Verklig saknad behörighet beskrivs
separat och hänvisar till den som administrerar företaget eller föreningen.
Tekniska felmeddelanden och uppdragsuppgifter visas inte på felsidan.

”Försök igen” laddar om originaladressen. ”Logga in igen” avslutar först den
lokala sessionen, endast efter uttryckligt knapptryck, och öppnar inloggningen
med samma säkra returadress. Ett misslyckat försök ger ett begripligt fel och
lämnar knapparna användbara. Direktbesök på återhämtningssidan använder dess
kontrollerade `next`-adress.

Den gemensamma klientkontrollen döljer tidigare innehåll vid förlorad session
eller misslyckad sessionskontroll. När en frisk session kontrolleras på nytt
behålls de monterade formulären. Inbäddade kontroller delar samma gräns i
stället för att skapa flera oberoende sessionslyssnare.

## Verifiering

```powershell
node --experimental-strip-types --test test/auth-return-path.test.ts test/public-navigation.test.ts test/organization-create-proxy.test.ts test/dashboard-access-recovery.test.ts test/all-module-recovery-guards.test.ts
node scripts/preview-session-recovery.mjs --test
npm run build
```

Tester använder syntetiska sessioner och lokala svar. De får inte logga ut
verkliga användare, ändra behörigheter eller skriva till produktionen.
