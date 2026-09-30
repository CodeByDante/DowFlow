import subprocess
import concurrent.futures
import os
import json

urls = [
    "https://es.xhamster.com/videos/signature-tease-unfolds-as-yuria-reveals-her-bold-stunning-clothed-allure-scene-4-xhaqAGj",
    "https://es.xhamster.com/videos/signature-tease-unfolds-as-yuria-reveals-her-bold-stunning-clothed-allure-scene-3-xhESVRC",
    "https://es.xhamster.com/videos/signature-tease-unfolds-as-yuria-reveals-her-bold-stunning-clothed-allure-scene-7-xhvX4GE",
    "https://es.xhamster.com/videos/sweat-soaked-heat-surges-as-a-bound-curvy-wife-reveals-her-bold-overwhelming-presence-scene-1-xhRdASi",
    "https://es.xhamster.com/videos/sweat-soaked-heat-surges-as-a-bound-curvy-wife-reveals-her-bold-overwhelming-presence-scene-3-xhYTA6m",
    "https://es.xhamster.com/videos/sweat-soaked-heat-surges-as-a-bound-curvy-wife-reveals-her-bold-overwhelming-presence-scene-2-xhImvap",
    "https://es.xhamster.com/videos/rising-desire-surges-as-a-wedded-curvy-wife-unleashes-her-bold-overwhelming-presence-part-2-xhIYl8x",
    "https://es.xhamster.com/videos/signature-tease-unfolds-as-yuria-reveals-her-bold-stunning-clothed-allure-scene-1-xhZ0oV6",
    "https://es.xhamster.com/videos/yuria-yoshine-the-naked-housewives-of-japan-part-1-xhbqSZJ",
    "https://es.xhamster.com/videos/sweat-soaked-heat-surges-as-a-bound-curvy-wife-reveals-her-bold-overwhelming-presence-scene-4-xhwOgFa",
    "https://es.xhamster.com/videos/signature-tease-unfolds-as-yuria-reveals-her-bold-stunning-clothed-allure-scene-5-xhfZxVy",
    "https://es.xhamster.com/videos/three-days-with-a-playful-temptress-who-moved-in-ep-3-xh3UfTPy",
    "https://es.xhamster.com/videos/heat-surges-as-a-married-young-wife-unleashes-her-bold-curvy-presence-scene-2-xhMqLif",
    "https://es.xhamster.com/videos/tension-surge-rises-as-married-nene-unleashes-her-bold-overwhelming-curvy-presence-part-2-xhyr4Sm",
    "https://es.xhamster.com/videos/rising-temptation-surges-as-a-devoted-curvy-wife-unleashes-her-bold-overwhelming-presence-part-2-xh1r1CQ",
    "https://es.xhamster.com/videos/tension-heat-rises-as-a-committed-curvy-wife-unleashes-her-bold-overwhelming-presence-part-2-xhc1g2q",
    "https://es.xhamster.com/videos/tension-heat-rises-as-married-kaho-unleashes-her-bold-overwhelming-curvy-presence-part-2-xha8s70",
    "https://es.xhamster.com/videos/apartment-complex-wife-indulging-in-afternoon-passion-while-her-husband-is-away-part-4-xhlQw1h",
    "https://es.xhamster.com/videos/when-i-played-a-trick-on-my-sons-big-breasted-tutor-it-worked-too-well-and-she-climaxed-repeatedly-xh805LP",
    "https://es.xhamster.com/videos/milf-is-secretly-lusting-after-a-man-thats-not-her-husband-playing-with-herself-under-the-table-5-xhAHrnM",
    "https://es.xhamster.com/videos/heatwave-tension-rises-as-a-committed-curvy-wife-reveals-her-bold-overwhelming-presence-scene-3-xhBSnkm",
    "https://es.xhamster.com/videos/big-tit-playroom-yuria-yoshine-k-cup-111-cm-xhv3zDY",
    "https://es.xhamster.com/videos/japanese-hot-wife-cheating-part-5-9677443",
    "https://es.xhamster.com/videos/hiyori-i-caught-an-unprecedentedly-tight-plump-super-a5-rank-top-quality-meat-xhdfKZX",
    "https://es.xhamster.com/videos/mendicant-wife-3-mami-hoshino-xhGH1k7",
    "https://es.xhamster.com/videos/rising-desire-surges-as-a-wedded-curvy-wife-unleashes-her-bold-overwhelming-presence-part-3-xhp0a5R",
    "https://es.xhamster.com/videos/yuria-yoshine-slut-big-breasts-creampie-ol-other-fetishes-xhVkYbo",
    "https://es.xhamster.com/videos/yuria-yoshine-newlywed-life-is-completely-subjective-part-1-xhHUu08",
    "https://es.xhamster.com/videos/out-of-shape-japanese-man-meets-voluptuous-yuria-yoshine-xhX0b0X",
    "https://es.xhamster.com/videos/signature-tease-unfolds-as-yuria-reveals-her-bold-stunning-clothed-allure-scene-2-xhDanih",
    "https://es.xhamster.com/videos/photoshoot-with-busty-asian-babe-in-cosplay-went-too-far-xhUj0eq",
    "https://es.xhamster.com/videos/sun-kissed-gal-and-a-night-that-changed-everything-part1-xhSdLRK",
    "https://es.xhamster.com/videos/sun-kissed-gal-and-a-night-that-changed-everything-part1-xhBkqo9",
    "https://es.xhamster.com/videos/healing-temptation-from-a-busty-mature-woman-with-soft-curves-yuria-y-pt-3-xhmH2HX"
]

ytdlp_path = os.path.join(os.getcwd(), "host", "bin", "yt-dlp.exe")

def get_m3u8(url):
    try:
        result = subprocess.run([ytdlp_path, "-g", url], capture_output=True, text=True, timeout=30)
        if result.returncode == 0:
            return {"url": url, "m3u8": result.stdout.strip()}
        else:
            return {"url": url, "error": result.stderr.strip()}
    except Exception as e:
        return {"url": url, "error": str(e)}

results = []
print(f"Extrayendo enlaces de {len(urls)} videos...")

with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
    future_to_url = {executor.submit(get_m3u8, url): url for url in urls}
    for future in concurrent.futures.as_completed(future_to_url):
        res = future.result()
        results.append(res)
        print(f"Procesado: {res['url'][:50]}...")

with open("m3u8_results.json", "w", encoding="utf-8") as f:
    json.dump(results, f, indent=4)

print("¡Listo! Resultados guardados en m3u8_results.json")
