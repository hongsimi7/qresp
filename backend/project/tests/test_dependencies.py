import io
import os
import re
import unittest
from unittest import mock

# Dependency CONTRACT tests.
#
# A deploy breaks when a declared dependency is not actually installed by the
# image that runs. The unit tests cannot catch that on their own, because they
# pass whenever the package happens to be present in the developer's
# environment. What they CAN pin is that the Docker build path installs from
# the declared files at all.

BACKEND = os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))))


def read(*parts):
    with io.open(os.path.join(BACKEND, *parts), encoding="utf-8") as handle:
        return handle.read()


class TestDockerInstallsDeclaredDependencies(unittest.TestCase):
    def test_both_docker_images_install_from_those_files(self):
        production = read("Dockerfile")
        self.assertIn("COPY requirements.lock.txt", production)
        self.assertIn("pip install --no-cache-dir -r requirements.lock.txt",
                      production)

        dev = read("Dockerfile.dev")
        self.assertIn("COPY requirements.txt", dev)
        self.assertIn("pip install --no-cache-dir -r requirements.txt", dev)


class TestRemovedDependencies(unittest.TestCase):
    """pypdf came in only for the manuscript PDF import, which is gone."""

    def test_pypdf_is_no_longer_declared(self):
        for name in ("requirements.txt", "requirements.lock.txt"):
            self.assertNotIn("pypdf", read(name), name)
