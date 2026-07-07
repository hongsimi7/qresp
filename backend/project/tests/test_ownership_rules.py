import glob
import json
import os
import unittest
from unittest import mock

from project.paperdao import Paper
from project.tests.test_permissions import (
    ADMIN,
    OTHER,
    OWNER,
    PermissionTestBase,
)


def load_fixture():
    location = os.path.realpath(
        os.path.join(os.getcwd(), os.path.dirname(__file__)))
    with open(os.path.join(location, 'data.json')) as f:
        return json.load(f)


PUBLISH_ID = "PUBLISH_test_ownership_rules"


def publish_file_path():
    return os.path.join(os.getcwd(), "papers", "publish",
                        PUBLISH_ID + ".json")


class TestPublishRequiresOwner(PermissionTestBase):
    """POST /api/publish — production ownership rules for NEW records."""

    def tearDown(self):
        if os.path.exists(publish_file_path()):
            os.remove(publish_file_path())
        super().tearDown()

    def publish(self, payload, origin="https://localhost:8443"):
        # Publish builds the verify link from the Origin header (browsers
        # always send it on cross-page POSTs); provide it like a browser.
        headers = {}
        if origin:
            headers["Origin"] = origin
        if getattr(self, "csrf", None):
            headers["X-CSRF-Token"] = self.csrf
        with mock.patch("project.controllers.publish.mailClient") as mail, \
                mock.patch("project.controllers.publish.Publish.generateId",
                           return_value=PUBLISH_ID):
            response = self.client.post(
                "/api/publish", json=payload, headers=headers
            )
        return response, mail

    def test_anonymous_publish_denied_401(self):
        response, mail = self.publish(load_fixture())
        self.assertEqual(401, response.status_code, response.text)
        mail.send.assert_not_called()
        self.assertFalse(os.path.exists(publish_file_path()))

    def test_authenticated_publish_stamps_session_owner(self):
        self.login(OWNER)
        response, mail = self.publish(load_fixture())
        self.assertEqual(200, response.status_code, response.text)
        mail.send.assert_called_once()
        with open(publish_file_path()) as f:
            stored = json.load(f)
        self.assertEqual(OWNER, stored["owner_email"])

    def test_authenticated_publish_without_origin_header_uses_request_host(self):
        self.login(OWNER)
        response, mail = self.publish(load_fixture(), origin=None)
        self.assertEqual(200, response.status_code, response.text)
        mail.send.assert_called_once()

    def test_publish_can_skip_email_for_staging_and_return_verify_link(self):
        self.login(OWNER)
        with mock.patch.dict(os.environ, {"QRESP_PUBLISH_SKIP_EMAIL": "1"}):
            response, mail = self.publish(load_fixture())
        self.assertEqual(200, response.status_code, response.text)
        body = response.json()
        self.assertTrue(body["success"])
        self.assertFalse(body["email_sent"])
        self.assertIn("/verify/%s" % PUBLISH_ID, body["verify_link"])
        mail.send.assert_not_called()
        self.assertTrue(os.path.exists(publish_file_path()))

    def test_publish_controller_error_is_returned_as_json_message(self):
        self.login(OWNER)
        headers = {
            "Origin": "https://localhost:8443",
            "X-CSRF-Token": self.csrf,
        }
        with mock.patch("project.api.Publish") as publish_cls:
            publish_cls.return_value.publish.return_value = {
                "msg": "schema failed",
                "code": 400,
            }
            response = self.client.post(
                "/api/publish", json=load_fixture(), headers=headers
            )
        self.assertEqual(400, response.status_code, response.text)
        self.assertEqual("schema failed", response.json()["msg"])

    def test_client_supplied_owner_is_discarded(self):
        self.login(OWNER)
        payload = load_fixture()
        payload["owner_email"] = "attacker@evil.com"
        response, _ = self.publish(payload)
        self.assertEqual(200, response.status_code, response.text)
        with open(publish_file_path()) as f:
            stored = json.load(f)
        self.assertEqual(OWNER, stored["owner_email"])

    def test_preview_stays_anonymous(self):
        payload = load_fixture()
        response = self.client.post("/api/preview", json=payload)
        self.assertEqual(200, response.status_code, response.text)
        preview_id = response.json()
        # cleanup the preview artifact written by the controller
        for path in glob.glob(
                os.path.join(os.getcwd(), "papers", "previews",
                             "%s.json" % preview_id)):
            os.remove(path)


