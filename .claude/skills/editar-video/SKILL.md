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

## Efectos gráficos (siempre, salvo que pida algo sobrio)

Con los tiempos de palabra de `captions.json` escribir `trabajo/<nombre>/efectos.json` y pasarlo con `--efectos`:
`{ "colores": {"marca","fuerte","texto"}, "efectos": [...] }`. Tipos (en `src/Efectos.tsx`):
- `titulo` (arriba, con `sub`) para el gancho y cada bloque; `etiqueta` (sticker con `x`,`y`,`giro`) cuando nombra un producto o atributo;
- `zoom` (punch-in 1.12–1.16) en las palabras fuertes; `flash` en cada empalme entre partes;
- `promo` (`grande` + `chico`) para descuentos, cuotas y precios; `cta` con la web o el @ al final;
- `broll` (`src` relativo al JSON) para planos de apoyo **encima de la voz** — nunca un plano mudo suelto: si queda un hueco sin voz necesita música, y no tenemos música propia (sugerir agregarla en Instagram o pedir un MP3).
**Estilo por defecto: el del Reel de Juanita v2** (etiquetas tipo sticker adelante, chicas, en `y` ~820; subtítulos abajo). Lucas probó la versión con texto detrás de la persona y se quedó con la v2: no usar `persona` salvo que lo pida. Si pide que una etiqueta no tape la estampa de la prenda, primero moverla a una zona libre (techo / costado).
Opcional, solo si lo pide — texto detrás de la persona: `pnpm editar persona <nombre> 6.6-12.5 25.7-35.1` recorta a la persona con lo que tiene en la mano (modelo local de HyperFrames, ~0,65 s por cuadro: solo los tramos con etiqueta) e imprime los efectos `persona` para pegar en el JSON. Esas etiquetas van grandes (`tam` 100–120, o ~72 si el texto es largo) a media altura (`y` ~600), así asoman por detrás. El tramo `persona` no puede pisar un `broll`. Los subtítulos siempre abajo.
Barra de progreso arriba automática. Colores de la marca; subtítulos con `--color` en un tono de la marca que se lea sobre borde negro.

**Voz del camarógrafo** ("3, 2, 1, va"): whisper suele no transcribirla y además corre los tiempos de las primeras palabras. Para cada toma, medir el nivel cada 0,1 s del principio (`asetnsamples=4800,astats=metadata=1:reset=1`) y cortar donde arranca la voz fuerte de quien habla a cámara; después verificar transcribiendo el arranque de cada empalme del video final.

`unir` ya limpia la voz (filtro de ruido, compresión, presencia) y realza el color; `--sin-mejorar` lo saltea.

## Ajustes finos

- **Estilo de subtítulos** (tamaño, fuente, posición, mayúsculas, borde): `Pagina` en `src/Reel.tsx`. `paddingBottom: 430` los deja sobre la zona de botones de Instagram.
- **Animación del cierre**: `Cierre` en `src/Reel.tsx`.
- **Previsualizar en vivo**: `pnpm studio` (Remotion Studio; cargar `public/trabajo/<id>/props.json` como props).

## Reels de motion graphics (sin filmación)

Cuando pide "un video como este" con una referencia de animaciones (showreel, presentación de marca): un proyecto por pieza en `video/motion/<nombre>/` (index.html + assets/ + hyperframes.json + meta.json), una escena `.clip` por golpe y un solo timeline GSAP. Ejemplo hecho: `video/motion/prodi-software/` (19 s, escenas cada 0,5 s a 120 BPM: tipografía cinética, grilla en onda, celular con pago aprobado, blob, grilla 3D, código, palabras al golpe, glitch, cierre con rayos y logo). Para ondas/grillas usar el patrón `onda()` (proxy que redibuja en `onUpdate`, así funciona al hacer seek cuadro a cuadro). `pnpm exec hyperframes check motion/<nombre>` tiene que pasar (texto con contorno → `color` igual al fondo; capas de glitch → `data-layout-allow-overlap`). Render: `pnpm exec hyperframes render motion/<nombre> --workers 2 -o salida/<nombre>.mp4` (~1 min). Sale sin audio: armar los cortes a un tempo fijo y que la música se agregue en Instagram o con un MP3 que pase Lucas.

