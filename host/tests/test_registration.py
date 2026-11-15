import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'setup' / 'register_host.py'
spec = importlib.util.spec_from_file_location('register_host', SCRIPT)
registration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(registration)


class RegistrationTests(unittest.TestCase):
    def test_manifest_has_current_launcher_and_exact_origin(self):
        with tempfile.TemporaryDirectory(prefix='app con espacios ') as directory:
            root = Path(directory)
            (root / 'host').mkdir()
            (root / 'host' / 'download_host.bat').touch()
            manifest = registration.build_manifest(root, 'a' * 32)
            parsed = json.loads(json.dumps(manifest))
            self.assertEqual(parsed['path'], str(root.resolve() / 'host' / 'download_host.bat'))
            self.assertEqual(parsed['allowed_origins'], ['chrome-extension://' + 'a' * 32 + '/'])

    def test_invalid_extension_ids_are_rejected(self):
        for value in ('', 'abc', 'z' * 32, 'a' * 31, 'a' * 33, 'a' * 32 + '&echo injected'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                registration.build_manifest(Path.cwd(), value)

    def test_missing_launcher_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory, self.assertRaises(FileNotFoundError):
            registration.build_manifest(directory, 'a' * 32)
