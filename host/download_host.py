import sys
import json
import struct
import subprocess
import os
import threading
import re
import shutil
import time
import tempfile
from pathlib import Path
from subtitle_tracks import NO_SUBTITLE_DOWNLOAD, prepare_caption_download, finalize_subtitles
from engines import available_engine
from audio_tracks import metadata_command, apply_audio_plan
from video_quality import fixed_height, fixed_selector, detected_selector, enforce_height, clean_formats

active_downloads = 0
active_processes = []
lock = threading.Lock()
active_output_names = set()

def get_message():
    raw_length = sys.stdin.buffer.read(4)
    if len(raw_length) == 0:
        raise EOFError()
    msg_length = struct.unpack('@I', raw_length)[0]
    message = sys.stdin.buffer.read(msg_length).decode('utf-8')
    return json.loads(message)

def send_message(message):
    try:
        encoded_message = json.dumps(message).encode('utf-8')
        with lock:
            sys.stdout.buffer.write(struct.pack('@I', len(encoded_message)))
            sys.stdout.buffer.write(encoded_message)
            sys.stdout.buffer.flush()
    except Exception:
        pass

def cancel_active_processes():
    # Copy under the lock; stopping subprocesses must not block worker cleanup.
    with lock:
        processes = list(active_processes)
        for proc in processes:
            proc.is_cancelled = True
    for proc in processes:
        # Native Python downloads have a cancellation flag but no subprocess PID.
        if not hasattr(proc, 'pid'):
            continue
        try:
            if os.name == 'nt':
                subprocess.run(
                    ['taskkill', '/F', '/T', '/PID', str(proc.pid)],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                    creationflags=subprocess.CREATE_NO_WINDOW,
                )
            else:
                proc.terminate()
        except OSError:
            pass

def start_child(job, command, **kwargs):
    with lock:
        if job.is_cancelled:
            raise RuntimeError('Descarga cancelada.')
        child = subprocess.Popen(command, **kwargs)
        active_processes.append(child)
        return child


def finish_child(child):
    with lock:
        if child in active_processes:
            active_processes.remove(child)


def conversion_launcher(job):
    def start(command):
        return start_child(job, command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                           stderr=subprocess.STDOUT, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    return start


def get_track_info(job, args, env):
    send_message({'status': 'log', 'log': '[Idiomas] Consultando pistas disponibles…'})
    process = start_child(job, metadata_command(args), stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, text=True, encoding='utf-8', errors='replace',
                          creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0), env=env)
    try:
        try:
            raw, errors = process.communicate(timeout=90)
        except subprocess.TimeoutExpired:
            process.kill()
            process.communicate()
            raise RuntimeError('La consulta de idiomas superó 90 segundos. Vuelve a intentarlo.')
        if job.is_cancelled:
            raise RuntimeError('Descarga cancelada al consultar idiomas.')
        if process.returncode:
            raise RuntimeError('No se pudieron consultar las pistas: ' + (errors or '')[-1500:])
        return json.loads(raw)
    finally:
        finish_child(process)


def fetch_captions(job, command, env):
    process = start_child(job, command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                          text=True, encoding='utf-8', errors='replace',
                          creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0), env=env)
    try:
        last_line = ''
        with process.stdout:
            for line in process.stdout:
                last_line = line.strip()
                if last_line:
                    send_message({'status': 'log', 'log': '[Subtítulos] ' + last_line})
        process.wait()
        if job.is_cancelled:
            raise RuntimeError('Descarga cancelada al obtener subtítulos.')
        if process.returncode:
            raise RuntimeError('Falló el proceso de subtítulos: ' + last_line)
    finally:
        finish_child(process)


def engine_output(tracked, downloads_path, tmp_folder, output_name, receipt=None):
    """Prefer yt-dlp's final path, which also works for translated/generated titles."""
    if receipt and receipt.is_file():
        with receipt.open(encoding='utf-8') as entries:
            final = Path(json.loads(next(entries)))
        return str(final) if final.is_file() and final.stat().st_size else ''
    # Other engines may only report a destination or use the requested basename.
    media_extensions = {'.mp4', '.m4v', '.mkv', '.webm', '.mov', '.ts', '.flv', '.avi', '.mpeg',
                        '.mpg', '.3gp', '.mp3', '.m4a', '.aac', '.opus', '.ogg', '.flac', '.wav'}
    candidates = [Path(name) for name in reversed(tracked)]
    if output_name:
        for directory in (downloads_path, tmp_folder):
            if directory and Path(directory).is_dir():
                candidates.extend(p for p in Path(directory).iterdir() if p.stem == output_name)
    for path in candidates:
        if (path.suffix.lower() in media_extensions and not re.search(r'\.f[^.]+$', path.stem) and
                path.is_file() and path.stat().st_size):
            return str(path)
    return ''


def publish_media(source, directory):
    """Never reuse the audio/subtitles from an earlier download of the same title."""
    source = Path(source)
    target = Path(directory) / source.name
    counter = 2
    while True:
        try:
            with target.open('xb'):
                pass
            break
        except FileExistsError:
            target = Path(directory) / f'{source.stem} ({counter}){source.suffix}'
            counter += 1
    try:
        os.replace(source, target)
    except OSError:
        target.unlink()
        raise
    return str(target)


