import io
import os
import re
import unittest
from unittest import mock

# Dependency CONTRACT tests.
#
# Staging answered "PDF support is not available on this server." for a
# perfectly good PDF. Nothing was wrong with the code: pypdf is declared and
# both Dockerfiles install it — the running image simply predated the
# dependency. The unit tests could not have caught that, because they pass
# whenever pypdf happens to be present in the developer's environment.
#
# These tests check the things that actually break a deploy: that the
# dependency is DECLARED and PINNED, that the Docker build path installs from
# those files, and that the unavailable branch is reachable and readable
# without needing an environment where the package is missing.

BACKEND = os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))))


def read(*parts):
    with io.open(os.path.join(BACKEND, *parts), encoding="utf-8") as handle:
        return handle.read()


class TestPdfDependencyIsDeclared(unittest.TestCase):
    def test_pypdf_is_in_requirements(self):
        names = [
            re.split(r"[<>=!\[;]", line.strip())[0].strip().lower()
            for line in read("requirements.txt").splitlines()
            if line.strip() and not line.strip().startswith("#")
        ]
        self.assertIn("pypdf", names)

    def test_pypdf_is_pinned_in_the_lock_file(self):
        lock = read("requirements.lock.txt")
        match = re.search(r"(?im)^pypdf==([0-9][^\s]*)\s*$", lock)
        self.assertIsNotNone(
            match, "pypdf must be pinned in requirements.lock.txt")
        # A pin, not a range: the lock is what the production image installs.
        self.assertRegex(match.group(1), r"^\d+\.\d+")

    def test_both_docker_images_install_from_those_files(self):
        production = read("Dockerfile")
        self.assertIn("COPY requirements.lock.txt", production)
        self.assertIn("pip install --no-cache-dir -r requirements.lock.txt",
                      production)

        dev = read("Dockerfile.dev")
        self.assertIn("COPY requirements.txt", dev)
        self.assertIn("pip install --no-cache-dir -r requirements.txt", dev)

    def test_the_import_actually_works_here(self):
        # Guards against a pin that cannot be imported at all (a bad
        # release, a wheel that does not match the interpreter).
        from pypdf import PdfReader
        self.assertTrue(callable(PdfReader))


class TestPdfUnavailableBranch(unittest.TestCase):
    """The failure path, tested WITHOUT uninstalling anything."""

    def _import_failure(self):
        """Make `from pypdf import PdfReader` raise, as a stale image would."""
        real_import = __import__

        def fake_import(name, *args, **kwargs):
            if name == "pypdf" or name.startswith("pypdf."):
                raise ModuleNotFoundError("No module named 'pypdf'")
            return real_import(name, *args, **kwargs)

        return mock.patch("builtins.__import__", side_effect=fake_import)

    def test_a_missing_parser_says_what_an_operator_must_do(self):
        from project import manuscript
        with self._import_failure():
            with self.assertRaises(manuscript.ImportError_) as caught:
                manuscript._process_pdf(b"%PDF-1.4\n")
        message = str(caught.exception)
        # Actionable: names the remedy and a way to keep working meanwhile.
        self.assertIn("needs to be rebuilt", message)
        self.assertIn("administrator", message)
        self.assertIn(".tex", message)
        # And it does not read like an optional feature nobody enabled.
        self.assertNotIn("not available on this server", message)

    def test_the_log_line_names_the_dependency_and_the_remedy(self):
        import contextlib
        from project import manuscript
        stdout = io.StringIO()
        with self._import_failure(), contextlib.redirect_stdout(stdout):
            with self.assertRaises(manuscript.ImportError_):
                manuscript._process_pdf(b"%PDF-1.4\n")
        logged = stdout.getvalue()
        self.assertIn("pypdf", logged)
        self.assertIn("rebuild", logged)

    def test_a_working_parser_never_reaches_that_branch(self):
        # The positive control for the two tests above: with pypdf present a
        # malformed file gets the ORDINARY error, not the deployment one.
        from project import manuscript
        with self.assertRaises(manuscript.ImportError_) as caught:
            manuscript._process_pdf(b"not a pdf at all")
        self.assertIn("not a readable PDF", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
