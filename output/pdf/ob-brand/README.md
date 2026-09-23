# OB: varumarkesprofil 1.2

Beslutad designriktning for OB-modulen, i samma leveransformat som RenoApp och HusHub
Uppdrag. BesiktApp ar produkten; OB/Overlatelsebesiktning ar modulen och
OB-runda ar arbetsvyn. Ingen produktkod, publicerad logotyp,
kunddata eller befintlig rapport andras av denna leverans.
OB behaller sin bla identitet: befintlig primarfarg #245EB5.

## Andringar i 1.2, 2026-09-23

- RenoApps listformsprak: neutral statustext, tunna linjer och smala
  vanstermarkeringar, utan fargade helrader eller statuspiller.
- Gemensam OB-lista under de fyra befintliga verktygen under overgangen.
- Separata lagen for uppdragsbekraftelse och besiktning, utan nya arbetsregler.
- Mobil: utfallbara Genvagar och staplade rader utan sidscrollning.
- Tydligare typografisk hierarki, lasbar listtext och namngivna handlingar.
- Tva godkanda AI-genererade konceptbilder med fiktiva data ingar som referens.
- 17-sidig PDF; version 1.1 behalls som historik. Ingen appandring eller release.

Den normativa textspecifikationen och beslutsloggen finns i
`docs/OB_BRAND_PROFILE.md` i repot, och som `OB_BRAND_PROFILE.md` i ZIP-paketet.
Bildtext och pixelmatt ar inte krav nar de avviker fran textspecifikationen.
Statusmappning, filterregler och vanstermarkeringens prioritet ska verifieras
fore implementation. Godkannanden, behorigheter och utskick andras inte har.

## Andringar i 1.1

- Befintlig BesiktApp-logotyp bevaras utan omritning eller omfargning.
- Nytt modulmarke fran 1.0 utgar; det ingar inte i det aktuella paketet.
- Modulnamnet ar en separat textetikett, inte ett nytt sammansatt ordmarke.
- Mineralgron dekoraccent utgar; gront anvands for sparstatus och i originalets logotyp.
- Fyra byggnader, langa rumsnamn, tat text och sparfel visas med fiktiva data.
- Kvalitetskrav for smala skarmar, textforstoring, tangentbord och sparfel ingar.
- PDF- och paketfiler fran 1.0 och 1.1 behalls som historik; 1.2 ar aktuell leverans.

## Bygg

Fran repots rot:

```text
node output/pdf/ob-brand/build_icons.mjs
python output/pdf/ob-brand/build_profile.py
```

Python behover reportlab, fonttools, pypdf, Pillow och svglib. Node anvander
repots React, React DOM och lucide-react. Manrope och fontlicensen ateranvands
fran den versionshanterade RenoApp-profilen, utan att andra dess filer.

Utdata:
- `BesiktApp-OB-varumarkesprofil-v1.2.pdf`: 17 sidor.
- `BesiktApp-OB-profilpaket-v1.2.zip`: PDF, regler, denna README och profiltillgangarna.
- `assets/`: originalets logotyp, Lucide-ikoner, typsnitt/licens, CSS-variabler och fargdata.
- `assets/examples/`: dator- och mobilkoncept, kallbeskrivning och kontrollsummor.

Logotypen kopieras exakt fran `public/report-assets/BesiktApp.png`.
Kalla och SHA-256 finns i `assets/logo/provenance.json`; anvandningen beskrivs
i `assets/logo/USAGE.md`. Ingen ny vit, en-fargs- eller vektorvariant skapas.
Alla granssnittsexempel ar koncept med fiktiva data, inte skarmbilder eller
bevis pa genomforda apptester. Fargparen ar beraknade; detta certifierar inte
appens tillganglighet. SVG-filerna i paketet ar verktygsikoner fran Lucide.

## Avgransning

- Bevara fastighet, byggnad, besiktning och plats som separata begrepp.
- Profilen far inte andra befintliga planbenamningar eller sparade rapporter.
- Besiktningsforetaget ar avsandare av utlatandet; appen ar verktyget.
- Risk, fortsatt teknisk utredning och sparstatus far aldrig blandas ihop.
- Publicering ar ett separat steg. Den forsta lokala implementationen av
  runda, noteringar, bilder och stegmeny dokumenteras sedan 2026-09-21 i
  `docs/OB_BRAND_IMPLEMENTATION.md`; profilpaketet andrar inte gamla rapporter.

Genererade PDF/ZIP, QA-raster, fontkopior och Lucide-exporter ignoreras av Git.
De tva godkanda referensbilderna i `assets/examples/` ar daremot byggunderlag
och kan versionshanteras tillsammans med byggskript, regler, farger och
designvariabler. Rendera samtliga PDF-sidor och kontrollera dem fore leverans.
