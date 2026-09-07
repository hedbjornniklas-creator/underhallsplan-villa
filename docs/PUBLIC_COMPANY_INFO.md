# Bolaget bakom HusHub

Kontrollerat 2026-09-07. Detta är käll- och implementationsanteckningar, inte ett fullständigt juridiskt godkännande av tjänsten.

## Publicerade uppgifter

`src/lib/publicCompanyInfo.ts` är den gemensamma källan för:

- JNH Consulting AB
- Organisationsnummer 559027-7694
- Momsregistreringsnummer SE559027769401
- Adress: Bryggvägen 7, 117 71 Stockholm, Sverige

Användaren har uppgett att HusHub ägs och drivs av JNH Consulting AB. Formuleringen bygger på den uppgiften, inte på en extern kontroll av domänägande eller varumärkesregistrering.

Namn och organisationsnummer visas alltid i `PublicFrame` via `PublicCompanyIdentity`. Sidfoten länkar direkt till `/om-hushub`, som även visar momsnummer, adress och bekräftad offentlig e-post när den fyllts i. Bolagsuppgifter är inte en valfri marknadssektion och påverkas inte av `PUBLIC_COMMERCIAL_CONTENT.contact.enabled` eller prisinställningarna.

Sätesorten verifierades som Sundbyberg men togs bort från sidan, sidfoten och den publika innehållsfilen på användarens uttryckliga begäran 2026-09-07. Användaren informerades om aktiebolagslagens informationskrav. Den här versionen ska därför inte beskrivas som juridiskt komplett.

## Källor

- [Bolagsfakta: JNH Consulting AB](https://www.bolagsfakta.se/5590277694-JNH_Consulting_AB): bolagsnamn, organisationsnummer, säte, adress och momsnummer.
- [Ratsit: JNH Consulting AB](https://www.ratsit.se/5590277694-JNH_Consulting_AB): samstämmiga bolagsuppgifter. Den öppnade sidan angav uppdatering 2026-09-07.
- [Hitta: bolagsinformation](https://www.hitta.se/f%C3%B6retagsinformation/jnh%2Bconsulting%2Bab/5590277694): organisationsnummer, momsnummer samt gatuadress och postort.

Bolagskällorna är publika informationstjänster, inte ett beställt registerutdrag direkt från Bolagsverket. Adressen visas som gatuadress och postort enligt Hittas företagssida. Personanknutna adresstillägg i andra register (c/o och lägenhetsnummer) har inte lagts ut på HusHub. Ekonomiska uppgifter, personnummer, styrelsepersoners privata uppgifter och andra irrelevanta registerdata har inte tagits med.

## Offentlig e-post behöver bekräftas

En e-postadress kunde inte verifieras som JNH Consulting AB:s egen kontaktkanal. SBR:s publika yrkesprofil anger en adress i anknytning till ett annat företag; den har därför inte automatiskt publicerats som HusHubs kontakt. Publika register visar också olika telefonnummer. Inget nummer har valts godtyckligt.

`PUBLIC_COMPANY_INFO.email` är därför `null` tills användaren bekräftar vilken adress som ska publiceras. Frågan är ställd. När en adress bekräftats fylls den i här; kontaktlänken visas då automatiskt på företagssidan. Detta får **inte** samtidigt aktivera BesiktApps intresseutskick: `BESIKTAPP_INTEREST_TO` är en separat privat serverinställning.

## Juridisk avgränsning

- [Aktiebolagslagen, 28 kap. 5 §](https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/aktiebolagslag-2005551_sfs-2005-551/) anger att bolagets webbplats ska innehålla företagsnamn, styrelsens sätesort och organisationsnummer.
- [E-handelslagen, 8 §](https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/lag-2002562-om-elektronisk-handel-och-andra_sfs-2002-562/) anger grundläggande leverantörsuppgifter som namn, adress och e-post samt, när tillämpligt, organisations- och momsregistreringsnummer. Informationen ska vara enkelt och varaktigt tillgänglig.

Ägartexten ensam innebär alltså inte att allt juridiskt är klart: sätesorten har utelämnats på användarens begäran och offentlig e-post behöver bekräftas. Ändringen inför ingen integritetspolicy, ändrar inte avtalsvillkor eller versioner och fastställer inte dataskyddsroller för BesiktApp/RenoApp. Sådana frågor behöver bedömas utifrån respektive behandling och avtal, vid behov med juridisk hjälp.

## Kontroller

`npm run test:public-products` kontrollerar att identiteten finns i sidfoten även med kommersiella sektioner avstängda, att företagssidan använder samma uppgifter och att borttagen sätesort och okonfirmerad kontakt inte renderas. Typkontroll och produktionsbygge kompletterar testerna. Inget riktigt mejl skickas.
