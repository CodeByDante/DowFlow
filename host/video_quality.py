"""Video format selectors and a verified, non-upscaling resolution ceiling."""
import json
import os
from pathlib import Path
import re
import subprocess
import uuid

RESOLUTIONS = (144, 240, 360, 480, 720, 1080, 1440, 2160, 4320)


def fixed_height(value):
    try:
        height = int(value)
    except (TypeError, ValueError):
        raise ValueError('La calidad fija debe ser una resolucion valida.')
    if height not in RESOLUTIONS:
        raise ValueError('Resolucion fija no permitida.')
    return height


def fixed_selector(height, audio='bestaudio'):
    height = fixed_height(height)
    # Prefer the highest offered stream under the ceiling. If only larger streams
    # exist (e.g. a direct MP4), download the smallest and downscale afterwards.
    return ('bestvideo*[height<={0}]+{1}/bestvideo*[height<={0}]+bestaudio/'
            'best[height<={0}]/bestvideo*[height<={0}]/worstvideo*+bestaudio/worst/worstvideo*').format(height, audio)


def detected_selector(format_id):
    if not isinstance(format_id, str) or not re.fullmatch(r'[A-Za-z0-9_.-]+', format_id):
        raise ValueError('Detector: selecciona un formato valido antes de descargar.')
    # Video-only formats need audio; combined formats must not get a duplicate track.
    # No /best fallback: an unavailable format must never silently change quality.
    return '{0}[acodec=none]+bestaudio/{0}'.format(format_id)


def probe_height(filename, ffprobe):
    result = subprocess.run(
        [str(ffprobe), '-v', 'error', '-select_streams', 'v:0',
         '-show_entries', 'stream=height', '-of', 'json', str(filename)],
        capture_output=True, text=True, check=True, timeout=30,
        creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
    )
    streams = json.loads(result.stdout).get('streams', [])
    if not streams or not streams[0].get('height'):
        raise ValueError('No se pudo comprobar la resolucion del video.')
    return int(streams[0]['height'])


def enforce_height(filename, height, ffmpeg, ffprobe, start_process=None, finish_process=None, log=None):
    """Keep lower sources unchanged; atomically replace only a verified downscale."""
    height = fixed_height(height)
    source = Path(filename)
    if probe_height(source, ffprobe) <= height:
        return str(source)
    if log:
        log('La fuente supera {}p. Ajustando el archivo a {}p con FFmpeg...'.format(height, height))
    temporary = source.with_name(source.stem + '.nekodrop-' + uuid.uuid4().hex[:8] + source.suffix)
    process = None
    try:
        args = [str(ffmpeg), '-hide_banner', '-loglevel', 'error', '-y', '-i', str(source),
                '-map', '0:v:0', '-map', '0:a?', '-map_metadata', '0',
                '-vf', 'scale=-2:{}'.format(height), '-c:v', 'libx264', '-preset', 'fast',
                '-crf', '20', '-c:a', 'copy', str(temporary)]
        if start_process:
            process = start_process(args)
        else:
            process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                       creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        output, _ = process.communicate()
        if process.returncode or getattr(process, 'is_cancelled', False):
            raise RuntimeError('No se completo el ajuste de calidad: {}'.format((output or b'').decode('utf-8', errors='replace')[-500:]))
        if probe_height(temporary, ffprobe) > height:
            raise RuntimeError('El archivo generado supera el limite de calidad.')
        os.replace(str(temporary), str(source))
        return str(source)
    finally:
        if temporary.exists():
            temporary.unlink()
        if process and finish_process:
            finish_process(process)


def clean_formats(info):
    """Return real yt-dlp format IDs; never invent IDs from resolution labels."""
    result = []
    seen = set()
    for item in info.get('formats') or [info]:
        identifier = str(item.get('format_id') or '')
        if not identifier or identifier in seen or item.get('vcodec') == 'none':
            continue
        if item.get('ext') in ('mhtml', 'jpg', 'jpeg', 'png', 'webp'):
            continue
        if not re.fullmatch(r'[A-Za-z0-9_.-]+', identifier):
            continue
        def number(key):
            try:
                return max(0, round(float(item.get(key) or 0)))
            except (ValueError, TypeError, OverflowError):
                return 0
        height, width = number('height'), number('width')
        result.append({
            'format_id': identifier, 'height': height, 'width': width,
            'resolution': '{}x{}'.format(width, height) if width and height else item.get('resolution') or ('{}p'.format(height) if height else 'Resolucion no informada'),
            'ext': item.get('ext') or '', 'tbr': number('tbr'),
            'has_audio': item.get('acodec') not in (None, 'none'),
        })
        seen.add(identifier)
    return sorted(result, key=lambda item: (item['height'], item['tbr']), reverse=True)
