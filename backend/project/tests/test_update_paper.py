import unittest

from project.paperdao import Paper
from project.tests.test_permissions import (
    ADMIN,
    OTHER,
    OWNER,
    PermissionTestBase,
)


class TestUpdatePaper(PermissionTestBase):
    """PUT /api/paper/{id} — owner-gated update through the real middleware."""

    def update(self, paper_id, payload, csrf=True):
        headers = {}
        if csrf and getattr(self, "csrf", None):
            headers["X-CSRF-Token"] = self.csrf
        return self.client.put(
            f"/api/paper/{paper_id}", json=payload, headers=headers
        )

    def test_update_without_csrf_token_denied(self):
        self.login(OWNER)
        response = self.update(self.owned_id, {"tags": ["hacked"]}, csrf=False)
        self.assertEqual(403, response.status_code)
        self.assertIn("CSRF", response.json()["error"])
        self.assertNotIn("hacked", Paper.objects.get(id=self.owned_id).tags)

    def test_anonymous_update_denied_401(self):
        response = self.update(self.owned_id, {"tags": ["hacked"]})
        self.assertEqual(401, response.status_code)
        self.assertNotIn("hacked", Paper.objects.get(id=self.owned_id).tags)

    def test_non_owner_update_denied_403(self):
        self.login(OTHER)
        response = self.update(self.owned_id, {"tags": ["hacked"]})
        self.assertEqual(403, response.status_code)
        self.assertNotIn("hacked", Paper.objects.get(id=self.owned_id).tags)

    def test_owner_update_allowed_and_persisted(self):
        self.login(OWNER)
        response = self.update(self.owned_id, {"tags": ["DFT", "edited-tag"]})
        self.assertEqual(200, response.status_code, response.text)
        self.assertEqual(
            {"id": self.owned_id, "success": True}, response.json()
        )
        updated = Paper.objects.get(id=self.owned_id)
        self.assertEqual(["DFT", "edited-tag"], list(updated.tags))
        # untouched fields survive the merge
        self.assertTrue(updated.reference.title)

    def test_admin_update_allowed(self):
        self.login(ADMIN)
        response = self.update(self.owned_id, {"tags": ["admin-edit"]})
        self.assertEqual(200, response.status_code, response.text)
        self.assertEqual(
            ["admin-edit"], list(Paper.objects.get(id=self.owned_id).tags)
        )

    def test_ownerless_update_is_admin_only(self):
        self.login(OTHER)
        response = self.update(self.ownerless_id, {"tags": ["nope"]})
        self.assertEqual(403, response.status_code)

        self.login(ADMIN)
        response = self.update(self.ownerless_id, {"tags": ["admin-ok"]})
        self.assertEqual(200, response.status_code, response.text)
        self.assertEqual(
            ["admin-ok"], list(Paper.objects.get(id=self.ownerless_id).tags)
        )

    def test_update_cannot_change_owner_email(self):
        self.login(OWNER)
        response = self.update(
            self.owned_id,
            {"owner_email": "attacker@example.com", "tags": ["still-mine"]},
        )
        self.assertEqual(200, response.status_code, response.text)
        updated = Paper.objects.get(id=self.owned_id)
        self.assertEqual(OWNER, updated.owner_email)
        self.assertEqual(["still-mine"], list(updated.tags))

    def test_institution_survives_an_edit_that_does_not_touch_it(self):
        # `institution` has to be a DECLARED field on the Paper model:
        # update_paper keeps only `k in Paper._fields` when it merges the
        # stored document with the payload, so an undeclared field would be
        # silently dropped on every edit, not just the ones that set it.
        self.login(OWNER)
        Paper.objects(id=self.owned_id).update(
            set__institution="University of Chicago")
        response = self.update(self.owned_id, {"tags": ["edited"]})
        self.assertEqual(200, response.status_code, response.text)
        updated = Paper.objects.get(id=self.owned_id)
        self.assertEqual("University of Chicago", updated.institution)
        self.assertEqual(["edited"], list(updated.tags))

    def test_institution_can_be_set_and_cleared_through_an_edit(self):
        self.login(OWNER)
        response = self.update(
            self.owned_id, {"institution": "Duke University"})
        self.assertEqual(200, response.status_code, response.text)
        self.assertEqual(
            "Duke University", Paper.objects.get(id=self.owned_id).institution)

        response = self.update(self.owned_id, {"institution": ""})
        self.assertEqual(200, response.status_code, response.text)
        self.assertEqual("", Paper.objects.get(id=self.owned_id).institution)

    def test_missing_paper_returns_404(self):
        self.login(ADMIN)
        response = self.update("000000000000000000000000", {"tags": ["x"]})
        self.assertEqual(404, response.status_code)

    def test_invalid_payload_returns_400(self):
        self.login(OWNER)
        # license is a required StringField; nulling it must fail validation
        response = self.update(self.owned_id, {"license": None})
        self.assertEqual(400, response.status_code)


if __name__ == "__main__":
    unittest.main()
