"""Download ES/EN captions into the job directory and mux optional subtitle tracks."""
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile


LANGUAGES = {'en': 'eng', 'eng': 'eng', 'es': 'spa', 'spa': 'spa'}
MP4_EXTS = {'.mp4', '.mov', '.m4v'}


# Subtitle transfer is deliberately independent of the actual video download.
NO_SUBTITLE_DOWNLOAD = ('--no-write-subs', '--no-write-auto-subs', '--no-embed-subs')
CAPTION_FORMATS = ('srt', 'vtt', 'ass', 'ssa', 'ttml', 'dfxp', 'tt')


def _language(code):
    return LANGUAGES.get(re.split('[-_]', str(code or '').lower(), maxsplit=1)[0])


def _caption_tracks(info):
    """Choose one authored track per language, falling back to an automatic one."""
    selected = {}
    for category in ('subtitles', 'automatic_captions'):
        tracks = info.get(category) or {}
        def priority(code):
            # Automatic originals can coexist with translated versions in the same language.
            original = category == 'automatic_captions' and code.lower().endswith('-orig')
            return not original, code.lower() not in LANGUAGES, code.lower()
        for code in sorted(tracks, key=priority):
            language = _language(code)
            if (not language or language in selected or
                    not re.fullmatch(r'[a-zA-Z0-9]+(?:[-_][a-zA-Z0-9]+)*', code)):
                continue
            formats = [f for f in tracks[code] or []
                       if f.get('ext') in CAPTION_FORMATS and (f.get('url') or f.get('data'))]
            if formats:
                selected[language] = (code, formats)
    return {code: formats for code, formats in selected.values()}


def prepare_caption_download(args, info, tmp_folder):
    """Prepare a captions-only yt-dlp job from metadata the host has already extracted."""
    from audio_tracks import metadata_command
    tracks = _caption_tracks(info)
    if not tracks:
        return None
    folder = Path(tmp_folder)
    folder.mkdir(parents=True, exist_ok=True)
    source = folder / 'caption-source.json'
    # A single real format URL satisfies yt-dlp's metadata validation. --skip-download
    # never reads it. Omit webpage_url so yt-dlp cannot re-extract the page on error.
    url = info.get('url') or next((f['url'] for f in info.get('formats') or [] if f.get('url')),
                                  info.get('webpage_url'))
    metadata = {'id': info['id'], 'title': info.get('title') or info['id'],
                'url': url, 'ext': info.get('ext') or 'mp4', 'subtitles': tracks,
                'http_headers': info.get('http_headers') or {}}
    source.write_text(json.dumps(metadata, ensure_ascii=False), encoding='utf-8')
    # Reuse the same extractor/network context, without media selectors, output receipts,
    # or unrelated postprocessors. A missing caption is a warning only in this process.
    network = [value for value in metadata_command(args)[1:-1]
               if value not in ('--dump-single-json', '--no-warnings')]
    return [args[0], '--ignore-config', *network, '--ignore-errors',
            '--retries', '0', '--fragment-retries', '0', '--extractor-retries', '0',
            '--write-subs', '--no-write-auto-subs', '--no-embed-subs', '--sub-langs', 'all',
            '--sub-format', '/'.join(CAPTION_FORMATS), '--convert-subs', 'srt',
            '-P', str(folder / 'subtitles'), '-o', 'captions.%(ext)s',
            '--load-info-json', str(source)]


def _probe(path, ffprobe):
    result = subprocess.run(
        [str(ffprobe), '-v', 'error', '-select_streams', 's', '-show_entries',
         'stream=index,id:stream_tags=language,title,handler_name:stream_disposition=default,forced',
         '-of', 'json', str(path)],
        capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=30,
        creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
    )
    if result.returncode:
        raise RuntimeError('No se pudieron comprobar los subtítulos: ' + result.stderr.strip()[-500:])
    return json.loads(result.stdout)['streams']


def _boxes(file, start, end):
    """Iterate direct ISO BMFF children, seeking over payloads (including mdat)."""
    while start < end:
        file.seek(start)
        header = file.read(8)
        if len(header) != 8:
            raise ValueError('Cabecera MP4 incompleta.')
        size = int.from_bytes(header[:4], 'big')
        kind = header[4:8]
        if size == 1:
            size = int.from_bytes(file.read(8), 'big')
        elif size == 0:
            size = end - start
        payload, limit = file.tell(), start + size
        if not payload <= limit <= end:
            raise ValueError('Tamaño de caja MP4 inválido.')
        yield kind, payload, limit
        start = limit


def _disable_mp4_tracks(path, track_ids):
    # The MOV muxer enables the first subtitle of its type even with disposition 0.
    # VLC and ffprobe use tkhd.track_enabled. Change that bit only in our new file.
    with path.open('r+b') as file:
        size = file.seek(0, os.SEEK_END)
        for kind, moov, end in _boxes(file, 0, size):
            if kind != b'moov':
                continue
            for kind, trak, stop in _boxes(file, moov, end):
                if kind != b'trak':
                    continue
                for kind, body, limit in _boxes(file, trak, stop):
                    if kind != b'tkhd':
                        continue
                    file.seek(body)
                    version_flags = file.read(4)
                    if len(version_flags) != 4 or version_flags[0] not in (0, 1):
                        raise ValueError('Cabecera de pista MP4 inválida.')
                    track_offset = body + (20 if version_flags[0] else 12)
                    if track_offset + 4 > limit:
                        raise ValueError('Identificador de pista MP4 incompleto.')
                    file.seek(track_offset)
                    if int.from_bytes(file.read(4), 'big') in track_ids:
                        file.seek(body + 3)
                        file.write(bytes([version_flags[3] & ~1]))
                    break
            break


