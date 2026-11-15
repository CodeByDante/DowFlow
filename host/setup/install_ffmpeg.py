import urllib.request
import zipfile
import os

print("Descargando FFmpeg (necesario para convertir a MP3)...")
url = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
try:
    urllib.request.urlretrieve(url, "ffmpeg.zip")

    bin_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "bin")
    if not os.path.exists(bin_dir): os.makedirs(bin_dir)

    print("Extrayendo ffmpeg.exe y ffprobe.exe...")
    with zipfile.ZipFile("ffmpeg.zip", 'r') as zip_ref:
        for file in zip_ref.namelist():
            if file.endswith("ffmpeg.exe"):
                with zip_ref.open(file) as source, open(os.path.join(bin_dir, "ffmpeg.exe"), "wb") as target:
                    target.write(source.read())
            elif file.endswith("ffprobe.exe"):
                with zip_ref.open(file) as source, open(os.path.join(bin_dir, "ffprobe.exe"), "wb") as target:
                    target.write(source.read())

    os.remove("ffmpeg.zip")
    print("FFmpeg instalado correctamente en modo silencioso.")
except Exception as e:
    print(f"Error descargando ffmpeg: {e}")
    raise SystemExit(1)
