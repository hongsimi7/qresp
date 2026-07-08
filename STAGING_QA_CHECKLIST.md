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
- [ ] "Local recovery draft" lists an in-progress curator draft with
      Resume/Clear (start typing in /curator create mode first)

## Account server drafts (signed in)

- [ ] In `/curator` create mode, fill a few fields (even incomplete, no
      charts/datasets) → "Save Draft" → name it → success dialog
- [ ] `/account` → "My drafts" lists it with an "Updated …" time
- [ ] Save a second draft → both appear (multiple drafts supported)
- [ ] Resume a draft → `/curator?draft=<id>` reloads exactly that draft's state
- [ ] Edit and Save Draft again → the SAME draft updates (no duplicate in the list)
- [ ] "Rename" a draft → title updates in the list
- [ ] "Delete" a draft → confirmation dialog first → confirm removes it
- [ ] "Start from Scratch" with unsaved work → dialog offers Cancel /
      Save Draft and Start Fresh / Discard and Start Fresh (no duplicate
      Dismiss); "Discard" truly blanks the form
- [ ] Navigating away with unsaved changes prompts Save Draft and Leave /
      Leave Without Saving / Stay
- [ ] Publishing from a resumed draft → success dialog offers "Delete the
      saved draft"; the account draft is only removed when you click it
- [ ] Export/Import Metadata (Upload Metadata / Export Metadata) still work and
      are independent of account drafts
- [ ] Anonymous: "Save Draft" prompts to sign in (no server draft is created)

## Soft-deactivate published records (owner/admin)

Chosen design (documented): deactivated records are hidden from the PUBLIC
detail route for everyone, including the owner. Next SSR fetches
`/api/paper/{id}` server-side WITHOUT the browser session cookie, so an
owner's request is anonymous and correctly 404s. Therefore all owner/admin
management of deactivated records happens on `/account` (client-side,
authenticated), NOT on the public detail page. `is_active` is toggled only via
`PUT /api/paper/{id}/active`; metadata edits never change it.

- [ ] `/account` "My published records": an ACTIVE owned record shows
      View + Edit in Curator + **Deactivate**
- [ ] Click "Deactivate" → confirm dialog says it hides but does NOT delete
      (preserved, reversible) → confirm
- [ ] The record disappears from `/search`, `/explorer` and their filter
      dropdowns; its detail page 404s for anonymous/other users
- [ ] Back on `/account`, that record now shows a "deactivated" chip,
      **no View button** (it would 404), Edit in Curator, and **Reactivate**
- [ ] "Edit in Curator" on the deactivated record loads, Save Changes
      succeeds, and returns to `/account` (not a 404 detail page); the record
      stays deactivated (search still hides it)
- [ ] "Reactivate" → confirm dialog → record is public again in search/detail
- [ ] (Active record only) paperdetails still offers owner/admin Deactivate in
      the permission notice; after deactivating there, reloading the detail
      404s by design — manage it from `/account` thereafter

## Admin: ownerless records

- [ ] Signed in as an allowlisted admin, `/account` shows an
      "Ownerless records (admin)" section listing legacy records with no owner
- [ ] Each row shows the (unverified) suggested email; "Assign" sets the owner
      and the row disappears; a bad email shows the backend error inline
- [ ] Non-admins do not see the section; `GET /api/admin/ownerless-papers`
      with a non-admin cookie → 403

## Verify link edge cases

- [ ] Re-click a verification link after publishing → still lands on the paper
      (idempotent), NOT an error, and no duplicate record is created
- [ ] A tampered/unknown `/verify/PUBLISH_bogus?server=…` → "couldn't finish
      publishing" page with a specific message and a Browse link (not a blank
      "contact the administrators")

Identity/verification model (documented, not configurable in UI): Google
(or staging dev-login) provides the verified identity and owner_email;
publishing still queues the record for a final verification step before DB
insertion; production sends the verification email over SMTP, staging can
set QRESP_PUBLISH_SKIP_EMAIL=1 to show the link instead. No Google
Drive/Gmail scopes anywhere.

## After QA

- [ ] Note any UI deltas vs production in FULL_STACK_MODERNIZATION_REPORT.md §8
- [ ] Do NOT leave `QRESP_ENABLE_DEV_LOGIN` set on anything production-facing
