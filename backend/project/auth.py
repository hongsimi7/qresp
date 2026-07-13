"""Session-auth skeleton (Qresp 2.0 checklist, goal 3 — identity only).

Endpoints (wired through swagger.yml, served by Connexion 3):
- GET  /api/auth/me         current session's auth state
- POST /api/auth/logout     clears only the auth user from the session
- POST /api/auth/dev-login  development/staging-only login

Google OAuth will later replace dev-login as the identity provider; /me and
/logout are provider-agnostic and stay as-is. Record ownership and edit
permissions are NOT implemented here (separate phase). No secrets are stored
in the session — only the identity claims below.
"""
import base64
import functools
import hashlib
import secrets
from datetime import datetime
from urllib.parse import urlencode

import jwt
import requests
from flask import redirect, request, session
from requests_oauthlib import OAuth2Session

from project.config import Config

AUTH_SESSION_KEY = "auth_user"
OAUTH_STATE_KEY = "oauth_state"
AUTH_NEXT_KEY = "auth_next"
CSRF_SESSION_KEY = "csrf_token"

# Google OAuth endpoints; [GOOGLE_API] config.ini entries override the
# defaults if present (case-insensitive keys), env QRESP_* overrides both.
GOOGLE_AUTH_URI_DEFAULT = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URI_DEFAULT = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URI_DEFAULT = "https://openidconnect.googleapis.com/v1/userinfo"
# Identity ONLY. Deliberately hardcoded (not read from config) so no broader
# Google API scope (Drive/Gmail/...) can ever be requested by this flow.
GOOGLE_SCOPES = ["openid", "email", "profile"]

# CILogon: institutional login broker (universities' own SSO behind one OIDC
# provider). Configured EXCLUSIVELY via environment variables
# (QRESP_CILOGON_CLIENT_ID / _CLIENT_SECRET / _REDIRECT_URI, optional
# _DISCOVERY_URL) — never config.ini values. Scopes are identity-only, and
# hardcoded like Google's so nothing broader can be requested.
CILOGON_DISCOVERY_DEFAULT = "https://cilogon.org/.well-known/openid-configuration"
CILOGON_SCOPES = "openid email profile"
CILOGON_STATE_KEY = "cilogon_state"
CILOGON_NONCE_KEY = "cilogon_nonce"
CILOGON_PKCE_KEY = "cilogon_code_verifier"
# ID-token signature algorithms CILogon publishes; "none" is implicitly
# rejected by the allowlist.
CILOGON_ID_TOKEN_ALGS = ["RS256", "RS384", "RS512"]


def _dev_login_enabled():
    """Dev login is DISABLED unless explicitly switched on.

    Config.get_setting checks the ``QRESP_ENABLE_DEV_LOGIN`` environment
    variable first (standard config.py env override), then an optional
    ``[AUTH] ENABLE_DEV_LOGIN`` entry in config.ini. Production runs without
    either, so the endpoint stays off by default; the check happens per
    request, never trusting frontend route hiding.
    """
    value = Config.get_setting("AUTH", "ENABLE_DEV_LOGIN") or ""
    return value.strip().lower() in ("1", "true", "yes", "on")


def get_current_user():
    """The auth user dict stored in the session, or None when anonymous."""
    return session.get(AUTH_SESSION_KEY)


def issue_csrf_token():
    """Session-bound CSRF token. The frontend reads it from /api/auth/me and
    replays it in the X-CSRF-Token header on mutating same-origin requests."""
    token = session.get(CSRF_SESSION_KEY)
    if not token:
        token = secrets.token_urlsafe(32)
        session[CSRF_SESSION_KEY] = token
    return token


def csrf_protect(handler):
    """Require X-CSRF-Token on a mutating route WHEN the request carries an
    authenticated session — cookie-authenticated users are the CSRF target,
    while anonymous API/CLI usage (e.g. anonymous publish) keeps working
    unchanged. dev-login is deliberately not wrapped: it only establishes a
    session (login-CSRF is out of scope for the MVP, and the Google flow is
    already protected by the OAuth state parameter)."""

    @functools.wraps(handler)
    def wrapper(*args, **kwargs):
        if session.get(AUTH_SESSION_KEY):
            expected = session.get(CSRF_SESSION_KEY) or ""
            provided = request.headers.get("X-CSRF-Token") or ""
            if not expected or not secrets.compare_digest(expected, provided):
                return {"error": "CSRF token missing or invalid."}, 403
        return handler(*args, **kwargs)

    return wrapper


