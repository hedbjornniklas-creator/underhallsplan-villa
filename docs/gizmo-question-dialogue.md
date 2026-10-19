# Frågedialog och deltagare

## Beslutade krav 2026-10-19

- En fråga har en ansvarig och flera uttryckligt valda deltagare.
- Endast projektansvarig får lägga till och ta bort deltagare. Det ersätter den
  tidigare diskuterade möjligheten för alla interna deltagare att göra det.
- Svara är en gemensam dialog för frågans deltagare, inte ett automatiskt beslut
  om att frågan är besvarad eller löst. Avslut sker manuellt.
- Senare tillagda deltagare får läsa tidigare uttryckligt delade meddelanden.
- Intern anteckning hålls utanför den delade dialogen. Befintlig intern historik
  får inte publiceras i efterhand som en bieffekt av det nya flödet.
- Slutsatsfunktionen ska tas bort helt ur gränssnitt, typer och datamodell.
  En kontroll i produktion fann inga slutsatsposter eller ifyllda slutsatsfält.
- Avtal och betalningsplaner påverkas inte.
- Projektansvarig väljs under Översikt. En aktiv organisationsadministratör utser
  eller byter projektansvarig; rollen får inte tas genom att en vanlig användare
  väljer sig själv. Projektansvarig blir deltagare i projektets frågor.
- En fråga visas bara för sina aktiva deltagare. Tilldelning till en person
  utanför deltagarlistan får därför bara göras av projektansvarig.

## Arbetsläge

Inte publicerat. Borttagning av Slutsats och avkoppling av automatisk
Besvarad-status finns i arbetskopian. Den nya SQL-migreringen stoppar innan någon
ändring om en slutsats skulle ha registrerats sedan kontrollen. Den tar endast
bort oanvända, tomma slutsatsfält; historikens ordinarie oföränderlighet återställs
i samma transaktion.

Deltagarstyrning, projektansvarig och delad dialog finns i arbetskopian och
verifieras före publicering. Uppdrags befintliga individuella uppgifter breddas
inte. Gruppdialogen har en egen frågebegränsad behörighet och återanvänder
Uppdrags mejltjänst, varumärkesmall och uppföljningskörning.

## Inför Publicering

Kör `_04_project_question_dialogue.sql` följt av
`_05_project_question_participants.sql`. De ersätter inte tidigare migreringar.
Det finns ingen automatisk utnämning utifrån `created_by` eller `updated_by`.
Befintliga frågors skapare och interna ansvariga behåller deltagarskap.
Externa mottagare får ingen ny åtkomst förrän projektansvarig uttryckligen delar.

Nya frågeuppladdningar ligger i en separat privat lagringsbucket och visas inte
i projektets allmänna fillista. Frågan måste först vara sparad. Redan gemensamma
projektfiler blir inte privata för att de bifogas en fråga. Tidigare utskickade
individuella uppgifter behåller sina befintliga mottagare och behörigheter.

Personliga dialoglänkar gäller i 90 dagar och återkallas när deltagaren tas bort.
De verifierar innehav av en personlig länk, inte en digital underskrift.
`PROJECT_QUESTION_LINK_SECRET` kan sättas separat; annars används serverns
befintliga service-nyckel som signeringsnyckel. Nyckelbyte ogiltigförklarar länkar.
`APP_BASE_URL` ska vara den konfigurerade HTTPS-adressen i produktion.
Notifieringarna innehåller en uppmaning att öppna frågan, inte själva svaret.
Utskicksfel återförsöks högst fem gånger av befintlig uppföljningskörning.

## Beslutslogg

2026-10-19: Användaren valde projektansvarig som enda roll för deltagarhantering
och godkände ett nytt fält i Översikt. Administratörsutnämning är den konservativa
behörighetsgränsen; inga ändringar av avtalsparter eller avtalsbehörigheter ingår.
