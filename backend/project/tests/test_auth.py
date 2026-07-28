import os
import unittest

# Importing project builds the Connexion 3 app; these tests exercise the auth
# session skeleton through the real ASGI middleware (cookies persist on the
# test client, so Flask-Session round-trips are covered). No MongoDB needed.
from project import connexionapp


class TestAuthSkeleton(unittest.TestCase):
    """GET /api/auth/me, POST /api/auth/dev-login, POST /api/auth/logout."""

    def setUp(self):
        self.client = connexionapp.test_client()
        # Dev login is disabled by default; tests enable it explicitly. The
        # flag is read per request, so toggling the env var here is enough.
        os.environ["QRESP_ENABLE_DEV_LOGIN"] = "1"

    def tearDown(self):
        os.environ.pop("QRESP_ENABLE_DEV_LOGIN", None)

    def test_me_is_anonymous_without_login(self):
        response = self.client.get("/api/auth/me")
        self.assertEqual(200, response.status_code)
        body = response.json()
        self.assertFalse(body["authenticated"])
        self.assertIsNone(body["user"])
        self.assertTrue(body["csrf_token"])  # issued even for anonymous sessions

    def test_dev_login_me_logout_roundtrip(self):
        response = self.client.post(
            "/api/auth/dev-login",
            json={"email": "  Owner@Example.COM ", "name": "Owner Example"},
        )
        self.assertEqual(200, response.status_code)
        expected_user = {
            "email": "owner@example.com",  # trimmed + lowercased
            "name": "Owner Example",
            "is_admin": False,
            "provider": "dev",
        }
        self.assertEqual(
            {"authenticated": True, "user": expected_user}, response.json()
        )

        response = self.client.get("/api/auth/me")
        self.assertEqual(200, response.status_code)
        body = response.json()
        self.assertTrue(body["authenticated"])
        self.assertEqual(expected_user, body["user"])
        csrf = body["csrf_token"]

        response = self.client.post(
            "/api/auth/logout", headers={"X-CSRF-Token": csrf}
        )
        self.assertEqual(200, response.status_code)
        self.assertEqual({"success": True}, response.json())

        body = self.client.get("/api/auth/me").json()
        self.assertFalse(body["authenticated"])
        self.assertIsNone(body["user"])

    def test_logout_requires_csrf_when_authenticated(self):
        self.client.post("/api/auth/dev-login", json={"email": "o@e.com"})
        # missing token
        response = self.client.post("/api/auth/logout")
        self.assertEqual(403, response.status_code)
        self.assertIn("CSRF", response.json()["error"])
        # wrong token
        response = self.client.post(
            "/api/auth/logout", headers={"X-CSRF-Token": "not-the-token"}
        )
        self.assertEqual(403, response.status_code)
        # still logged in, then a correct token works
        csrf = self.client.get("/api/auth/me").json()["csrf_token"]
        response = self.client.post(
            "/api/auth/logout", headers={"X-CSRF-Token": csrf}
        )
        self.assertEqual(200, response.status_code)

    def test_dev_login_name_defaults_to_email(self):
        response = self.client.post(
            "/api/auth/dev-login", json={"email": "a@b.co"}
        )
        self.assertEqual(200, response.status_code)
        self.assertEqual("a@b.co", response.json()["user"]["name"])
        self.assertFalse(response.json()["user"]["is_admin"])

    def test_dev_login_admin_flag_roundtrips(self):
        response = self.client.post(
            "/api/auth/dev-login",
            json={"email": "admin@example.com", "is_admin": True},
        )
        self.assertEqual(200, response.status_code)
        self.assertTrue(response.json()["user"]["is_admin"])

    def test_dev_login_requires_email(self):
        # Missing email -> rejected by Connexion's request validation.
        response = self.client.post("/api/auth/dev-login", json={"name": "x"})
        self.assertEqual(400, response.status_code)
        # Whitespace-only email -> rejected by the handler.
        response = self.client.post(
            "/api/auth/dev-login", json={"email": "   "}
        )
        self.assertEqual(400, response.status_code)

    def test_dev_login_disabled_by_default(self):
        os.environ.pop("QRESP_ENABLE_DEV_LOGIN", None)
        response = self.client.post(
            "/api/auth/dev-login", json={"email": "owner@example.com"}
        )
        self.assertEqual(404, response.status_code)
        # And the session stays anonymous.
        body = self.client.get("/api/auth/me").json()
        self.assertFalse(body["authenticated"])
        self.assertIsNone(body["user"])


class TestRetiredProviders(unittest.TestCase):
    """CILogon was removed: Microsoft Entra and Google are the only public
    providers. Nothing may still route to the retired broker."""

    def setUp(self):
        self.client = connexionapp.test_client()

    def test_cilogon_routes_are_gone(self):
        for path in ("/api/auth/cilogon", "/api/auth/cilogon/callback"):
            response = self.client.get(path)
            self.assertEqual(404, response.status_code, path)

    def test_cilogon_handlers_are_gone(self):
        from project import auth
        for name in ("cilogon_login", "cilogon_callback", "_cilogon_config",
                     "_cilogon_metadata", "_validate_cilogon_id_token"):
            self.assertFalse(hasattr(auth, name), name)

    def test_the_shared_oidc_helper_microsoft_needs_is_kept(self):
        from project import auth
        self.assertTrue(callable(auth._oidc_signing_key))
        self.assertTrue(callable(auth._validate_microsoft_id_token))

    def test_only_google_and_microsoft_are_advertised(self):
        import io
        import os
        import yaml
        spec_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "swagger.yml")
        with io.open(spec_path, encoding="utf-8") as handle:
            spec = yaml.safe_load(handle)
        providers = sorted(
            path for path in spec["paths"] if path.startswith("/auth/"))
        self.assertEqual(
            ["/auth/dev-login", "/auth/google", "/auth/google/callback",
             "/auth/logout", "/auth/me", "/auth/microsoft",
             "/auth/microsoft/callback"],
            providers)


if __name__ == "__main__":
    unittest.main()
