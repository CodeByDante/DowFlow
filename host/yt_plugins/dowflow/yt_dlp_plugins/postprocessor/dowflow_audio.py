"""Choose the actual audio stream before yt-dlp merges, extracts or labels it."""
from dataclasses import dataclass
import os
from pathlib import Path
import re
import uuid

from yt_dlp.postprocessor.ffmpeg import FFmpegPostProcessor
from yt_dlp.utils import ISO639Utils, PostProcessingError

__all__ = ['DowFlowAudioPP']


def language_code(value):
    code = (value or '').lower().replace('_', '-').split('-')[0]
    if code in ('und', 'mul', 'zxx'):
        return ''
    return (ISO639Utils.short2long(code) or code) if len(code) == 2 else code


def track_details(stream):
    tags = {k.lower(): v for k, v in stream.get('tags', {}).items()}
    name = ' '.join(str(tags.get(key, '')) for key in ('title', 'handler_name'))
    disposition = stream.get('disposition') or {}
    language = language_code(tags.get('language'))
    if not language and re.search(r'\b(español|espanol|castellano|spanish|castilian)\b', name, re.I):
        language = 'spa'
    original = bool(disposition.get('original') or re.search(r'\boriginal\b', name, re.I))
    alternate = bool(disposition.get('visual_impaired') or disposition.get('comment') or
                     re.search(r'descriptiv|description|audiodescrip|comentario|commentary', name, re.I))
    return language, original, alternate, bool(disposition.get('default'))


@dataclass
class Track:
    source: int
    index: int
    language: str
    tagged_language: bool
    original: bool
    alternate: bool
    default: bool
    primary: bool


def choose_track(inputs, preference, selected_input, hint):
    """Inputs are lists of ffprobe streams, in yt-dlp's input order."""
    candidates = []
    for source, streams in enumerate(inputs):
        tracks = [stream for stream in streams if stream['codec_type'] == 'audio']
        for stream in tracks:
            language, original, alternate, default = track_details(stream)
            tagged = bool(language)
            primary = source == selected_input
            # An extractor identifies a format. It can identify an untagged
            # single audio stream, but cannot distinguish siblings in that file.
            if not language and primary and len(tracks) == 1:
                language = hint
            candidates.append(Track(source, stream['index'], language, tagged, original,
                                    alternate, default, primary))
    if not candidates:
        return None
    spanish = [track for track in candidates if preference == 'es' and track.language == 'spa']
    original = [track for track in candidates if track.original]
    candidates = spanish or original or candidates
    return max(candidates, key=lambda track: (not track.alternate,
               bool(hint and track.language == hint), bool(spanish and track.tagged_language),
               track.primary, track.default))


class DowFlowAudioPP(FFmpegPostProcessor):
    def __init__(self, downloader, preference='es'):
        super().__init__(downloader)
        self.preference = preference
        downloader.add_postprocessor_hook(self.before_merge)

    def streams(self, path):
        streams = self.get_metadata_object(path).get('streams')
        if not streams:
            raise PostProcessingError('FFprobe no pudo leer las pistas del archivo descargado.')
        return streams

    def report_choice(self, choice):
        reason = 'original' if choice.original else 'predeterminada' if choice.default else 'seleccionada'
        self.to_screen(f'Audio de la entrada {choice.source + 1}, pista {choice.index}: '
                       f'{choice.language or "idioma sin identificar"} ({reason}).')

    def before_merge(self, event):
        if event['status'] != 'started' or event['postprocessor'] != 'Merger':
            return
        formats = event['info_dict']['requested_formats']
        # The host also handles sources whose extractor exposes no audio metadata.
        # Only override the merger for the explicit video + audio plan we built.
        if len(formats) != 2 or formats[1].get('format_id') != 'nekodrop_selected_audio':
            return
        inputs = [self.streams(fmt['filepath']) for fmt in formats]
        hint = language_code(formats[1].get('language'))
        choice = choose_track(inputs, self.preference, 1, hint)
        if not choice:
            raise PostProcessingError('No se encontró audio en las pistas descargadas.')
        self.report_choice(choice)
        # The stock merger has already requested -map 1:a:0. Remove it before
        # adding the verified global stream index. Keep embedded video subtitles.
        args = ['-map', '-1:a', '-map', f'{choice.source}:{choice.index}', '-disposition:a:0', '+default',
                '-map', '0:s?', '-map', '0:t?', '-map_chapters', '0']
        ext = event['info_dict']['ext']
        subtitles = [s for s in inputs[0] if s['codec_type'] == 'subtitle']
        for i, sub in enumerate(subtitles):
            if ext == 'mkv' and sub['codec_name'] == 'mov_text':
                args += [f'-c:s:{i}', 'srt']
            elif ext in ('mp4', 'mov') and sub['codec_name'] != 'mov_text':
                args += [f'-c:s:{i}', 'mov_text']
        if choice.language:
            args += ['-metadata:s:a:0', f'language={choice.language}']
        self._downloader.params.setdefault('postprocessor_args', {})['merger+ffmpeg_o'] = args

    def run(self, info):
        path = Path(info['filepath'])
        streams = self.streams(str(path))
        audio = [s for s in streams if s['codec_type'] == 'audio']
        if not audio:
            self.to_screen('El archivo no contiene audio.')
            return [], info
        audio_format = next((f for f in info.get('requested_formats') or []
                             if f.get('acodec') != 'none'), info)
        hint = language_code(audio_format.get('language'))
        choice = choose_track([streams], self.preference, 0, hint)
        self.report_choice(choice)
        video_container = path.suffix.lower() in ('.mkv', '.mp4', '.mov', '.m4v', '.webm')
        if len(audio) > 1 or (video_container and not choice.default):
            temp = path.with_name(f'{path.stem}.audio-{uuid.uuid4().hex}{path.suffix}')
            try:
                # Negative maps preserve the order of video, subtitles, attachments,
                # and the chosen audio. A replacement is made only after verification.
                args = ['-map', '0']
                for other in audio:
                    if other['index'] != choice.index:
                        args += ['-map', f'-0:{other["index"]}']
                args += ['-c', 'copy', '-map_metadata', '0', '-map_chapters', '0',
                         '-disposition:a:0', '+default']
                if choice.language:
                    args += ['-metadata:s:a:0', f'language={choice.language}']
                self.run_ffmpeg(str(path), str(temp), args)
                result = self.streams(str(temp))
                if len([s for s in result if s['codec_type'] == 'audio']) != 1:
                    raise PostProcessingError('No se pudo verificar la pista de audio seleccionada.')
                os.replace(temp, path)
            finally:
                temp.unlink(missing_ok=True)
        # MetadataPP assigns format.language by assumed stream positions. A
        # combined file can put subtitles before audio. Leave verified track tags
        # in place, and use the extractor label only for an untagged single track.
        audio_format['language'] = None if choice.tagged_language else (choice.language or None)
        return [], info
