# Offert med uppskattad tidsatgang

## Beslut 2026-10-30

- Offert ska kunna ange lopande rakning med kundens timpris inklusive moms.
- En valfri uppskattning anges som fran/till antal timmar. Arbetspriset raknas
  fran intervallet och timpriset, utan att bli fast pris, totalpris eller takpris.
- Material och ovriga kostnader redovisas separat enligt de lopande prisgrunderna.
- Intern kalkyl och kundpris ar olika uppgifter. Inga interna kostnader importeras
  till timpriset automatiskt och ingen mittpunkt valjs ur intervallet.
- Befintliga fastprisofferter behaller sitt format och sina belopp tills anvandaren
  uttryckligen byter prisform. Byte tillbaka till fast pris bevarar tidigare belopp.
- Andringen galler den fristaende offerten, inte grundavtal, signerade versioner,
  projektarbete eller betalningsplan. Timuppskattningen kopieras inte till avtal.
- Inget skickas eller accepteras automatiskt. Offerter granskas som tidigare.

## Implementerat

Den befintliga prisredigeraren ateranvands for fasta och lopande prisgrunder.
`offerHourEstimate` lagras endast i offertutkastets JSON. Tomma eller omvanda
intervall far sparas som utkast, men far ingen beraknad summa och maste kompletteras
fore utskick. Timmar stodjer tva decimaler. Noll skiljs fran tomt falt.

Granska offert visar samma timpris, intervall, arbetskostnad och materialvillkor.
Ingen intern kalkyl visas dar. Den signerade avtalets PDF-mall andras inte.

Databassteget ar `docs/db/2026-10-30_03_offer_hour_estimate.sql`. Det lagger enbart
till validering och skydd mot aldre offertflikar. Inga befintliga rader uppdateras.
Offertens vanliga revisionskontroll galler fortfarande vid samtidiga andringar.

## Kvar utanfor detta steg

Inga nya villkor for godkannande, takpris, timrapportering eller ROT-avdrag.
Ett intervall ersatter inte en komplett omfattningsbeskrivning eller materialvillkor.
