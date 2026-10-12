---
name: editar-video
description: Edita videos para redes en el proyecto video/ (Remotion + HyperFrames + ffmpeg). Corta silencios, arma Reels verticales 1080×1920 de 30 a 60 segundos, agrega subtítulos automáticos en español (whisper.cpp local, palabra activa resaltada) y el logo de la marca al final. Usar siempre que Lucas pase un video (.mp4/.mov/.webm) o pida editar, recortar, subtitular, "sacar Reels", "cortar silencios", "hacer un vertical", poner el logo al cierre, o una placa / intro / motion graphic animada, aunque no diga "skill".
---

# Edición de video para Reels

Todo vive en `video/` (paquete aparte de la app, con su propio `pnpm-workspace.yaml`; **siempre pnpm, nunca npx**). Correr los comandos con `cwd` en `video/`.

| Pieza | Para qué |
|---|---|
| `scripts/editar.ts` (`pnpm editar …`) | El pipeline: silencios → transcripción → tramo → render |
| `src/Reel.tsx` (Remotion) | Composición `Reel` 1080×1920 a 30 fps: video + subtítulos estilo Reels + cierre con logo |
| `hyperframes/` (HyperFrames) | Placas, intros, títulos y motion graphics en HTML + GSAP (`index.html` = placa de cierre PRODI) |
| `whisper.cpp/` | Transcripción local, modelo `medium` (no usa API ni cuesta) |
| `trabajo/<nombre>/` | Intermedios: `limpio.mp4`, `transcripcion.txt`, `captions.json` |
| `salida/` | MP4 finales |

Nada de eso último va a git (`video/.gitignore`).

## Si llegan varios videos

Primero mirarlos (tira de cuadros) y transcribirlos cada uno con `preparar`. Si son **tomas repetidas** del mismo texto, elegir la mejor (sin trabas ni repeticiones, buen audio, encuadre y foco) y seguir solo con esa. Si son **partes distintas** (gancho, producto, promo, cierre), armar el orden y empalmar recortando lo que sobre para que entre en 57,5 s:
```
pnpm editar unir <nombre> "C:\...\IMG_1.MOV:0-8.3" "C:\...\IMG_2.MOV:4.9-16.3" "C:\...\IMG_3.MOV"
pnpm editar preparar trabajo\<nombre>.mp4 --vocabulario "..."
```
`unir` lleva todo a 1080×1920 y empareja el volumen. Tomas con solo cuenta regresiva o "3, 2, 1" no van. En un local con ruido de fondo los silencios casi no se detectan con -35 dB: probar `--umbral -26 --min-silencio 0.35`.

Si la marca no está en `marcas/marcas.json`, recortar el logo que pase Lucas a su contenido (ffmpeg `crop`) y usar `--logo` + `--fondo` del color de fondo del logo.

## Flujo con un video nuevo

1. **Preparar** (corta silencios + transcribe):
   ```
   pnpm editar preparar "<ruta al video>" [--vocabulario "PRODI, Nexo Pilates"]
   ```
   - `--vocabulario`: nombres propios / marcas que se dicen en el video, así whisper los escribe bien. Si el video es de un cliente, pasar siempre el nombre de la marca.
   - Si cortó de más (se comen sílabas) → `--umbral -45` o `--margen 0.25`. Si dejó pausas → `--umbral -30` o `--min-silencio 0.35`. Video con música de fondo → `--sin-cortar`.
   - Tarda: el modelo medium transcribe ~1 min de audio cada 2–3 min en esta PC.

2. **Elegir el tramo leyendo `trabajo/<nombre>/transcripcion.txt`.** Cada línea es una frase con `[inicio – fin]` en la línea de tiempo *ya sin silencios*. Elegí vos el mejor momento (no lo dejes al automático si el video es largo):
   - arranca con un gancho (pregunta, dato fuerte, promesa) y no a mitad de idea;
   - termina en una frase cerrada;
   - dura entre **27,5 y 57,5 s** (el cierre con logo suma 2,5 s → Reel total de 30 a 60 s);
   - si el video da para varios Reels, proponé varios tramos que no se pisen.
   Mostrale a Lucas los tramos con el texto de arranque y cierre antes de renderizar si hay más de una opción razonable.