def _safe_next_path(value):
    """Validate a post-login redirect target: same-origin path-only strings
    (no scheme/host, no protocol-relative //, no backslash tricks). Returns
    None for anything else, preventing open redirects."""
    if not value or not isinstance(value, str):
        return None
    if not value.startswith("/") or value.startswith("//") or "\\" in value:
        return None
    return value


def _admin_emails():
    """Admin allowlist: QRESP_ADMIN_EMAILS env (comma-separated) via the
    standard config override, or an optional [AUTH] ADMIN_EMAILS ini entry."""
    raw = Config.get_setting("AUTH", "ADMIN_EMAILS") or ""
    return {e.strip().lower() for e in raw.split(",") if e.strip()}


def is_admin(user):
    """Admin = allowlisted email, or the session's is_admin claim (dev-login
    only sets it while the endpoint is enabled; Google login will derive it
    from the allowlist at login time)."""
    if not user:
        return False
    if user.get("is_admin"):
        return True
    return (user.get("email") or "").lower() in _admin_emails()


def paper_role(paper, user):
    """The session user's role on a record: 'admin', 'owner', 'editor' or
    None. Emails are compared case-insensitively; editor_emails is stored
    normalized (lowercase) but matched defensively anyway."""
    if not user:
        return None
    if is_admin(user):
        return "admin"
    email = (user.get("email") or "").strip().lower()
    if not email:
        return None
    owner = (getattr(paper, "owner_email", None) or "").strip().lower()
    if owner and owner == email:
        return "owner"
    editors = getattr(paper, "editor_emails", None) or []
    if email in {(e or "").strip().lower() for e in editors}:
        return "editor"
    return None


def can_edit_paper(paper, user):
    """Permission rule for EDITING a record's metadata. Returns
    (allowed, reason).

    anonymous -> no; admin -> yes; owner -> yes; listed editor -> yes;
    ownerless record (legacy, no owner_email/editors) -> admin only;
    anyone else -> no.
    """
    if not user:
        return False, "authentication required"
    role = paper_role(paper, user)
    if role:
        return True, role
    owner = (getattr(paper, "owner_email", None) or "").strip().lower()
    editors = getattr(paper, "editor_emails", None) or []
    if not owner and not editors:
        return False, "record has no owner; only an admin can edit it"
    return False, ("only the record owner, an editor, or an admin can edit "
                   "this record")


def can_manage_paper(paper, user):
    """Permission rule for MANAGING a record (deactivate/reactivate, editor
    list). Stricter than editing: editors are edit-only by design. Returns
    (allowed, reason)."""
    if not user:
        return False, "authentication required"
    role = paper_role(paper, user)
    if role in ("admin", "owner"):
        return True, role
    if role == "editor":
        return False, "editors can edit this record but not manage it"
    owner = (getattr(paper, "owner_email", None) or "").strip().lower()
    if not owner:
        return False, "record has no owner; only an admin can manage it"
    return False, "only the record owner or an admin can manage this record"


def stamp_owner(paper):
    """Attach the verified session identity to a record being published.

    Called on the /api/publish payload before it is validated/stored, so the
    owner survives the email-verification round trip into MongoDB. Anonymous
    publishing stays allowed: without a session the record simply has no
    owner_email (=> admin-only edit later).
    """
    user = get_current_user()
    if user and user.get("email"):
        paper["owner_email"] = user["email"]
    return paper


def _google_config():
    """Google OAuth client settings. Sources, in order: QRESP_GOOGLE_* env
    (via the standard config override), then [GOOGLE_API] entries in
    config.ini. Returns None values when not configured — the app must boot
    and dev-login must keep working without them."""
    cfg = {}
    for key in ("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET",
                "GOOGLE_REDIRECT_URI"):
        value = Config.get_setting("GOOGLE_API", key)
        cfg[key] = value.strip() if value else None
    cfg["AUTH_URI"] = (Config.get_setting("GOOGLE_API", "AUTH_URI")
                       or GOOGLE_AUTH_URI_DEFAULT)
    cfg["TOKEN_URI"] = (Config.get_setting("GOOGLE_API", "TOKEN_URI")
                        or GOOGLE_TOKEN_URI_DEFAULT)
    cfg["USER_INFO"] = (Config.get_setting("GOOGLE_API", "USER_INFO")
                        or GOOGLE_USERINFO_URI_DEFAULT)
    return cfg


def _google_ready(cfg):
    return bool(cfg["GOOGLE_CLIENT_ID"] and cfg["GOOGLE_CLIENT_SECRET"]
                and cfg["GOOGLE_REDIRECT_URI"])


