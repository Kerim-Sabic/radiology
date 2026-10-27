# Deploying privately (Netlify or Vercel)

The app is a static SPA (`dist/`) with no server functions. Large DICOM is served as static files, never proxied through a function.

## What the configs do
- `vercel.json` / `netlify.toml`: build `npm run build` → `dist`; SPA deep links rewrite to `index.html`, while missing files under `/packs` and `/content` return a real 404 (Vercel: excluded from the rewrite; Netlify: explicit 404 rules before the SPA fallback); long immutable caching for hashed assets and content-addressed DICOM (`/packs/*/dicom/*`, served as `application/dicom`); `no-cache` for manifests/lessons; `application/wasm` for codecs; `X-Robots-Tag: noindex`.
- No cross-origin isolation headers: Cornerstone 5 does not need SharedArrayBuffer in this configuration (verified by the e2e suite in Chromium and Firefox without them).
- The app checks one file per pack at start-up; packs whose images are not on the host are listed in Settings → Data packs and their cases are hidden (no dead studies).

## Environment variables (see `.env.example`)
| name | where | purpose |
|---|---|---|
| `VITE_PACK_BASE_URL` | build | serve packs from another origin (must send CORS `Access-Control-Allow-Origin` for your app origin, allow `GET, HEAD`, and be access-protected) |
| `VITE_BOOK_URL` | build | URL of *your* protected copy of the PDF (needs HTTP range requests + CORS). Otherwise import the PDF per device in Settings. |

**Your book in a private build:** `python scripts/book/install_book.py --pdf <file>` puts the PDF at `public/book/learning-radiology-5e.pdf` (git-ignored). A local build then contains `dist/book/…` and the app opens it automatically. Deploy such a build only behind access protection (Vercel *All Deployments* + Vercel Authentication); a Git-based deploy never contains it because it is not in the repository. Note it adds 73 MB to the upload (Vercel Hobby's CLI limit is 100 MB in total).

## Vercel (recommended for privacy)
1. Import the GitHub repo in Vercel (framework: Vite).
2. **Settings → Deployment Protection → All Deployments + Vercel Authentication.** Per Vercel's docs (checked 27 Oct 2026) this is available on every plan and protects *all* URLs — production domain, generated URLs and every static file (DICOM, JSON) — for everyone who is not a member of your Vercel team. Password Protection is a paid Pro add-on and not needed.
3. Size: Git deployments include only what is in the repository (app + `starter` pack + all manifests/lessons/target JSON). CLI uploads are limited to **100 MB on Hobby** and **1 GB on Pro** (15,000 files). To host all packs (~730 MB) build locally after `packs.py fetch …` and deploy with `vercel deploy --prebuilt --archive=tgz` on Pro.
4. Verify signed-out: open a private window and request `/`, `/packs/index.json` and one `/packs/starter/dicom/...dcm` URL — all must require login.

## Netlify
1. New site from Git; build settings come from `netlify.toml`; set the optional env vars.
2. Privacy: Netlify **Free/Personal** plans have no password protection — use *Private project visibility* (credit-based plans) or upgrade to **Pro** for basic password protection; team-login/SSO is Enterprise. Netlify's docs do not state whether protection covers every static file, so verify signed-out access to a `.dcm` URL yourself.
3. Larger packs: `netlify deploy --prod --dir dist` after building locally with the packs fetched.

## Without protected hosting
Run locally (`npm run build && npm run preview`) or use the hosted app with only the starter pack and import your own studies on each device (Import page — files never leave the browser). A public, unlisted URL is **not** private.

## Progress across devices
Progress lives in each browser's IndexedDB. Use Progress → Export backup / Import backup to move it. There is no automatic sync.
