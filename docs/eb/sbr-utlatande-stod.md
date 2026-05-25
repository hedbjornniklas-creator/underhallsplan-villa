# EB - SBR-utlåtande, stödmatris

Senast uppdaterad: 2026-05-25

Syfte: hålla koll på vilka uppgifter som krävs för ett SBR-likt utlåtande för slutbesiktning och var de stöds i Hushub. Målet är att färdigt utlåtande inte ska innehålla instruktionstext eller "Ange ..."-texter.

## Princip

- Entreprenadens grunduppgifter fylls i på entreprenadsidan via `Ny entreprenad` eller `Redigera entreprenad`.
- Besiktningsspecifika uppgifter fylls i på besiktning/runda/kallelse.
- Noteringar fylls i i `Granska` eller mobil runda.
- Formella utlåtandepunkter fylls i i `Utlåtandeutkast`. Strukturerade beslut och datum fylls i i panelen `Utlåtandeuppgifter` på samma sida.
- Färdigt utlåtande får skriva ut formella standardtexter som anger att uppgift inte redovisats, inte fastställts eller inte är aktuell.
- Färdigt utlåtande får inte skriva ut instruktionstext som börjar med `Ange`, `Komplettera` eller motsvarande redigeringshjälp.

## Rubrikregel

EB-utlåtandet ska följa en fast rubrikhierarki så att digital vy och PDF får samma struktur:

| Nivå | Användning | Form |
|---|---|---|
| Dokumenttitel | Huvudrubriken efter objektinformationen | Versaler, vänsterställd, 16 pt, fet. Exakt text: `UTLÅTANDE ÖVER SLUTBESIKTNING`. |
| Huvudavsnitt | Formella utlåtandepunkter från `report_draft.sections` | 12 pt, fet. Synlig rubrik skrivs utan numrering. SBR-punkt får bara användas internt för spårbarhet. |
| Bilagerubrik | Noteringsbilaga och fotobilaga | Versaler, 13 pt, fet. Exempel: `BILAGA 1 TILL UTLÅTANDE ÖVER SLUTBESIKTNING`. |
| Tabellrubrik | Kolumner i noteringsbilagan | Kort SBR-lik text: `Bet.`, `Nr`, `Del/Rum`, `Fel`, `Avhjälpt/sign`. |
| Fältetikett | Objektinformation och metadata | Fet etikett till vänster, värde till höger. |

Regel i kod: rubrikklasser för EB-utlåtandet ska ligga samlade i rapportkomponenten som namngivna konstanter. Nya rubriker ska använda dessa nivåer i stället för egna Tailwind-klasser direkt i JSX.

Första synliga avsnitt i färdigt utlåtande ska vara:

1. `Besiktningens omfattning`
2. `Tid för besiktningen`
3. `Avtalade arbeten och parter`

`Typ av besiktning` sparas i utkastet för spårbarhet men skrivs inte ut som egen rubrik, eftersom dokumenttiteln redan anger slutbesiktning.

`Avtalade arbeten och parter` ska byggas från strukturerade entreprenadfält och visas med denna fasta struktur. Vokabulären styrs av avtalstyp: HF 17 använder `Hantverkare /(Näringsidkare)`, medan ABS 18 och övriga entreprenadavtal använder `Entreprenör`.

```text
Avtalsform: Enligt Hantverkarformuläret HF 17 för konsumenttjänster

Parter

Beställare /(Konsument): [namn]
                         [adressrad]
                         [postnummer ort]

Hantverkare /(Näringsidkare): [företagsnamn]
                              [adressrad]
                              [postnummer ort]
                              Org.nr: [organisationsnummer]
```

## Datastöd

