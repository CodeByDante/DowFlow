"""Offline regression tests. No browsers, external downloads, or Windows required."""
import importlib.util
from pathlib import Path
import json
import struct
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

HOST_PATH = Path(__file__).resolve().parents[1] / 'download_host.py'
sys.path.insert(0, str(HOST_PATH.parent))
spec = importlib.util.spec_from_file_location('download_host', HOST_PATH)
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)


class OutputFileTests(unittest.TestCase):
    def test_receipt_selects_media_even_when_title_differs_and_subtitle_written_last(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            media, sub = root / 'Título [id].mp4', root / 'captions.es.srt'
            media.write_bytes(b'video')
            sub.write_bytes(b'captions')
            receipt = root / 'download-result.jsonl'
            receipt.write_text(json.dumps(str(media)) + '\n', encoding='utf-8')
            self.assertEqual(host.engine_output([str(sub)], folder, None, 'Other', receipt), str(media))
            self.assertEqual(host.engine_output([str(sub)], folder, None, 'Other'), '')

    def test_repeating_a_title_publishes_a_separate_file(self):
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory(dir=directory) as job:
            previous = Path(directory) / 'Clip [id].mp4'
            previous.write_bytes(b'english')
            source = Path(job) / previous.name
            source.write_bytes(b'espanol')
            second = Path(host.publish_media(source, directory))
            self.assertEqual(second.name, 'Clip [id] (2).mp4')
            self.assertEqual(previous.read_bytes(), b'english')
            self.assertEqual(second.read_bytes(), b'espanol')


class HostShutdownTests(unittest.TestCase):
    def tearDown(self):
        host.active_processes.clear()

    def test_closed_input_exits_without_traceback(self):
        result = subprocess.run(
            [sys.executable, str(HOST_PATH)], input=b'',
            capture_output=True, timeout=5,
        )
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertEqual(result.stderr, b'')
        self.assertEqual(result.stdout, b'')

    def test_cancel_message_round_trip_then_disconnect(self):
        payload = json.dumps({'command': 'cancel'}).encode('utf-8')
        result = subprocess.run(
            [sys.executable, str(HOST_PATH)],
            input=struct.pack('@I', len(payload)) + payload,
            capture_output=True, timeout=5,
        )
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertEqual(result.stderr, b'')
        length = struct.unpack('@I', result.stdout[:4])[0]
        self.assertEqual(len(result.stdout[4:]), length)
        self.assertEqual(json.loads(result.stdout[4:]), {'status': 'cancelled'})

    def test_cancel_handles_native_download_and_all_subprocesses(self):
        native = SimpleNamespace(is_cancelled=False)
        process = SimpleNamespace(pid=123, terminate=Mock())
        gone = SimpleNamespace(pid=124, terminate=Mock(side_effect=ProcessLookupError))
        host.active_processes.extend([native, gone, process])
        with patch.object(host.os, 'name', 'posix'):
            host.cancel_active_processes()
        self.assertTrue(native.is_cancelled)
        self.assertTrue(process.is_cancelled)
        gone.terminate.assert_called_once()
        process.terminate.assert_called_once()

    def test_cancel_during_language_query_does_not_start_a_download(self):
        metadata = SimpleNamespace(pid=123, returncode=-15, terminate=Mock())
        def query_result(**kwargs):
            host.cancel_active_processes()
            return '{}', ''
        metadata.communicate = query_result
        with tempfile.TemporaryDirectory() as directory, \
             patch.object(host.os, 'name', 'posix'), \
             patch.object(host.subprocess, 'Popen', return_value=metadata) as start, \
             patch.object(host, 'send_message') as send:
            host.handle_download(['yt-dlp.exe', '-f', 'best', 'https://example.com/video'],
                downloads_path=directory, tmp_folder=directory + '/temporary',
                audio_options={'preference': 'es'})
        self.assertEqual(start.call_count, 1)
        metadata.terminate.assert_called_once()
        self.assertEqual(host.active_downloads, 0)
        self.assertEqual(host.active_processes, [])
        self.assertTrue(any(message.args[0].get('status') == 'error' for message in send.call_args_list))

    def test_windows_cancel_targets_owned_pid(self):
        process = SimpleNamespace(pid=123)
        host.active_processes.append(process)
        with patch.object(host.os, 'name', 'nt'), \
             patch.object(host.subprocess, 'CREATE_NO_WINDOW', 0x08000000, create=True), \
             patch.object(host.subprocess, 'run') as run:
            host.cancel_active_processes()
        self.assertEqual(run.call_args.args[0], ['taskkill', '/F', '/T', '/PID', '123'])
        self.assertTrue(process.is_cancelled)


if __name__ == '__main__':
    unittest.main()
