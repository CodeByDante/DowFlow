import sys
import json
import struct
import subprocess
import os
import threading
import re
import shutil
import time

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

def native_download(url, output_name, downloads_path):
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
        ext = '.mp4'
        if 'ext=' in url:
            ext = '.' + url.split('ext=')[-1].split('&')[0]
        dest = os.path.join(downloads_path, f"{output_name}{ext}")
        
        send_message({"status": "log", "log": f"[*] Iniciando descarga nativa directa a {dest}...", "output_name": output_name})
        
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
                        
        if proc.is_cancelled:
            send_message({"status": "log", "log": "[-] Descarga nativa cancelada.", "output_name": output_name})
            send_message({"status": "error", "error": "Descarga cancelada.", "output_name": output_name})
        else:
            send_message({"status": "progress", "percent": "100", "output_name": output_name})
            send_message({"status": "log", "log": f"[Descarga Nativa] 100.0% ({downloaded / 1024 / 1024:.2f} MB Completados)", "output_name": output_name})
            send_message({"status": "log", "log": "[*] Descarga nativa completada con éxito.", "output_name": output_name})
            send_message({"status": "complete", "output_name": output_name})
            
    except Exception as e:
        send_message({"status": "log", "log": f"[ERROR] {str(e)}", "output_name": output_name})
        send_message({"status": "error", "error": str(e), "output_name": output_name})
    finally:
        with lock:
            if proc in active_processes:
                active_processes.remove(proc)
            active_downloads -= 1

