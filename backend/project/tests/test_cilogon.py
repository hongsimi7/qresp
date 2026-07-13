import json
import os
import time
import unittest
from unittest import mock
from urllib.parse import parse_qs, urlparse

import jwt
import mongoengine
import mongomock
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

# Importing project builds the Connexion 3 app; these tests exercise the
# CILogon institutional OIDC flow through the real ASGI middleware with ALL
# network (discovery, token, JWKS, userinfo) mocked — no CILogon calls. ID
# tokens are REALLY signed with a test RSA key and verified by the production
# code path (PyJWT + JWKS), so signature/issuer/audience/expiry/nonce checks
# are exercised for real.
from project import auth as auth_module
from project import connexionapp
from project.models import ExternalIdentity
from project.paperdao import Paper

CLIENT_ENV = {
    "QRESP_CILOGON_CLIENT_ID": "cilogon:/client_id/testclient",
    "QRESP_CILOGON_CLIENT_SECRET": "test-secret",
    "QRESP_CILOGON_REDIRECT_URI":
        "https://localhost:8443/api/auth/cilogon/callback",
}

ISSUER = "https://cilogon.org"
KID = "test-key-1"
SUBJECT = "http://cilogon.org/serverA/users/12345"
EMAIL = "prof@uchicago.edu"

METADATA = {
    "issuer": ISSUER,
    "authorization_endpoint": "https://cilogon.org/authorize",
    "token_endpoint": "https://cilogon.org/oauth2/token",
    "jwks_uri": "https://cilogon.org/oauth2/certs",
    "userinfo_endpoint": "https://cilogon.org/oauth2/userinfo",
}

_SIGNING_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_SIGNING_PEM = _SIGNING_KEY.private_bytes(
    serialization.Encoding.PEM,
    serialization.PrivateFormat.PKCS8,
    serialization.NoEncryption(),
)
# A second key whose signature must be REJECTED (its public half is never in
# the published JWKS).
_ROGUE_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_ROGUE_PEM = _ROGUE_KEY.private_bytes(
    serialization.Encoding.PEM,
    serialization.PrivateFormat.PKCS8,
    serialization.NoEncryption(),
)


def _jwks():
    entry = json.loads(
        jwt.algorithms.RSAAlgorithm.to_jwk(_SIGNING_KEY.public_key()))
    entry.update({"kid": KID, "alg": "RS256", "use": "sig"})
    return {"keys": [entry]}


def load_fixture():
    location = os.path.realpath(
        os.path.join(os.getcwd(), os.path.dirname(__file__)))
    with open(os.path.join(location, 'data.json')) as f:
        return json.load(f)


class MockResponse:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError("HTTP %s" % self.status_code)