| Område | Datastöd | UI-stöd | Kommentar |
|---|---|---|---|
| Entreprenad/projekt | `eb_projects` | Entreprenadsidan | Strukturerat. |
| Objekt/adress/kommun/fastighetsbeteckning | `eb_projects`, kopplad `properties` | Entreprenadsidan | Strukturerat. |
| Avtal/entreprenadform/upphandling/kontraktsdatum | `eb_projects` | Entreprenadsidan | Strukturerat. |
| Beställare/hantverkare/entreprenör/org.nr/adress | `eb_projects`, initialt `eb_participants` | Entreprenadsidan, kallelse | Strukturerat för beställare och primär hantverkare/entreprenör. |
| Besiktningstyp/datum/tid | `inspections`, `eb_inspection_details` | Ny besiktning/runda, Utlåtandeutkast | Strukturerat. |
| Kallelse | `eb_inspection_details`, `eb_participants`, `outbound_messages` | Kallelse-dialog, Utlåtandeutkast | Delvis strukturerat. |
| Deltagare/närvarande | `eb_participants` | Kallelse-dialog | Strukturerat, men partsombud/för talan behöver tydligare rollstöd. |
| Fack/littera | `eb_disciplines` | Seedas, visas i granska | Strukturerat. |
| Noteringar | `eb_notes` | Granska/runda | Strukturerat. |
| Bilder | `inspection_images.eb_note_id` | Granska/runda | Strukturerat. |
| Handlingar/bilagor som filer | `eb_project_attachments` | Entreprenadsidan | Strukturerat som filer, men inte fullt kopplat till SBR-bilageförteckning. |
| Utlåtandets formella text | `eb_inspection_details.report_draft` | Utlåtandeutkast | Redigerbart JSON-utkast. |

## Fältprincip

All nödvändig information ska antingen finnas som strukturerat fält eller som redigerbar utlåtandesektion:

- Strukturerade fält används för sådant som återkommer i listor, filter, kallelser och noteringar: entreprenad, parter, objekt, avtal, tider, deltagare, fack, noteringar, bilder och bilagor.
- Redigerbara utlåtandesektioner används för formella bedömningar och texter som varierar mellan uppdrag: jäv, tidigare besiktningar, handlingar, ej åtkomligt, dokumentationsbesiktning, godkännande, garantitid, avhjälpande, efterbesiktning, sändlista och underskrift.
- Utlåtandeutkastet sparas i `eb_inspection_details.report_draft`. Det innebär att vi inte behöver hårdkoda nya databaskolumner för varje formell textpunkt innan flödet har satt sig.
- Om ett redigerbart fält senare behöver statistik, filtrering eller återanvändning ska det brytas ut till egen kolumn/tabell.

## Beslutad fältplacering

