# RenoApp Flodesbyggare - Hjalpsektion

## Overgripande: hur allt hanger ihop

Flodesbyggaren utgar alltid fran en renoveringstyp.
Renoveringstypen ar roten i flodet och innehaller:

- startfragor
- underlag som alltid ska samlas in
- medverkande som alltid ska anges

Varje fraga har svarsalternativ.
Ett svarsalternativ kan i sin tur trigga fler delar:

- foljdfraga
- extra underlag
- extra medverkande
- granskningsflagga

Objekt (fraga, underlag, medverkande, flagga) kan ateranvandas i flera floden.
Att "ta bort fran flodet" tar bort kopplingen i just det flodet.
Att "radera overallt" tar bort objektet helt ur systemet.

## Falt som inte fylls i manuellt

Intern nyckel skapas automatiskt nar ett nytt objekt skapas.
Nyckeln anvands tekniskt for stabil koppling och spårbarhet och ska normalt inte redigeras manuellt.

## Renoveringstyp

Visningsnamn:
Namnet administratoren ser i listor och i flodeskartan.

Beskrivning:
Intern beskrivning av nar renoveringstypen ska anvandas och vad den omfattar.

Sortering:
Styr ordningen i listor. Lagre tal visas tidigare.

Aktiv renoveringstyp:
Avgor om renoveringstypen ska vara valbar och kunna anvandas i nya floden.

## Fraga

Visningsnamn:
Själva fragetexten som ska besvaras.

Hjalptext:
Forklarar hur fragan ska tolkas och vad den som svarar ska ta hansyn till.

Svarstyp:
Styr om fragan ska ha ett val, flera val eller ja/nej.

Sortering:
Styr ordningen mellan fragor pa samma niva.

Aktiv fraga:
Avgor om fragan kan anvandas i floden.

Obligatorisk i denna renoveringstyp:
Anger om fragan maste besvaras nar den ligger direkt under en renoveringstyp.

Kopplingens sortering:
Styr ordningen for fragan i just den valda renoveringstypen.

## Svarsalternativ

Svarstext:
Texten som visas som val pa en fraga.

Beskrivning:
Kompletterar svarstexten nar valet behover extra forklaring.

Sortering:
Styr ordningen mellan svarsalternativen.

Aktivt svarsalternativ:
Avgor om valet ar valbart och kan trigga foljddelar.

## Underlag

Visningsnamn:
Namnet pa dokumentet eller uppgiften som ska lamnas in.

Hjalptext till sokande:
Forklarar for sokande vad som ska bifogas eller beskrivas.

Granskningsstod:
Intern vagledning till handlaggaren om vad som ska kontrolleras.

Standardfas:
Anger om underlaget normalt hors hemma fore, under eller efter utforandet.

Sortering:
Styr ordningen mellan underlag.

Aktiv underlagstyp:
Avgor om underlaget kan anvandas i nya kopplingar.

Obligatoriskt i denna renoveringstyp:
Anger om underlaget maste lamnas in nar det ar direkt kopplat till renoveringstypen.

Kopplingens sortering:
Styr ordningen for underlaget i just den valda renoveringstypen.

Notering:
Intern notering pa kopplingen, till exempel motiv eller specialvillkor.

## Medverkande

Visningsnamn:
Namnet pa rollen som ska anges, till exempel entreprenor eller konsult.

Hjalptext till sokande:
Forklarar vilken part som ska anges och vilka uppgifter som behovs.

Granskningsstod:
Intern vagledning om hur rollen ska verifieras.

Typ:
Anger om rollen ar entreprenor eller konsult.

Verifieringsinstruktion:
Beskriver hur rollen eller dess behorighet ska kontrolleras.

Verifieringslank:
Lank till register, kontrollsida eller annan extern verifieringskalla.

Sortering:
Styr ordningen mellan medverkande.

Forsakringsbevis kravs:
Anger om forsakringsbevis maste kunna visas.

Krav pa foretagsnamn:
Anger om foretagsnamn ska samlas in.

Krav pa org.nr:
Anger om organisationsnummer ska samlas in.

Krav pa kontaktperson:
Anger om kontaktperson ska samlas in.

Krav pa e-post:
Anger om e-postadress ska samlas in.

Krav pa telefon:
Anger om telefonnummer ska samlas in.

Krav pa certifiering:
Anger om certifiering ska samlas in eller kontrolleras.

Aktiv:
Avgor om rollen kan anvandas i nya floden.

Obligatorisk i denna renoveringstyp:
Anger om rollen maste anges nar den ar direkt kopplad till renoveringstypen.

Kopplingens sortering:
Styr ordningen for rollen i just den valda renoveringstypen.

## Granskningsflagga

Visningsnamn:
Namnet pa risk, avvikelse eller uppmarksammande som ska visas for granskaren.

Allvar:
Anger niva: info, varning eller hog risk.

Kategori:
Gor flaggor enklare att gruppera och filtrera.

Sortering:
Styr ordningen mellan flaggor.

Beskrivning:
Forklarar vad flaggan betyder och vad granskaren bor kontrollera.

Aktiv flagga:
Avgor om flaggan kan anvandas i nya flodeskopplingar.
