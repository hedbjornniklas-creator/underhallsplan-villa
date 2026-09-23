# HusHub Uppdrag: varumarkesprofil 1.0

Historisk version. Aktuell namnprofil ar Gizmo fran HusHub, version 2.1,
i `../gizmo-brand/`. Farg- och typografiriktningen nedan lever vidare,
men produktnamnet och U-symbolen har ersatts i den nya profilen.

Ett profilforslag med samma leveransformat som RenoApps varumarkesprofil.
Detta ar inte en implementering av ett nytt tema i appen eller prototypen.
Inga priser, tjansteloften, produktnamnsbyten eller nya integrationer beslutas har.

## Bygg

Kor `build_profile.py` fran valfri katalog med Python, reportlab, fonttools,
pypdf och Pillow. Skriptet ateranvander Manrope och licensen fran
`../renoapp-brand/assets/fonts/` utan att andra RenoApp-filerna.

Utdata:
- `HusHub-Uppdrag-varumarkesprofil-v1.pdf`: 12 sidor.
- `HusHub-Uppdrag-profilpaket-v1.zip`: PDF, README och samtliga tillgangar.
- `assets/`: logotyper i SVG, font/licens, CSS-variabler och fargdata.

PDF och ZIP ar genererade lokala leveranser och ignoreras av Git.
Byggskript och vektortillgangar kan versionshanteras separat.

## Avgransning

Rekommenderat namn ar HusHub Uppdrag, med Uppdrag i befintlig navigation.
Gizmo ar assistenten. Den ar inte ett separat varumarke eller en avtalspart.
Logotypen ar ett nytt forslag och inte varumarkesrattsligt kontrollerad.
Layoutbilderna ar illustrerade koncept med fiktiva data, inte bevis pa
implementerad funktionalitet. Kallreferenser finns pa PDF:ens sista sida.

Kontrollera renderade sidor, teckentackning, textgranser och kontrastvarden
innan paketet levereras. Denna kontroll certifierar inte appens tillganglighet.