| Uppgift | Placering | Kommentar |
|---|---|---|
| Besiktningsman som utför utlåtandet | Hämtas från inloggad användares settings/profil | Ska inte matas in manuellt i varje utlåtande. |
| Certifiering och SBR-medlemskap | Hämtas från inloggad användares settings/profil | Profilen behöver bära certifiering, nummer och eventuell SBR-koppling. ÖB-specifika formuleringar ska inte visas i EB-utlåtandet. |
| Vem som utsett besiktningsmannen | Besiktningen | Val: `Beställare`, `Parterna gemensamt`, `Entreprenör`. |
| Biträdande besiktningsmän | Avvaktas | Ska inte byggas nu. |
| Partsombud/för talan för beställare | Besiktningen, deltagarlistan | Fylls i under besiktningen. |
| Partsombud/för talan för entreprenör | Besiktningen, deltagarlistan | Fylls i under besiktningen. |
| Närvarande vid besiktning | Besiktningen, deltagarlistan | Ska vara separat från kallade. |
| Mottagare av utlåtande | Besiktningen, deltagarlistan | Ska vara separat från kallelsemottagare. E-post ska samlas in här. |
| Kallelsemetod | Besiktningen/kallelse | Framgår av kallelsen men ska kunna redigeras i besiktningen. |
| Kallelsedatum | Besiktningen/kallelse | Ska vara tydlig egen uppgift och kunna justeras. |
| Fråga om jäv | Villkorad utlåtandepunkt | Rubrik och text visas endast om besiktningsmannen är utsedd av parterna gemensamt. Tas bort om utsedd av beställaren. |
| Tidigare besiktningar | Utlåtandeuppgifter | Baseras på intern information samt kompletterande fritext. |
| Provningar/kontroller som åberopas | Utlåtandeuppgifter | Fritext. |
| Entreprenadhandlingar | Entreprenaden/handlingar + utlåtandeuppgifter | Välj från entreprenadens handlinglista med kryss för vilka som ska med, plus fritt kompletteringsfält. |
| Överenskommelser vid/inför besiktning | Utlåtandeuppgifter | Fritext. |
| Bilageförteckning med littera | Byggs från valda handlingar, kompletteringar och bilagor | Ska inte dubbelmatas. |
| Delar ej åtkomliga | Granska + utlåtandeuppgifter | Baseras på noteringar/status och kan kompletteras i utlåtandeuppgifter. |
| Delar endast besiktigade genom handling | Utlåtandeuppgifter | Fritext/lista. |
| Beslut godkänd/ej godkänd/delvis | Besiktningen | Dropdown. |
| Beslutets motivering | Besiktningen eller utlåtandeuppgifter | Fritext. |
| Fortsatt slutbesiktning krävs | Besiktningen | Dropdown ja/nej. |
| Garantitidens längd | Besiktningen | Dropdown 1-10 år. |
| Garantitidens slutdatum | Besiktningen | Datumväljare. |
| Avhjälpandetid generellt | Besiktningen | Datumväljare. |
| Efterbesiktning påkallad | Besiktningen | Dropdown ja/nej. |
| Efterbesiktning datum/senast datum | Besiktningen | Datumväljare. |
| Utlåtandet gäller som kallelse till efterbesiktning | Standardtext | Ska styras av standardtext, inte fritext i varje utlåtande. |
| Särskild utredning: ansvarig | Noteringar markerade som utredningspunkt | Lista byggs från noteringar. Per rad: dropdown `Entreprenör`, `Beställare`, `Annat` + fritext. |
| Särskild utredning: kostnadsansvar | Utredningslistan | Dropdown `Entreprenör` eller `Beställare`. |
| Särskild utredning: klar senast | Utredningslistan | Datumväljare. |
| Nedsättning: belopp | Noteringar markerade för nedsättning | Fritext per kopplad notering eller nedsättningsrad. |
| Nedsättning: kopplade noteringar | Byggs från noteringarnas markering | Ska inte dubbelmatas. |
| Noteringsbeteckningens förklaring | Utlåtandet | Ren standard-/inställningstext. |
| Separata fackbilagor | Avvaktas | Ska inte byggas nu. |
| Utlåtandets distributionsdatum | Utlåtande/skicka | Standard dagens datum, men datumväljare ska finnas. |
| Utlåtandets distributionssätt | Besiktningens sändlista | Byggs från mottagare/e-post i deltagarlistan. |

## Föreslaget datastöd för beslutade fält

| Datamodell | Nya/tydligare fält |
|---|---|
| `profiles` eller befintlig profil/settings-modell | certifieringsuppgifter, SBR-medlemskap och visningsnamn för besiktningsman. |
| `eb_inspection_details` | `inspector_appointed_by`, `invitation_method`, tydligt `invitation_date`, beslut, beslutstext, fortsatt slutbesiktning, garantitid, garantitidens slut, generell avhjälpandetid, efterbesiktning, distributionsdatum. |
| `eb_participants` | `attended`, `receives_report`, `represents_party_key`, `can_represent_party`. |
| `eb_project_attachments` | `include_in_report`, `littera`, `document_date`, `document_number`, `document_note`. |
| `eb_inspection_details.report_draft` | fri text för tidigare besiktningar, provningar, överenskommelser, dokumentationsbesiktigade delar och kompletteringar. |
| `eb_notes` | utnyttja `marker_key` för särskild utredning och nedsättning; komplettera vid behov med per-notering ansvar, kostnadsansvar, klar-senast och nedsättningsbelopp. |

## Standardtexter

EB-standardtexter ska inte hårdkodas i React-komponenter eller i `src/lib/eb/server.ts`. De ska ligga som separata textfiler och registreras i `src/content/standardtexts/registry.ts`, på samma sätt som ÖB-utlåtandet.

EB-texterna ligger här:

