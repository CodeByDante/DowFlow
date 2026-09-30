import subprocess
import os
import re

ytdlp = r"c:\Users\Gonzalo\Desktop\descargador de videos\host\yt-dlp.exe"
args = [ytdlp, '--no-colors', '--newline', 'https://test-videos.co.uk/vids/jellyfish/mp4/h264/1080/Jellyfish_1080_10s_1MB.mp4']
env = os.environ.copy()
env['PYTHONUNBUFFERED'] = '1'

process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1, env=env)
with open(r'c:\Users\Gonzalo\Desktop\ytdeps_log.txt', 'w', encoding='utf-8') as f:
    for line in process.stdout:
        match = re.search(r'([0-9]+(?:\.[0-9]+)?)%', line)
        if match:
            f.write(f"MATCH: {match.group(1)}% -> {line}")
        else:
            f.write(f"NO_MATCH: {line}")
        f.flush()
