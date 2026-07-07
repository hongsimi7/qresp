# Staging QA Checklist — auth/edit MVP (Qresp 2.0)

Target: **`qresp_staging` ONLY** (never `/home/sushant/qresp`, never the live
compose project). Access via the SSH tunnel: `https://localhost:8443`.
No secrets in this file or in compose files — inject everything via
environment variables on the staging backend container.

## Backend environment (staging only)

- [ ] `QRESP_ENABLE_DEV_LOGIN=1` (dev-login stays OFF everywhere it is unset)
- [ ] `QRESP_ADMIN_EMAILS=admin@example.com` (optional, comma-separated allowlist)
- [ ] `QRESP_GOOGLE_CLIENT_ID=...`
- [ ] `QRESP_GOOGLE_CLIENT_SECRET=...`
- [ ] `QRESP_GOOGLE_REDIRECT_URI=https://localhost:8443/api/auth/google/callback`
      (must match an authorized redirect URI on the Google OAuth client; use
      the public staging hostname instead if testing without the tunnel)
- [ ] `QRESP_PUBLISH_SKIP_EMAIL=1` (staging QA only: show the publish verify
      link in the browser instead of sending SMTP email; never in production)
- [ ] `QRESP_OAUTHLIB_INSECURE_TRANSPORT=1` **only if** the callback is served
      over plain HTTP (not needed for the HTTPS tunnel; never in production)

## API smoke (curl -k through the tunnel)

- [ ] `curl -k https://localhost:8443/api/auth/me` → 200, `authenticated:false`, a `csrf_token`
- [ ] `curl -k https://localhost:8443/api/search` → 200 (unchanged)
- [ ] dev-login round trip:
      `curl -k -c c.txt -X POST https://localhost:8443/api/auth/dev-login -H "Content-Type: application/json" -d '{"email":"owner@example.com"}'` → 200
      then `curl -k -b c.txt https://localhost:8443/api/auth/me` → `authenticated:true`
- [ ] mutation without `X-CSRF-Token` while logged in → 403 (e.g. logout)

## Browser (https://localhost:8443)

- [ ] Home/header/footer render like https://paperstack.uchicago.edu (commit `4af350f` repairs)
- [ ] Mobile-width header drawer opens and shows nav + auth controls (manual)
- [ ] "Dev sign in" logs in; header shows name and Sign out
- [ ] "Sign in with Google" → consent → returns to the ORIGINATING page; header shows Google name
- [ ] paperdetails shows the permission notice (anonymous: "Sign in to edit …")
- [ ] Owner (or admin): "Edit metadata" visible → edit tags on a **staging/test record only** → saves and reloads with new tags
- [ ] Non-owner signed in: no edit button; direct `PUT /api/paper/{id}` with their cookie+token → 403
- [ ] Anonymous `PUT /api/paper/{id}` → 401
- [ ] `/api/ui/` swagger page loads

## Publish → verify → account round trip

- [ ] Signed in, publish a staging test record → success dialog says
      "Queued for verification…" with the verification link and an
      "Open verification link" button (QRESP_PUBLISH_SKIP_EMAIL=1 mode)
- [ ] Open the link → verify page succeeds through the tunnel
      (`https://localhost:8443/verify/PUBLISH_<id>?server=https://localhost:8443`
      — SSR reaches the backend via QRESP_INTERNAL_API_URL, not localhost)
- [ ] "Go to Paper" shows the new record; the permission notice says you can
      edit it (owner)
- [ ] Header name → `/account`: profile shows name/email/provider (+admin
      badge if allowlisted); the new record appears under "My published
      records" with working View / Edit in Curator links
- [ ] "Drafts on this browser" lists an in-progress curator draft with
      Resume/Clear (start typing in /curator create mode first)

Identity/verification model (documented, not configurable in UI): Google
(or staging dev-login) provides the verified identity and owner_email;
publishing still queues the record for a final verification step before DB
insertion; production sends the verification email over SMTP, staging can
set QRESP_PUBLISH_SKIP_EMAIL=1 to show the link instead. No Google
Drive/Gmail scopes anywhere.

## After QA

- [ ] Note any UI deltas vs production in FULL_STACK_MODERNIZATION_REPORT.md §8
- [ ] Do NOT leave `QRESP_ENABLE_DEV_LOGIN` set on anything production-facing
