import subprocess
import struct
import json
import os
import sys

def main():
    if len(sys.argv) != 2:
        raise SystemExit("Uso: python host/tests/manual/test_download.py URL")
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_dir = os.path.dirname(os.path.dirname(os.path.dirname(script_dir)))
    host_py = os.path.join(project_dir, "host", "download_host.py")
    
    # Message payload
    payload = {
        "command": "download",
        "url": sys.argv[1],
        "savePath": os.path.join(os.path.expanduser("~"), "Downloads"),
        "formatSetting": "mp4",
        "qualitySetting": "max",
        "engineSetting": "ytdlp",
        "threadCount": 4,
        "audioFormat": "best",
        "audioQuality": "0",
        "audioConvert": "mp3",
        "videoFormatPref": "calidad", # Simulating "Calidad" setting
        "customFormatId": "",
        "netscapeCookies": "",
        "ytAudioLang": "es",
        "ytSubs": "off",
        "isAutoTitle": True
    }
    
    encoded_msg = json.dumps(payload).encode('utf-8')
    length_prefix = struct.pack('@I', len(encoded_msg))
    
    print(f"Starting host: {host_py}")
    process = subprocess.Popen(
        [sys.executable, host_py],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        bufsize=0
    )
    
    # Write message
    process.stdin.write(length_prefix)
    process.stdin.write(encoded_msg)
    process.stdin.flush()
    
    print("Message sent, reading responses...")
    
    # Read messages from host
    try:
        while True:
            raw_length = process.stdout.read(4)
            if not raw_length or len(raw_length) < 4:
                break
            msg_length = struct.unpack('@I', raw_length)[0]
            msg_data = process.stdout.read(msg_length).decode('utf-8')
            msg = json.loads(msg_data)
            
            status = msg.get("status")
            if status == "log":
                print(f"[LOG] {msg.get('log')}")
            elif status == "progress":
                print(f"[PROGRESS] {msg.get('percent')}%")
            elif status == "completed":
                print(f"[COMPLETED] Final file: {msg.get('final_file')}")
                break
            elif status == "error":
                print(f"[ERROR] {msg.get('error')}")
                break
            else:
                print(f"[MSG] {msg}")
    except KeyboardInterrupt:
        print("Interrupted.")
    finally:
        process.terminate()

if __name__ == "__main__":
    main()
