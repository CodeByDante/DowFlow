import hashlib
import http.server
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from subtitle_tracks import NO_SUBTITLE_DOWNLOAD, finalize_subtitles, prepare_caption_download

FFMPEG = shutil.which('ffmpeg')
FFPROBE = shutil.which('ffprobe')


def cue(text):
    return '1\n00:00:00,000 --> 00:00:00,500\n' + text + '\n'


def ffmpeg(*args):
    return subprocess.check_output([FFMPEG, '-v', 'error', '-nostdin', '-y', *map(str, args)], timeout=20)


def streams(path):
    return json.loads(subprocess.check_output([
        FFPROBE, '-v', 'error', '-select_streams', 's', '-show_streams', '-of', 'json', str(path)
    ], timeout=10))['streams']


@unittest.skipUnless(FFMPEG and FFPROBE, 'FFmpeg and ffprobe required for real subtitle tests')
class SubtitleTrackTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory(prefix='dowflow-captions-')
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.job = self.root / 'temp'
        self.captions = self.job / 'subtitles'
        self.captions.mkdir(parents=True)
        self.movies = self.root / 'movies'
        self.movies.mkdir()
        self.video = self.root / 'source.mp4'
        ffmpeg('-f', 'lavfi', '-i', 'color=c=blue:s=32x32:d=1',
               '-f', 'lavfi', '-i', 'sine=frequency=500:duration=1',
               '-c:v', 'mpeg4', '-c:a', 'aac', self.video)
        self.logs = []

    def process(self, path, enabled):
        return Path(finalize_subtitles(path, enabled, self.job, FFMPEG, FFPROBE, log=self.logs.append))

    def embedded(self, name, languages):
        target = self.movies / name
        args = ['-i', self.video]
        for code in languages:
            sub = self.root / (code + '.srt')
            sub.write_text(cue('inside ' + code), encoding='utf-8')
            args.extend(['-i', sub])
        args.extend(['-map', '0'])
        for index, code in enumerate(languages):
            args.extend(['-map', f'{index + 1}:0', f'-metadata:s:s:{index}', 'language=' + code,
                         f'-disposition:s:{index}', 'default+forced'])
        ffmpeg(*args, '-c', 'copy', '-c:s', 'mov_text' if name.endswith('.mp4') else 'srt', target)
        return target

    def test_optional_english_and_spanish_are_individually_decodable_and_off(self):
        for name in ('movie.mp4', 'movie.mkv'):
            with self.subTest(name=name):
                target = self.embedded(name, ['eng', 'spa', 'fra'])
                self.assertEqual(self.process(target, True), target)
                actual = streams(target)
                self.assertEqual([s['tags']['language'] for s in actual], ['eng', 'spa'])
                for i, language in enumerate(('eng', 'spa')):
                    self.assertEqual((actual[i]['disposition']['default'], actual[i]['disposition']['forced']), (0, 0))
                    self.assertIn(('inside ' + language).encode(), ffmpeg('-i', target, '-map', f'0:s:{i}', '-f', 'srt', '-'))
                # The stored video and audio packets are identical to the original.
                for role in ('v:0', 'a:0'):
                    def packet_hash(path):
                        return ffmpeg('-i', path, '-map', '0:' + role, '-c', 'copy', '-f', 'hash', '-')
                    self.assertEqual(packet_hash(target), packet_hash(self.video))

    def test_off_strips_source_tracks_and_ignores_sidecars(self):
        (self.captions / 'captions.en.srt').write_text(cue('unused'))
        for name in ('movie.mp4', 'movie.mkv'):
            with self.subTest(name=name):
                target = self.embedded(name, ['eng', 'spa'])
                self.process(target, False)
                self.assertEqual(streams(target), [])
                self.assertEqual(list(self.movies.glob('*.srt')), [])

    def test_missing_subtitles_is_a_successful_unchanged_video(self):
        for enabled in (True, False):
            target = self.movies / 'movie.mp4'
            shutil.copy2(self.video, target)
            original = target.read_bytes()
            self.assertEqual(self.process(target, enabled), target)
            self.assertEqual(target.read_bytes(), original)
        self.assertTrue(any('No hay subtítulos' in msg for msg in self.logs))

    def test_unsupported_container_uses_mkv_and_respects_an_existing_file(self):
        target = self.movies / 'movie.avi'
        ffmpeg('-i', self.video, '-c', 'copy', target)
        sibling = self.movies / 'movie.mkv'
        sibling.write_bytes(b'unrelated')
        (self.captions / 'captions.en.srt').write_text(cue('English'))
        output = self.process(target, True)
        self.assertEqual(output, self.movies / 'movie (2).mkv')
        self.assertFalse(target.exists())
        self.assertEqual(sibling.read_bytes(), b'unrelated')
        self.assertEqual(streams(output)[0]['disposition']['default'], 0)

    def test_failed_mux_preserves_original_and_leaves_no_partial_mkv(self):
        target = self.movies / 'movie.avi'
        ffmpeg('-i', self.video, '-c', 'copy', target)
        original = hashlib.sha256(target.read_bytes()).digest()
        (self.captions / 'captions.en.srt').write_text('invalid subtitle')
        with self.assertRaisesRegex(RuntimeError, 'subtítulos'):
            self.process(target, True)
        self.assertEqual(hashlib.sha256(target.read_bytes()).digest(), original)
        self.assertEqual(list(self.movies.iterdir()), [target])

    @unittest.skipUnless(importlib.util.find_spec('yt_dlp'), 'Optional yt-dlp Python package required')
    def test_ytdlp_job_retains_internal_and_external_languages_without_sidecars(self):
        original = self.embedded('input.mp4', ['eng'])
        webvtt = 'WEBVTT\n\n00:00:00.000 --> 00:00:00.500\nHola\n'
        info = {'id': 'offline', 'title': 'Captions', 'extractor': 'fixture', 'extractor_key': 'Fixture',
                'webpage_url': 'https://example.org/', 'url': original.as_uri(), 'protocol': 'file',
                'ext': 'mp4', 'format_id': 'local',
                'subtitles': {'fr': [{'ext': 'vtt', 'data': webvtt}]},
                'automatic_captions': {'es-419': [{'ext': 'vtt', 'data': webvtt}]}}
        info_path = self.job / 'info.json'
        info_path.write_text(json.dumps(info), encoding='utf-8')
        for enabled in (True, False):
            name = 'with' if enabled else 'without'
            home = self.movies / name
            home.mkdir()
            if enabled:
                command = prepare_caption_download(['yt-dlp', info['webpage_url']], info, self.job)
                subprocess.run([sys.executable, '-m', 'yt_dlp', *command[1:]], check=True,
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=30)
            command = [sys.executable, '-m', 'yt_dlp', '--ignore-config', '--enable-file-urls',
                       '-P', 'home:' + str(home), '-P', 'temp:' + str(self.job),
                       '-o', 'clip.%(ext)s', *NO_SUBTITLE_DOWNLOAD,
                       '--load-info-json', str(info_path)]
            subprocess.run(command, check=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=30)
            output = self.process(home / 'clip.mp4', enabled)
            actual = streams(output)
            self.assertEqual([s['tags']['language'] for s in actual], ['eng', 'spa'] if enabled else [])
            if enabled:
                self.assertIn('es-419', actual[1]['tags']['handler_name'])
                self.assertIn(b'Hola', ffmpeg('-i', output, '-map', '0:s:1', '-f', 'srt', '-'))
                self.assertTrue(all(s['disposition']['default'] == s['disposition']['forced'] == 0 for s in actual))
            self.assertEqual(list(home.iterdir()), [output])


    def test_only_one_authored_track_per_language_is_selected_before_translations(self):
        fmt = [{'ext': 'vtt', 'data': 'WEBVTT'}]
        info = {'id': 'test', 'title': 'test', 'url': self.video.as_uri(),
                'subtitles': {'es-419': fmt, 'en-US': fmt, 'en': fmt, 'fr': fmt},
                'automatic_captions': {'es': fmt, 'es-orig': fmt, 'en': fmt}}
        args = ['yt-dlp', '--add-header', 'X-Fixture: test', '--embed-thumbnail',
                '-f', 'video', 'https://example.org/']
        command = prepare_caption_download(args, info, self.job)
        metadata = json.loads(Path(command[-1]).read_text(encoding='utf-8'))
        self.assertEqual(set(metadata['subtitles']), {'es-419', 'en'})
        self.assertNotIn('webpage_url', metadata)
        self.assertIn('X-Fixture: test', command)
        self.assertIn('--skip-download', command)
        self.assertNotIn('--embed-thumbnail', command)
        self.assertNotIn('-f', command)
        self.assertNotIn('--ignore-errors', NO_SUBTITLE_DOWNLOAD)

    @unittest.skipUnless(importlib.util.find_spec('yt_dlp'), 'Optional yt-dlp Python package required')
    def test_404_and_429_captions_do_not_retry_or_stop_the_media_download(self):
        movie = self.embedded('source.mp4', ['eng']).read_bytes()
        received = []
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                received.append(self.path)
                if self.path.startswith('/missing-'):
                    self.send_error(int(self.path.split('-')[-1]))
                    return
                body = movie if self.path == '/movie.mp4' else b'WEBVTT\n\n00:00:00.000 --> 00:00:00.500\nHola\n'
                self.send_response(200)
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            def log_message(self, *args):
                pass
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        base = f'http://127.0.0.1:{server.server_port}'
        for status in (404, 429):
            with self.subTest(status=status):
                received.clear()
                job = self.job / str(status)
                absent = f'/missing-{status}'
                info = {'id': 'test', 'title': 'test', 'ext': 'mp4', 'url': base + '/movie.mp4',
                        'subtitles': {'en': [{'ext': 'srt', 'url': base + absent}],
                                      'ES-419': [{'ext': 'vtt', 'url': base + '/es.vtt'}]},
                        'automatic_captions': {'es': [{'ext': 'vtt', 'url': base + '/unused'}]}}
                captions = prepare_caption_download(['yt-dlp', base], info, job)
                result = subprocess.run([sys.executable, '-m', 'yt_dlp', *captions[1:]], capture_output=True,
                                        text=True, timeout=20, check=True)
                self.assertIn(str(status), result.stderr)
                self.assertCountEqual(received, [absent, '/es.vtt'])
                info_path = job / 'media.json'
                info_path.write_text(json.dumps(info), encoding='utf-8')
                target = self.movies / f'output-{status}.mp4'
                subprocess.run([sys.executable, '-m', 'yt_dlp', '--ignore-config', *NO_SUBTITLE_DOWNLOAD,
                                '-o', str(target), '--load-info-json', str(info_path)], check=True,
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=20)
                self.assertCountEqual(received, [absent, '/es.vtt', '/movie.mp4'])
                finalize_subtitles(target, True, job, FFMPEG, FFPROBE)
                self.assertEqual([s['tags']['language'] for s in streams(target)], ['eng', 'spa'])
                self.assertIn(b'Hola', ffmpeg('-i', target, '-map', '0:s:1', '-f', 'srt', '-'))
                self.assertFalse(list(self.movies.glob('*.srt')))

    @unittest.skipUnless(importlib.util.find_spec('yt_dlp'), 'Optional yt-dlp Python package required')
    def test_missing_ffmpeg_is_a_real_caption_processing_error(self):
        info = {'id': 'test', 'title': 'test', 'url': self.video.as_uri(),
                'subtitles': {'en': [{'ext': 'vtt', 'data': 'WEBVTT\n\n00:00:00.000 --> 00:00:00.500\nEnglish\n'}]}}
        command = prepare_caption_download(['yt-dlp', '--ffmpeg-location', str(self.job), 'url'], info, self.job)
        result = subprocess.run([sys.executable, '-m', 'yt_dlp', *command[1:]], capture_output=True, timeout=20)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b'ffmpeg', result.stderr.lower())


if __name__ == '__main__':
    unittest.main()
