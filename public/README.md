Logo files used by the header (already in this folder, matching the naming
from your other dashboards):

- Vita Mojo_Primary_Dark.png
- Subway.png

The code tries these exact names first, then falls back to
vita-mojo-logo.(svg|png) / subway-logo.(svg|png) if you ever swap them out.
If a file is missing it just quietly shows no logo instead of breaking.

Note: filenames are case-sensitive on Vercel (Linux) even though they're not
on a Mac - if you rename these, match the case exactly.
