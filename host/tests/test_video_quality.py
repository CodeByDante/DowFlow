import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from video_quality import fixed_height, fixed_selector, detected_selector, clean_formats, enforce_height, probe_height


class QualitySelectionTests(unittest.TestCase):
    def test_fixed_resolution_is_validated(self):
        self.assertEqual(fixed_height('1080'), 1080)
        for value in ('best', '1080/best', None, 0, 999):
            with self.subTest(value=value), self.assertRaises(ValueError):
                fixed_height(value)

    def test_fixed_selector_prefers_capped_formats_before_downscale_fallback(self):
        selector = fixed_selector(1080)
        branches = selector.split('/')
        self.assertTrue(all('[height<=1080]' in branch for branch in branches[:-3]))
        self.assertEqual(branches[-3:], ['worstvideo*+bestaudio', 'worst', 'worstvideo*'])

    def test_detector_uses_real_format_id_and_never_falls_back_to_best(self):
        self.assertEqual(detected_selector('hls-1920'), 'hls-1920[acodec=none]+bestaudio/hls-1920')
        for value in ('', '137/best', '137+140', '[height=1080]', None):
            with self.subTest(value=value), self.assertRaises(ValueError):
                detected_selector(value)

    def test_clean_formats_removes_audio_images_duplicates_and_sorts(self):
        formats = clean_formats({'formats': [
            {'format_id': 'audio', 'vcodec': 'none', 'acodec': 'opus'},
            {'format_id': 'thumb', 'ext': 'jpg'},
            {'format_id': 'low', 'height': 360, 'width': 640, 'tbr': 500, 'ext': 'mp4', 'acodec': 'aac'},
            {'format_id': 'high', 'height': 1080, 'width': 1920, 'tbr': 2500, 'ext': 'mp4', 'vcodec': 'avc1', 'acodec': 'none'},
            {'format_id': 'high', 'height': 1080},
        ]})
        self.assertEqual([f['format_id'] for f in formats], ['high', 'low'])
        self.assertEqual(formats[0]['tbr'], 2500)
        self.assertFalse(formats[0]['has_audio'])
        self.assertEqual(formats[0]['resolution'], '1920x1080')

    def test_lower_source_is_preserved_without_reencoding(self):
        with patch('video_quality.probe_height', return_value=720), patch('video_quality.subprocess.Popen') as start:
            self.assertEqual(enforce_height('original.mp4', 1080, 'ffmpeg', 'ffprobe'), 'original.mp4')
            start.assert_not_called()


@unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'FFmpeg and ffprobe required for local media tests')
class RealVideoQualityTests(unittest.TestCase):
    def test_higher_source_is_reduced_and_lower_source_keeps_original_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            video = Path(directory) / 'example.mp4'
            ffmpeg, ffprobe = shutil.which('ffmpeg'), shutil.which('ffprobe')
            subprocess.run([ffmpeg, '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=640x360:d=0.2',
                            '-c:v', 'libx264', '-pix_fmt', 'yuv420p', str(video)], check=True, timeout=20)
            before = video.read_bytes()
            enforce_height(video, 720, ffmpeg, ffprobe)
            self.assertEqual(video.read_bytes(), before)
            enforce_height(video, 240, ffmpeg, ffprobe)
            self.assertEqual(probe_height(video, ffprobe), 240)
            self.assertEqual(len(list(Path(directory).glob('*.mp4'))), 1)

    def test_downscale_preserves_secondary_video_audio_subtitles_attachments_and_chapters(self):
        ffmpeg, ffprobe = shutil.which('ffmpeg'), shutil.which('ffprobe')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            sub = root / 'text.srt'
            sub.write_text('1\n00:00:00,000 --> 00:00:00,250\nHola mundo\n')
            attachment = root / 'license.txt'
            attachment.write_text('Fixture attachment')
            chapters = root / 'chapters.ffmeta'
            chapters.write_text(';FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=250\ntitle=Inicio\n')
            target = root / 'movie.mkv'
            subprocess.run([
                ffmpeg, '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=s=640x360:d=0.3',
                '-f', 'lavfi', '-i', 'color=c=red:s=64x48:d=0.3',
                '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.3', '-i', str(sub),
                '-f', 'ffmetadata', '-i', str(chapters), '-map', '0:v', '-map', '1:v',
                '-map', '2:a', '-map', '2:a', '-map', '3:s', '-map_chapters', '4',
                '-metadata:s:a:0', 'language=eng', '-metadata:s:a:1', 'language=spa',
                '-metadata:s:s:0', 'language=spa', '-attach', str(attachment),
                '-metadata:s:t:0', 'mimetype=text/plain', '-c:v', 'mpeg4', '-c:a', 'aac',
                '-c:s', 'srt', str(target)
            ], check=True, timeout=20)
            def inspect():
                result = json.loads(subprocess.check_output([
                    ffprobe, '-v', 'error', '-show_streams', '-show_chapters', '-show_data_hash', 'sha256',
                    '-of', 'json', str(target)
                ], timeout=10))
                return result['streams'], result['chapters']
            before, chapters_before = inspect()
            enforce_height(target, 240, ffmpeg, ffprobe)
            after, chapters_after = inspect()
            self.assertEqual([s['height'] for s in after if s['codec_type'] == 'video'], [240, 48])
            self.assertEqual([s['codec_type'] for s in after], ['video', 'video', 'audio', 'audio', 'subtitle', 'attachment'])
            self.assertEqual([s['tags']['language'] for s in after if s['codec_type'] in ('audio', 'subtitle')],
                             ['eng', 'spa', 'spa'])
            self.assertEqual(after[-1]['extradata_hash'], before[-1]['extradata_hash'])
            self.assertEqual(after[-1]['tags']['filename'], 'license.txt')
            self.assertEqual(chapters_after, chapters_before)
            self.assertIn(b'Hola mundo', subprocess.check_output([
                ffmpeg, '-v', 'error', '-i', str(target), '-map', '0:s:0', '-f', 'srt', '-'
            ]))

    def test_webm_stays_playable_after_downscaling(self):
        ffmpeg, ffprobe = shutil.which('ffmpeg'), shutil.which('ffprobe')
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'movie.webm'
            subprocess.run([ffmpeg, '-v', 'error', '-f', 'lavfi', '-i', 'color=s=320x180:d=0.2',
                            '-c:v', 'libvpx-vp9', str(target)], check=True, timeout=20)
            enforce_height(target, 144, ffmpeg, ffprobe)
            self.assertEqual(probe_height(target, ffprobe), 144)
            subprocess.run([ffmpeg, '-v', 'error', '-i', str(target), '-f', 'null', '-'],
                           check=True, timeout=10)

    def test_mp4_cover_keeps_original_dimensions_and_codec(self):
        ffmpeg, ffprobe = shutil.which('ffmpeg'), shutil.which('ffprobe')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cover, movie = root / 'front.jpg', root / 'movie.mp4'
            subprocess.run([ffmpeg, '-v', 'error', '-f', 'lavfi', '-i', 'color=s=48x48',
                            '-frames:v', '1', str(cover)], check=True, timeout=15)
            subprocess.run([ffmpeg, '-v', 'error', '-f', 'lavfi', '-i', 'color=s=640x360:d=0.3',
                            '-i', str(cover), '-map', '0:v', '-map', '1:v', '-c:v:0', 'libx264',
                            '-c:v:1', 'copy', '-disposition:v:1', 'attached_pic', str(movie)],
                           check=True, timeout=15)
            enforce_height(movie, 240, ffmpeg, ffprobe)
            videos = json.loads(subprocess.check_output([
                ffprobe, '-v', 'error', '-select_streams', 'v', '-show_streams', '-of', 'json', str(movie)
            ]))['streams']
            self.assertEqual([(s['codec_name'], s['height'], s['disposition']['attached_pic']) for s in videos],
                             [('h264', 240, 0), ('mjpeg', 48, 1)])

    def test_failed_conversion_preserves_source_and_removes_temporary_output(self):
        with tempfile.TemporaryDirectory() as directory:
            video = Path(directory) / 'original.mp4'
            video.write_bytes(b'keep this source')
            with patch('video_quality.probe_height', return_value=1080):
                with self.assertRaises((RuntimeError, OSError)):
                    enforce_height(video, 720, shutil.which('ffmpeg'), shutil.which('ffprobe'))
            self.assertEqual(video.read_bytes(), b'keep this source')
            self.assertEqual(list(Path(directory).iterdir()), [video])