3. **Renderizar**:
   ```
   pnpm editar reel <nombre> --desde 12.4 --hasta 55.0 --marca "NEXO PILATES"
   ```
   - `--marca` = carpeta de `marcas/` (lee `marcas/marcas.json`): usa la variante blanca del logo sobre el color más oscuro de la paleta; si no hay variante blanca, el logo principal sobre el color más claro. Sin `--marca` → logo PRODI sobre `#111111`.
   - `--logo ruta.png` / `--fondo "#hex"` pisan lo de la marca. `--color "#hex"` = color de la palabra que se está diciendo (por defecto amarillo `#ffd400`; tiene que contrastar con blanco y negro).
   - `--encuadre recorte` llena la pantalla cortando costados (es el default si el video ya es vertical); `desenfoque` muestra el video entero sobre una copia desenfocada (default si es horizontal). Si en un horizontal la persona está centrada, `recorte` suele quedar mejor.
   - `--sin-subtitulos`, `--cierre 3` (segundos de logo), `--salida nombre.mp4`.
   - Render: ~3 min por Reel de 30 s en esta PC (concurrencia 2 por poca RAM; no subirla).

   Atajo sin elegir: `pnpm editar todo "<video>" --marca X` (prepara y elige solo un tramo de ~45 s que arranque y termine en frase).

4. **Verificar antes de mostrar.** Sacar una tira de cuadros y mirarla:
   ```
   ffmpeg -v error -y -i salida/<archivo>.mp4 -vf "select='eq(n\,60)+eq(n\,300)+eq(n\,600)',scale=360:-1,tile=3x1" -frames:v 1 <scratchpad>/cuadros.png
   ```
   Revisar: que el sujeto quede en cuadro, subtítulos legibles y bien escritos (si whisper erró una palabra, corregirla en `trabajo/<nombre>/captions.json` y volver a correr `reel`), y el logo del cierre. Chequear duración con `ffprobe`. Recién después mandarle el MP4 a Lucas (SendUserFile) con duración y tramo usado.

## Ajustes finos

- **Estilo de subtítulos** (tamaño, fuente, posición, mayúsculas, borde): `Pagina` en `src/Reel.tsx`. `paddingBottom: 430` los deja sobre la zona de botones de Instagram.
- **Animación del cierre**: `Cierre` en `src/Reel.tsx`.
- **Previsualizar en vivo**: `pnpm studio` (Remotion Studio; cargar `public/trabajo/<id>/props.json` como props).

## HyperFrames (placas y motion graphics)

Para piezas gráficas sin video de cámara: placa de cierre más elaborada, intro, "3 claves" en texto animado, contador, lower third. Es HTML + GSAP; leer `video/hyperframes/CLAUDE.md` antes de armar una composición nueva.

```
pnpm hf:check                                   # lint + validación + contraste (tiene que pasar)
pnpm hf:render -o salida/<nombre>.mp4           # 1080×1920
pnpm hf:preview                                 # studio en el navegador
```
Reglas que ya nos mordieron: cada elemento con `class="clip"` se posiciona a pantalla completa → agrupar el layout dentro de **un** clip contenedor; logos e imágenes en `hyperframes/assets/`.

Para pegar una placa de HyperFrames al final de un Reel en vez del cierre de Remotion: renderizar el Reel con `--cierre 0` y concatenar:
```
ffmpeg -i salida/reel.mp4 -i salida/placa.mp4 -filter_complex "[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[v][a]" -map "[v]" -map "[a]" -c:v libx264 -crf 18 -c:a aac salida/final.mp4
```
(si la placa no tiene audio, agregarle uno mudo antes con `-f lavfi -i anullsrc=r=48000:cl=stereo -shortest`).

## Si algo no anda

- `No encuentro ffmpeg` → `winget install Gyan.FFmpeg` (el script igual lo busca en la carpeta de winget aunque la terminal no tenga el PATH nuevo). HyperFrames sí necesita ffmpeg en el PATH: abrir una terminal nueva.
- Falta `whisper.cpp/` (no está en git) → `pnpm instalar-whisper` (baja ~1,5 GB).
- pnpm rechaza versiones por `minimumReleaseAge`: no saltear la política; fijar una versión de hace al menos unos días.
