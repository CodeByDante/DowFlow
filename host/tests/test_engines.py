from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from engines import available_engine


class EngineAvailabilityTests(unittest.TestCase):
    def test_automatic_stream_falls_back_when_specialized_engine_is_missing(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / 'yt-dlp.exe').touch()
            engine, notice = available_engine('nm3u8', directory, True)
            self.assertEqual(engine, 'ytdlp')
            self.assertIn('alternativa', notice)

    def test_manual_missing_stream_engine_produces_actionable_error(self):
        with tempfile.TemporaryDirectory() as directory, self.assertRaisesRegex(FileNotFoundError, 'actualizar_e_instalar_motores.bat'):
            available_engine('nm3u8', directory, False)

    def test_aria2_falls_back_to_installed_ytdlp(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / 'yt-dlp.exe').touch()
            self.assertEqual(available_engine('aria2', directory, True)[0], 'ytdlp')
            (Path(directory) / 'aria2c.exe').touch()
            self.assertEqual(available_engine('aria2', directory, True)[0], 'aria2')

    def test_native_needs_no_binary_and_ytdlp_missing_is_reported(self):
        with tempfile.TemporaryDirectory() as directory:
            self.assertEqual(available_engine('native', directory, True), ('native', ''))
            with self.assertRaises(FileNotFoundError):
                available_engine('ytdlp', directory, True)
