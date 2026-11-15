# Gizmo: sparningsskydd

Beslut 2026-11-15: navigation ska inte varna enbart for att en panel ar oppen
eller en lasning pagar. Endast innehall som riskerar att ga forlorat ska
utlosa bekraftelse. Befintliga uppgifter, avtal och sparade priser andras inte.

## Gemensam projektstatus

Projektets redigerare registrerar en namngiven sparpost med del, beskrivning,
eventuell bakgrundssparning och om det finns verklig forlustrisk. Listan visar
aven tidigare oppnade, nu dolda projektflikar. Poster tas bort nar sparningen
bekraftas eller redigeraren stangs. En lasning registreras inte som en sparning.

Vid projektfliksbyte och lanknavigation forsoker skyddet forst slutfora
befintliga autosparkoer. Det skickar aldrig meddelanden, dagboksanteckningar,
offertforfragningar eller avtal automatiskt. Misslyckad sparning aterforsoks
inte automatiskt. En kvarvarande risk ger ett namngivet val att stanna eller
lamna. Uppladdningskoer skyddas aven nar fakturatexten ar sparad.

Ett verifierat localStorage-utkast kan aterstallas efter omladdning och behover
inte samma lamningsvarning som text eller filer som bara finns i minnet.
SessionStorage for dagbok ar daremot inte ett skydd mot att fliken stangs.
Om lokal lagring misslyckas ska den osparade texten fortsatta vara skyddad.

Webblasaren tillater inte egen text i dess inbyggda varning vid omladdning
eller stangning. Forklaringen finns i projektets sparstatus; interna
navigationsvarningar visar de specifika delarna. Ett uttryckligen godkant
lamnande ska inte utlosa en andra inbyggd ruta for samma navigation.

## Avgransning och verifiering

Ingen SQL-migrering, datarensning, omskrivning av avtal eller annan ny
bakgrundssynk ingar. Skyddet anvander redigerarnas befintliga sparfunktioner.
Den generella autosparkoens tidigare skydd behalls som standard for andra
Hushub-moduler. Gizmos namngivna redigerare ager sitt eget skydd.

Regressionstester behaller befintliga statusfloden, versionskontroller,
aterforsoksidentiteter, priser och avtalslas. UI-tester kor mot fiktiva
uppgifter utan produktionsdatabas eller mejlutskick och provar bland annat
ororda forfragningsfonster, snabb navigering, sparfel, lokal aterstallning,
blockerad lokal lagring, ofardiga bilagor och mobilvy.