class TestOwnerlessAdminList(PermissionTestBase):
    """GET /api/admin/ownerless-papers — admin-only legacy inventory."""

    def test_anonymous_denied_401(self):
        response = self.client.get("/api/admin/ownerless-papers")
        self.assertEqual(401, response.status_code)

    def test_non_admin_denied_403(self):
        self.login(OTHER)
        response = self.client.get("/api/admin/ownerless-papers")
        self.assertEqual(403, response.status_code)

    def test_admin_gets_compact_ownerless_list(self):
        self.login(ADMIN)
        response = self.client.get("/api/admin/ownerless-papers")
        self.assertEqual(200, response.status_code, response.text)
        body = response.json()
        self.assertEqual(1, body["count"])  # owned record must NOT be listed
        entry = body["papers"][0]
        self.assertEqual(self.ownerless_id, entry["id"])
        self.assertIsNone(entry["owner_email"])
        self.assertEqual("john.doe@company.com",
                         entry["suggested_owner_email"])
        self.assertTrue(entry["title"])
        self.assertEqual(2016, entry["year"])
        self.assertIn("Gaiduk", entry["authors"])


class TestAssignOwner(PermissionTestBase):
    """PUT /api/paper/{id}/owner — admin-only legacy owner assignment."""

    def assign(self, paper_id, body):
        headers = {}
        if getattr(self, "csrf", None):
            headers["X-CSRF-Token"] = self.csrf
        return self.client.put(
            f"/api/paper/{paper_id}/owner", json=body, headers=headers
        )

    def test_anonymous_denied_401(self):
        response = self.assign(self.ownerless_id,
                               {"owner_email": "a@b.co"})
        self.assertEqual(401, response.status_code)

    def test_non_admin_denied_403(self):
        self.login(OTHER)
        response = self.assign(self.ownerless_id,
                               {"owner_email": "other@example.com"})
        self.assertEqual(403, response.status_code)
        self.assertIsNone(
            Paper.objects.get(id=self.ownerless_id).owner_email)

    def test_admin_assigns_owner_to_legacy_record(self):
        self.login(ADMIN)
        response = self.assign(
            self.ownerless_id, {"owner_email": "  New.Owner@Example.COM "}
        )
        self.assertEqual(200, response.status_code, response.text)
        self.assertEqual(
            {"id": self.ownerless_id,
             "owner_email": "new.owner@example.com",
             "success": True},
            response.json(),
        )
        updated = Paper.objects.get(id=self.ownerless_id)
        self.assertEqual("new.owner@example.com", updated.owner_email)
        # only owner_email changed
        self.assertTrue(updated.reference.title)
        self.assertEqual(["DFT"], list(updated.tags)[:1])

    def test_assigned_owner_can_edit(self):
        self.login(ADMIN)
        self.assign(self.ownerless_id, {"owner_email": OTHER})
        self.login(OTHER)
        response = self.client.get(
            f"/api/paper/{self.ownerless_id}/permissions")
        self.assertTrue(response.json()["can_edit"])

    def test_invalid_email_rejected(self):
        self.login(ADMIN)
        for bad in ("", "not-an-email", "a@b", "a b@c.com"):
            response = self.assign(self.ownerless_id, {"owner_email": bad})
            self.assertEqual(400, response.status_code, bad)

    def test_existing_owner_not_overwritten_without_force(self):
        self.login(ADMIN)
        response = self.assign(self.owned_id,
                               {"owner_email": "usurper@example.com"})
        self.assertEqual(409, response.status_code)
        self.assertEqual(OWNER, Paper.objects.get(id=self.owned_id).owner_email)

        response = self.assign(
            self.owned_id,
            {"owner_email": "usurper@example.com", "force": True},
        )
        self.assertEqual(200, response.status_code, response.text)
        self.assertEqual("usurper@example.com",
                         Paper.objects.get(id=self.owned_id).owner_email)


if __name__ == "__main__":
    unittest.main()
