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
import functools
import secrets

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

    session[AUTH_SESSION_KEY] = {
        "email": email,
        "name": (info.get("name") or "").strip() or email,
        # Google is trusted for identity only; admin comes exclusively from
        # the local allowlist, never from the provider.
        "is_admin": email in _admin_emails(),
        "provider": "google",
        "google_sub": info.get("sub"),
    }
    # Return to the page the user signed in from (re-validated: session data
    # still must not produce an off-origin redirect).
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
