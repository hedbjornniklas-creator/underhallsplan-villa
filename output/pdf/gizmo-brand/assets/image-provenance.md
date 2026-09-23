# Gizmo gecko: source and production notes

Version 2.1, 16 September 2026.

## Source

The selected gecko concept was recovered from the user's conversation
"Skapade applogotyperna", ID `6a874933-9430-83eb-a0ae-4bc1f2d2ae3b`.
The user chose the reference with "Jag tycker vi kor pa denna nu".
The source attachment was `cf233806-aadc-4625-b545-052b5aabd2d7.png`.
Its unchanged copy is `gizmo-original-reference.png`.
The historical Orbit label is not the current brand name.

## Outputs and limits

- `gizmo-gecko-white.png`: AI-assisted restoration of the selected character,
  using the built-in image_gen tool (not the CLI/API fallback).
- Opaque RGB on white. The initial transparency attempt produced a visible
  checkerboard, so that output was rejected and the white-background edit used.
- Not a pixel-identical crop, a rigged model, or a transparent production asset.
- `gizmo-symbol.svg` and logotype variants: manually constructed vector
  interpretation of the original climbing silhouette. Not an image trace.
- The original is retained for future identity comparisons. New poses and
  animations require separate review for consistent eyes, body, feet and tail.
- Name, trademark and source-image rights have not been independently checked.

## Prompt 1: isolated character (intermediate, not delivered)

Use case: background-extraction / identity-preserve. Asset type: transparent mascot PNG for the Gizmo brand guide. The input image is the edit target: extract ONLY the large turquoise 3D gecko in the upper right of this existing brand concept sheet, keeping the established character. Remove all typography, the Orbit logo, small icons, mini geckos, panel headings and white paper background. Produce one isolated full-body mascot on genuinely transparent background with clean alpha, ample transparent margin, all toes and curled tail completely visible. Preserve its exact distinctive pose and design: diagonal climbing gecko with upper hand reaching up behind head and other upper arm outward right; lower hand reaches left; one bent back leg; curved long tail sweeping down and curling to the left; large expressive black-and-white eyes, turquoise teal skin, pale throat/belly, subtle hexagonal scale pattern, rounded toe pads, subtle smile. Do not invent clothing, tools, robotic armor, a different animal, text, a logo, a border or colored backdrop. This is a faithful clean extraction / high-resolution restoration of that existing chosen mascot, not a redesign. No new pose. Retain soft original 3D lighting; omit any ground cast shadow so it can sit on white and neutral panels.

## Prompt 2: white-background edit (delivered)

Use case: precise-object-edit / background replacement. Edit only the background of this existing gecko mascot image. Replace the ENTIRE gray checkerboard backdrop, including gaps between toes and the inner tail curl, with a clean perfectly solid pure white (#FFFFFF) opaque background. No checkerboard, texture, transparency pattern, shadow or gray floor anywhere. Keep the turquoise gecko itself exactly unchanged: same silhouette, exact pose, head, face, eyes, limbs, fingertips, scale pattern, proportions, curled tail and lighting. Do not enlarge the character or crop any toes. Full body visible centered on the same portrait canvas. Do not add text, logos, borders or other objects. Output an opaque RGB image with a completely solid white background.