- `src/content/standardtexts/eb/EB_REPORT_SCOPE.txt`
- `src/content/standardtexts/eb/EB_REPORT_INSPECTORS.txt`
- `src/content/standardtexts/eb/EB_REPORT_SUMMONS_MISSING.txt`
- `src/content/standardtexts/eb/EB_REPORT_CONFLICT_OF_INTEREST.txt`
- `src/content/standardtexts/eb/EB_REPORT_PREVIOUS_INSPECTIONS_TESTS.txt`
- `src/content/standardtexts/eb/EB_REPORT_TESTING_DOCUMENTATION.txt`
- `src/content/standardtexts/eb/EB_REPORT_CONTRACT_DOCUMENTS_MISSING.txt`
- `src/content/standardtexts/eb/EB_REPORT_NOT_ACCESSIBLE_NONE.txt`
- `src/content/standardtexts/eb/EB_REPORT_DOCUMENTATION_ONLY.txt`
- `src/content/standardtexts/eb/EB_REPORT_APPENDICES.txt`
- `src/content/standardtexts/eb/EB_REPORT_DEFECTS_APPENDICES_EMPTY.txt`
- `src/content/standardtexts/eb/EB_REPORT_MARKER_LEGEND_MISSING.txt`
- `src/content/standardtexts/eb/EB_REPORT_SPECIAL_INVESTIGATION.txt`
- `src/content/standardtexts/eb/EB_REPORT_DEDUCTION.txt`
- `src/content/standardtexts/eb/EB_REPORT_NOTES_EMPTY.txt`
- `src/content/standardtexts/eb/EB_REPORT_APPROVAL_DECISION.txt`
- `src/content/standardtexts/eb/EB_REPORT_CONTINUED_FINAL_INSPECTION.txt`
- `src/content/standardtexts/eb/EB_REPORT_WARRANTY_END.txt`
- `src/content/standardtexts/eb/EB_REPORT_RECLAMATION_NOTICE.txt`
- `src/content/standardtexts/eb/EB_REPORT_REMEDY_DEADLINE.txt`
- `src/content/standardtexts/eb/EB_REPORT_REMEDY_COST.txt`
- `src/content/standardtexts/eb/EB_REPORT_AFTER_INSPECTION.txt`
- `src/content/standardtexts/eb/EB_REPORT_OTHER_NOTES.txt`
- `src/content/standardtexts/eb/EB_REPORT_DISTRIBUTION_LIST_MISSING.txt`
- `src/content/standardtexts/eb/EB_REPORT_SIGNATURE_CERTIFICATE.txt`
- `src/content/standardtexts/eb/EB_REPORT_NOTE_LEGEND.txt`

Regel: textfilerna får vara våra egna standardtexter och stödtexter, men de ska inte vara en kopia av SBR:s malltext.

## SBR-punkter

