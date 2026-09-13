# RenoApp film sources

This directory contains the source scripts for the local presentation films.
Generated videos, screenshots, contact sheets and the compiled `combined/list.js`
are ignored by Git. They remain on disk; the cleanup does not move or delete them.

## Scripts

- `build_film.py`: 18-second application presentation.
- `build_whiteboard.py`: 20-second whiteboard presentation.
- `capture-list.mjs` and `capture-list.tsx`: capture the case-list component using
  fictional records and a loopback-only page.
- `build_combined.py`: 30-second combined whiteboard/application presentation.

Python scripts require Pillow, imageio-ffmpeg and the Windows Segoe UI fonts.
The capture script uses the repository's Node dependencies and local Chrome.
Run these scripts from the repository root. They were preserved during cleanup;
they were not rerun or modified as part of the OB work.

## Local inputs and outputs

The render scripts use screenshots in `tmp/renoapp-resident-journey` and
`tmp/renoapp-completion-ui`, the repository logo, and locally generated storyboard
artwork. `build_whiteboard.py` currently references the original artwork by an
absolute local path; `build_combined.py` uses its `whiteboard/bildmanus.png` copy.
These inputs are not all in Git, so a fresh clone alone cannot reproduce the films.
Keep a separate media backup before moving to another computer.

Existing final videos remain at:

- `RenoApp-kort-presentation.mp4`
- `whiteboard/RenoApp-whiteboard-20sek.mp4`
- `combined/RenoApp-whiteboard-och-app-30sek.mp4`

No source files or final videos were deleted or published during Git cleanup.