def _publish_mkv(temporary, source):
    """Reserve a destination without overwriting a sibling during a container change."""
    target = source.with_suffix('.mkv')
    counter = 2
    while True:
        try:
            with target.open('xb'):
                pass
            break
        except FileExistsError:
            target = source.with_name(f'{source.stem} ({counter}).mkv')
            counter += 1
    try:
        os.replace(temporary, target)
    except OSError:
        target.unlink()
        raise
    source.unlink()
    return target


def finalize_subtitles(filename, enabled, tmp_folder, ffmpeg, ffprobe,
                       start_process=None, finish_process=None, log=None):
    """Apply the video job's subtitle policy after all A/V processing; verify before replacing."""
    source = Path(filename)
    embedded = _probe(source, ffprobe)
    external = []
    if enabled and tmp_folder:
        caption_dir = Path(tmp_folder) / 'subtitles'
        for path in sorted(caption_dir.glob('captions.*')):
            code = path.stem[len('captions.'):]
            language = _language(code)
            if language and path.suffix.lower() == '.srt':
                external.append((path, language, code))
            elif language and log:
                log('Se omite un formato de subtítulo no convertible: ' + path.suffix)
    external_languages = {language for _, language, _ in external}
    selected = []
    if enabled:
        for stream in embedded:
            tags = stream.get('tags', {})
            language = _language(tags.get('language'))
            if language and language not in external_languages:
                selected.append((stream, language))
    languages = [lang for _, lang in selected] + [lang for _, lang, _ in external]

    if log and enabled and not languages:
        log('No hay subtítulos ES/EN utilizables en el origen.')
    if not external and len(selected) == len(embedded) and all(
            not item['disposition']['default'] and not item['disposition']['forced']
            for item in embedded):
        if languages and log:
            log('Subtítulos opcionales: ' + ', '.join(languages) + '.')
        return str(source)

    ext = source.suffix.lower()
    fallback = bool(languages) and ext not in MP4_EXTS | {'.mkv', '.webm'}
    out_ext = '.mkv' if fallback else ext
    with tempfile.NamedTemporaryFile(dir=source.parent, prefix='.dowflow-sub-', suffix=out_ext, delete=False) as staged:
        temporary = Path(staged.name)
    process = None
    try:
        args = [str(ffmpeg), '-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(source)]
        for path, _, _ in external:
            args.extend(['-i', str(path)])
        if fallback:
            args.extend(['-map', '0:v?', '-map', '0:a?', '-map', '0:t?'])
        else:
            args.extend(['-map', '0', '-map', '-0:s?'])
        for stream, _ in selected:
            args.extend(['-map', f"0:{int(stream['index'])}"])
        for i in range(len(external)):
            args.extend(['-map', f'{i + 1}:s:0'])
        args.extend(['-map_metadata', '0', '-map_chapters', '0', '-c', 'copy'])
        for i, language in enumerate(languages):
            args.extend([f'-disposition:s:{i}', '0', f'-metadata:s:s:{i}', f'language={language}'])
        for i, (_, language, code) in enumerate(external, len(selected)):
            codec = 'mov_text' if out_ext in MP4_EXTS else 'webvtt' if out_ext == '.webm' else 'srt'
            title = ('Español' if language == 'spa' else 'English') + f' ({code})'
            args.extend([f'-c:s:{i}', codec, f'-metadata:s:s:{i}', 'title=' + title,
                         f'-metadata:s:s:{i}', 'handler_name=' + title])
        args.append(str(temporary))
        if start_process:
            process = start_process(args)
        else:
            process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                       creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        output, _ = process.communicate()
        if process.returncode or getattr(process, 'is_cancelled', False):
            detail = (output or b'').decode('utf-8', errors='replace').strip()[-500:]
            raise RuntimeError('No se pudo guardar la selección de subtítulos. ' + detail)
        streams = _probe(temporary, ffprobe)
        if out_ext in MP4_EXTS:
            active = {int(s['id'], 0) for s in streams if s['disposition']['default']}
            if active:
                _disable_mp4_tracks(temporary, active)
                streams = _probe(temporary, ffprobe)
        if ([_language(s.get('tags', {}).get('language')) for s in streams] != languages or
                any(s['disposition']['default'] or s['disposition']['forced'] for s in streams)):
            raise RuntimeError('La comprobación final de las pistas de subtítulos falló.')
        if getattr(process, 'is_cancelled', False):
            raise RuntimeError('Descarga cancelada durante el ajuste de subtítulos.')
        if fallback:
            target = _publish_mkv(temporary, source)
            if log:
                log('Subtítulos en contenedor MKV: ' + target.name)
        else:
            os.replace(temporary, source)
            target = source
        if languages and log:
            log('Subtítulos opcionales (apagados por defecto): ' + ', '.join(languages) + '.')
        return str(target)
    finally:
        temporary.unlink(missing_ok=True)
        if process and finish_process:
            finish_process(process)