| SBR-punkt | Stöd i Hushub | Källa |
|---|---|---|
| Typ av besiktning (1) | Ja | `inspections`, `eb_inspection_details`, `report_draft.inspection_type` |
| Besiktningens omfattning (2) | Ja, redigerbart | `report_draft.scope`, standardtext. Entreprenadbeskrivning visas i sidhuvudet från `eb_projects.object_description`. |
| Tid för besiktningen (3) | Ja | `inspections.date`, `inspections.inspection_time`, `report_draft.inspection_time` |
| Avtalade arbeten och parter (4) | Ja | `eb_projects`, `report_draft.contract_parties` |
| Besiktningsman (5) | Redigerbart utkast | `report_draft.inspectors` |
| Närvarande (6) | Delvis strukturerat | `eb_participants`, `report_draft.participants` |
| Sättet för kallelse (7) | Delvis strukturerat | `eb_inspection_details.invitation_sent_at`, `report_draft.summons` |
| Fråga om jäv (8) | Redigerbart utkast | `report_draft.conflict_of_interest` |
| Tidigare besiktningar/provningar (9) | Redigerbart utkast | `report_draft.previous_inspections_tests` |
| Provning/dokumentation | Redigerbart utkast + standardtext | `report_draft.testing_documentation` |
| Entreprenadhandlingar/överenskommelser (10) | Delvis | `eb_project_attachments`, `report_draft.contract_documents` |
| Ej åtkomliga delar (11) | Delvis | `eb_notes.status_key=not_accessible`, `report_draft.not_accessible` |
| Endast dokumentationsbesiktigade delar (12) | Redigerbart utkast | `report_draft.documentation_only` |
| Fel, bristfälligheter, anmärkningar och förhållanden (13-17, 23) | Ja/delvis | `eb_notes`, `report_draft.defects_appendices` |
| Beteckningar E/B/S/U/N/A | Ja/delvis | `settings_eb_note_markers`, `report_draft.marker_legend` |
| Särskild utredning | Redigerbart utkast | `report_draft.special_investigation` |
| Nedsättning | Redigerbart utkast | `report_draft.deduction` |
| Besked om godkännande (18) | Redigerbart utkast | `report_draft.approval_decision` |
| Fortsatt/ny slutbesiktning (19) | Redigerbart utkast | `report_draft.continued_final_inspection` |
| Garantitidens slut (20) | Redigerbart utkast | `report_draft.warranty_end` |
| Reklamationsfrister | Standardtext + redigerbart utkast vid behov | `report_draft.reclamation_notice` |
| När fel ska vara avhjälpta (24) | Redigerbart utkast | `report_draft.remedy_deadline` |
| Kostnad för avhjälpande | Standardtext + redigerbart utkast vid behov | `report_draft.remedy_cost` |
| Efterbesiktning (24) | Redigerbart utkast | `report_draft.after_inspection` |
| Övriga noteringar | Redigerbart utkast | `report_draft.other_notes` |
| Sändlista (25) | Delvis strukturerat | `eb_participants`, `report_draft.distribution_list` |
| Underskrift/certifiering/SBR | Redigerbart utkast | `report_draft.signature_certificate` |

Layoutregel för `Besiktningsman`: sektionen ska visa rubriken `Besiktningsman` och en rad i formatet `Besiktningsman: [namn] [utsedd av ...]`. Biträdande besiktningsmän ska inte skrivas ut i denna första version.

Layoutregel för `Närvarande`: uppgifterna fylls i under `Uppgifter` på besiktningen. Sektionen ska visa rubriken `Närvarande`, texten `Vid besiktningen var parterna representerade av:` och tre rader: `för beställaren:`, `för hantverkaren:`/`för entreprenören:` samt `Övriga närvarande:`. Övriga närvarande ska visa namn, företag och roll i projektet när uppgifterna finns.

Layoutregel för `Sättet för kallelse till besiktningen`: sektionen ska visa rubriken med markering och meningen `Besiktningsmannen har [kallelsedatum] kallat parterna per [kallelsemetod].`. Kallelsedatum och metod fylls i under `Uppgifter` på besiktningen. Kallelsemetod ska kunna väljas från vanliga alternativ, med möjlighet att ange egen metod.

## Kvar att göra för mer strukturerat stöd

Detta är inte blockerande för att kunna fylla i ett komplett utlåtande, men bör prioriteras för bättre styrning:

- Lägg till tydliga roller i deltagare: partsombud, närvarande, mottagare, för talan.
- Koppla `eb_project_attachments` till formell bilageförteckning med littera, datum och typ.
- Lägg till strukturerade beslut för godkännande/ej godkännande och automatisk styrning av punkterna 18-20.
- Lägg till strukturerade datum för avhjälpande och efterbesiktning.
- Lägg till besiktningsmannaprofil med certifikatnummer och SBR-medlemskap.
- Generera bilagor per fack/littera från `eb_disciplines` och `eb_notes`.
- Bygg fullt stöd för flera hantverkare/entreprenörer per entreprenad med egen lista/tabell. Nuvarande `eb_projects` hanterar primär hantverkare/entreprenör.

## Regel för utskrift

Färdigt utlåtande ska aldrig skriva ut instruktionstext. Om en uppgift saknas men avsnittet bör framgå i ett komplett utlåtande ska standardtexten vara en formell uppgift, till exempel att något inte har redovisats, inte fastställts eller inte är aktuellt. Sektioner i `Utkast` får alltså skrivas ut när texten är en sådan formell standardtext eller när användaren har granskat och ersatt den med faktisk information.
