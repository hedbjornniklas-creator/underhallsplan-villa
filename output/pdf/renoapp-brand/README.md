# RenoApp brand profile

`build_profile.py`, the variable font/license and reusable brand assets are
versioned. Generated PDFs, ZIP packages, static font instances and page screenshots
stay on disk but are excluded from Git. Ignoring them does not delete them or
create a backup of them.

Run `build_profile.py` from the repository root in a Python environment with
reportlab, fonttools, pypdf and their dependencies installed. The script recreates
the static fonts and profile deliverables in this directory.

Browser preview helpers are kept separately under `tmp/renoapp-brand-preview.mjs`,
`tmp/renoapp-brand-tsconfig.json` and `tmp/renoapp-search-debug.mjs`. Their generated
browser bundle, screenshots and local result files are not source files.