class CilogonTestBase(unittest.TestCase):
    def setUp(self):
        self.client = connexionapp.test_client()
        for key, value in CLIENT_ENV.items():
            os.environ[key] = value
        auth_module._cilogon_metadata_cache.clear()
        mongoengine.disconnect_all()
        mongoengine.connect('mongoenginetest',
                            mongo_client_class=mongomock.MongoClient)
        self.userinfo_payload = {}

    def tearDown(self):
        for key in CLIENT_ENV:
            os.environ.pop(key, None)
        os.environ.pop("QRESP_ADMIN_EMAILS", None)
        ExternalIdentity.drop_collection()
        Paper.drop_collection()
        mongoengine.disconnect_all()
        auth_module._cilogon_metadata_cache.clear()

    # ---- mocked CILogon network --------------------------------------------

    def _mock_get(self, url, **kwargs):
        if url == auth_module.CILOGON_DISCOVERY_DEFAULT:
            return MockResponse(METADATA)
        if url == METADATA["jwks_uri"]:
            return MockResponse(_jwks())
        if url == METADATA["userinfo_endpoint"]:
            return MockResponse(self.userinfo_payload)
        raise AssertionError("unexpected GET %s" % url)

    def start_login(self, next_path=None):
        params = {"next": next_path} if next_path else None
        with mock.patch("project.auth.requests") as requests_mock:
            requests_mock.get.side_effect = self._mock_get
            response = self.client.get(
                "/api/auth/cilogon", params=params, follow_redirects=False)
        assert response.status_code == 302, response.text
        return response.headers["location"]

    def make_id_token(self, nonce, key=None, kid=KID, **overrides):
        now = int(time.time())
        claims = {
            "iss": ISSUER,
            "aud": CLIENT_ENV["QRESP_CILOGON_CLIENT_ID"],
            "sub": SUBJECT,
            "email": EMAIL,
            "name": "Prof Example",
            "iat": now,
            "exp": now + 600,
            "nonce": nonce,
        }
        claims.update(overrides)
        claims = {k: v for k, v in claims.items() if v is not None}
        return jwt.encode(claims, key or _SIGNING_PEM, algorithm="RS256",
                          headers={"kid": kid})

    def finish_login(self, token_factory=None, next_path=None,
                     state_override=None):
        location = self.start_login(next_path=next_path)
        query = parse_qs(urlparse(location).query)
        state = query["state"][0]
        nonce = query["nonce"][0]
        factory = token_factory or (lambda n: self.make_id_token(n))
        id_token = factory(nonce)
        with mock.patch("project.auth.requests") as requests_mock:
            requests_mock.get.side_effect = self._mock_get
            requests_mock.post.return_value = MockResponse({
                "access_token": "transient-access-token",
                "token_type": "Bearer",
                "id_token": id_token,
            })
            response = self.client.get(
                "/api/auth/cilogon/callback",
                params={"state": state_override or state, "code": "authcode"},
                follow_redirects=False,
            )
        return response

    def me(self):
        return self.client.get("/api/auth/me").json()


class TestCilogonConfiguration(CilogonTestBase):
    def test_unconfigured_returns_503_and_other_logins_unaffected(self):
        for key in CLIENT_ENV:
            os.environ.pop(key, None)
        response = self.client.get("/api/auth/cilogon", follow_redirects=False)
        self.assertEqual(503, response.status_code)
        self.assertIn("not configured", response.json()["error"])
        response = self.client.get(
            "/api/auth/cilogon/callback", follow_redirects=False)
        self.assertEqual(503, response.status_code)

        # dev-login keeps working while CILogon is unconfigured.
        os.environ["QRESP_ENABLE_DEV_LOGIN"] = "1"
        try:
            response = self.client.post(
                "/api/auth/dev-login", json={"email": "dev@example.com"})
            self.assertEqual(200, response.status_code)
        finally:
            os.environ.pop("QRESP_ENABLE_DEV_LOGIN", None)


class TestCilogonAuthorizationRequest(CilogonTestBase):
    def test_redirect_carries_state_nonce_pkce_and_identity_scopes(self):
        location = self.start_login()
        parsed = urlparse(location)
        query = parse_qs(parsed.query)
        self.assertEqual("cilogon.org", parsed.netloc)
        self.assertEqual(["code"], query["response_type"])
        self.assertEqual([CLIENT_ENV["QRESP_CILOGON_CLIENT_ID"]],
                         query["client_id"])
        self.assertEqual([CLIENT_ENV["QRESP_CILOGON_REDIRECT_URI"]],
                         query["redirect_uri"])
        self.assertEqual(["openid email profile"], query["scope"])
        self.assertNotIn("drive", query["scope"][0])
        self.assertNotIn("gmail", query["scope"][0])
        self.assertTrue(query["state"][0])
        self.assertTrue(query["nonce"][0])
        self.assertEqual(["S256"], query["code_challenge_method"])
        # base64url-encoded SHA-256: 43 chars, no padding
        self.assertEqual(43, len(query["code_challenge"][0]))

    def test_each_login_gets_fresh_state_and_nonce(self):
        first = parse_qs(urlparse(self.start_login()).query)
        second = parse_qs(urlparse(self.start_login()).query)
        self.assertNotEqual(first["state"], second["state"])
        self.assertNotEqual(first["nonce"], second["nonce"])


