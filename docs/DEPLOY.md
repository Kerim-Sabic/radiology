# Deploying privately (Netlify or Vercel)

The app is a static SPA (`dist/`) with no server functions. Large DICOM is served as static files, never proxied through a function.

## What the configs do
- `vercel.json` / `netlify.toml`: build `npm run build` → `dist`; SPA deep links rewrite to `index.html`, while missing files under `/packs` and `/content` return a real 404 (Vercel: excluded from the rewrite; Netlify: explicit 404 rules before the SPA fallback); long immutable caching for hashed assets and content-addressed DICOM (`/packs/*/dicom/*`, served as `application/dicom`); `no-cache` for manifests/lessons; `application/wasm` for codecs; `X-Robots-Tag: noindex` only on the data files (`/packs`, `/content`), which pages fetch but which are not pages.
- No cross-origin isolation headers: Cornerstone 5 does not need SharedArrayBuffer in this configuration (verified by the e2e suite in Chromium and Firefox without them).
- The app checks one file per pack at start-up; packs whose images are not on the host are listed in Settings → Data packs and their cases are hidden (no dead studies).

## Environment variables (see `.env.example`)
| name | where | purpose |
|---|---|---|
| `VITE_PACK_BASE_URL` | build | serve packs from another origin (must send CORS `Access-Control-Allow-Origin` for your app origin, allow `GET, HEAD`, and be access-protected) |
| `VITE_BOOK_URL` | build | URL of *your* protected copy of the PDF (needs HTTP range requests + CORS). Otherwise import the PDF per device in Settings. |

**Your book in a private build:** `python scripts/book/install_book.py --pdf <file>` puts the PDF at `public/book/learning-radiology-5e.pdf` (git-ignored). It works with the dev server (`npm run dev`). No build ever contains it: `vite.config.ts` removes `dist/book` from every build, so neither a deploy nor an uploaded `dist/` folder can publish the book, and a Git-based deploy could not anyway because it is not in the repository.

## Vercel (recommended for privacy)
1. Import the GitHub repo in Vercel (framework: Vite).
2. **Settings → Deployment Protection → All Deployments + Vercel Authentication.** Per Vercel's docs (checked 27 Oct 2026) this is available on every plan and protects *all* URLs — production domain, generated URLs and every static file (DICOM, JSON) — for everyone who is not a member of your Vercel team. Password Protection is a paid Pro add-on and not needed.
3. Size: the repository now carries every data pack (DICOM + thumbnails, about 1.2 GB and 8,000 files), so a Git deployment hosts every case. Check that your Vercel plan accepts a deployment of that size; CLI uploads are limited to **100 MB on Hobby** and **1 GB on Pro** (15,000 files).
4. Verify signed-out: open a private window and request `/`, `/packs/index.json` and one `/packs/starter/dicom/...dcm` URL — all must require login.

## Netlify
1. Netlify → **Add new site → Import an existing project → GitHub** → pick the repository. Build settings come from `netlify.toml` (`npm run build`, publish `dist`, Node 22); nothing else to fill in. Every data pack is in the repository, so the deployed site has all cases.
   The textbook PDF is not in the repository: on each device open **Book → Import PDF** once (it stays in that browser).
2. Privacy: Netlify **Free/Personal** plans have no password protection — use *Private project visibility* (credit-based plans) or upgrade to **Pro** for basic password protection; team-login/SSO is Enterprise. Netlify's docs do not state whether protection covers every static file, so verify signed-out access to a `.dcm` URL yourself.
3. Updates: every push to `main` redeploys automatically.

## Custom domain radiology.monster
1. Netlify → the site → **Domain management → Add a domain** → `radiology.monster`. Netlify offers to add `www.radiology.monster` too; accept it. Set `radiology.monster` as the **primary domain** (the `www` name then redirects to it).
2. DNS, one of:
   - **Netlify DNS** (simplest): choose *Set up Netlify DNS* and, at the registrar where the domain was bought, replace the nameservers with the four Netlify nameservers it shows.
   - **Keep DNS at the registrar**: an `A` record for `radiology.monster` (apex, `@`) → `75.2.60.5` (Netlify's load balancer), and a `CNAME` for `www` → `<your-site>.netlify.app`. Remove any other `A`/`AAAA`/parking records for those names.
3. HTTPS: once DNS resolves (minutes to a few hours), Netlify provisions a Let's Encrypt certificate automatically (**Domain management → HTTPS**); then turn on *Force HTTPS* if it is not already on.
4. The page metadata (`index.html`: Open Graph image and URL) already points to `https://radiology.monster/`.
5. Later, once the domain is live, the old address can be redirected with a forced rule at the top of `netlify.toml`:
   ```toml
   [[redirects]]
     from = "https://<your-site>.netlify.app/*"
     to = "https://radiology.monster/:splat"
     status = 301
     force = true
   ```
   Do not add it before `radiology.monster` resolves, or the site becomes unreachable.

The site is public and indexable. Search engines get:
- `public/robots.txt` (personal pages and the book reader left out) and `public/sitemap.xml`: the main pages, every course chapter and every condition page.
- A page title per route, and per condition (e.g. "Pneumothorax: imaging, cases and book pages").

After adding a condition or a chapter, run `node scripts/sitemap.mjs`; `tests/sitemap.test.ts` fails until you do. Once the domain is live, add it in Google Search Console and submit `https://radiology.monster/sitemap.xml`.

## Without protected hosting
Run locally (`npm run build && npm run preview`) or use the hosted app with only the starter pack and import your own studies on each device (Import page — files never leave the browser). A public, unlisted URL is **not** private.

## Progress across devices
Progress lives in each browser's IndexedDB. Use Progress → Export backup / Import backup to move it. There is no automatic sync.