def native_download(url, output_name, downloads_path, thread_count=1, format_type='video', base_title='Video'):
    global active_downloads
    with lock:
        active_downloads += 1
        
    class DummyProc:
        def __init__(self):
            self.is_cancelled = False
    proc = DummyProc()
    with lock:
        active_processes.append(proc)
        
    try:
        import urllib.request
        import os
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
        }
        if "pimpbunny.com" in url:
            headers['Referer'] = 'https://pimpbunny.com/es/videos/'
            
        req = urllib.request.Request(url, headers=headers)
        from urllib.parse import urlsplit, parse_qs
        parsed = urlsplit(url)
        extension = os.path.splitext(parsed.path)[1].lower()
        query_extension = parse_qs(parsed.query).get('ext', [''])[0].lower().lstrip('.')
        allowed = {'.mp4', '.webm', '.mkv', '.mov', '.m4v'}
        ext = '.' + query_extension if '.' + query_extension in allowed else extension if extension in allowed else '.mp4'

        dest = os.path.join(downloads_path, f"{output_name}{ext}")
        media_type = "Audio" if format_type == 'mp3' or ext == '.mp3' else "Video"
        
        send_message({"status": "log", "log": "[*] Motor de descarga: Python (Descarga Nativa)", "output_name": output_name})
        send_message({"status": "log", "log": "[*] No se usarán los hilos, motor nativo no lo permite", "output_name": output_name})
        send_message({"status": "log", "log": f"[*] Formato a descargar: {ext.upper().replace('.', '')} ({media_type})", "output_name": output_name})
        send_message({"status": "log", "log": f"[*] Título original: {base_title}", "output_name": output_name})
        send_message({"status": "log", "log": f"[*] Guardando en: {dest}", "output_name": output_name})
        
        with urllib.request.urlopen(req, timeout=15) as response, open(dest, 'wb') as out_file:
            chunk_size = 8192
            downloaded = 0
            total_length = response.getheader('content-length')
            total = int(total_length) if total_length else None
            
            while not proc.is_cancelled:
                chunk = response.read(chunk_size)
                if not chunk:
                    break
                out_file.write(chunk)
                downloaded += len(chunk)
                if total:
                    percent = downloaded / total * 100
                    if downloaded % (chunk_size * 256) == 0:
                        send_message({"status": "progress", "percent": str(percent), "output_name": output_name})
                        send_message({"status": "log", "log": f"[Descarga Nativa] {percent:.1f}% ({downloaded / 1024 / 1024:.2f} MB / {total / 1024 / 1024:.2f} MB)", "output_name": output_name})
                if total and downloaded >= total:
                    break
                        
        if proc.is_cancelled:
            send_message({"status": "log", "log": "[-] Descarga nativa cancelada.", "output_name": output_name})
            send_message({"status": "error", "error": "Descarga cancelada.", "output_name": output_name})
        else:
            if format_type != 'mp3':
                bin_dir = Path(__file__).resolve().parent / 'bin'
                dest = finalize_subtitles(dest, False, None, bin_dir / 'ffmpeg.exe', bin_dir / 'ffprobe.exe',
                                          conversion_launcher(proc), finish_child)
            if proc.is_cancelled:
                raise RuntimeError('Descarga cancelada.')
            send_message({"status": "progress", "percent": "100", "output_name": output_name})
            send_message({"status": "log", "log": f"[Descarga Nativa] 100.0% ({downloaded / 1024 / 1024:.2f} MB Completados)", "output_name": output_name})
            send_message({"status": "log", "log": "[*] Descarga nativa completada con éxito.", "output_name": output_name})
            send_message({"status": "completed", "output_name": output_name, "final_file": dest})
            
    except Exception as e:
        send_message({"status": "log", "log": f"[ERROR] {str(e)}", "output_name": output_name})
        send_message({"status": "error", "error": str(e), "output_name": output_name})
    finally:
        with lock:
            if proc in active_processes:
                active_processes.remove(proc)
            active_downloads -= 1
            active_output_names.discard(output_name)