def handle_download(args, output_name=None, downloads_path=None, tmp_folder=None):
    global active_downloads
    with lock:
        active_downloads += 1
        
    task_tracked_files = []
    process = None
    
    try:
        create_no_window = getattr(subprocess, 'CREATE_NO_WINDOW', 0x08000000)
        
        exe_name = os.path.basename(args[0])
        send_message({"status": "log", "log": f"[*] Iniciando {exe_name}..."})
        
        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        
        process = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1, creationflags=create_no_window, env=env)
        with lock:
            active_processes.append(process)
            
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
                    send_message({"status": "log", "log": clean_line})
                    
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
        
        is_cancelled = getattr(process, 'is_cancelled', False)
        
        final_file = ""
        import tempfile
        temp_dir = tempfile.gettempdir()
        
        # 1. Buscar en task_tracked_files
        if task_tracked_files:
            for f in reversed(task_tracked_files):
                if os.path.exists(f) and os.path.isfile(f) and os.path.getsize(f) > 0 and not f.endswith(('.jpg', '.png', '.webp', '.part', '.ytdl')):
                    final_file = f
                    break
                    
        # 2. Si no se encontró, buscar cualquier video del lote en downloads_path o tmp_folder
        search_dirs = []
        if downloads_path and os.path.exists(downloads_path):
            search_dirs.append(downloads_path)
        if tmp_folder and os.path.exists(tmp_folder):
            search_dirs.append(tmp_folder)
            
        if not final_file and output_name:
            for d in search_dirs:
                try:
                    for f in os.listdir(d):
                        if f.startswith(output_name) and not f.endswith(('.part', '.ytdl', '.tmp', '.m4a', '.ytdl.part', '.jpg', '.png', '.webp')):
                            full_path = os.path.join(d, f)
                            if os.path.isfile(full_path) and os.path.getsize(full_path) > 0:
                                final_file = full_path
                                break
                    if final_file:
                        break
                except:
                    pass

        # Detectar si la falla fue únicamente por incrustar miniatura o metadatos en ffmpeg
        only_postprocessor_error = False
        if last_errors and final_file:
            err_text = " ".join(last_errors).lower()
            if "embedthumbnail" in err_text or "ffmpegpostprocessorerror" in err_text or "unable to embed" in err_text or "metadata" in err_text:
                only_postprocessor_error = True

        if (process.returncode == 0 or only_postprocessor_error) and not is_cancelled and final_file:
            # Si el video quedó en el directorio temporal por el fallo del postprocesador, moverlo a downloads_path
            if (final_file.startswith(temp_dir) or (tmp_folder and final_file.startswith(tmp_folder))) and downloads_path:
                try:
                    target_file = os.path.join(downloads_path, os.path.basename(final_file))
                    shutil.move(final_file, target_file)
                    final_file = target_file
                except Exception:
                    pass
                    
            if only_postprocessor_error:
                send_message({"status": "log", "log": "[*] ADVERTENCIA: La miniatura/metadatos no se pudieron incrustar (formato no soportado), pero el video se descargó y guardó con éxito."})
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
            if process in active_processes:
                active_processes.remove(process)
            if output_name and output_name in active_output_names:
                active_output_names.remove(output_name)
        
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
                        subprocess.Popen(['explorer', '/select,', file_path])
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
                url = msg['url']
                script_dir = os.path.dirname(os.path.abspath(__file__))
                bin_dir = os.path.join(script_dir, "bin")
                ytdlp_path = os.path.join(bin_dir, "yt-dlp.exe")
                
                try:
                    create_no_window = getattr(subprocess, 'CREATE_NO_WINDOW', 0x08000000)
                    result = subprocess.run([ytdlp_path, '--no-playlist', '--force-ipv4', '--no-warnings', '-j', url], capture_output=True, text=True, check=True, creationflags=create_no_window)
                    info = json.loads(result.stdout)
                    formats = info.get('formats', [])
                    clean_formats = []
                    for f in formats:
                        if f.get('vcodec') != 'none':
                            try:
                                tbr = round(float(f.get('tbr', 0) or 0))
                            except:
                                tbr = 0
                            clean_formats.append({
                                'format_id': f.get('format_id'),
                                'resolution': f.get('resolution', 'N/A'),
                                'ext': f.get('ext'),
                                'tbr': tbr
                            })
                    send_message({"status": "info", "info": {"title": info.get("title"), "formats": clean_formats}})
                except Exception as e:
                    send_message({"status": "error", "error": f"Error: {str(e)}"})
                    
            elif msg.get('command') == 'get_playlist_info' and 'url' in msg:
                url = msg['url']
                script_dir = os.path.dirname(os.path.abspath(__file__))
                bin_dir = os.path.join(script_dir, "bin")
                ytdlp_path = os.path.join(bin_dir, "yt-dlp.exe")
                
                try:
                    create_no_window = getattr(subprocess, 'CREATE_NO_WINDOW', 0x08000000)
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
                            if urls:
                                url = urls[-1] # El último suele ser la mejor calidad
                                send_message({"status": "log", "log": "[*] Enlace MP4 extraído exitosamente."})
                            else:
                                send_message({"status": "error", "error": "No se pudo encontrar el video en esta página de Pimpbunny."})
                                continue
                    except Exception as e:
                        send_message({"status": "error", "error": f"Error extrayendo video de Pimpbunny: {e}"})
                        continue

                custom_path = msg.get('savePath', '').strip()
                format_type = msg.get('formatSetting', 'mp4')
                quality_setting = msg.get('qualitySetting', 'max')
                engine_setting = msg.get('engineSetting', 'ytdlp')
                
                # El motor de descarga ahora se respeta tal como viene configurado por el usuario
                pass
                    
                thread_count = int(msg.get('threadCount', 4))
                audio_format = msg.get('audioFormat', 'best')
                audio_quality = msg.get('audioQuality', '0')
                audio_convert = msg.get('audioConvert', 'none')
                video_format_pref = msg.get('videoFormatPref', 'legado')
                custom_format_id = msg.get('customFormatId', '')
                netscape_cookies = msg.get('netscapeCookies', '')
                yt_audio_lang = msg.get('ytAudioLang', 'es')
                yt_subs = msg.get('ytSubs', 'off')
                
                global tracked_files
                with lock:
                    tracked_files = []
                
                send_message({"status": "started"})
                
                script_dir = os.path.dirname(os.path.abspath(__file__))
                bin_dir = os.path.join(script_dir, "bin")
                ytdlp_path = os.path.join(bin_dir, "yt-dlp.exe")
                
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
                        create_no_window = getattr(subprocess, 'CREATE_NO_WINDOW', 0x08000000)
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
                    threading.Thread(target=native_download, args=(url, output_name, downloads_path), daemon=False).start()
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
                    
                    send_message({"status": "log", "log": f"[*] Motor Extremo (N_m3u8DL) activado usando {thread_count} hilo(s)."})
                    
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
                        
                    threading.Thread(target=handle_download, args=(args, output_name, downloads_path, tmp_folder_nm), daemon=False).start()
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
                    cookie_path = os.path.join(script_dir, "youtube_cookies.txt")
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

                    if quality_setting == 'min':
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
                            
                sort_directives = []
                if yt_audio_lang == 'es':
                    sort_directives.extend(['lang:es', 'lang:spa', 'lang:es-419'])
                    
                if format_type != 'mp3' and video_format_pref == 'legado':
                    sort_directives.extend(['vcodec:h264', 'res', 'acodec:m4a'])
                    
                if sort_directives:
                    args.extend(['-S', ','.join(sort_directives)])
                    
                if yt_subs == 'on':
                    args.extend(['--write-subs', '--write-auto-subs', '--sub-langs', 'es.*,en.*', '--embed-subs'])
                        
                if engine_setting == 'aria2':
                    aria2c_path = os.path.join(bin_dir, "aria2c.exe")
                    if os.path.exists(aria2c_path):
                        args.extend(['--downloader', 'aria2c', '--downloader-args', f'aria2c:-x {thread_count} -s {thread_count} -k 1M'])
                        send_message({"status": "log", "log": f"[*] Acelerador Aria2 activado ({thread_count} conexiones simultáneas)."})
                    else:
                        send_message({"status": "log", "log": "[-] Aria2c.exe no encontrado, usando descargador nativo."})
                else:
                    send_message({"status": "log", "log": f"[*] Motor predeterminado (yt-dlp) activado usando {thread_count} hilo(s)."})
                    if thread_count > 1:
                        args.extend(['-N', str(thread_count)])
                        
                args.extend(['--embed-thumbnail', '--embed-metadata', '--convert-thumbnails', 'jpg'])
                args.append('-v')
                args.append('--newline')
                args.append(url)
                
                threading.Thread(target=handle_download, args=(args, output_name, downloads_path, tmp_folder_ytdlp), daemon=False).start()
                
            elif msg.get('command') == 'cancel':
                with lock:
                    for proc in list(active_processes):
                        try:
                            proc.is_cancelled = True
                            if os.name == 'nt':
                                subprocess.run(['taskkill', '/F', '/T', '/PID', str(proc.pid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=0x08000000)
                            else:
                                proc.terminate()
                        except Exception:
                            pass
                send_message({"status": "cancelled"})
                
        except EOFError:
            with lock:
                if active_process is not None:
                    try:
                        active_process.is_cancelled = True
                        if os.name == 'nt':
                            subprocess.run(['taskkill', '/F', '/T', '/PID', str(active_process.pid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=0x08000000)
                        else:
                            active_process.terminate()
                    except:
                        pass
            break
        except Exception as e:
            send_message({"status": "error", "error": str(e)})

if __name__ == '__main__':
    main()
