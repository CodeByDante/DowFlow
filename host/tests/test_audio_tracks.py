import array
import copy
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from audio_tracks import select_audio, prepare_audio_info, apply_audio_plan, video_selector, metadata_command


def track(identifier, language, bitrate=128, **extra):
    return {'format_id': identifier, 'language': language, 'abr': bitrate,
            'vcodec': 'none', 'acodec': 'mp4a.40.2', 'ext': 'm4a', **extra}


class AudioTrackTests(unittest.TestCase):
    def test_spanish_variants_override_higher_bitrate_original(self):
        for language in ('es', 'es-419', 'es-ES', 'spa', 'spa-MX', 'ES_419'):
            info = {'formats': [track('en', 'en', 320, format_note='English (original)'), track('es', language, 64)]}
            chosen, _ = select_audio(info, 'es', audio_format='opus')
            self.assertEqual(chosen['format_id'], 'es')

    def test_original_is_selected_even_if_a_dub_is_the_site_default(self):
        info = {'formats': [track('en', 'en', 64, format_note='English (original)', language_preference=10),
                            track('es', 'es', 256, language_preference=5)]}
        self.assertEqual(select_audio(info, 'orig')[0]['format_id'], 'en')

    def test_spanish_missing_falls_back_to_original(self):
        info = {'formats': [track('fr', 'fr', 320), track('en', 'en', 64, is_original=True)]}
        chosen, log = select_audio(info, 'es')
        self.assertEqual(chosen['format_id'], 'en')
        self.assertIn('No hay pista en espanol', log)

    def test_unknown_original_uses_extractor_preference_and_reports_uncertainty(self):
        info = {'formats': [track('fr', 'fr', 320, language_preference=-1), track('en', 'en', 64, language_preference=5)]}
        chosen, log = select_audio(info, 'orig')
        self.assertEqual(chosen['format_id'], 'en')
        self.assertIn('no identifica', log)

    def test_regular_spanish_is_preferred_to_audio_description(self):
        info = {'formats': [track('ad', 'es-desc', 320, format_note='Spanish descriptive'), track('normal', 'es', 64)]}
        self.assertEqual(select_audio(info)[0]['format_id'], 'normal')

    def test_combined_containers_get_separate_stream_mapping_roles(self):
        info = {'formats': [track('en', 'en', vcodec='h264', ext='mp4', height=1080),
                            track('es', 'es', vcodec='h264', ext='mp4', height=360)]}
        original = copy.deepcopy(info)
        prepared, audio_id, mapping = prepare_audio_info(info, info['formats'][1])
        self.assertEqual(info, original, 'metadata/cache must not be mutated')
        self.assertEqual(prepared['formats'][0]['acodec'], 'none')
        self.assertEqual(prepared['formats'][-1]['vcodec'], 'none')
        self.assertEqual(prepared['formats'][-1]['language'], 'es')
        self.assertEqual(video_selector('detect', audio_id, custom_id='en', video_ids=mapping), mapping['en'] + '+' + audio_id)

    def test_audio_only_selects_the_exact_track_and_reuses_extracted_metadata(self):
        info = {'id': 'test', 'formats': [track('en', 'en', 256), track('es', 'es-419', 64)]}
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'info.json'
            args, _ = apply_audio_plan(['yt-dlp.exe', '-f', 'bestaudio/best', 'https://example.com/video'], info,
                                       {'preference': 'es', 'format_type': 'mp3'}, target)
            self.assertEqual(args[args.index('-f') + 1], 'es')
            self.assertEqual(args[-2:], ['--load-info-json', str(target)])
            self.assertNotIn('https://example.com/video', args)
            self.assertEqual(json.loads(target.read_text())['formats'][0]['language'], 'es-419')

    def test_single_combined_file_is_not_downloaded_twice(self):
        info = {'id': 'test', 'formats': [track('single', 'en', vcodec='h264', ext='mp4', height=720)]}
        with tempfile.TemporaryDirectory() as directory:
            args, _ = apply_audio_plan(['yt-dlp.exe', '-f', 'best', 'https://example.com/video'], info,
                                       {'preference': 'orig', 'format_type': 'mp4', 'quality': 'fixed', 'fixed_limit': 1080}, Path(directory) / 'info.json')
            self.assertEqual(args[args.index('-f') + 1], 'single')

    def test_metadata_query_retains_session_and_referer_without_downloading(self):
        args = ['yt-dlp.exe', '--cookies', 'private.txt', '--add-header', 'Referer:https://example.com/',
                '--js-runtimes', 'node', '--force-ipv4', '-f', 'best', '--embed-thumbnail', '-o', 'file.mp4', 'https://example.com/video']
        command = metadata_command(args)
        self.assertIn('--cookies', command)
        self.assertIn('Referer:https://example.com/', command)
        self.assertIn('--skip-download', command)
        self.assertNotIn('--embed-thumbnail', command)
        self.assertNotIn('-f', command)


@unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe') and importlib.util.find_spec('yt_dlp'),
                     'Optional yt-dlp Python package, FFmpeg and ffprobe required for offline merge proof')
class RealMultilanguageTests(unittest.TestCase):
    def test_real_merge_uses_chosen_audio_without_losing_video_resolution(self):
        with tempfile.TemporaryDirectory(prefix='nekodrop-audio-proof-') as directory:
            root = Path(directory)
            for name, size, frequency, language in [('english', '640x360', 440, 'eng'), ('spanish', '320x180', 880, 'spa')]:
                subprocess.run([shutil.which('ffmpeg'), '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s={}:d=0.4'.format(size),
                    '-f', 'lavfi', '-i', 'sine=frequency={}:duration=0.4'.format(frequency), '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
                    '-c:a', 'aac', '-metadata:s:a:0', 'language=' + language, str(root / (name + '.mp4'))], check=True, timeout=20)
            info = {'id': 'offline-test', 'title': 'Audio selection', 'webpage_url': 'https://example.com/watch', 'formats': [
                track('english-original', 'en', 160, url=(root / 'english.mp4').as_uri(), height=360, width=640, vcodec='h264', acodec='aac', ext='mp4', protocol='file', language_preference=10, format_note='English (original)'),
                track('spanish-dub', 'es-419', 128, url=(root / 'spanish.mp4').as_uri(), height=180, width=320, vcodec='h264', acodec='aac', ext='mp4', protocol='file', language_preference=-1)]}
            for preference, frequency in [('es', 880), ('orig', 440)]:
                output = root / ('output-' + preference + '.mp4')
                base = [sys.executable, '-m', 'yt_dlp', '--enable-file-urls', '--quiet', '--no-warnings', '--no-progress', '-f', 'best',
                        '--merge-output-format', 'mp4', '-o', str(output), 'https://example.com/watch']
                args, _ = apply_audio_plan(base, info, {'preference': preference, 'quality': 'max', 'format_type': 'mp4'}, root / ('info-' + preference + '.json'))
                subprocess.run(args, check=True, timeout=30)
                streams = json.loads(subprocess.check_output([shutil.which('ffprobe'), '-v', 'error', '-show_streams', '-of', 'json', str(output)]))['streams']
                self.assertEqual(len([stream for stream in streams if stream['codec_type'] == 'audio']), 1)
                self.assertEqual([stream['height'] for stream in streams if stream['codec_type'] == 'video'], [360])
                raw = subprocess.check_output([shutil.which('ffmpeg'), '-v', 'error', '-i', str(output), '-map', '0:a:0', '-ar', '8000', '-ac', '1', '-f', 'f32le', '-'])
                samples = array.array('f'); samples.frombytes(raw); samples = samples[400:2400]
                crossings = sum((samples[i - 1] < 0) != (samples[i] < 0) for i in range(1, len(samples)))
                measured = crossings / 2 / (len(samples) / 8000)
                self.assertAlmostEqual(measured, frequency, delta=25)