def google_login(next=None):
    """GET /api/auth/google — start the Google OAuth identity flow.

    An optional ``next`` query parameter (validated to a same-origin path)
    is remembered in the session so the callback can return the user to the
    page they signed in from.
    """
    cfg = _google_config()
    if not _google_ready(cfg):
        return {"error": "Google login is not configured on this server."}, 503

    next_path = _safe_next_path(next)
    if next_path:
        session[AUTH_NEXT_KEY] = next_path
    else:
        session.pop(AUTH_NEXT_KEY, None)

    oauth = OAuth2Session(cfg["GOOGLE_CLIENT_ID"],
                          redirect_uri=cfg["GOOGLE_REDIRECT_URI"],
                          scope=GOOGLE_SCOPES)
    authorization_url, state = oauth.authorization_url(cfg["AUTH_URI"])
    session[OAUTH_STATE_KEY] = state
    return redirect(authorization_url, code=302)


def google_callback(state=None, code=None, error=None):
    """GET /api/auth/google/callback — finish the flow and create the session.

    Tokens are used server-side for the single userinfo fetch and then
    discarded; nothing token-like is stored in the session or sent to the
    frontend.
    """
    cfg = _google_config()
    if not _google_ready(cfg):
        return {"error": "Google login is not configured on this server."}, 503

    if error:
        return {"error": "Google sign-in was cancelled or failed: %s" % error}, 400

    expected_state = session.pop(OAUTH_STATE_KEY, None)
    if not expected_state or not state or state != expected_state:
        return {"error": "Invalid OAuth state, please retry signing in."}, 400
    if not code:
        return {"error": "Missing authorization code."}, 400

    try:
        oauth = OAuth2Session(cfg["GOOGLE_CLIENT_ID"],
                              redirect_uri=cfg["GOOGLE_REDIRECT_URI"],
                              state=expected_state)
        oauth.fetch_token(cfg["TOKEN_URI"],
                          client_secret=cfg["GOOGLE_CLIENT_SECRET"],
                          code=code)
        info = oauth.get(cfg["USER_INFO"]).json()
    except Exception as e:
        print("Google sign-in failed: %s" % e)
        return {"error": "Google sign-in failed, please try again."}, 400

    email = (info.get("email") or "").strip().lower()
    if not email:
        return {"error": "Google account did not provide an email address."}, 400

    user = {
        "email": email,
        "name": (info.get("name") or "").strip() or email,
        # Google is trusted for identity only; admin comes exclusively from
        # the local allowlist, never from the provider.
        "is_admin": email in _admin_emails(),
        "provider": "google",
        "google_sub": info.get("sub"),
    }
    # Record the durable issuer+subject identity (same account layer as
    # institutional login) so the future ownership migration can reference
    # Google users too. Best-effort: login proceeds without it on failure.
    account_id = _record_external_identity(
        "https://accounts.google.com", info.get("sub"), "google",
        email, user["name"])
    if account_id:
        user["account_id"] = account_id
    session[AUTH_SESSION_KEY] = user
    # Return to the page the user signed in from (re-validated: session data
    # still must not produce an off-origin redirect).
    target = _safe_next_path(session.pop(AUTH_NEXT_KEY, None)) or "/"
    return redirect(target, code=302)


def _record_external_identity(issuer, subject, provider, email, name,
                              idp_name=None):
    """Upsert the durable external identity (keyed by immutable
    issuer+subject) and return its id string.

    Best-effort: session login must never fail because the identity write
    did — the caller proceeds without an account_id on error. No tokens are
    stored, only verified identity claims.
    """
    if not issuer or not subject:
        return None
    try:
        from project.models import ExternalIdentity
        now = datetime.utcnow()
        identity = ExternalIdentity.objects(
            issuer=issuer, subject=str(subject)).first()
        if identity is None:
            identity = ExternalIdentity(
                issuer=issuer, subject=str(subject), provider=provider,
                created_at=now)
        identity.email = (email or "").strip().lower()
        identity.name = name or ""
        if idp_name:
            identity.idp_name = idp_name
        identity.last_login_at = now
        identity.save()
        return str(identity.id)
    except Exception as e:
        print("external identity persistence failed: %s" % e)
        return None


def _cilogon_config():
    """CILogon OIDC client settings, environment-only (QRESP_CILOGON_*).
    Returns None values when not configured — the app must boot, and Google
    login / dev-login must keep working, without them."""
    cfg = {}
    for key in ("CILOGON_CLIENT_ID", "CILOGON_CLIENT_SECRET",
                "CILOGON_REDIRECT_URI"):
        value = Config.get_setting("CILOGON", key)
        cfg[key] = value.strip() if value else None
    cfg["DISCOVERY_URL"] = ((Config.get_setting(
        "CILOGON", "CILOGON_DISCOVERY_URL") or "").strip()
        or CILOGON_DISCOVERY_DEFAULT)
    return cfg


