"""Select an offered audio track before building download format selectors."""
import copy
import re

SAFE_ID = re.compile(r'[A-Za-z0-9_.-]+')


def _number(value, default=0):
    try:
        return float(value) if value is not None else default
    except (TypeError, ValueError):
        return default


def _language(track):
    return str(track.get('language') or '').lower().replace('_', '-')


def _original(track):
    return bool(track.get('is_original') is True or track.get('audio_is_original') is True or
                re.search(r'\boriginal\b', str(track.get('format_note') or ''), re.I))


def _descriptive(track):
    return bool(re.search(r'(?:^|[-_])desc(?:$|[-_])', _language(track)) or re.search(r'\b(descriptive|description|audiodescrip|descripci[oó]n)\b',
                          '{} {}'.format(_language(track), track.get('format_note') or ''), re.I))


def select_audio(info, preference='es', audio_format='best', audio_quality='0'):
    tracks = [item for item in info.get('formats') or [info]
              if item.get('acodec') not in (None, 'none') and
              SAFE_ID.fullmatch(str(item.get('format_id') or ''))]
    if not tracks:
        return None, 'El origen no publica pistas de audio seleccionables.'
    spanish = [item for item in tracks if _language(item).split('-')[0] in ('es', 'spa') or
               (not _language(item) and re.search(r'spanish|espa[nñ]ol|castellano', str(item.get('format_note') or ''), re.I))]
    originals = [item for item in tracks if _original(item)]
    if preference == 'es' and spanish:
        candidates, reason = spanish, 'Se eligio una pista en espanol disponible.'
    elif originals:
        languages = {_language(item) for item in originals if _language(item)}
        candidates = [item for item in tracks if _original(item) or (_language(item) and _language(item) in languages)]
        reason = 'No hay pista en espanol; se eligio la original.' if preference == 'es' else 'Se eligio la pista identificada como original.'
    else:
        highest = max(_number(item.get('language_preference'), -1) for item in tracks)
        candidates = [item for item in tracks if _number(item.get('language_preference'), -1) == highest]
        primary = str(info.get('language') or '').lower().replace('_', '-')
        primary_candidates = [item for item in candidates if _language(item) == primary] if primary else []
        candidates = primary_candidates or candidates
        reason = 'El sitio no identifica una pista original; se conserva su preferencia predeterminada.'
        if preference == 'es':
            reason = 'No hay pista en espanol. ' + reason
    regular = [item for item in candidates if not _descriptive(item)]
    candidates = regular or candidates
    cap = _number(audio_quality)
    def rank(item):
        codec = str(item.get('acodec') or '').lower()
        preferred = audio_format == 'best' or (audio_format == 'opus' and 'opus' in codec) or (audio_format == 'm4a' and (item.get('ext') == 'm4a' or 'aac' in codec or 'mp4a' in codec))
        bitrate = _number(item.get('abr') or item.get('tbr'))
        return (item.get('vcodec') == 'none', preferred, not cap or bitrate <= cap,
                _number(item.get('language_preference'), -1), bitrate, _number(item.get('asr')))
    selected = max(candidates, key=rank)
    return selected, '{} Idioma: {}; pista: {}.'.format(reason, selected.get('language') or 'no informado', selected['format_id'])


def prepare_audio_info(info, selected, audio_only=False):
    """Give the merger explicit video-only and audio-only roles without extra tracks.

    The URLs and streams are unchanged. The role metadata tells yt-dlp's FFmpeg
    merger which streams to map from a combined container.
    """
    prepared = copy.deepcopy(info)
    formats = prepared.get('formats') or [prepared.copy()]
    if audio_only:
        prepared['formats'] = [copy.deepcopy(selected)]
        return prepared, selected['format_id'], {}
    video_ids = {}
    output = []
    for item in formats:
        if item.get('vcodec') in (None, 'none'):
            continue
        identifier = str(item.get('format_id') or '')
        if not SAFE_ID.fullmatch(identifier):
            continue
        variant = copy.deepcopy(item)
        variant['format_id'] = identifier + '__nekodrop_video'
        variant['acodec'] = 'none'
        variant['language'] = None
        variant['language_preference'] = 0
        variant.pop('abr', None)
        video_ids[identifier] = variant['format_id']
        output.append(variant)
    if not output:
        return prepared, None, {}
    audio = copy.deepcopy(selected)
    audio['format_id'] = 'nekodrop_selected_audio'
    audio['vcodec'] = 'none'
    for field in ('height', 'width', 'fps', 'vbr'):
        audio.pop(field, None)
    output.append(audio)
    prepared['formats'] = output
    return prepared, audio['format_id'], video_ids


