export const costingHelpTopics = [
  {
    id: 'start', title: 'Kom igång',
    paragraphs: ['Kalkylen gäller den åtgärd som du har öppnat, till exempel Mark och grund. Varje rad är en kostnad, exempelvis grävarbete, material eller transport. Alla belopp i kalkyltabellen är exklusive moms.'],
    steps: ['Beskriv arbetet under Omfattning och invänta att omfattningen är sparad.', 'Välj Kalkyl och Lägg till rad. Ange beskrivning, kategori, mängd, enhet, kostnad per enhet och påslag.', 'Välj Spara rad. Kontrollera radens kostnad och kundpris i tabellen.', 'Markera Klar när du är färdig med raden. Kontrollera sedan summan längst ned.'],
  },
  {
    id: 'prices', title: 'Kostnad, påslag och kundpris',
    paragraphs: ['Kostnad är din interna kostnad: mängd × kostnad per enhet. Kundpris är kostnaden med radens påslag. Påslaget beräknas på kostnaden, inte på kundpriset; det är alltså inte samma sak som marginal.', 'Exempel: 10 timmar × 500 kr ger 5 000 kr i kostnad. Med 20 % påslag blir kundpriset 6 000 kr, exklusive moms. Varje rad kan ha sitt eget påslag.', 'Summa visar hela åtgärdens kostnad och kundpris, även när du filtrerar på en arbetsdel. Den är inte summan för hela projektet. Om mängd eller pris saknas visas i stället Preliminär summa, som bara omfattar rader med både mängd och pris. En varning anger vad som saknas. Om ingen rad kan räknas ut visas 0 kr som preliminär summa, inte som ett färdigt pris.'],
  },
  {
    id: 'rows', title: 'Lägg till, redigera och ta bort rader',
    paragraphs: ['Beskrivning och enhet ska fyllas i. Kategori kan vara Eget arbete, Material, Underentreprenör, Avfall, Transport eller Övrigt. Kategorin beskriver kostnaden; den skapar inte en extra kostnad.', 'Mängd är antalet enheter, exempelvis timmar, kvadratmeter eller stycken. Kostnad/enhet anges exklusive moms. För ett paket om 64 000 kr kan du ange mängd 1, enhet paket och kostnad/enhet 64 000. Lägg inte samma arbete både i ett paketpris och på en separat rad.', 'Pennan öppnar radens detaljer. Välj Spara rad för att spara eller Avbryt för att kasta formulärets osparade ändringar. När ett sparförsök misslyckas ligger formuläret kvar så att du kan försöka igen.', 'Ta bort rad finns i radens detaljer och kräver bekräftelse. Vissa rader med skickat offertunderlag eller paketkoppling kan inte tas bort här. Öppna då offertunderlaget och hantera kopplingen där först.'],
  },
  {
    id: 'done', title: 'Vad betyder Klar?',
    paragraphs: ['Klar är din markering att raden är färdig. Ett känt pris räknas med även när bocken är tom. En tom bock betyder alltså inte att priset saknas.', 'Du kan klarmarkera en egen rad när mängd och kostnad finns. Bocken sparas direkt. Om du ändrar radens uppgifter och sparar behöver den klarmarkeras igen.', 'Offertprissatta rader styrs av sitt valda underlag och kan därför ha en låst Klar-bock. Sidfoten visar hur många rader som är klara samt om mängd eller pris faktiskt saknas.'],
  },
  {
    id: 'sources', title: 'Mängdunderlag, priskälla och anteckningar',
    paragraphs: ['Mängdunderlag anger om mängden är angiven, beräknad eller uppskattad. Priskälla beskriver var kostnaden kommer från. Källänk och Antaganden och underlag hjälper dig att dokumentera beräkningen.', 'Att välja en priskälla hämtar inte automatiskt ett pris från leverantören. Ange kostnaden själv eller använd ett valt offertunderlag. Ett tomt pris är okänt, inte noll kronor. Ange 0 bara om kostnaden verkligen är noll. Mängden måste vara större än noll när den anges.'],
  },
  {
    id: 'tools', title: 'Fler verktyg',
    paragraphs: ['Knappen med tre punkter bredvid Lägg till rad öppnar Fler verktyg. Där finns Markera rader, Arbetsdelar, Kostnadsslag, Prisunderlag och Föreslå kalkyl med AI när funktionen är tillgänglig.', 'Markera rader visar en separat urvalskolumn. Den markeringen används för masshantering och offertförfrågningar, inte för att säga att en rad är Klar. Välj Avsluta markering för att återgå till den vanliga vyn.', 'Kostnadsslag låter dig ange att ett kostnadsslag utan rader inte är aktuellt. Det skapar inga prisrader och ersätter inte uppgifter som saknas på en befintlig rad.'],
  },
  {
    id: 'parts', title: 'Arbetsdelar och masshantering',
    paragraphs: ['Arbetsdelar grupperar arbeten inom åtgärden, exempelvis schakt och dränering. Du kan lägga till och hantera arbetsdelar och filtrera arbetena. Material och övriga kostnader ligger kvar när du filtrerar arbeten. Om en arbetsdel tas bort behålls kalkylraderna utan arbetsdel.', 'Markera rader och öppna Ändra valda arbeten för att flytta markerade arbeten till en arbetsdel eller ändra deras timkostnad tillsammans. Gemensam timkostnad kräver att alla valda arbeten har egen timkalkyl. Antalet timmar behålls.', 'Spara eller återställ den påbörjade massändringen innan du fortsätter. Summaraden avser fortfarande hela åtgärden, inte bara de markerade eller synliga arbetena.'],
  },
  {
    id: 'purchaselist', title: 'Skriv ut en beställningslista',
    paragraphs: ['Välj Fler verktyg, Markera rader och markera de produkter du vill ha med. Beställningslista visar antalet valda materialrader; arbete och andra kostnadsslag tas inte med.', 'Granska produkterna och ange valfri leverantör, leveransadress, leveransdatum och referens. Du kan justera mängd, enhet, produkttext, artikelnummer och notering enbart i listan. Kalkylraderna ändras inte. Om du byter enhet töms listans inköpspris så att du kan ange rätt pris för den nya enheten.', 'Utskriften är prisfri från början. Välj Visa inköpspriser exkl. moms om dessa ska vara med. Kundpris, påslag och interna kalkylanteckningar tas aldrig med. Tomma mängder och priser ger en varning och lämnas tomma i utskriften; ett angivet nollpris visas som 0 kr.', 'Välj Skriv ut för att öppna webbläsarens utskrift. Listan sparas inte i Hushub och skapar ingen PDF, historik eller beställning. Ingen information skickas till leverantören. Stänger du listan behöver du göra eventuella justeringar igen nästa gång.'],
  },
  {
    id: 'quotes', title: 'Ta in och använda offerter',
    paragraphs: ['För Eget arbete och Underentreprenör kan en ny rad skapas med Ta in offerter i stället för Timmar / eget pris. Radens detaljer visar då prisunderlagen. Du kan också öppna Prisunderlag från en befintlig arbetsrad.', 'En sparad leverantörsoffert används inte automatiskt. Kontrollera omfattning, pris och villkor, markera underlaget som kontrollerat och välj Använd i kalkylen. Då används det valda priset med radens påslag. Att välja ett pris är inte en beställning.', 'För att begära offert på flera arbeten: välj Markera rader, markera arbetsraderna och välj Begär offert för valda. Granska mottagare och innehåll i förfrågan innan du skickar. Högst 30 arbetsrader kan tas med i en sådan förfrågan.', 'Rader som visar Ingår i vald offert räknas inte en gång till ovanpå offertpriset. Grupppris hanteras via offertförfrågan. Om omfattningen ändras eller offerten går ut kan ett nytt bekräftat underlag behövas.'],
  },
  {
    id: 'total', title: 'Samlat pris för hela åtgärden',
    paragraphs: ['Öppna Fler verktyg och Prisunderlag. Välj Samlat pris för åtgärden om du vill ange ett enda kundpris i stället för att beräkna det från raderna.', 'Ange Kundpris exkl. moms och vald moms. Intern kostnad är valfri. Detta är ett direkt kundpris; påslag från de gamla raderna läggs inte ovanpå. Välj Spara prisunderlag när du har ändrat.', 'Befintliga kalkylrader bevaras, men läggs inte ovanpå det samlade priset. Välj Detaljerad kalkyl och spara prisunderlaget för att använda raderna igen. Klar för det samlade priset sparas tillsammans med prisunderlaget.'],
  },
  {
    id: 'ai', title: 'Kalkylförslag med AI',
    paragraphs: ['Föreslå kalkyl med AI utgår från åtgärdens sparade omfattning. Förslaget är ett underlag att granska, inte ett verifierat kostnadsförslag. Priser hämtas inte in av AI-förslaget.', 'Välj vilka föreslagna rader du vill lägga till. Befintliga rader ersätts inte. Kontrollera mängder och antaganden, fyll i verkliga priser och undvik dubbletter. Om underlaget har ändrats behöver du skapa ett nytt förslag.'],
  },
  {
    id: 'problems', title: 'Om något saknas eller är låst',
    paragraphs: ['Mängd saknas: öppna pennan och fyll i mängd och enhet. Pris saknas: fyll i kostnaden per enhet eller välj ett komplett offertunderlag. Ej komplett betyder att hela beloppet ännu inte kan räknas ut.', 'Om Lägg till rad eller redigering är låst: avsluta eller avbryt den öppna radredigeringen och invänta pågående sparning av omfattningen. Ett påbörjat prisunderlag, offertformulär eller en massändring behöver också avslutas. Åtgärdens arbetsstatus och valt offertunderlag kan begränsa vissa ändringar.', 'Stäng åtgärd stänger panelen. Osparade kalkyländringar kräver bekräftelse innan de kastas. Hjälpfönstret sparar eller kastar inga uppgifter; stäng hjälpen för att fortsätta där du var.'],
  },
  {
    id: 'contract', title: 'Vad påverkas utanför kalkylen?',
    paragraphs: ['Projektarbete är projektets arbetskalkyl. Kundpriser och kalkylstatus kan uppdateras när du sparar här, men detta ändrar inte automatiskt dina fristående avtalstexter, avtalspriser, betalningsplan eller låsta avtalsversioner.', 'Offert och Avtal har egna kopior av de uppgifter som uttryckligen har hämtats in. Om du vill ändra dem behöver du gå till respektive flik och välja vad som ska hämtas eller redigeras där. Att markera Klar, läsa hjälpen eller välja en leverantörsoffert skickar inte ett avtal till beställaren.'],
  },
] as const