def _cilogon_ready(cfg):
    return bool(cfg["CILOGON_CLIENT_ID"] and cfg["CILOGON_CLIENT_SECRET"]
                and cfg["CILOGON_REDIRECT_URI"])


# Discovery metadata cache, keyed by discovery URL (process-lifetime; the
# document is static in practice). Tests clear this between cases.
_cilogon_metadata_cache = {}


def _cilogon_metadata(discovery_url):
    cached = _cilogon_metadata_cache.get(discovery_url)
    if cached:
        return cached
    response = requests.get(discovery_url, timeout=10)
    response.raise_for_status()
    metadata = response.json()
    _cilogon_metadata_cache[discovery_url] = metadata
    return metadata


def _cilogon_signing_key(jwks_uri, id_token):
    """Resolve the JWKS key matching the token's kid header. Fetched through
    `requests` (uniformly mockable in tests); verification itself is PyJWT's."""
    header = jwt.get_unverified_header(id_token)
    kid = header.get("kid")
    response = requests.get(jwks_uri, timeout=10)
    response.raise_for_status()
    for entry in response.json().get("keys", []):
        if kid is None or entry.get("kid") == kid:
            return jwt.PyJWK(entry).key
    raise jwt.InvalidTokenError("no JWKS key matches the ID token")


def _validate_cilogon_id_token(id_token, metadata, client_id, expected_nonce):
    """Full OIDC ID-token validation: signature against the provider JWKS,
    issuer, audience, expiry, required claims, and the session nonce.
    Raises jwt.InvalidTokenError (or subclasses) on any failure."""
    signing_key = _cilogon_signing_key(metadata["jwks_uri"], id_token)
    claims = jwt.decode(
        id_token,
        signing_key,
        algorithms=CILOGON_ID_TOKEN_ALGS,
        audience=client_id,
        issuer=metadata["issuer"],
        options={"require": ["exp", "iat", "iss", "aud", "sub"]},
    )
    nonce = claims.get("nonce") or ""
    if not expected_nonce or not secrets.compare_digest(
            str(expected_nonce), str(nonce)):
        raise jwt.InvalidTokenError("nonce missing or mismatched")
    return claims


