#!/usr/bin/env python3
"""Arma la demo navegable en un solo HTML (código, estilos e imágenes adentro).
Uso: SINGLE=1 pnpm exec vite build --config vite.demo.config.ts && python3 scripts/demo-single.py
"""
import base64, glob, json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "dist-demo-single")

def data_uri(path):
    ext = path.rsplit(".", 1)[-1].lower()
    mime = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg"}[ext]
    return f"data:{mime};base64," + base64.b64encode(open(path, "rb").read()).decode()

assets = {}
for f in glob.glob(os.path.join(ROOT, "public/brand/*.png")):
    assets["brand/" + os.path.basename(f)] = data_uri(f)
for f in glob.glob(os.path.join(ROOT, "public/icons/icon-192.png")):
    assets["icons/" + os.path.basename(f)] = data_uri(f)
for f in glob.glob(os.path.join(ROOT, "demo/public/demo/*.jpg")) + glob.glob(os.path.join(ROOT, "demo/public/demo/*.png")):
    assets["demo/" + os.path.basename(f)] = data_uri(f)

js = open(glob.glob(os.path.join(OUT, "assets/*.js"))[0], encoding="utf-8").read()
css = open(glob.glob(os.path.join(OUT, "assets/*.css"))[0], encoding="utf-8").read()
fav = data_uri(os.path.join(ROOT, "public/favicon.png"))

js = js.replace("</script", "<\\/script")
html = f"""<!doctype html>
<html lang="es" class="dark">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
<title>Prodi Redes · Demo</title>
<link rel="icon" type="image/png" href="{fav}" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
<style>html{{background:#060609}}</style>
<style>{css}</style>
<script>window.__PRODI_ASSETS__ = {json.dumps(assets)};</script>
</head>
<body>
<div id="root"></div>
<script type="module">{js}</script>
</body>
</html>
"""
dest = os.path.join(ROOT, "prodi-redes-demo.html")
open(dest, "w", encoding="utf-8").write(html)
print(dest, round(len(html) / 1024 / 1024, 2), "MB")