def handle_download(args, output_name=None, downloads_path=None, tmp_folder=None, fixed_limit=None, audio_options=None, subtitle_enabled=None):
    global active_downloads
    from types import SimpleNamespace
    job = SimpleNamespace(is_cancelled=False)
    with lock:
        active_downloads += 1
        active_processes.append(job)

    task_tracked_files = []
    process = None
    receipt = None
    media_stage = None
    
    try:
        create_no_window = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
        
        exe_name = os.path.basename(args[0])
        send_message({"status": "log", "log": f"[*] Iniciando {exe_name}..."})
        
        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        env["PYTHONIOENCODING"] = "utf-8"
        
        if tmp_folder and exe_name.lower() in ('yt-dlp', 'yt-dlp.exe'):
            os.makedirs(tmp_folder, exist_ok=True)
            receipt = Path(tmp_folder) / 'download-result.jsonl'
            args = list(args)
            if downloads_path:
                Path(downloads_path).mkdir(parents=True, exist_ok=True)
                media_stage = tempfile.TemporaryDirectory(prefix='.dowflow-', dir=downloads_path)
                # A stable auto-title must never cause yt-dlp to reuse an older language.
                args[-1:-1] = ['-P', 'home:' + media_stage.name]
            args = [*args[:-1], '--print-to-file', 'after_move:%(filepath)j',
                    str(receipt).replace('%', '%%'), args[-1]]

        if audio_options or subtitle_enabled:
            info = get_track_info(job, args, env)
            os.makedirs(tmp_folder, exist_ok=True)
            if subtitle_enabled:
                caption_command = prepare_caption_download(args, info, tmp_folder)
                if caption_command:
                    fetch_captions(job, caption_command, env)
            # Web captions were handled independently; huge translation catalogs
            # need not travel in the media selection that yt-dlp loads next.
            for field in ('subtitles', 'automatic_captions', 'requested_subtitles'):
                info.pop(field, None)
            if audio_options:
                args, notice = apply_audio_plan(args, info, audio_options, os.path.join(tmp_folder, 'audio-selection.json'))
                send_message({'status': 'log', 'log': '[Audio] ' + notice})
            else:
                selection = Path(tmp_folder) / 'media-info.json'
                selection.write_text(json.dumps(info, ensure_ascii=False), encoding='utf-8')
                args = [*args[:-1], '--load-info-json', str(selection)]
        process = start_child(job, args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                         text=True, encoding='utf-8', errors='replace', bufsize=1, creationflags=create_no_window, env=env)

        send_message({"status": "log", "log": "[*] Subproceso creado, leyendo respuestas..."})
        
        last_errors = []
        last_reported_percent = -1.0
        
        while True:
            line = process.stdout.readline()
            if not line:
                break
            clean_line = line.strip()
            if clean_line:
                # Filtrar logs de progreso repetitivo de fragmentos para no saturar memoria/consola
                is_fragment_progress = False
                if clean_line.startswith("[download]") and "%" in clean_line and "frag" in clean_line:
                    is_fragment_progress = True
                
                if not is_fragment_progress:
                    display_line = clean_line
                    # Traducciones comunes de yt-dlp a español
                    tr = [
                        ('Extracting URL:', 'Extrayendo URL:'),
                        ('Downloading just the video', 'Descargando solo el video'),
                        ('because of --no-playlist', 'debido a --no-playlist'),
                        ('Downloading webpage', 'Descargando página web'),
                        ('Downloading web embedded client config', 'Descargando configuración web'),
                        ('Downloading player', 'Descargando reproductor'),
                        ('Downloading tv downgraded player API JSON', 'Descargando API JSON de TV'),
                        ('Downloading web embedded player API JSON', 'Descargando API JSON web'),
                        ('Solving JS challenges using node', 'Resolviendo desafíos JS con Node.js'),
                        ('Downloading', 'Descargando'),
                        ('format(s):', 'formato(s):'),
                        ('Writing video thumbnail', 'Guardando miniatura en'),
                        ('video thumbnail', 'miniatura del video'),
                        ('Converting thumbnail', 'Convirtiendo miniatura'),
                        ('Deleting original file', 'Eliminando archivo original'),
                        ('(pass -k to keep)', ''),
                        ('[download] Destination:', '[descarga] Destino:'),
                        ('[download]', '[descarga]'),
                        ('to:', 'en:'),
                        ('has already been downloaded', 'ya ha sido descargado'),
                        ('[Metadata] Adding metadata to', '[Metadatos] Añadiendo metadatos a'),
                        ('[EmbedThumbnail] mutagen: Adding thumbnail to', '[Miniatura] Añadiendo miniatura a'),
                        ('[MoveFiles] Moving file', '[Mover] Moviendo archivo'),
                        ('to "', 'a "')
                    ]
                    for eng, spa in tr:
                        display_line = display_line.replace(eng, spa)
                    
                    send_message({"status": "log", "log": display_line})
                    
                if clean_line.startswith("ERROR:") or "oserror:" in clean_line.lower() or "error:" in clean_line.lower():
                    last_errors.append(clean_line)
                
                # Rastrear archivos para limpieza si se cancela o falla
                if "Destination:" in clean_line:
                    try:
                        filepath = clean_line.split("Destination:")[1].strip()
                        if filepath not in task_tracked_files:
                            task_tracked_files.append(filepath)
                    except: pass
                elif "Merging formats into" in clean_line:
                    try:
                        filepath = clean_line.split("Merging formats into")[1].strip().strip('"')
                        if filepath not in task_tracked_files:
                            task_tracked_files.append(filepath)
                    except: pass
                elif "Writing" in clean_line and " to: " in clean_line:
                    try:
                        filepath = clean_line.split(" to: ")[1].strip()
                        if filepath not in task_tracked_files:
                            task_tracked_files.append(filepath)
                    except: pass
                elif "has already been downloaded" in clean_line and "[download]" in clean_line:
                    try:
                        filepath = clean_line.split("[download]")[1].split("has already been downloaded")[0].strip()
                        if filepath not in task_tracked_files:
                            task_tracked_files.append(filepath)
                    except: pass
                    
            if "%" in line:
                match = re.search(r'\b([0-9]{1,3}(?:\.[0-9]+)?)\s*%', line)
                if match:
                    try:
                        percent_val = float(match.group(1))
                        if percent_val <= 100.0 and (percent_val - last_reported_percent >= 0.5 or percent_val >= 100.0 or last_reported_percent < 0):
                            last_reported_percent = percent_val
                            send_message({"status": "progress", "percent": str(percent_val)})
                    except Exception:
                        pass
                    
        process.wait()
        
        is_cancelled = job.is_cancelled or getattr(process, 'is_cancelled', False)
        
        actual_home = media_stage.name if media_stage else downloads_path
        final_file = engine_output(task_tracked_files, actual_home, tmp_folder, output_name, receipt)
        # A thumbnail failure is recoverable only when every error concerns the thumbnail.
        only_postprocessor_error = bool(last_errors and final_file) and all(
            'thumbnail' in error.lower() for error in last_errors)

        if (process.returncode == 0 or only_postprocessor_error) and not is_cancelled and final_file:
            if tmp_folder and actual_home and Path(tmp_folder).resolve() in Path(final_file).resolve().parents:
                target = Path(actual_home) / Path(final_file).name
                final_file = shutil.move(final_file, str(target))
            if only_postprocessor_error:
                send_message({"status": "log", "log": "[*] La miniatura no se pudo incrustar."})
            bin_dir = Path(args[0]).parent
            ffmpeg, ffprobe = bin_dir / 'ffmpeg.exe', bin_dir / 'ffprobe.exe'
            start_conversion = conversion_launcher(job)
            if fixed_limit:
                final_file = enforce_height(final_file, fixed_limit, ffmpeg, ffprobe,
                    start_conversion, finish_child,
                    lambda text: send_message({'status': 'log', 'log': '[Calidad fija] ' + text}))
            if subtitle_enabled is not None:
                final_file = finalize_subtitles(final_file, subtitle_enabled, tmp_folder, ffmpeg, ffprobe,
                    start_conversion, finish_child,
                    lambda text: send_message({'status': 'log', 'log': '[Subtítulos] ' + text}))
            if job.is_cancelled or getattr(process, 'is_cancelled', False):
                raise RuntimeError('Descarga cancelada.')
            if media_stage:
                final_file = publish_media(final_file, downloads_path)
            send_message({"status": "completed", "final_file": final_file})
        else:
            if not is_cancelled:
                err_msg = "La descarga falló o fue interrumpida."
                if last_errors:
                    err_msg = " | ".join(last_errors[-2:])
                send_message({"status": "error", "error": err_msg})
            
            # Limpiar archivos residuales solo al cancelar o cuando la descarga fue un fallo real
            time.sleep(1) # Esperar a que el SO libere los archivos
            for f in task_tracked_files:
                for ext in ["", ".part", ".ytdl"]:
                    try:
                        path_to_delete = f + ext
                        if os.path.exists(path_to_delete):
                            os.remove(path_to_delete)
                            send_message({"status": "log", "log": f"[*] Archivo residual eliminado: {os.path.basename(path_to_delete)}"})
                    except Exception:
                        try:
                            time.sleep(1)
                            if os.path.exists(path_to_delete):
                                os.remove(path_to_delete)
                                send_message({"status": "log", "log": f"[*] Archivo residual eliminado (reintento): {os.path.basename(path_to_delete)}"})
                        except:
                            pass
    except Exception as e:
        send_message({"status": "error", "error": str(e)})
    finally:
        with lock:
            active_downloads -= 1
            if job in active_processes:
                active_processes.remove(job)
            if process in active_processes:
                active_processes.remove(process)
            if output_name and output_name in active_output_names:
                active_output_names.remove(output_name)
        
        if media_stage:
            media_stage.cleanup()
        # Limpiar carpeta temporal si existe
        if tmp_folder and os.path.exists(tmp_folder):
            try:
                shutil.rmtree(tmp_folder, ignore_errors=True)
            except Exception:
                pass

