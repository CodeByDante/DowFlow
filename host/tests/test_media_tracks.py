"""Offline coverage for the bundled yt-dlp plugin and real multi-stream media."""
import array
import importlib.util
import json
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from threading import Thread
import unittest

HOST = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HOST))
from audio_tracks import apply_audio_plan, select_audio


class ManifestAudioTests(unittest.TestCase):
    def test_youtube_identifies_original_without_an_original_note(self):
        info = {'extractor_key': 'Youtube', 'formats': [
            {'format_id': '140-23', 'acodec': 'aac', 'vcodec': 'none', 'language': 'en',
             'language_preference': 10},
            {'format_id': '140-9', 'acodec': 'aac', 'vcodec': 'none', 'language': 'es',
             'language_preference': 5}]}
        chosen, log = select_audio(info, 'orig')
        self.assertEqual(chosen['format_id'], '140-23')
        self.assertIn('identificada como original', log)
        self.assertEqual(select_audio(info, 'es')[0]['format_id'], '140-9')

    def test_hls_audio_renditions_do_not_need_a_codec(self):
        info = {'formats': [{'format_id': 'audio-Original', 'vcodec': 'none', 'language': 'en',
                             'format_note': 'Original', 'protocol': 'm3u8_native'},
                            {'format_id': 'audio-Castellano', 'vcodec': 'none', 'language': 'es-ES',
                             'format_note': 'Castellano', 'protocol': 'm3u8_native'}]}
        self.assertEqual(select_audio(info, 'es')[0]['format_id'], 'audio-Castellano')
        self.assertEqual(select_audio(info, 'orig')[0]['format_id'], 'audio-Original')


@unittest.skipUnless(importlib.util.find_spec('yt_dlp') and shutil.which('ffmpeg') and shutil.which('ffprobe'),
                     'Offline integration requires yt-dlp, FFmpeg and FFprobe')
class ContainerAudioTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix='dowflow-internal-audio-')
        cls.addClassCleanup(cls.tmp.cleanup)
        cls.root = Path(cls.tmp.name)
        sub = cls.root / 'dialogue.srt'
        sub.write_text('1\n00:00:00,000 --> 00:00:00,400\nHola.\n', encoding='utf-8')
        for name, size in [('high', '640x360'), ('low', '320x180')]:
            target = cls.root / (name + '.mp4')
            subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
                            '-f', 'lavfi', '-i', 'color=c=blue:s=' + size + ':d=0.5',
                            '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.5',
                            '-f', 'lavfi', '-i', 'sine=frequency=880:duration=0.5',
                            '-i', str(sub), '-map', '0:v', '-map', '1:a', '-map', '2:a', '-map', '3:s',
                            '-c:v', 'libx264', '-c:a', 'aac', '-c:s', 'mov_text',
                            '-metadata:s:a:0', 'language=eng', '-disposition:a:0', 'default',
                            '-metadata:s:a:1', 'language=spa', '-disposition:a:1', '0',
                            '-metadata:s:s:0', 'language=spa', str(target)], check=True, timeout=20)

    @staticmethod
    def frequency(path):
        raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(path), '-map', '0:a:0',
                                       '-ar', '8000', '-ac', '1', '-f', 'f32le', '-'], timeout=15)
        samples = array.array('f')
        samples.frombytes(raw)
        samples = samples[400:2600]
        crossings = sum((last < 0) != (current < 0) for last, current in zip(samples, samples[1:]))
        return crossings * 4000 / len(samples)

    def download(self, name, formats, preference, audio_only=False, ext='mp4', generic=False, source=None, subtitle_lang='spa'):
        source = source or self.root / 'high.mp4'
        output = self.root / (name + '.%(ext)s')
        command = [sys.executable, '-m', 'yt_dlp', '--ignore-config', '--enable-file-urls',
                   '--no-warnings', '--no-progress', '-f', 'bestaudio/best' if audio_only else 'best',
                   '--merge-output-format', ext, '--embed-metadata', '-o', str(output)]
        if audio_only:
            command += ['-x', '--audio-format', 'mp3']
        command.append(source.as_uri())
        info = {'id': name, 'title': name, 'webpage_url': 'https://example.com/test', 'formats': formats}
        if generic:
            # Exercise unknown codecs from the real generic extractor.
            meta = subprocess.check_output([sys.executable, '-m', 'yt_dlp', '--ignore-config',
                                            '--enable-file-urls', '--no-warnings', '-J', source.as_uri()],
                                           text=True, timeout=15)
            info = json.loads(meta)
        args, _ = apply_audio_plan(command, info, {'preference': preference,
                                  'format_type': 'mp3' if audio_only else 'mp4',
                                  'quality': 'max'}, self.root / (name + '.json'))
        result = subprocess.run(args, capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('[DowFlowAudio]', result.stdout)
        target = self.root / (name + ('.mp3' if audio_only else '.' + ext))
        streams = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams',
                                                       '-of', 'json', str(target)]))['streams']
        audio = [s for s in streams if s['codec_type'] == 'audio']
        self.assertEqual(len(audio), 1)
        if not audio_only:
            self.assertTrue(audio[0]['disposition']['default'])
            self.assertEqual([s['height'] for s in streams if s['codec_type'] == 'video'], [360])
            subs = [s for s in streams if s['codec_type'] == 'subtitle']
            self.assertEqual([s['tags']['language'] for s in subs], [subtitle_lang])
            subtitle_text = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(target),
                                                     '-map', '0:s:0', '-f', 'srt', '-'])
            self.assertIn(b'Hola.', subtitle_text)
        self.assertAlmostEqual(self.frequency(target), 880 if preference == 'es' else 440, delta=20)

    def test_generic_direct_file_in_video_and_audio_only_modes(self):
        for audio_only in (False, True):
            for pref in ('es', 'orig'):
                with self.subTest(audio_only=audio_only, preference=pref):
                    self.download(f'generic-{audio_only}-{pref}', [], pref, audio_only, generic=True)

    def test_audio_selection_preserves_english_subtitle_before_audio_in_stream_order(self):
        src = self.root / 'unusual-order.mkv'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(self.root / 'high.mp4'),
                        '-map', '0:v', '-map', '0:s', '-map', '0:a', '-c', 'copy', '-c:s', 'srt',
                        '-metadata:s:s:0', 'language=eng', str(src)], check=True, timeout=15)
        self.download('ordered-subs', [], 'es', ext='mkv', generic=True, source=src, subtitle_lang='eng')

    def test_explicit_original_inside_mkv_overrides_first_default_dub(self):
        src = self.root / 'original-second.mkv'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(self.root / 'high.mp4'),
                        '-map', '0:v', '-map', '0:a:1', '-map', '0:a:0', '-map', '0:s',
                        '-c', 'copy', '-c:s', 'srt', '-disposition:a:0', 'default',
                        '-disposition:a:1', 'original', str(src)], check=True, timeout=15)
        self.download('marked-original', [], 'orig', ext='mkv', generic=True, source=src)

    def test_combined_format_uses_actual_audio_before_merge_into_mp4_and_mkv(self):
        formats = [{'format_id': name, 'url': (self.root / (name + '.mp4')).as_uri(), 'protocol': 'file',
                    'ext': 'mp4', 'vcodec': 'h264', 'acodec': 'aac', 'height': height, 'language': lang}
                   for name, height, lang in [('high', 360, 'en'), ('low', 180, 'es-419')]]
        for ext in ('mp4', 'mkv'):
            with self.subTest(ext=ext):
                self.download('merged-' + ext, formats, 'es', ext=ext)

    def test_ffmpeg_hls_downloader_preserves_embedded_second_audio(self):
        playlist = self.root / 'multiaudio.m3u8'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(self.root / 'high.mp4'),
                        '-map', '0:v:0', '-map', '0:a', '-c', 'copy', '-hls_time', '1',
                        '-hls_list_size', '0', str(playlist)], check=True, timeout=10)

        class QuietHandler(SimpleHTTPRequestHandler):
            def log_message(self, *args):
                pass

        server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(self.root)))
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            url = f'http://127.0.0.1:{server.server_port}/{playlist.name}'
            fmt = {'url': url, 'format_id': 'hls', 'acodec': 'aac', 'vcodec': 'h264',
                   'protocol': 'm3u8', 'ext': 'mp4', 'language': 'es'}
            info = {'id': 'ffmpeg-hls', 'title': 'ffmpeg-hls', 'webpage_url': url, 'formats': [fmt]}
            output = self.root / 'ffmpeg-hls.mp4'
            args, _ = apply_audio_plan([sys.executable, '-m', 'yt_dlp', '--ignore-config', '--no-warnings',
                         '--downloader', 'ffmpeg', '-f', 'best', '-o', str(output), url],
                         info, {'preference': 'es'}, self.root / 'hls.json')
            result = subprocess.run(args, capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertAlmostEqual(self.frequency(output), 880, delta=20)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