**Comerciales (lo que Lucas aprobó y rechazó):** quiere piezas que vendan, con estructura problema (rojo, caos, "−VENTAS / −TIEMPO / −PLATA") → "¡BASTA!" con glitch → revelación de la marca → beneficios uno por golpe con UI del producto → CTA con botón que late + cursor → cierre con logo y frase. Base: `video/motion/erp-venta/` y `erp-sistemas/`. Rechazó: conceptos narrativos tipo "un día en tu negocio con reloj" (`erp-dia`, `erp-comercial`) y copiar el formato de una referencia (`erp-producto`). Nunca clonar voces de terceros.
**Efectos 3D tipo motion design** (referencia que pidió Lucas, adaptada en `video/motion/erp-neo/`): tipografía cinética inclinada en 3D sobre fondo claro con palabra en caja de color, efecto lente/abombado en la última palabra, texto neón con extrusión (`text-shadow` en capas) y parpadeo, ícono que sube sobre anillos holográficos con haz de luz, celular 3D (`preserve-3d`) con tarjetas que se despegan de la pantalla (`z`), "dolly" de cámara entre escenas (escala 1.9 + blur → 1), texto en órbita (letras con `rotateY(i) translateZ(R)`), logo en baldosa con resplandor sobre tipografía gigante tenue, polvo/partículas y viñeta. Siempre con colores PRODI. Para que `check` pase: capas decorativas o en movimiento 3D con `data-layout-ignore`.
**Márgenes de Instagram (obligatorio):** en 1080×1920 todo texto y gráfico importante entre y=250 y y=1500, x entre 60 y 960, y nada en la franja derecha x>930 por debajo de y=1000 (botones). Verificar siempre con guías antes de entregar:
`ffmpeg -i salida/X.mp4 -vf "select='eq(n\,90)+...',drawbox=x=0:y=0:w=1080:h=250:color=red@0.25:t=fill,drawbox=x=0:y=1500:w=1080:h=420:color=red@0.25:t=fill,drawbox=x=930:y=1000:w=150:h=920:color=red@0.25:t=fill,scale=216:-1,tile=5x1" -frames:v 1 guias.png`. Con rotaciones 3D el texto se ensancha: dejar aire.
**Sonido cinematográfico (lo que quiere Lucas):** los sintetizados de `pnpm sfx crear` le parecieron feos; usar `--lib sfx-cine` (efectos de ElevenLabs: whoosh, golpe, subida, logo, glitch, ding, pop, monedas, con `anclas.json` = segundo del golpe de cada uno, así el cue marca el instante visual). Pocos y con intención: whoosh en cada vuelo de cámara, golpe solo en momentos fuertes, subida que corta en la revelación. Para generar más en ElevenLabs (Efectos de sonido): abrir el selector de duración antes de fijarla, descargar desde la pestaña Historial (hover + ícono de descarga → WAV); a veces el archivo queda como `.tmp` en Descargas pero completo.
**Efectos de sonido sintetizados (respaldo):** `pnpm sfx crear` sintetiza la biblioteca en `video/sfx/` (whoosh, whoosh-corto, golpe, golpe-suave, glitch, neon, subida, brillo, pop, clic, ding, monedas; todos al mismo pico). Escribir `motion/<pieza>/sfx.json` con `[nombre, segundo, dB]` siguiendo los tiempos del timeline (whoosh ~0,3 s antes de cada corte de cámara, golpe en revelaciones y palabras fuertes, pop en cada tarjeta/palabra que entra, clic+ding en cursores y confirmaciones, monedas en ventas) y `pnpm sfx mezclar <voz.mp3> motion/<pieza>/sfx.json motion/<pieza>/assets/mezcla.m4a --duracion <seg>`; en el `<audio>` usar `mezcla.m4a`. Verificar transcribiendo la mezcla que la voz se entienda. Ejemplo: `motion/erp-neo/sfx.json`.
**Voz en off:** ElevenLabs (cuenta de Lucas, en el navegador de la app). Voz propia diseñada "Prodi sofware" (Voice Design: locutor porteño ~35, cálido, publicitario). Text to Speech → 2 tomas → Lucas elige escuchando → bajar con el ícono de descarga de esa toma (cae en `Downloads/ElevenLabs_*.mp3`) → `loudnorm=I=-14` a `assets/voz.m4a` → tiempos por palabra con `whisper-cli -ml 1 -sow` → animar en esos segundos. En el panel angosto ElevenLabs funciona bien a su tamaño normal; con viewport emulado los diálogos se dibujan en blanco.
PRODI: violeta `#6F40FC`, Software celeste `#0EA5E9`, fondo casi negro, Inter; logos en `public/brand/`; web somosprodi.com. PRODI Software = apps para cobrar con Mercado Pago + mantenimiento.

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