def video_selector(quality, audio_id, preference='legado', fixed_limit=None, custom_id='', video_ids=None):
    from video_quality import fixed_selector
    if not SAFE_ID.fullmatch(audio_id):
        raise ValueError('Identificador de audio invalido.')
    if quality == 'detect':
        identifier = (video_ids or {}).get(custom_id)
        if not identifier:
            raise ValueError('El formato del Detector ya no esta disponible. Vuelve a detectarlo.')
        return '{}+{}'.format(identifier, audio_id)
    if quality in ('fixed', 'ask'):
        if quality == 'fixed':
            return fixed_selector(fixed_limit, audio_id)
        height = int(custom_id or 1080)
        if height <= 0 or height > 4320:
            raise ValueError('Limite de calidad invalido.')
        return 'bestvideo[height<={0}]+{1}/worstvideo+{1}'.format(height, audio_id)
    video = 'worstvideo' if quality == 'min' else 'bestvideo'
    if preference == 'legado':
        return '{0}[ext=mp4]+{1}/{0}+{1}'.format(video, audio_id)
    return '{}+{}'.format(video, audio_id)


def metadata_command(args):
    """Reuse network/session options, without output or download postprocessors."""
    paired = {'--cookies', '--add-header', '--referer', '--user-agent', '--impersonate',
              '--js-runtimes', '--ffmpeg-location', '--proxy'}
    switches = {'--force-ipv4', '--force-ipv6'}
    output = [args[0], '--no-playlist', '--no-colors', '--no-warnings', '--dump-single-json', '--skip-download']
    index = 1
    while index < len(args) - 1:
        if args[index] in paired:
            output.extend(args[index:index + 2])
            index += 2
        elif args[index] in switches:
            output.append(args[index])
            index += 1
        else:
            index += 1
    return output + [args[-1]]


def apply_audio_plan(args, info, options, info_path):
    import json
    from pathlib import Path
    chosen, notice = select_audio(info, options['preference'], options.get('audio_format', 'best'), options.get('audio_quality', '0'))
    audio_only = options.get('format_type') == 'mp3'
    if chosen is None:
        if audio_only:
            raise ValueError('El origen no publica ninguna pista de audio para descargar.')
        return args, notice
    raw_formats = info.get('formats') or [info]
    single_combined = not audio_only and len(raw_formats) == 1 and chosen.get('vcodec') not in (None, 'none')
    if single_combined:
        if options.get('quality') == 'detect' and options.get('custom_id') != chosen['format_id']:
            raise ValueError('El formato del Detector ya no esta disponible. Vuelve a detectarlo.')
        prepared = copy.deepcopy(info)
        selector = chosen['format_id']
    else:
        prepared, audio_id, video_ids = prepare_audio_info(info, chosen, audio_only)
        if not audio_only and not video_ids:
            raise ValueError('El origen no publica formatos de video utilizables.')
        if audio_only:
            selector = audio_id
        else:
            selector = video_selector(options.get('quality', 'max'), audio_id,
                options.get('video_preference', 'legado'), options.get('fixed_limit'),
                options.get('custom_id', ''), video_ids)
    # Remove selections produced by the metadata query: the role-specific formats
    # will be chosen again by the final download command.
    for key in ('requested_formats', 'requested_downloads', 'requested_subtitles', '_filename', 'filepath', '__files_to_merge'):
        prepared.pop(key, None)
    Path(info_path).write_text(json.dumps(prepared, ensure_ascii=False), encoding='utf-8')
    updated = list(args[:-1])
    index = updated.index('-f')
    updated[index + 1] = selector
    updated.extend(['--load-info-json', str(info_path)])
    return updated, notice