def main():
    while True:
        try:
            msg = get_message()
            if msg.get('command') == 'open_folder':
                file_path = msg.get('file', '')
                if os.name == 'nt':
                    if file_path and os.path.exists(file_path):
                        norm_path = os.path.normpath(file_path)
                        subprocess.Popen(f'explorer /select,"{norm_path}"')
                    else:
                        downloads_path = os.path.join(os.path.expanduser("~"), "Downloads")
                        subprocess.Popen(['explorer', downloads_path])
                send_message({"status": "started"})
                
            elif msg.get('command') == 'select_folder':
                import tkinter as tk
                from tkinter import filedialog
                import ctypes
                try:
                    # 1 = PROCESS_SYSTEM_DPI_AWARE (Safe for Tkinter), 2 = PROCESS_PER_MONITOR_DPI_AWARE (can freeze dialogs)
                    ctypes.windll.shcore.SetProcessDpiAwareness(1)
                except Exception:
                    try:
                        ctypes.windll.user32.SetProcessDPIAware()
                    except:
                        pass
                
                root = tk.Tk()
                root.withdraw()
                root.attributes('-topmost', True)
                root.lift()
                root.focus_force()
                folder_path = filedialog.askdirectory(parent=root, title="Selecciona la carpeta para descargar")
                root.destroy()
                if folder_path:
                    send_message({"status": "folder_selected", "path": folder_path})
                else:
                    send_message({"status": "folder_selection_cancelled"})
                
            elif msg.get('command') == 'get_info' and 'url' in msg:
                import tempfile
                from urllib.parse import urlsplit
                bin_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'bin')
                ytdlp_path = os.path.join(bin_dir, 'yt-dlp.exe')
                try:
                    if not os.path.isfile(ytdlp_path):
                        raise FileNotFoundError('Falta yt-dlp.exe. Ejecuta actualizar_e_instalar_motores.bat.')
                    with tempfile.TemporaryDirectory(prefix='nekodrop-info-') as temporary:
                        args = [ytdlp_path, '--no-playlist', '--force-ipv4', '--no-warnings', '--js-runtimes', 'node', '-j', msg['url']]
                        page_url = msg.get('pageUrl', '')
                        if urlsplit(page_url).scheme in ('http', 'https'):
                            args.extend(['--referer', page_url])
                        cookies = msg.get('netscapeCookies', '')
                        if cookies:
                            cookie_file = os.path.join(temporary, 'cookies.txt')
                            with open(cookie_file, 'w', encoding='utf-8') as target:
                                target.write(cookies)
                            args.extend(['--cookies', cookie_file])
                        response = subprocess.run(args, capture_output=True, text=True, check=True, timeout=60,
                                                  creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                        info = json.loads(response.stdout)
                        formats = clean_formats(info)
                        if not formats:
                            raise ValueError('No se encontraron formatos de video disponibles para este enlace.')
                        send_message({'status': 'info', 'info': {'title': info.get('title'), 'formats': formats}})
                except subprocess.TimeoutExpired:
                    send_message({'status': 'error', 'error': 'La deteccion supero 60 segundos. Vuelve a intentarlo.'})
                except subprocess.CalledProcessError as error:
                    send_message({'status': 'error', 'error': (error.stderr or str(error))[-1200:]})
                except Exception as error:
                    send_message({'status': 'error', 'error': str(error)})

            elif msg.get('command') == 'get_playlist_info' and 'url' in msg:
                url = msg['url']
                script_dir = os.path.dirname(os.path.abspath(__file__))
                bin_dir = os.path.join(script_dir, "bin")
                ytdlp_path = os.path.join(bin_dir, "yt-dlp.exe")
                
                try:
                    create_no_window = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
                    result = subprocess.run([ytdlp_path, '--flat-playlist', '-J', url], capture_output=True, text=True, check=True, creationflags=create_no_window)
                    info = json.loads(result.stdout)
                    send_message({"status": "info", "info": info})
                except Exception as e:
                    send_message({"status": "error", "error": f"Error: {str(e)}"})
                    
            elif msg.get('command') == 'download' and 'url' in msg:
                url = msg['url']
                
                # Auto-extractor para Pimpbunny si el usuario pasa la página web directamente
                if "pimpbunny.com/es/videos" in url.lower() or ("pimpbunny.com" in url.lower() and "get_file" not in url.lower() and "remote_control.php" not in url.lower()):
                    send_message({"status": "log", "log": "[*] URL de Pimpbunny detectada. Extrayendo enlace directo del video..."})
                    try:
                        import urllib.request
                        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'})
                        with urllib.request.urlopen(req, timeout=10) as response:
                            html = response.read().decode('utf-8')
                            urls = re.findall(r'(?:video_url|video_alt_url\d*):\s*\'([^\']+)\'', html)
                            urls = [u for u in urls if 'upgrade=' not in u and '.mp4' in u]
                            if urls:
                                url = urls[-1] # El último suele ser la mejor calidad
                                send_message({"status": "log", "log": "[*] Enlace MP4 extraído exitosamente."})
                            else:
                                send_message({"status": "log", "log": "[-] No se pudo encontrar el video MP4 en Pimpbunny. Se intentará con el enlace original."})
                    except Exception as e:
                        send_message({"status": "log", "log": f"[-] Error en el extractor interno de Pimpbunny: {e}. Se intentará descargar con el motor seleccionado."})

                custom_path = msg.get('savePath', '').strip()
                format_type = msg.get('formatSetting', 'mp4')
                quality_setting = msg.get('qualitySetting', 'max')
                fixed_limit = fixed_height(msg.get('fixedQuality', 1080)) if quality_setting == 'fixed' and format_type != 'mp3' else None
                engine_setting = msg.get('engineSetting', 'ytdlp')
                
                yt_audio_lang = msg.get('ytAudioLang', 'es')
                subtitle_enabled = format_type != 'mp3' and msg.get('ytSubs', 'off') in (True, 'on')
                needs_track_selection = subtitle_enabled or yt_audio_lang in ('es', 'orig')
                if (format_type == 'mp3' or quality_setting in ('fixed', 'detect', 'ask', 'min') or needs_track_selection) and engine_setting not in ('ytdlp', 'aria2'):
                    engine_setting = 'ytdlp'
                    
                thread_count = int(msg.get('threadCount', 4))
                audio_format = msg.get('audioFormat', 'best')
                audio_quality = msg.get('audioQuality', '0')
                audio_convert = msg.get('audioConvert', 'none')
                video_format_pref = msg.get('videoFormatPref', 'legado')
                custom_format_id = msg.get('customFormatId', '')
                if quality_setting == 'detect' and format_type != 'mp3':
                    detected_selector(custom_format_id)
                netscape_cookies = msg.get('netscapeCookies', '')
                auto_engine_status = msg.get('autoEngine', True)
                
                global tracked_files
                with lock:
                    tracked_files = []
                
                send_message({"status": "started"})
                
                send_message({"status": "log", "log": "[*] --- Configuración de Descarga ---"})
                if format_type == 'mp3':
                    send_message({"status": "log", "log": "[*] Formato: Audio (MP3)"})
                else:
                    v_pref = "Legado (MP4/H.264)" if video_format_pref == 'legado' else "Calidad (AV1/VP9/H.265)"
                    send_message({"status": "log", "log": f"[*] Formato: Video | Preferencia: {v_pref}"})
                    
                if format_type != 'mp3':
                    q_str = "Fija (hasta {}p)".format(fixed_limit) if fixed_limit else "Detector" if quality_setting == "detect" else "Máxima" if quality_setting == 'max' else "Mínima" if quality_setting == 'min' else "Personalizada"
                    send_message({"status": "log", "log": f"[*] Calidad de Video: {q_str}"})
                
                cookies_status = "Activado" if (netscape_cookies and len(netscape_cookies) > 20) else "Desactivado"
                send_message({"status": "log", "log": f"[*] Cookies del navegador: {cookies_status}"})
                
                auto_str = "Activado" if (auto_engine_status is True or auto_engine_status == "on") else "Desactivado"
                send_message({"status": "log", "log": f"[*] Automatización de Motor: {auto_str}"})
                eng_name = {"ytdlp": "Por defecto (yt-dlp)", "aria2": "Acelerador (aria2)", "nm3u8": "Extremo (N_m3u8DL)", "native": "Nativo (Directo)"}.get(engine_setting, engine_setting)
                send_message({"status": "log", "log": f"[*] Motor elegido: {eng_name} | Hilos: {thread_count}"})
                send_message({"status": "log", "log": "[*] ---------------------------------"})
                
                script_dir = os.path.dirname(os.path.abspath(__file__))
                bin_dir = os.path.join(script_dir, "bin")
                ytdlp_path = os.path.join(bin_dir, "yt-dlp.exe")
                engine_setting, engine_notice = available_engine(engine_setting, bin_dir, auto_engine_status is True or auto_engine_status == 'on')
                if engine_notice:
                    send_message({'status': 'log', 'log': '[Motor] ' + engine_notice})

                
                # Check updates only once every 24 hours to avoid blocking the download start
                update_flag_file = os.path.join(script_dir, "last_update.txt")
                update_lock_file = os.path.join(script_dir, "last_update.lock")
                should_update = True
                if os.path.exists(update_flag_file):
                    if time.time() - os.path.getmtime(update_flag_file) < 86400: # 24 hours
                        should_update = False
                
                if should_update and not os.path.exists(update_lock_file):
                    try:
                        with open(update_lock_file, 'w') as f_lock:
                            f_lock.write(str(os.getpid()))
                        send_message({"status": "log", "log": "[*] Comprobando actualizaciones de yt-dlp (rápido)..."})
                        create_no_window = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
                        subprocess.run([ytdlp_path, '--update-to', 'master'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=create_no_window, timeout=10)
                        with open(update_flag_file, 'w') as f:
                            f.write(str(time.time()))
                    except Exception:
                        pass
                    finally:
                        try:
                            if os.path.exists(update_lock_file):
                                os.remove(update_lock_file)
                        except Exception:
                            pass
                
                # Se eliminó la advertencia de Node.js para no confundir al usuario
                
                if custom_path and os.path.exists(custom_path):
                    downloads_path = custom_path
                else:
                    downloads_path = os.path.join(os.path.expanduser("~"), "Downloads")
                
                base_title = msg.get('title', 'Video').strip()
                base_title = re.sub(r'[\\/*?:"<>|]', "", base_title)
                base_title = base_title[:80]
                
                output_name = base_title
                counter = 2
                
                def file_exists_with_name(name, dir_path):
                    for ext in ['.mp4', '.mkv', '.webm', '.ts', '.m4a', '.mp3', '.m3u8']:
                        if os.path.exists(os.path.join(dir_path, name + ext)):
                            return True
                    return False
                    
                while file_exists_with_name(output_name, downloads_path) or output_name in active_output_names:
                    output_name = f"{base_title} ({counter})"
                    counter += 1
                
                with lock:
                    active_output_names.add(output_name)
                
                # Para yt-dlp, escapamos el % por si acaso, aunque no deberia haber en output_name
                is_auto_title = msg.get('isAutoTitle', False)
                url_lower = url.lower()
                if is_auto_title and ('facebook.com' in url_lower or 'fb.watch' in url_lower or 'instagram.com' in url_lower or 'tiktok.com' in url_lower):
                    is_auto_title = False
                    
                ext_str = "%(ext)s"
                if ".php" in url.lower() or "php?" in url.lower():
                    ext_str = "mp4" if format_type != 'mp3' else "mp3"

                if is_auto_title and engine_setting != 'nm3u8':
                    output_template = f"%(title).80s [%(id)s].{ext_str}"
                else:
                    safe_output_name_ytdlp = output_name.replace('%', '%%')
                    output_template = f"{safe_output_name_ytdlp}.{ext_str}"
                
                if engine_setting == 'native':
                    threading.Thread(target=native_download, args=(url, output_name, downloads_path, thread_count, format_type, base_title), daemon=False).start()
                    continue
                
                if engine_setting == 'nm3u8':
                    # N_m3u8DL-RE Mode
                    nm3u8_path = os.path.join(bin_dir, "N_m3u8DL-RE.exe")
                    if not os.path.exists(nm3u8_path):
                        send_message({"status": "error", "error": "No se encontró N_m3u8DL-RE.exe en la carpeta del host."})
                        with lock:
                            active_downloads -= 1
                        return
                    
                    import tempfile
                    import uuid
                    unique_id = uuid.uuid4().hex[:8]
                    tmp_folder_nm = os.path.join(tempfile.gettempdir(), f"{output_name}_{unique_id}_tmp")
                    
                    mux_ext = 'mp4' if video_format_pref == 'legado' else 'mkv'
                    if format_type == 'mp3':
                        mux_ext = 'm4a' if audio_format == 'm4a' else 'mp3'
                        
                    args = [nm3u8_path, url, '--save-dir', downloads_path, '--save-name', output_name, '--auto-select', '--thread-count', str(thread_count), '--tmp-dir', tmp_folder_nm, '--mux-after-done', mux_ext]
                    
                    send_message({"status": "log", "log": f"[*] Numero de hilos motor Extremo (N_m3u8DL): {thread_count}"})
                    
                    page_url = msg.get('pageUrl', '')
                    try:
                        from urllib.parse import urlparse
                        if "wowstream" in url.lower() or "surrit.store" in url.lower():
                            args.extend(['-H', 'Referer: https://surrit.store/'])
                            args.extend(['-H', 'Origin: https://surrit.store'])
                        elif "surrit.com" in url.lower():
                            args.extend(['-H', 'Referer: https://surrit.com/'])
                            args.extend(['-H', 'Origin: https://surrit.com'])
                        elif page_url and page_url.startswith('http'):
                            parsed_page = urlparse(page_url)
                            base_origin = f"{parsed_page.scheme}://{parsed_page.netloc}"
                            args.extend(['-H', f'Referer: {page_url}'])
                            args.extend(['-H', f'Origin: {base_origin}'])
                        else:
                            parsed_url = urlparse(url)
                            base_origin = f"{parsed_url.scheme}://{parsed_url.netloc}"
                            args.extend(['-H', f'Referer: {base_origin}/'])
                            args.extend(['-H', f'Origin: {base_origin}'])
                    except Exception:
                        pass
                        
                    args.extend(['--drop-subtitle', 'all'])
                    threading.Thread(target=handle_download, args=(args, output_name, downloads_path, tmp_folder_nm, None, None, False), daemon=False).start()
                    return
                # End N_m3u8DL-RE Mode
                
                import tempfile
                import uuid
                unique_id = uuid.uuid4().hex[:8]
                tmp_folder_ytdlp = os.path.join(tempfile.gettempdir(), f"{output_name}_{unique_id}_tmp")
                args = [ytdlp_path, '--no-continue', '--windows-filenames', '--trim-filenames', '150', '--no-mtime', '--no-playlist', '--no-colors']
                args.extend(['-P', f'home:{downloads_path}'])
                args.extend(['-P', f'temp:{tmp_folder_ytdlp}'])
                args.extend(['--force-ipv4'])
                args.extend(['--impersonate', 'chrome'])
                page_url = msg.get('pageUrl', '')
                try:
                    from urllib.parse import urlparse
                    if "wowstream" in url.lower() or "surrit.store" in url.lower():
                        args.extend(['--add-header', 'Referer:https://surrit.store/'])
                        args.extend(['--add-header', 'Origin:https://surrit.store'])
                    elif "surrit.com" in url.lower():
                        args.extend(['--add-header', 'Referer:https://surrit.com/'])
                        args.extend(['--add-header', 'Origin:https://surrit.com'])
                    elif page_url and page_url.startswith('http'):
                        parsed_page = urlparse(page_url)
                        base_origin = f"{parsed_page.scheme}://{parsed_page.netloc}"
                        args.extend(['--add-header', f'Referer:{page_url}'])
                        args.extend(['--add-header', f'Origin:{base_origin}'])
                    else:
                        parsed_url = urlparse(url)
                        if "tiktok" in parsed_url.netloc:
                            args.extend(['--add-header', 'Referer:https://www.tiktok.com/'])
                            args.extend(['--add-header', 'Origin:https://www.tiktok.com'])
                        else:
                            base_origin = f"{parsed_url.scheme}://{parsed_url.netloc}"
                            args.extend(['--add-header', f'Referer:{base_origin}/'])
                            args.extend(['--add-header', f'Origin:{base_origin}'])
                except Exception:
                    args.extend(['--add-header', 'Referer:https://www.tiktok.com/'])
                args.extend(['--js-runtimes', 'node'])
                args.extend(['--ffmpeg-location', bin_dir])
                
                if ".php" in url.lower() or "php?" in url.lower():
                    args.extend(['--replace-in-metadata', 'ext', 'php', 'mp4'])
                    args.extend(['--replace-in-metadata', 'original_ext', 'php', 'mp4'])
                    args.extend(['--replace-in-metadata', 'url', '.php', '.mp4'])
                
                if netscape_cookies and len(netscape_cookies) > 20:
                    os.makedirs(tmp_folder_ytdlp, exist_ok=True)
                    cookie_path = os.path.join(tmp_folder_ytdlp, "session-cookies.txt")
                    try:
                        with open(cookie_path, "w", encoding="utf-8") as f:
                            f.write(netscape_cookies)
                        args.extend(['--cookies', cookie_path])
                    except Exception:
                        pass
                    
                if format_type == 'mp3':
                    args.append('-x')
                    
                    if audio_format == 'opus':
                        args.extend(['-f', 'bestaudio[ext=webm]/bestaudio[ext=opus]/bestaudio/best'])
                    elif audio_format == 'm4a':
                        args.extend(['-f', 'bestaudio[ext=m4a]/bestaudio/best'])
                    else:
                        args.extend(['-f', 'bestaudio/best'])
                        
                    if audio_convert != 'none':
                        args.extend(['--audio-format', audio_convert])
                    
                    if audio_quality != '0':
                        args.extend(['--audio-quality', f'{audio_quality}K'])
                    else:
                        args.extend(['--audio-quality', '0'])
                        
                    args.extend(['-o', output_template])
                else:
                    audio_selector = 'bestaudio'
                    if audio_format != 'best':
                        audio_selector += f"[ext={audio_format}]"
                    if audio_quality != '0':
                        audio_selector += f"[abr<={audio_quality}]"

                    if quality_setting == 'fixed':
                        args.extend(['-f', fixed_selector(fixed_limit, audio_selector),
                                     '--merge-output-format', 'mp4' if video_format_pref == 'legado' else 'mkv', '-o', output_template])
                    elif quality_setting == 'detect':
                        args.extend(['-f', detected_selector(custom_format_id),
                                     '--merge-output-format', 'mp4' if video_format_pref == 'legado' else 'mkv', '-o', output_template])
                    elif quality_setting == 'min':
                        if video_format_pref == 'legado':
                            args.extend(['-f', f'worstvideo[ext=mp4]+{audio_selector.replace("best", "worst")}/worst[ext=mp4]/worst', '-o', output_template])
                        else:
                            args.extend(['-f', f'worstvideo+{audio_selector.replace("best", "worst")}/worst', '-o', output_template])
                    elif quality_setting == 'ask' and custom_format_id:
                        max_h = custom_format_id
                        if video_format_pref == 'legado':
                            args.extend(['-f', f'bestvideo[height<={max_h}][ext=mp4]+{audio_selector}/best[height<={max_h}][ext=mp4]/best', '--merge-output-format', 'mp4', '-o', output_template])
                        else:
                            args.extend(['-f', f'bestvideo[height<={max_h}]+{audio_selector}/best[height<={max_h}]/best', '--merge-output-format', 'mkv', '-o', output_template])
                    else:
                        if video_format_pref == 'legado':
                            args.extend(['-f', f'bestvideo[ext=mp4]+{audio_selector}/best[ext=mp4]/best', '--merge-output-format', 'mp4', '-o', output_template])
                        else:
                            args.extend(['-f', f'bestvideo+{audio_selector}/best', '--merge-output-format', 'mkv', '-o', output_template])
                            
                sort_directives = ['height'] if fixed_limit else []
                    
                if format_type != 'mp3' and video_format_pref == 'legado':
                    sort_directives.extend(['res', 'vcodec:h264', 'acodec:m4a'] if fixed_limit else ['vcodec:h264', 'res', 'acodec:m4a'])
                    
                if sort_directives:
                    args.extend(['-S', ','.join(sort_directives)])
                    
                args.extend(NO_SUBTITLE_DOWNLOAD)
                        
                if engine_setting == 'aria2':
                    aria2c_path = os.path.join(bin_dir, "aria2c.exe")
                    if os.path.exists(aria2c_path):
                        args.extend(['--downloader', 'aria2c', '--downloader-args', f'aria2c:-x {thread_count} -s {thread_count} -k 1M'])
                        send_message({"status": "log", "log": f"[*] Numero de hilos motor Acelerador (aria2): {thread_count}"})
                    else:
                        send_message({"status": "log", "log": "[-] Aria2c.exe no encontrado, usando descargador nativo."})
                else:
                    send_message({"status": "log", "log": f"[*] Numero de hilos motor por defecto (yt-dlp): {thread_count}"})
                    if thread_count > 1:
                        args.extend(['-N', str(thread_count)])
                        
                args.extend(['--embed-thumbnail', '--embed-metadata', '--convert-thumbnails', 'jpg'])
                args.append('--newline')
                args.append(url)
                
                audio_options = None
                if yt_audio_lang in ('es', 'orig'):
                    audio_options = {'preference': yt_audio_lang, 'audio_format': audio_format,
                        'audio_quality': audio_quality, 'format_type': format_type,
                        'quality': quality_setting, 'video_preference': video_format_pref,
                        'fixed_limit': fixed_limit, 'custom_id': custom_format_id}
                threading.Thread(target=handle_download, args=(args, output_name, downloads_path, tmp_folder_ytdlp, fixed_limit, audio_options,
                                                              subtitle_enabled if format_type != 'mp3' else None), daemon=False).start()
                
            elif msg.get('command') == 'cancel':
                cancel_active_processes()
                send_message({"status": "cancelled"})
                
        except EOFError:
            cancel_active_processes()
            break
        except Exception as e:
            send_message({"status": "error", "error": str(e)})

if __name__ == '__main__':
    main()
