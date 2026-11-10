# Att gora: anvandbarhet och mottagarflode

Beslut 2026-11-10: genomfor de fem godkanda granskningsforbattringarna.
Befintliga uppgifter, statusovergangar och personliga lankar behalls.
De fem granskningsforbattringarna skriver inte om data eller historiska mejl.
Tillagget for redigering nedan anvander en separat, additiv SQL-migrering.
Avtal, kalkyler och projektets ekonomidata ar utanfor andringen.

## Privata utkast

- Svar och textunderlag lagras i sessionStorage i samma flik i hogst ett dygn.
- Servern ger ett icke-behorighetsgivande SHA-256-scope for organisation,
  uppgift och mottagarkontakt. Samma scope anvands i direktlank och portal.
  Lanktoken, e-postadress eller namn sparas inte som lagringsnyckel.
- Ett utkast ar tydligt markerat som inte skickat. Bara uttryckligt Skicka
  respektive Spara textunderlag publicerar nagot. Lyckad sparning tommer bara
  det falt som skickats; andra utkast och misslyckade forsok behalls.
- Omladdning/lamna sidan varnar nar oskickad text finns. Om enhetslagring ar
  blockerad fungerar skrivandet fortfarande, men lagringsfelet visas tydligt.
- Sessionens slut, utgangen lagring och annan mottagares scope delar inte text.

## Status och handhavande

- Bekrafta mottaget anvander befintlig start-action och statusen Pagar.
- Efter bekraftelse ar Klar for kontroll huvudhandling. Fore bekraftelse
  finns samma tidigare tillatna handling i Mer, liksom Vantar och Begar mer tid.
  Befintliga kontrollpunkter, barnuppgifter, tidsgranser och servervalidering
  galler fortfarande. Ingen ny overgangen eller behorighet infors.
- Godkanda/avbrutna uppgifter visar avslutsstatus. Datum visas bara nar ett
  faktiskt status-event finns. Ingen aktiv forsening fortsatter raknas efter
  avslut. Tidslinjens ursprung heter Skapad, inte faktisk arbetsstart.

## Mejlet

- Forsta externa tilldelningen visar projekt, titel, uppdragsansvarig och datum.
- Texten forklarar att svar via uppdraget sparas i Gizmo. Vanliga mejlsvar
  vidarebefordras fortfarande till samma Reply-To, utan ny mejlinlasning.
- Tabeller, inline-stilar, Arial-fallback och Outlooks VML-knapp behalls.
  Ett textordmarke ersatter de generiska bockarna, sa avsandaren fungerar
  aven om externa bilder eller typsnitt blockeras.
- Samlingsmejl ateranvander samma visuella skal; policy, antal utskick,
  personliga URL:er, leveranslogg och innehallsavgransning andras inte.

## Att gora

- Sammanfattningarna ar klickbara kompakta filter, inte dubbla filterrader.
- Aktiva utesluter godkanda och avbrutna uppgifter; Avslutade visar dessa.
  Alla finns kvar, och gamla sparade listpreferenser och direktlankar bevaras.
- Gruppering, sortering och sidstorlek finns under Fler filter. Sokning och
  Jag har-tidsfiltret finns kvar direkt i verktygsraden.
- Sammanfattningen avser alla uppgifter; grupperad lista raknar huvuduppdrag
  och behaller foraldrakontext. Valet skapar eller andrar inga uppgifter.

## Redigera vanliga uppgifter

Beslut 2026-11-10: uppdragsansvarig eller befintlig organisationsadministrator
kan redigera en oppen, manuellt skapad uppgifts rubrik, beskrivning, sammanhang,
mottagare, slutdatum, uppfoljning och kanaler. Tidsuppskattning och aterkomst
har kvar sina egna befintliga redigerare. Avslutade uppgifter ateroppnas inte.
Automatiskt kopplade uppgifter andras i sin ursprungsfunktion, inte har.
Detta styrs ocksa av den faktiska fragelankningen, eftersom aldre projektfragor
kan vara lagrade med created_source=manual. Kopplingen kontrolleras i bade
listans behorigheter och den atomiska databasfunktionen.

- Spara ar uttryckligt. Det skickar inget mejl eller bakgrundsutskick.
- Mottagarbyte kravs bekraftat. Alla gamla personliga lankar, portalgrant och
  ej anvanda aktiveringstoken sparras i samma transaktion som mottagarbytet.
  Nytt portalgrant halls aterkallat tills ett separat utskick sker.
- Utskicket vantar pa Skicka uppdraget. Externa mottagare anvander befintlig
  personlig lank och interna mottagare befintlig dialogavisering. Ett internt
  omtilldelningsmeddelande har unik koppling till byteshandelsen, sa ett
  aterforsok inte skapar ett andra meddelande. Ingen statusovergang fabriceras.
- Titel, mottagare och tider loggas med fore/efter och verklig aktor. Historik,
  underlag, kontrollpunkter, barnuppgifter och uppgiftens status behalls.
- Versionskonflikt sparrar overskrivning fran en aldre flik. En misslyckad
  sparning behaller formularet. Ovriga handlingar doljs medan redigering pagar.
- Pagande/oklar leverans maste hanteras innan mottagaren byts. Oppna
  forlangningsbeslut och datumgranser i hierarkin respekteras. Aterkommande
  uppgift maste stangas av innan dess datum andras.
- Gamla mejl och leveransloggar bevaras, men raknas inte som paminnelser till
  en ny mottagare. Befintliga sparrar for oklar leverans galler fortfarande.

Kor `docs/db/2026-11-10_01_task_details_editing.sql` fore applikationsslappet.
Migrationen lagger endast till tva service-rollsfunktioner och skriver inte om
nagra befintliga uppgifter. Den kan koras om. Inga klientroller far RPC-atkomst.

## Verifiering

- PGlite anvander riktiga versions-, gransknings-, jobb- och grant-triggers.
  Tester omfattar atomisk rollback, gammal atkomst, explicit utskick, no-op,
  organisationsgranser, modulbehorighet, samtidighet och datumgranser.
- Server/API-test verifierar betrodd aktor, faltlista och samma ursprung samt
  att Save inte aktiverar opportunistiska utskick.
- CUA med riktiga komponenter och fiktiva data provar mottagarbyte, sparfel,
  aterforsok, separat utskick, omladdning och mobil utan horisontell rullning.
- Mottagarvyn provas med oskickat svar och underlag, isolering mellan personer,
  statusflodet, stangda uppgifter och 320/390 px bredd. Mejl granskas som HTML
  i webblasaren; faktisk leverans/rendering i Outlook ar en separat driftkontroll.
