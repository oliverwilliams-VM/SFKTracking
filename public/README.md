Drop your logo files here with these exact base names — .svg, .png, or .jpg
all work, the dashboard tries each extension automatically:

- vita-mojo-logo.svg  (or .png / .jpg)
- subway-logo.svg     (or .png / .jpg)

If a file is missing, the header just falls back to no logo instead of
breaking. If logos still don't show after adding them, double check:
1. The files actually landed in `public/` (not a subfolder)
2. The filename matches exactly (case-sensitive) - "Subway-Logo.png" won't
   match "subway-logo"
3. You redeployed after pushing - Vercel needs a fresh deployment to pick up
   new files in public/
