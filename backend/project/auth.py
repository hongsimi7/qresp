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
from flask import redirect, session
from requests_oauthlib import OAuth2Session

from project.config import Config

AUTH_SESSION_KEY = "auth_user"
OAUTH_STATE_KEY = "oauth_state"

# Google OAuth endpoints; [GOOGLE_API] config.ini entries override the
# defaults if present (case-insensitive keys), env QRESP_* overrides both.
GOOGLE_AUTH_URI_DEFAULT = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URI_DEFAULT = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URI_DEFAULT = "https://openidconnect.googleapis.com/v1/userinfo"
# Identity ONLY. Deliberately hardcoded (not read from config) so no broader
# Google API scope (Drive/Gmail/...) can ever be requested by this flow.
GOOGLE_SCOPES = ["openid", "email", "profile"]


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


def can_edit_paper(paper, user):
    """Permission rule for modifying a record. Returns (allowed, reason).

    anonymous -> no; admin -> yes; owner -> yes; ownerless record (legacy,
    no owner_email) -> admin only; anyone else -> no.
    """
    if not user:
        return False, "authentication required"
    if is_admin(user):
        return True, "admin"
    owner = (getattr(paper, "owner_email", None) or "").strip().lower()
    if not owner:
        return False, "record has no owner; only an admin can edit it"
    if owner == (user.get("email") or "").lower():
        return True, "owner"
    return False, "only the record owner or an admin can edit this record"


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


def google_login():
    """GET /api/auth/google — start the Google OAuth identity flow."""
    cfg = _google_config()
    if not _google_ready(cfg):
        return {"error": "Google login is not configured on this server."}, 503

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

    session[AUTH_SESSION_KEY] = {
        "email": email,
        "name": (info.get("name") or "").strip() or email,
        # Google is trusted for identity only; admin comes exclusively from
        # the local allowlist, never from the provider.
        "is_admin": email in _admin_emails(),
        "provider": "google",
        "google_sub": info.get("sub"),
    }
    return redirect("/", code=302)


def me():
    """GET /api/auth/me — report the current authentication state."""
    user = session.get(AUTH_SESSION_KEY)
    if not user:
        return {"authenticated": False, "user": None}, 200
    return {"authenticated": True, "user": user}, 200


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