class TestCilogonCallbackRejections(CilogonTestBase):
    def test_mismatched_state_rejected(self):
        response = self.finish_login(state_override="wrong-state")
        self.assertEqual(400, response.status_code)
        self.assertIn("state", response.json()["error"].lower())
        self.assertFalse(self.me()["authenticated"])

    def test_callback_without_started_flow_rejected(self):
        response = self.client.get(
            "/api/auth/cilogon/callback",
            params={"state": "anything", "code": "authcode"},
            follow_redirects=False,
        )
        self.assertEqual(400, response.status_code)

    def test_provider_error_reported(self):
        response = self.client.get(
            "/api/auth/cilogon/callback",
            params={"error": "access_denied"},
            follow_redirects=False,
        )
        self.assertEqual(400, response.status_code)
        self.assertIn("access_denied", response.json()["error"])

    def test_mismatched_nonce_rejected(self):
        response = self.finish_login(
            token_factory=lambda nonce: self.make_id_token("other-nonce"))
        self.assertEqual(400, response.status_code)
        self.assertFalse(self.me()["authenticated"])

    def test_wrong_issuer_rejected(self):
        response = self.finish_login(
            token_factory=lambda nonce: self.make_id_token(
                nonce, iss="https://evil.example.com"))
        self.assertEqual(400, response.status_code)
        self.assertFalse(self.me()["authenticated"])

    def test_wrong_audience_rejected(self):
        response = self.finish_login(
            token_factory=lambda nonce: self.make_id_token(
                nonce, aud="cilogon:/client_id/someoneelse"))
        self.assertEqual(400, response.status_code)
        self.assertFalse(self.me()["authenticated"])

    def test_expired_token_rejected(self):
        now = int(time.time())
        response = self.finish_login(
            token_factory=lambda nonce: self.make_id_token(
                nonce, iat=now - 7200, exp=now - 3600))
        self.assertEqual(400, response.status_code)
        self.assertFalse(self.me()["authenticated"])

    def test_bad_signature_rejected(self):
        # Signed by a key whose public half is NOT in the published JWKS.
        response = self.finish_login(
            token_factory=lambda nonce: self.make_id_token(
                nonce, key=_ROGUE_PEM))
        self.assertEqual(400, response.status_code)
        self.assertFalse(self.me()["authenticated"])

    def test_missing_subject_rejected(self):
        response = self.finish_login(
            token_factory=lambda nonce: self.make_id_token(nonce, sub=None))
        self.assertEqual(400, response.status_code)
        self.assertFalse(self.me()["authenticated"])

    def test_missing_email_everywhere_rejected(self):
        self.userinfo_payload = {}
        response = self.finish_login(
            token_factory=lambda nonce: self.make_id_token(nonce, email=None))
        self.assertEqual(400, response.status_code)
        self.assertIn("email", response.json()["error"].lower())
        self.assertFalse(self.me()["authenticated"])


