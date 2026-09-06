# HusHub – Intuit-nära layout

## Förlaga och genomförande

Förlagan var den aktuella startsidan på https://www.intuit.com/, visuellt granskad den 6 september 2026. Sidans produktlist, vita huvudnavigation, mörkblå huvudsektion med vänsterställd text och stor bild samt ljusblå produktfält användes som direkt layoutreferens.

HusHubs version har:

- En smal produktrad med befintliga BesiktApp- och RenoApp-logotyper.
- Ett vitt sidhuvud med HusHub, tre huvudlänkar och tydlig inloggning.
- Mörkblå huvudsektion med stor normalviktig typografi, kort text, två handlingar och en större illustrationsbild.
- Två stora bild- och textsektioner i stället för de tidigare rollkorten, processlistorna och funktionslistorna.
- En ljus cyan hjälpsektion.
- Samma kanoniska länkar, sessionstyrda produktdestinationer, behörigheter och formulär som tidigare.

Det är en närliggande omarbetning av layouten, inte en pixelidentisk kopia. Inga Intuit-texter, kundbilder, logotyper, nedladdade typsnitt eller källkod har återanvänts. Ingen automatisk karusell eller autoplay-film har lagts till.

## Filer

- src/app/(app)/page.tsx
- src/components/public/PublicHeader.tsx
- src/components/public/public.css
- public/landing/besiktning-editorial-v2.png
- public/landing/renovering-editorial-v2.png

Tidigare implementation och verifiering finns i 2026-09-06-public-entry-redesign.md. Den filens beskrivning av startsidans tre rollkort är ersatt av denna version.

## Kontroller

- Riktad ESLint: godkänd.
- TypeScript: godkänd.
- Fyra publika navigationstester: godkända.
- Produktionsbuild: godkänd.
- git diff --check: godkänd.
- Startsidan visuellt granskad vid 375, 768, 1024 och 1440 px. Ingen horisontell scroll.
- Dubblerad grundtextstorlek (32 px) kontrollerad vid 375 px utan överflöde; tillfällig QA-regel borttagen.
- Mobilmenyns öppning, scrollåsning, Escape och fokusåterställning kontrollerade.
- Produktankaret kontrollerat med tangentbord. Produktdestinationerna kontrollerade i renderade länkar och regressionstester.
- Nya bilder laddas genom Next Image med angivna dimensioner och responsiva sizes.

Ingen lyckad autentisering eller formulärinlämning genomfördes i denna visuella omarbetning. Ingen databasändring, push eller publicering gjordes.

## Bildkällor och genereringsprompter

Två originalbilder skapades med det inbyggda bildgenereringsverktyget, inte CLI. De är illustrationsbilder med fiktiva personer, inte bilder av verkliga kunder eller medarbetare. Originalen finns i projektet; Next Image sköter webbvisningen.

### Besiktning

Sparad fil: C:/Users/hedbj/underhallsplan-villa/public/landing/besiktning-editorial-v2.png

```text
Use case: photorealistic-natural
Asset type: original editorial website photograph for HusHub, suitable for a large portrait crop on a dark navy homepage hero and a property-inspection product panel.
Primary request: a premium Scandinavian property-inspection scene in a bright Swedish villa living room.
Subject: one fictional middle-aged building inspector wearing a plain navy overshirt, standing naturally and using a tablet, looking down at it with quiet concentration.
Composition/framing: vertical 4:5 portrait photograph, person visible waist-up and offset slightly right, hands and tablet visible, comfortable room around head and shoulders for cropping.
Scene/backdrop: white walls, oak trim and generous window light in a calm lived-in Scandinavian villa interior.
Style/medium: photorealistic candid editorial photography, believable skin pores and wrinkles, woven overshirt texture, real oak grain, subtle everyday imperfections.
Lighting/mood: soft abundant natural daylight, calm professional mood, cool restrained white/navy/oak palette.
Constraints: exactly one original fictional adult, no identifiable real person, no logos, no text, no UI visible, no watermark, no hard hat, no construction costume or staged construction theatre, no collage or designed webpage.
```

### Renovering

Sparad fil: C:/Users/hedbj/underhallsplan-villa/public/landing/renovering-editorial-v2.png

```text
Use case: photorealistic-natural
Asset type: original editorial website photograph for HusHub, for an apartment renovation planning panel.
Primary request: two adult apartment owners carefully reviewing a floorplan together at an oak table in a bright calm Swedish apartment kitchen/living room.
Subject: exactly two fictional adults, one standing and one seated, wearing understated neutral clothing; they naturally focus on an unlettered floorplan and use a pencil to discuss renovation details, without looking at the camera.
Composition/framing: vertical 4:5 portrait photograph, include both faces, natural hands interacting with the paper, and oak tabletop; frame the collaboration clearly for a website crop.
Scene/backdrop: calm Scandinavian kitchen and living room, soft daylight and restrained interior details.
Style/medium: photorealistic candid editorial photography with real skin texture, natural fabric folds, paper texture and oak grain.
Lighting/mood: soft daylight, focused quiet collaboration, cool white/navy/oak palette.
Constraints: no recognizable real people, no logos, no text or lettering anywhere, no watermark, no branded tablet UI, no camera smiles, no claim of actual customers, no collage or designed webpage.
```
