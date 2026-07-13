# CILogon Institutional Login — Setup & Migration

Qresp supports "Sign in with your institution" through **CILogon**
(https://www.cilogon.org/), the NSF-backed OpenID Connect broker used across
US research computing. A researcher picks their university on CILogon's
selection screen and authenticates through that university's **existing SSO**
(Shibboleth/SAML/OIDC — whatever the campus runs); Qresp only ever speaks
standard OIDC to CILogon.

**⚠️ Never commit credentials.** The client id/secret exist ONLY as
environment variables on the server (staging/production compose or systemd
env). Nothing goes into config.ini, compose files in Git, or this document.

## Why CILogon

- One OIDC integration covers thousands of InCommon/eduGAIN universities —
  Qresp never integrates campus SAML/OIDC systems directly.
- Identity-only: standards-compliant OIDC id_tokens; no research-data scopes.
- Free for research projects; operated by NCSA; the standard choice for
  academic web apps that need federated login without running Shibboleth.
- Globus Auth (which wraps CILogon) was considered and deferred — Qresp needs
  identity only, not Globus transfer/groups APIs.

## Registration (manual, one-time per environment)

1. Register a client at **https://cilogon.org/oauth2/register**
   (docs: https://www.cilogon.org/oidc).
2. Client name: e.g. `Qresp (staging)` / `Qresp`.
3. Callback URLs — must match EXACTLY what the server is configured with:
   - Production: `https://<production-domain>/api/auth/cilogon/callback`
   - Staging: `https://<staging-host>:<port>/api/auth/cilogon/callback`
     (register the staging callback separately; localhost-tunnel hosts must be
     registered too if used)
4. Scopes: `openid`, `email`, `profile` — identity only. Qresp hardcodes this
   scope set server-side; do not request more at registration.
5. Approval may take a business day (CILogon reviews registrations).
6. Store the issued client id (`cilogon:/client_id/...`) and secret as
   environment variables (below). The secret is shown once at registration.

## Environment variables (names only — values never in Git)

| Variable | Meaning |
| --- | --- |
| `QRESP_CILOGON_CLIENT_ID` | Client id issued by CILogon |
| `QRESP_CILOGON_CLIENT_SECRET` | Client secret issued by CILogon |
| `QRESP_CILOGON_REDIRECT_URI` | The exact registered callback URL for THIS environment |
| `QRESP_CILOGON_DISCOVERY_URL` | Optional; defaults to `https://cilogon.org/.well-known/openid-configuration` |

When unset, `GET /api/auth/cilogon` returns a clear JSON 503 and everything
else (Google login, dev-login, sessions, permissions) is unaffected.

## What the backend implements

- OIDC Authorization Code flow with **server-side session state, nonce, and
  PKCE (S256)**; exact configured redirect URI in both legs.
- Discovery metadata + JWKS fetched from CILogon; the id_token is validated
  with PyJWT for **signature (RS256/384/512), issuer, audience, expiry,
  required claims, and the session nonce**.
- Provider tokens are used transiently for verification (and an email
  userinfo fallback) and are **never persisted**.
- A durable `ExternalIdentity` record is created/updated per login, keyed by
  the immutable OIDC **issuer + subject** pair (never email): provider,
  asserted email (normalized), display name, created/last-login timestamps.
- The session keeps the existing frontend-compatible shape
  (`email, name, is_admin, provider`) plus `account_id`.
- Same-origin `next` path validation (no open redirects). Logout clears the
  Qresp session only — it never attempts university IdP logout.

## Coexistence with Google login (migration period)

Both providers establish the SAME session shape and flow through the same
permission checks. "Sign in with Google" stays in the header as a temporary
fallback; Google logins now also record an `ExternalIdentity`
(issuer `https://accounts.google.com`). A user who signs in via CILogon with
the same email as their previous Google sign-ins sees all the same records,
because ownership is currently email-based (below). Retire the Google button
once institutional login is verified in production.

## Legacy owner/editor mapping implications

- Records store `owner_email` / `editor_emails`. A CILogon user whose
  institution asserts a matching (normalized) email gets owner/editor access
  through the EXISTING permission checks — records are matched, never
  mutated or "claimed" on login.
- `QRESP_ADMIN_EMAILS` applies to institutional users identically.
- Caveat: institutional email ≠ Gmail address for most people. A user who
  published with a Gmail identity and signs in via their university email
  will NOT see their old records under the institutional account until an
  admin reassigns ownership (Account → All records → Reassign Owner) or adds
  the new email as an editor.

### Recommended future migration (not done in this task — deliberate)

Move ownership from mutable emails to durable accounts:
1. Add `owner_account_id` / `editor_account_ids` referencing
   `ExternalIdentity` alongside the email fields.
2. Backfill lazily: on successful login, link records whose `owner_email`
   matches the verified asserted email **after explicit user confirmation**
   (or admin action) — never silently.
3. Switch `can_edit_paper`/`can_manage_paper` to prefer account ids, keeping
   email fallback for unmigrated records.
4. Only then consider account merging (same person, Google + CILogon).
No big-bang migration; existing records keep working throughout.

## Staging verification after registration (E2E — still to do)

Real end-to-end CILogon login has NOT been verified yet — it requires a
registered client. On staging, after setting the env vars and restarting the
backend container (bind-mount: restart, not rebuild):

1. Anonymous → "Sign in with your institution" → CILogon IdP selector loads.
2. **University of Chicago**: select it, complete campus SSO; you return to
   the page you started on; header shows your name; `/account` shows
   "Signed in with your institution (CILogon)" and your email.
3. **Second university** (any other InCommon campus you have credentials
   for; otherwise CILogon's own "ORCID" or "GitHub" IdP options exercise the
   same flow): repeat and confirm a separate `external_identities` document
   is created (distinct issuer subject).
4. Publish a record → verify → it appears under My published records; edit,
   drafts, and (for an allowlisted email) admin surfaces all work.
5. Confirm `QRESP_ADMIN_EMAILS` with your institutional email grants admin.
6. Sign out → only Qresp session ends (campus SSO stays signed in).
7. Unset the env vars → the button yields the JSON 503; Google still works.