class TestCilogonSuccessfulLogin(CilogonTestBase):
    def test_login_establishes_compatible_session_and_identity(self):
        response = self.finish_login(
            token_factory=lambda nonce: self.make_id_token(
                nonce, email="  Prof@UChicago.EDU "))
        self.assertEqual(302, response.status_code, response.text)
        self.assertEqual("/", response.headers["location"])

        me = self.me()
        self.assertTrue(me["authenticated"])
        # Frontend-compatible session shape.
        self.assertEqual(EMAIL, me["user"]["email"])
        self.assertEqual("Prof Example", me["user"]["name"])
        self.assertEqual("cilogon", me["user"]["provider"])
        self.assertFalse(me["user"]["is_admin"])
        self.assertTrue(me["user"]["account_id"])

        identity = ExternalIdentity.objects.get(issuer=ISSUER, subject=SUBJECT)
        self.assertEqual("cilogon", identity.provider)
        self.assertEqual(EMAIL, identity.email)
        self.assertIsNotNone(identity.created_at)
        self.assertIsNotNone(identity.last_login_at)
        self.assertEqual(str(identity.id), me["user"]["account_id"])

    def test_second_login_reuses_the_identity(self):
        self.finish_login()
        first = ExternalIdentity.objects.get(issuer=ISSUER, subject=SUBJECT)
        self.finish_login(
            token_factory=lambda nonce: self.make_id_token(
                nonce, name="Prof Renamed"))
        self.assertEqual(1, ExternalIdentity.objects.count())
        again = ExternalIdentity.objects.get(issuer=ISSUER, subject=SUBJECT)
        self.assertEqual(first.id, again.id)
        self.assertEqual("Prof Renamed", again.name)
        self.assertEqual(first.created_at, again.created_at)
        self.assertGreaterEqual(again.last_login_at, first.last_login_at)

    def test_email_falls_back_to_userinfo(self):
        self.userinfo_payload = {"email": "  Fallback@Uni.EDU "}
        response = self.finish_login(
            token_factory=lambda nonce: self.make_id_token(nonce, email=None))
        self.assertEqual(302, response.status_code, response.text)
        self.assertEqual("fallback@uni.edu", self.me()["user"]["email"])

    def test_admin_allowlist_applies_to_institutional_users(self):
        os.environ["QRESP_ADMIN_EMAILS"] = "boss@example.com, %s" % EMAIL
        self.finish_login()
        self.assertTrue(self.me()["user"]["is_admin"])

    def test_safe_next_path_honored_and_open_redirects_blocked(self):
        response = self.finish_login(next_path="/curator")
        self.assertEqual("/curator", response.headers["location"])
        response = self.finish_login(next_path="https://evil.example.com/")
        self.assertEqual("/", response.headers["location"])


class TestCilogonPermissionsIntegration(CilogonTestBase):
    """A CILogon session flows through the existing email-based owner/editor
    permission checks unchanged — no record mutation, no claiming."""

    def _seed_paper(self, owner_email=None, editor_emails=None):
        paper = Paper(**load_fixture())
        if owner_email:
            paper.owner_email = owner_email
        if editor_emails:
            paper.editor_emails = editor_emails
        paper.save()
        return str(paper.id)

    def test_cilogon_user_is_owner_via_matching_email(self):
        paper_id = self._seed_paper(owner_email=EMAIL)
        self.finish_login()
        body = self.client.get(
            f"/api/paper/{paper_id}/permissions").json()
        self.assertTrue(body["can_edit"])
        self.assertEqual("owner", body["reason"])
        self.assertTrue(body["can_manage"])
        # The stored record was matched, not mutated.
        self.assertEqual(EMAIL, Paper.objects.get(id=paper_id).owner_email)

    def test_cilogon_user_is_editor_via_matching_email(self):
        paper_id = self._seed_paper(owner_email="other@example.com",
                                    editor_emails=[EMAIL])
        self.finish_login()
        body = self.client.get(
            f"/api/paper/{paper_id}/permissions").json()
        self.assertTrue(body["can_edit"])
        self.assertEqual("editor", body["reason"])
        self.assertFalse(body["can_manage"])

    def test_cilogon_session_can_edit_owned_record(self):
        paper_id = self._seed_paper(owner_email=EMAIL)
        self.finish_login()
        csrf = self.me()["csrf_token"]
        response = self.client.put(
            f"/api/paper/{paper_id}", json={"tags": ["cilogon-edit"]},
            headers={"X-CSRF-Token": csrf})
        self.assertEqual(200, response.status_code, response.text)
        self.assertEqual(
            ["cilogon-edit"], list(Paper.objects.get(id=paper_id).tags))


if __name__ == "__main__":
    unittest.main()
