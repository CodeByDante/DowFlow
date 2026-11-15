import subprocess
import struct
import json
import os
import sys

def test_postprocessor_resilience():
    if len(sys.argv) != 2:
        raise SystemExit("Uso: python host/tests/manual/test_postprocessor_resilience.py URL")
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_dir = os.path.dirname(os.path.dirname(os.path.dirname(script_dir)))
    host_py = os.path.join(project_dir, "host", "download_host.py")
    
    # We pass a test URL
    payload = {
        "command": "download",
        "url": sys.argv[1],
        "savePath": os.path.join(os.path.expanduser("~"), "Downloads"),
        "title": "TestPostprocessor",
        "formatSetting": "mp4",
        "qualitySetting": "min", # min quality for quick test
        "engineSetting": "ytdlp",
        "threadCount": 4,
        "audioFormat": "best",
        "audioQuality": "0",
        "audioConvert": "none",
        "videoFormatPref": "legado",
        "isAutoTitle": False
    }
    
    encoded_msg = json.dumps(payload).encode('utf-8')
    length_prefix = struct.pack('@I', len(encoded_msg))
    
    print("Enviando petición de descarga con incrustación de miniatura...")
    process = subprocess.Popen(
        [sys.executable, host_py],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        bufsize=0
    )
    
    process.stdin.write(length_prefix)
    process.stdin.write(encoded_msg)
    process.stdin.flush()
    
    status = "started"
    final_file = ""
    logs = []
    
    try:
        while True:
            raw_length = process.stdout.read(4)
            if not raw_length or len(raw_length) < 4:
                break
            msg_length = struct.unpack('@I', raw_length)[0]
            msg_data = process.stdout.read(msg_length).decode('utf-8')
            msg = json.loads(msg_data)
            
            st = msg.get("status")
            if st == "log":
                logs.append(msg.get("log"))
                print(f"[LOG] {msg.get('log')}")
            elif st == "completed":
                status = "completed"
                final_file = msg.get("final_file")
                print(f"[COMPLETED] Archivo final: {final_file}")
                break
            elif st == "error":
                status = "error"
                print(f"[ERROR] {msg.get('error')}")
                break
    except Exception as e:
        status = "exception"
        print(f"[EXCEPTION] {e}")
    finally:
        process.terminate()
        
    print(f"\nResultado final del Test: Estado={status}, Archivo={final_file}")
    if final_file and os.path.exists(final_file):
        print(f"ÉXITO CONFIRMADO: El video existe en el disco ({os.path.getsize(final_file)} bytes).")
    else:
        print("FALLO: El video no fue conservado.")

if __name__ == "__main__":
    test_postprocessor_resilience()
