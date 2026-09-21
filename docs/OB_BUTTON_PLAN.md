# OB: knapp- och profilregler 1.1

Beslut 2026-09-21: den bla varumarkesprofilen ersatter tidigare regler om
indigo, sky och violet i denna plan. Bevara befintlig BesiktApp-logotyp.

## Omfattning

Forsta implementationen omfattar OB-rundan, rum, noteringar, bildhantering
och besiktningens byggnadsgrupperade stegmeny. Stilarna ar avgransade till
`obm-root`, `obm-sheet` och `ob-step-menu-toggle` i
`src/components/ob/mobile-round.css`.

Detta ar inte ett besked om att alla OB-sidor redan foljer profilen.
Uppdragsbekraftelse, ovriga formular, rapporter och mejl anpassas separat.
Delade TU/EB-vyer och andra moduler ska inte arva OB-stilar automatiskt.

## Knappar och tillstand

| Funktion | Regel |
| --- | --- |
| Primar atgard | Bla `#245EB5`, vit text; hover `#1D4890` |
| Sekundar atgard och bildval | Vit, kontrollkant `#78838F`, text `#25313B` |
| Aktiv flik eller menypost | Bla text, vald yta `#EDF3FC`, aven markering/aria-tillstand |
| Radera | Rod `#A23140`; bekraftande destruktiv knapp har vit text |
| Inaktiv | Explicit ljusgra yta och lasbar gra text; inte enbart opacity |
| Tangentbordsfokus | Tydlig bla kontur med avstand till kontrollen |
| Pagaende sparande | Befintlig status och blockering bevaras; inget falskt kvitto |
| Sparfel | Rod yta/text, kvarvarande utkast, synlig aterforsoksknapp |

Manrope levereras lokalt under `public/ob/brand` med SIL Open Font License.
Typsnittsnamnet `OB Manrope` isolerar laddningen fran andra modulers profiler.
Normal brodtext ar 16px/24px, stodtext 14px, kompakta statusetiketter 12px.
Textstorlekar ar rem-baserade. Tryckytor ar minst 48px hoga, ikonknappar 48x48px,
hornen 6px. Langa namn far radbrytas; viktig text far inte kapas.

## Semantik

- Gront betyder bekraftat sparat, inte att en byggnad ar godkand.
- Risk: `#81551A` pa `#FFF2DA`.
- Fortsatt teknisk utredning: `#265C7B` pa `#EAF2F8`.
- Sparfel: `#A23140` pa `#FCEEF0`.
- Status visas aven med ord, aldrig enbart med farg.
- Sparad/lokalt sparad far endast visas nar motsvarande sparflode bekraftat det.

## Navigation och kvalitet

- Tillbakapil i rum, noteringar, bildvyer och stegmenyn.
- Forutsattningar och OB-runda under respektive byggnadsrubrik.
- Stegordning, byggnads-ID, behorighet och skydd for osparade utkast bevaras.
- Pa smala skarmar far flytt/radering en egen verktygsrad.
- Testa 320/360/390px, dator, langa namn, storre text, fokus och sparfel.
- Verifiera riktigt Android-tangentbord fore publicering.
- Ingen SQL-migrering eller andring av gamla PDF:er ingar.
