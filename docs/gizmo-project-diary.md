# Projektdagbok

## Godkant 2026-11-04

- En egen Dagbok i Uppdrag. Datum, tid fran/till, rast, namn, foretag,
  kort arbetsbeskrivning, valfritt moment och hogst atta bilder per anteckning.
- Projektansvarig aktiverar, skriver ut, byter eller stanger projektets QR-lank.
  Lanken ar avstangd fran borjan och ger aldrig projekt- eller kundbehorighet.
- QR-formularet verifierar mejladressen med en engangskod. En HttpOnly-session
  minns webblasaren i hogst 30 dagar. Ny webblasare, utgangen session eller
  utbytt QR-lank kraver ny verifiering. Delade telefoner har en logga-ut-knapp.
- Mejlkoden verifierar kontroll over mejladressen, inte namn, narvaro eller
  att arbetet faktiskt utforts. Namn och foretag ar egenrapporterade uppgifter.
- QR-besokaren kan bara skicka egna anteckningar och fa sitt eget kvitto.
  Projektets historik och andra personers bilder ar inte offentliga.
- Interna medlemmar med Uppdragsbehorighet kan lasa dagboken och registrera
  anteckningar. Bara projektansvarig kan lagga till en sparad rattelse.
- Sparade original, bildmanifest och rattelser ar append-only. Arbetsdatum
  skiljs fran serverns mottagningstid; bilder far en SHA-256-kontrollsumma.
- Inga anteckningar skapar timmar i kalkyl, bestallningar, fakturor, ATA,
  betalplaner eller andringar i avtal. Ingen kunddelning sker automatiskt.

## Teknisk avgransning

Egen lagring under action_case_diary_* och en egen privat bildbucket.
Generering/hashning av slumphemligheter, mejlutskick och mejlmall ateranvands;
Mina uppdrags konton och behorigheter andras inte. QR genereras lokalt av
qrcode, inte av en extern QR-tjanst. Standardkod: sex siffror, tio minuter,
hogst fem forsok samt transaktionella begransningar per mejl, klient och projekt.
Endast verifierade sessioner far reservera uppladdningar. Bilder laddas direkt
till ett tillfalligt privat objekt, kontrolleras pa servern och arkiveras pa en
separat, ej overskrivbar sokvag innan de kan knytas till en anteckning.
JPG, PNG och WebP, hogst 8 MiB per bild. Bildinnehall och storlek kontrolleras,
inte bara filnamnet. Orphan-uppladdningar forfaller efter 24 timmar och rensas
begransat vid projektansvarigs besok, efter 15 minuters sakerhetsmarginal for
pagaende bildanrop (servergrans 60 sekunder). En kvitterad rensning gar vidare
till nasta batch; lagringsfel kan provas igen. Bifogade bilder rensas aldrig.

Kvitton och request-ID gor aterforsok idempotenta. Ett osakert sparsvar far
inte skapa en andra anteckning eller kasta texten. Ett pa-borjat formulartutkast
skiljs fran en inskickad och mottagen dagboksanteckning.

SQL-migreringen ar additiv, utan backfill och utan skrivningar i andra moduler.
Ingen publicering eller riktig kodutskickning ingar fore separat godkannande.

## Aktivering och kontroll

1. Kor `docs/db/2026-11-04_01_project_diary.sql` fore publicering.
2. Anvand befintlig mejlkonfiguration: `RESEND_API_KEY` och
   `ASSIGNMENTS_MAIL_FROM`. Basadress tas fran `APP_BASE_URL` eller
   `NEXT_PUBLIC_APP_URL` och ska vara en HTTPS-adress i produktion.
3. `PROJECT_DIARY_LINK_SECRET` kan anges som separat hemlighet med minst
   32 tecken. Annars anvands befintlig serverhemlighet. Byte av denna
   hemlighet kraver nya utskrivna QR-koder.
4. Projektansvarig oppnar Dagbok och aktiverar QR-lanken. Ingen lank
   aktiveras genom migreringen. Provutskick till en riktig mejladress
   gors forst efter separat godkannande.

Lokal fiktiv provvy startas med `node --experimental-strip-types
scripts/test-project-diary-ui.mjs`. Testkoden ar 123456; ingen e-post eller
produktionsdatabas anvands. Databastester anvander PGlite och kontrollerar
att projekt-, avtals-, offert- och kalkylunderlag forblir oforandrade.

## Senare, Inte Bestallt

Kunddelning, faktureringsunderlag, automatisk tidsrapportering, vader,
geopositionering, offline-bildsynk och PDF-export av hela dagboken ingar inte.
