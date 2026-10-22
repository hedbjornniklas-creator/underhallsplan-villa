# Val och tillval: pris, tid och PDF

Beslut 2026-10-22. Galler Uppdrag, inte RenoApp.

## Beslutad omfattning

- Varje alternativ har Omfattning, Kalkyl samt Pris och tid i samma sidopanel.
- Omfattning innehaller specifikation, forutsattningar, undantag och befintliga PDF-bilagor.
- Interna kalkylrader har mangd, enhet, enhetskostnad, kostnadsslag, egna paslag och Klar.
  Kostnader och kalkylraders kundpriser anges exklusive moms. Moms adderas en gang.
  Noll ar kant pris. Saknade uppgifter ger preliminar intern summa och varning.
- Kundens prisvillkor ar separata fran kalkylen: fast pris, lopande rakning eller blandat.
  Fast kundpris kan anges manuellt eller uttryckligen kopplas till kalkylen.
  Redovisning kan vara totalsumma, delmoment utan delpriser eller delmoment med priser.
  Manuell prissattning kan delas i arbete och material; kalkylimporten gissar inte en sadan fordelning.
- Lopande villkor har timpris inklusive arvode/moms, arbetsledning, paslag pa sjalvkostnad
  och valfritt ungefarligt kundpris. Intern uppskattning blir aldrig automatiskt fast kundpris.
- Ett enkelt val kan uttryckligen markeras Ingar utan prisandring. Okant pris betyder inte gratis.
- Tidspaverkan ar inte bedomd, ingen paverkan eller forlangning i arbetsdagar med forklaring.
  Detta skriver inte om projektets tidsplan.
- PDF-underlag hamtas fran den sparade planeringsversionen. Fore och efter rendering kontrolleras
  revisionen. PDF innehaller endast kunduppgifter, unik underlagsreferens, prisvillkor, tid och
  bilageforteckning. Bilagor ar separata filer, inte inbaddade i PDF. Anvandaren mejlar sjalv.
- Ingen ny digital signering, inloggning, mejlsandning, godkannandestatus eller PDF-historik byggs.
  En kundmarkering i den befintliga kundvyn ar fortsatt inte en bestallning.
- Kort hjalp i panelen skiljer intern kalkyl fran kundpris och forklarar bilagorna.

## Avtalets oberoende

Lagring och skrivningar stannar i `action_case_customer_planning`. Publika prisvillkor ligger
i alternativets `offer`, privata inkopsuppgifter i `internal_costing`. Befintliga rena
prisfunktioner och den gemensamma PDF-renderaren ateranvands; inga avtalsdata eller avtalswriter anropas.
Grundavtal, offert, betalningsplan, lasningsversioner och avtals-PDF ar utanfor andringen.
Delning med bestallaren kraver fortfarande uttrycklig delning av den sparade versionen.

## Uppgradering

Kor `docs/db/2026-10-22_01_customer_choice_offers.sql` fore publicering. Den andrar inga
befintliga rader. Kapabilitetskontrollen doljer nya editorval tills SQL finns.
Gamla sparade kundpriser bevaras vid lasning/oppning. Konvertering av kalkylen sker
forst vid redigering. Aldre flikar far inte radera nya prisvillkor eller mangdformatet.
Migreringen ar omkorbar och behaller befintlig kategorivalidering. Den ateranvander
den rena prisvalidatorn utan att andra dess avtalsfunktioner eller skriva avtal.

## Senare

- Inloggat, uttryckligt godkannande med ratt mottagare och bevisunderlag utreds separat.
- TBD/oppet pris, prognos, faktiskt utfall och projektets totala budget ingar inte nu.
- PDF-exporten ar inte en juridisk signering eller garanti for hur bevisning varderas.

## Beslutslogg

- 2026-10-22: Anvandaren godkanner utokad kalkyl, fasta/lopande kundvillkor, tidspaverkan
  och PDF for manuell e-posthantering. Godkannande/inloggning och TBD skjuts upp.
- 2026-10-22: Kundpris och kalkylpris ska kunna hallas isar. Kort panelhjalp godkanns.
  Publicering godkanns efter verifiering och nodvandig SQL.
