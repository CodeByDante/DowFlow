import urllib.request
import json
import zipfile
import os

print("Buscando la última versión de N_m3u8DL-RE...")
req = urllib.request.Request("https://api.github.com/repos/nilaoda/N_m3u8DL-RE/releases")
req.add_header('User-Agent', 'Mozilla/5.0')
try:
    with urllib.request.urlopen(req) as response:
        data = json.loads(response.read().decode())

    download_url = None
    for release in data:
        for asset in release.get('assets', []):
            if 'win-x64' in asset['name'] and asset['name'].endswith('.zip'):
                download_url = asset['browser_download_url']
                break
        if download_url:
            break

    if not download_url:
        print("No se encontró el archivo ZIP para Windows x64.")
        exit(1)

    print(f"Descargando desde: {download_url}")
    urllib.request.urlretrieve(download_url, "nm3u8dlre.zip")

    bin_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "bin")
    if not os.path.exists(bin_dir): os.makedirs(bin_dir)

    print("Extrayendo N_m3u8DL-RE.exe...")
    with zipfile.ZipFile("nm3u8dlre.zip", 'r') as zip_ref:
        for file in zip_ref.namelist():
            if file.endswith("N_m3u8DL-RE.exe"):
                with zip_ref.open(file) as source, open(os.path.join(bin_dir, "N_m3u8DL-RE.exe"), "wb") as target:
                    target.write(source.read())

    os.remove("nm3u8dlre.zip")
    print("N_m3u8DL-RE ha sido instalado correctamente.")
except Exception as e:
    print(f"Ocurrió un error: {e}")
