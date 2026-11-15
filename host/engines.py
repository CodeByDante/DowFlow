"""Check installed download engines before creating a download task."""
from pathlib import Path


def available_engine(engine, bin_dir, automatic):
    root = Path(bin_dir)
    if engine == 'native':
        return engine, ''
    if engine == 'nm3u8':
        if (root / 'N_m3u8DL-RE.exe').is_file():
            return engine, ''
        if automatic and (root / 'yt-dlp.exe').is_file():
            return 'ytdlp', 'Falta N_m3u8DL-RE; se usara yt-dlp como alternativa.'
        raise FileNotFoundError('Falta N_m3u8DL-RE.exe. Ejecuta actualizar_e_instalar_motores.bat.')
    if not (root / 'yt-dlp.exe').is_file():
        raise FileNotFoundError('Falta yt-dlp.exe. Ejecuta actualizar_e_instalar_motores.bat.')
    if engine == 'aria2' and not (root / 'aria2c.exe').is_file():
        return 'ytdlp', 'Falta aria2c.exe; se usara el descargador de yt-dlp.'
    return engine, ''
