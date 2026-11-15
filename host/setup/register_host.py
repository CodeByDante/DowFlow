"""Validate and register the current checkout as a Windows Native Messaging host."""
import json
import os
from pathlib import Path
import re
import sys

HOST_NAME = 'com.gonzalo.videodownloader'
BROWSERS = (
    r'Software\Google\Chrome\NativeMessagingHosts',
    r'Software\Microsoft\Edge\NativeMessagingHosts',
    r'Software\BraveSoftware\Brave-Browser\NativeMessagingHosts',
)


def build_manifest(project_root, extension_id):
    if not re.fullmatch(r'[a-p]{32}', extension_id):
        raise ValueError('El ID debe tener 32 letras de la a a la p. Copialo desde la pagina de extensiones.')
    launcher = Path(project_root).resolve() / 'host' / 'download_host.bat'
    if not launcher.is_file():
        raise FileNotFoundError('No se encontro el lanzador: {}'.format(launcher))
    return {
        'name': HOST_NAME,
        'description': 'Descargador de Videos Local',
        'path': str(launcher),
        'type': 'stdio',
        'allowed_origins': ['chrome-extension://{}/'.format(extension_id)],
    }


def register_host(project_root, extension_id):
    import winreg
    manifest = build_manifest(project_root, extension_id)
    target = Path(project_root).resolve() / 'host' / (HOST_NAME + '.json')
    # json.dump correctly escapes spaces, Unicode, quotes and backslashes in paths.
    temporary = target.with_suffix('.json.tmp')
    try:
        temporary.write_text(json.dumps(manifest, ensure_ascii=True, indent=2) + '\n', encoding='utf-8')
        temporary.replace(target)
    finally:
        if temporary.exists():
            temporary.unlink()
    for browser in BROWSERS:
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, browser + '\\' + HOST_NAME) as key:
            winreg.SetValueEx(key, '', 0, winreg.REG_SZ, str(target))
    return target


def main():
    if os.name != 'nt':
        print('[ERROR] Este registro requiere Windows.', file=sys.stderr)
        return 1
    try:
        extension_id = input('ID de la extension: ').strip()
        project_root = Path(__file__).resolve().parents[2]
        target = register_host(project_root, extension_id)
        print('[OK] Manifiesto generado: {}'.format(target))
        return 0
    except (OSError, ValueError, EOFError) as error:
        print('[ERROR] {}'.format(error), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
