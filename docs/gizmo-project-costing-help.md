# Kalkylhjälp och preliminära summor

Beslut 2026-10-20: Projektarbetets åtgärdspanel får en frågeteckenikon bredvid
Lägg till rad. Hjälpen är en lokal, läsbar manual med innehållsförteckning,
inte en extern länk eller ett utskick. Samma hjälp finns vid samlat pris.

Manualen förklarar samtliga befintliga kalkylverktyg: rader, prispåslag,
mängder och källor, Klar, arbetsdelar, masshantering, offertunderlag,
samlat pris, AI-förslag, sparning och felsituationer. Innehållet finns i
`src/lib/action-cases/costingHelp.ts` och ska hållas i takt med verkligt beteende.

Hjälpen öppnas i en separat inbyggd modal med egna rullningsytor och
tangentbordshantering. Escape stänger endast hjälpen och återför fokus till
hjälpikonen. Kalkylens formulär ligger kvar monterade. Inga projektuppgifter
sparas, kastas, skickas eller delas när man öppnar eller läser manualen.
Byte från samlat pris till detaljerad kalkyl släpper sin lokala redigeringsspärr
efter en lyckad sparning, även när prisunderlagsformuläret då avmonteras.

## Prisvisning

Användaren har beslutat att en ofullständig projektkalkyl ändå ska visa den
beräkningsbara delen. Tabellen visar Preliminär summa med intern kostnad och
kundpris för rader med både mängd och pris. Varningen anger antal rader som
saknar mängd respektive pris. Om ingen rad kan beräknas anges detta uttryckligen
vid den preliminära nollsumman. Ett riktigt nollpris är ett känt pris och
räknas med; tomt pris är inte noll. Klar är separat från prisberäkningen.

Den verkliga beräkningen och fullständighetskontrollen ändras inte: ett
ofullständigt underlag blir inte komplett, och den preliminära summan sparas
inte som ett kundpris. Avtal, betalningsplan, frysta versioner, offertimport,
kunddelning och databasschema lämnas oförändrade.

Prispåslag benämns uttryckligen som påslag på kostnaden, inte moms. Fält,
tabellkolumner, mobilens beloppsetiketter och timkostnader anger exklusive moms.
Ingen beloppskonvertering, ny momssats eller ändring av sparade värden ingår.

## Verifiering

- 662 Uppdragstester passerar i en isolerad kopia av den publicerade basen
  med endast kalkyländringarna. Parallella PDF-ändringar är inte med.
- Riktad ESLint passerar. Produktionsbygge verifieras före publicering.
- Klicktest med riktiga komponenter och fiktiva uppgifter verifierar
  innehållslänkar, fokus, Escape och bevarad osparad nollprisrad.
- En sparad gratisrad visar 0 kr och påverkar inte summan. En rad utan mängd
  och en utan pris ger Preliminär summa och en varning med båda antalen.
- Byte från samlat pris till radkalkyl lämnar Lägg till rad aktiv.
- Dator samt mobil i 320 och 390 px är kontrollerade utan sidrullning.
  Manualen har 14 px brödtext på dator och 16 px på mobil.
- Testbackendens avtal är oförändrat efter öppnad hjälp, byte av kalkylens
  prisunderlag och tre nya testkostnader. Ingen produktionsuppgift har ändrats
  av klicktesterna. Ingen SQL krävs; publicering är ett separat steg.
