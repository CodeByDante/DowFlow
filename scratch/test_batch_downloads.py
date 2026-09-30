import subprocess
import struct
import json
import os
import sys
import time

def test_single_host_download(task_id, url):
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_dir = os.path.dirname(script_dir)
    host_py = os.path.join(project_dir, "host", "download_host.py")
    
    payload = {
        "command": "download",
        "url": url,
        "savePath": os.path.join(os.path.expanduser("~"), "Downloads"),
        "title": f"TestBatch_{task_id}",
        "formatSetting": "mp4",
        "qualitySetting": "min",
        "engineSetting": "ytdlp",
        "threadCount": 2,
        "audioFormat": "best",
        "audioQuality": "0",
        "audioConvert": "none",
        "videoFormatPref": "legado",
        "isAutoTitle": False
    }
    
    encoded_msg = json.dumps(payload).encode('utf-8')
    length_prefix = struct.pack('@I', len(encoded_msg))
    
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
    
    logs = []
    status = "started"
    final_file = ""
    
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
            elif st == "completed":
                status = "completed"
                final_file = msg.get("final_file")
                break
            elif st == "error":
                status = "error"
                logs.append(msg.get("error"))
                break
    except Exception as e:
        status = "exception"
        logs.append(str(e))
    finally:
        process.terminate()
        
    return {
        "task_id": task_id,
        "status": status,
        "final_file": final_file,
        "log_count": len(logs),
        "sample_logs": logs[:5]
    }

def main():
    print("Iniciando simulación de descargas concurrentes en el host Python...")
    test_urls = [
        "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    ]
    
    import concurrent.futures
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(test_single_host_download, i+1, url) for i, url in enumerate(test_urls)]
        results = [f.result() for f in concurrent.futures.as_completed(futures)]
        
    for res in results:
        print(f"Tarea {res['task_id']}: Estado={res['status']}, Archivo={res['final_file']}, Total Logs={res['log_count']}")
        
    time.sleep(0.5)
    print("\nVerificando limpieza en carpeta TEMP...")
    temp_dir = os.environ.get("TEMP", "")
    leftovers = [f for f in os.listdir(temp_dir) if f.startswith("TestBatch_")]
    print(f"Sobresalientes temporales con prefijo TestBatch: {len(leftovers)}")
    if len(leftovers) == 0:
        print("ÉXITO: No hay archivos temporales huérfanos de las pruebas.")

if __name__ == "__main__":
    main()