def cilogon_login(next=None):
    """GET /api/auth/cilogon — start the institutional (CILogon) OIDC flow.

    Standards-compliant Authorization Code flow with server-side session
    state, nonce, and PKCE (S256). CILogon brokers the university IdP
    selection and SSO; the requested scopes are identity-only.
    """
    cfg = _cilogon_config()
    if not _cilogon_ready(cfg):
        return {"error": "Institutional login (CILogon) is not configured "
                         "on this server."}, 503

    try:
        metadata = _cilogon_metadata(cfg["DISCOVERY_URL"])
    except Exception as e:
        print("CILogon discovery failed: %s" % e)
        return {"error": "The institutional login service could not be "
                         "reached, please try again later."}, 503

    next_path = _safe_next_path(next)
    if next_path:
        session[AUTH_NEXT_KEY] = next_path
    else:
        session.pop(AUTH_NEXT_KEY, None)

    state = secrets.token_urlsafe(32)
    nonce = secrets.token_urlsafe(32)
    code_verifier = secrets.token_urlsafe(64)
    code_challenge = base64.urlsafe_b64encode(
        hashlib.sha256(code_verifier.encode("ascii")).digest()
    ).rstrip(b"=").decode("ascii")

    session[CILOGON_STATE_KEY] = state
    session[CILOGON_NONCE_KEY] = nonce
    session[CILOGON_PKCE_KEY] = code_verifier

    params = {
        "response_type": "code",
        "client_id": cfg["CILOGON_CLIENT_ID"],
        "redirect_uri": cfg["CILOGON_REDIRECT_URI"],
        "scope": CILOGON_SCOPES,
        "state": state,
        "nonce": nonce,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    authorization_url = "%s?%s" % (
        metadata["authorization_endpoint"], urlencode(params))
    return redirect(authorization_url, code=302)


def cilogon_callback(code=None, state=None, error=None):
    """GET /api/auth/cilogon/callback — finish the CILogon flow.

    Verifies state, exchanges the code (with the PKCE verifier and the exact
    configured redirect URI), validates the ID token (signature via JWKS,
    issuer, audience, expiry, nonce), records the durable external identity,
    and establishes the same session shape every other login uses. Provider
    tokens are used transiently for verification only and never persisted.
    """
    cfg = _cilogon_config()
    if not _cilogon_ready(cfg):
        return {"error": "Institutional login (CILogon) is not configured "
                         "on this server."}, 503

    if error:
        return {"error": "Institutional sign-in was cancelled or failed: %s"
                         % error}, 400

    expected_state = session.pop(CILOGON_STATE_KEY, None)
    code_verifier = session.pop(CILOGON_PKCE_KEY, None)
    expected_nonce = session.pop(CILOGON_NONCE_KEY, None)

    if (not expected_state or not state
            or not secrets.compare_digest(str(expected_state), str(state))):
        return {"error": "Invalid OAuth state, please retry signing in."}, 400
    if not code:
        return {"error": "Missing authorization code."}, 400
    if not code_verifier or not expected_nonce:
        return {"error": "Your sign-in session expired, please retry "
                         "signing in."}, 400

    try:
        metadata = _cilogon_metadata(cfg["DISCOVERY_URL"])
        token_response = requests.post(
            metadata["token_endpoint"],
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": cfg["CILOGON_REDIRECT_URI"],
                "client_id": cfg["CILOGON_CLIENT_ID"],
                "client_secret": cfg["CILOGON_CLIENT_SECRET"],
                "code_verifier": code_verifier,
            },
            timeout=10,
        )
        token_response.raise_for_status()
        tokens = token_response.json()
    except Exception as e:
        print("CILogon token exchange failed: %s" % e)
        return {"error": "Institutional sign-in failed, please try again."}, 400

    id_token = tokens.get("id_token")
    if not id_token:
        return {"error": "The institutional login did not return an "
                         "identity token."}, 400

    try:
        claims = _validate_cilogon_id_token(
            id_token, metadata, cfg["CILOGON_CLIENT_ID"], expected_nonce)
    except Exception as e:
        print("CILogon ID token rejected: %s" % e)
        return {"error": "The institutional identity token could not be "
                         "verified, please retry signing in."}, 400

    email = (claims.get("email") or "").strip().lower()
    if not email and tokens.get("access_token"):
        # Some IdPs only release email via the userinfo endpoint.
        try:
            userinfo = requests.get(
                metadata["userinfo_endpoint"],
                headers={"Authorization": "Bearer %s"
                                          % tokens["access_token"]},
                timeout=10,
            ).json()
            email = (userinfo.get("email") or "").strip().lower()
        except Exception as e:
            print("CILogon userinfo fetch failed: %s" % e)
    if not email:
        return {"error": "Your institution did not release an email "
                         "address, which Qresp requires to link your "
                         "records. Please contact the administrators."}, 400

    name = (claims.get("name")
            or ("%s %s" % (claims.get("given_name") or "",
                           claims.get("family_name") or "")).strip()
            or email)

    user = {
        "email": email,
        "name": name,
        # Identity comes from the university via CILogon; admin comes
        # exclusively from the local allowlist, never from the provider.
        "is_admin": email in _admin_emails(),
        "provider": "cilogon",
    }
    account_id = _record_external_identity(
        claims.get("iss"), claims.get("sub"), "cilogon", email, name,
        idp_name=claims.get("idp_name"))
    if account_id:
        user["account_id"] = account_id
    session[AUTH_SESSION_KEY] = user

    target = _safe_next_path(session.pop(AUTH_NEXT_KEY, None)) or "/"
    return redirect(target, code=302)


def me():
    """GET /api/auth/me — report the current authentication state. Also
    issues the session's CSRF token for the frontend to replay on mutations."""
    user = session.get(AUTH_SESSION_KEY)
    token = issue_csrf_token()
    if not user:
        return {"authenticated": False, "user": None, "csrf_token": token}, 200
    return {"authenticated": True, "user": user, "csrf_token": token}, 200


@csrf_protect
def logout():
    """POST /api/auth/logout — clear only auth-related session data."""
    session.pop(AUTH_SESSION_KEY, None)
    return {"success": True}, 200


def dev_login(credentials):
    """POST /api/auth/dev-login — dev/staging-only session login.

    Body: {"email": required, "name": optional (defaults to email),
    "is_admin": optional (defaults to false)}.
    """
    if not _dev_login_enabled():
        return {"error": "Not found"}, 404

    email = (credentials.get("email") or "").strip().lower()
    if not email:
        return {"error": "email is required"}, 400

    user = {
        "email": email,
        "name": (credentials.get("name") or "").strip() or email,
        "is_admin": bool(credentials.get("is_admin", False)),
        "provider": "dev",
    }
    session[AUTH_SESSION_KEY] = user
    return {"authenticated": True, "user": user}, 200
