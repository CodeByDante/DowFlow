import urllib.request
import json
import zipfile
import os
import ssl

def install_atomicparsley():
    # Validate HTTPS certificates for downloaded executables.
    ctx = ssl.create_default_context()

    print("Fetching latest AtomicParsley release...")
    api_url = "https://api.github.com/repos/wez/atomicparsley/releases/latest"
    
    req = urllib.request.Request(api_url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, context=ctx) as response:
        data = json.loads(response.read().decode())
        
    download_url = None
    for asset in data.get('assets', []):
        if 'Windows' in asset['name'] and 'zip' in asset['name'].lower():
            download_url = asset['browser_download_url']
            break
            
    if not download_url:
        print("Could not find Windows asset.")
        return
        
    script_dir = os.path.dirname(os.path.abspath(__file__))
    zip_path = os.path.join(script_dir, "ap.zip")
    
    print(f"Downloading from {download_url}...")
    req = urllib.request.Request(download_url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, context=ctx) as response, open(zip_path, 'wb') as out_file:
        out_file.write(response.read())
    
    print("Extracting AtomicParsley...")
    with zipfile.ZipFile(zip_path, 'r') as zip_ref:
        zip_ref.extractall(script_dir)
        
    try:
        os.remove(zip_path)
    except:
        pass
    
    bin_dir = os.path.join(script_dir, "..", "bin")
    if not os.path.exists(bin_dir): os.makedirs(bin_dir)
    
    # Move to bin
    for root, dirs, files in os.walk(script_dir):
        for file in files:
            if file.lower() == "atomicparsley.exe" and root != bin_dir:
                import shutil
                shutil.move(os.path.join(root, file), os.path.join(bin_dir, "AtomicParsley.exe"))
                
    print(f"AtomicParsley installed successfully in {bin_dir}")

if __name__ == "__main__":
    install_atomicparsley()
