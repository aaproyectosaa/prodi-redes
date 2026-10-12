// Edición de video para Reels.
//
//   pnpm editar preparar <video>                     corta silencios y transcribe (trabajo/<nombre>/)
//   pnpm editar reel <nombre> --desde 12.4 --hasta 55  arma el Reel vertical de ese tramo (tiempos del video ya sin silencios)
//   pnpm editar todo <video>                         preparar + reel con el tramo que elige solo
//   pnpm editar unir <nombre> a.mov:0-8.3 b.mov:4.9-16.3 c.mov   empalma partes de varios videos en trabajo/<nombre>.mp4
//                                                    (vertical 1080×1920, voz limpia, colores realzados); después: preparar trabajo/<nombre>.mp4
//                                                    --sin-mejorar  deja sonido y color como vienen
//                                                    a.mov:2-5:mudo  usa solo la imagen de esa parte (audio en silencio)
//
// Opciones de reel/todo:
//   --marca "TOKIO"       logo y fondo del cierre salen de marcas/marcas.json (sin marca: logo PRODI)
//   --logo ruta.png       logo a mano (pisa al de la marca)      --fondo "#000000"  fondo del cierre
//   --color "#ffd400"     color de la palabra que se está diciendo
//   --encuadre recorte    llena la pantalla cortando costados (por defecto: desenfoque si el video es horizontal)
//   --sin-subtitulos      --cierre 2.5 (segundos del logo)       --salida nombre.mp4
//   --efectos efectos.json  títulos, etiquetas, promos, zooms, flashes y planos de apoyo (ver src/Efectos.tsx)
//
//   pnpm editar persona <nombre> 6.6-12.5 25.7-35.1   recorta a la persona en esos tramos (para texto detrás de ella)
// Opciones de preparar/todo:
//   --umbral -35          dB por debajo de los cuales es silencio  --min-silencio 0.5  (segundos)
//   --margen 0.15         aire que se deja a cada lado del corte   --sin-cortar  (no corta silencios)
//   --modelo medium       modelo de whisper (medium, small, base…; si no está bajado se baja solo)
//   --vocabulario "PRODI, Nexo Pilates"  nombres propios para que whisper los escriba bien

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { downloadWhisperModel, toCaptions, transcribe } from "@remotion/install-whisper-cpp";
import type { Caption } from "@remotion/captions";

const RAIZ = path.resolve(import.meta.dirname, "..");
const REPO = path.resolve(RAIZ, "..");
const TRABAJO = path.join(RAIZ, "trabajo");
const SALIDA = path.join(RAIZ, "salida");
const PUBLICO = path.join(RAIZ, "public", "trabajo");
const WHISPER = path.join(RAIZ, "whisper.cpp");
const WHISPER_VERSION = "1.7.6";
const FPS = 30;

// ---------- argumentos ----------
const [comando, objetivo, ...resto] = process.argv.slice(2);
const opts: Record<string, string | true> = {};
for (let i = 0; i < resto.length; i++) {
  const a = resto[i];
  if (!a.startsWith("--")) continue;
  const sig = resto[i + 1];
  if (sig === undefined || sig.startsWith("--")) opts[a.slice(2)] = true;
  else (opts[a.slice(2)] = sig), i++;
}
const num = (k: string, def: number) => (typeof opts[k] === "string" ? Number(opts[k]) : def);
const str = (k: string) => (typeof opts[k] === "string" ? (opts[k] as string) : undefined);

// ---------- ffmpeg ----------
function binario(nombre: "ffmpeg" | "ffprobe"): string {
  const enPath = spawnSync(process.platform === "win32" ? "where" : "which", [nombre], { encoding: "utf8" });
  if (enPath.status === 0) return enPath.stdout.split(/\r?\n/)[0].trim();
  // winget lo instala acá y la terminal puede no tener el PATH nuevo todavía
  const base = path.join(process.env.LOCALAPPDATA ?? "", "Microsoft", "WinGet", "Packages");
  for (const pkg of fs.existsSync(base) ? fs.readdirSync(base) : []) {
    if (!pkg.startsWith("Gyan.FFmpeg")) continue;
    for (const sub of fs.readdirSync(path.join(base, pkg))) {
      const exe = path.join(base, pkg, sub, "bin", `${nombre}.exe`);
      if (fs.existsSync(exe)) return exe;
    }
  }
  throw new Error(`No encuentro ${nombre}. Instalalo con: winget install Gyan.FFmpeg`);
}
const FFMPEG = binario("ffmpeg");
const FFPROBE = binario("ffprobe");

function correr(bin: string, args: string[], { silencioso = false } = {}) {
  const r = spawnSync(bin, args, { encoding: "utf8", maxBuffer: 1 << 28 });
  if (r.status !== 0) {
    if (!silencioso) console.error(r.stderr?.slice(-3000));
    throw new Error(`${path.basename(bin)} terminó con error (${r.status})`);
  }
  return r;
}

type Info = { duracion: number; ancho: number; alto: number; tieneAudio: boolean };
function info(archivo: string): Info {
  const r = correr(FFPROBE, ["-v", "error", "-show_streams", "-show_format", "-of", "json", archivo]);
  const j = JSON.parse(r.stdout);
  const v = j.streams.find((s: { codec_type: string }) => s.codec_type === "video");
  if (!v) throw new Error("El archivo no tiene video");
  // los celulares graban vertical con metadata de rotación
  const rot = Math.abs(Number(v.side_data_list?.find((d: { rotation?: number }) => d.rotation !== undefined)?.rotation ?? v.tags?.rotate ?? 0));
  const girado = rot === 90 || rot === 270;
  return {
    duracion: Number(j.format.duration),
    ancho: girado ? v.height : v.width,
    alto: girado ? v.width : v.height,
    tieneAudio: j.streams.some((s: { codec_type: string }) => s.codec_type === "audio"),
  };
}

const CODIFICAR = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart"];

// ---------- 1. silencios ----------
type Tramo = { desde: number; hasta: number };

function detectarSilencios(archivo: string, umbral: number, minimo: number): Tramo[] {
  const r = spawnSync(FFMPEG, ["-hide_banner", "-nostats", "-i", archivo, "-af", `silencedetect=noise=${umbral}dB:d=${minimo}`, "-vn", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1 << 28 });
  const silencios: Tramo[] = [];
  let inicio: number | null = null;
  for (const linea of r.stderr.split(/\r?\n/)) {
    const a = linea.match(/silence_start: (-?[\d.]+)/);
    if (a) inicio = Math.max(0, Number(a[1]));
    const b = linea.match(/silence_end: ([\d.]+)/);
    if (b && inicio !== null) silencios.push({ desde: inicio, hasta: Number(b[1])}), (inicio = null);
  }
  if (inicio !== null) silencios.push({ desde: inicio, hasta: Infinity });
  return silencios;
}

function tramosConVoz(duracion: number, silencios: Tramo[], margen: number): Tramo[] {
  const tramos: Tramo[] = [];
  let cursor = 0;
  for (const s of silencios) {
    const fin = Math.min(duracion, s.desde + margen);
    if (fin - cursor > 0.1) tramos.push({ desde: cursor, hasta: fin });
    cursor = Math.max(cursor, Math.min(duracion, s.hasta - margen));
  }
  if (duracion - cursor > 0.1) tramos.push({ desde: cursor, hasta: duracion });
  return tramos;
}

function cortarSilencios(entrada: string, salida: string, inf: Info) {
  const base = [...(inf.tieneAudio ? [] : ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"])];
  if (!inf.tieneAudio || opts["sin-cortar"]) {
    console.log(inf.tieneAudio ? "· No corto silencios (--sin-cortar)" : "· El video no tiene audio: no hay silencios que cortar");
    correr(FFMPEG, ["-y", "-i", entrada, ...base, "-vf", `fps=${FPS}`, "-shortest", ...CODIFICAR, salida]);
    return { antes: inf.duracion, despues: inf.duracion, cortes: 0 };
  }
  const silencios = detectarSilencios(entrada, num("umbral", -35), num("min-silencio", 0.5));
  const tramos = tramosConVoz(inf.duracion, silencios, num("margen", 0.15));
  if (tramos.length === 0) throw new Error("Todo el audio quedó por debajo del umbral. Probá con --umbral -45");

  const partes = tramos.map((t, i) =>
    `[0:v]trim=start=${t.desde.toFixed(3)}:end=${t.hasta.toFixed(3)},setpts=PTS-STARTPTS[v${i}];` +
    `[0:a]atrim=start=${t.desde.toFixed(3)}:end=${t.hasta.toFixed(3)},asetpts=PTS-STARTPTS[a${i}];`,
  );
  const concat = tramos.map((_, i) => `[v${i}][a${i}]`).join("") + `concat=n=${tramos.length}:v=1:a=1[vc][ac];[vc]fps=${FPS}[v]`;
  const script = path.join(path.dirname(salida), "cortes.filtro");
  fs.writeFileSync(script, partes.join("\n") + "\n" + concat);
  correr(FFMPEG, ["-y", "-i", entrada, "-/filter_complex", script, "-map", "[v]", "-map", "[ac]", ...CODIFICAR, salida]);

  const despues = tramos.reduce((s, t) => s + t.hasta - t.desde, 0);
  return { antes: inf.duracion, despues, cortes: tramos.length - 1 };
}

// ---------- 2. transcripción ----------
type Modelo = Parameters<typeof transcribe>[0]["model"];

async function transcribir(video: string, dir: string): Promise<Caption[]> {
  const wav = path.join(dir, "audio-16k.wav");
  correr(FFMPEG, ["-y", "-i", video, "-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav]);
  const modelo = (str("modelo") ?? "medium") as Modelo;
  await downloadWhisperModel({ model: modelo, folder: WHISPER });
  let ultimo = -1;
  const out = await transcribe({
    inputPath: wav,
    whisperPath: WHISPER,
    whisperCppVersion: WHISPER_VERSION,
    model: modelo,
    language: "es",
    tokenLevelTimestamps: true,
    splitOnWord: true,
    additionalArgs: str("vocabulario") ? [["--prompt", str("vocabulario")!]] : [],
    onProgress: (p) => {
      const pct = Math.floor(p * 10) * 10;
      if (pct !== ultimo) (ultimo = pct), process.stdout.write(`  transcribiendo ${pct}%\r`);
    },
  });
  fs.rmSync(wav, { force: true });
  const { captions } = toCaptions({ whisperCppOutput: out });
  // whisper a veces deja tokens vacíos o marcas tipo [MÚSICA]
  return captions.filter((c) => c.text.trim() && !/^\s*[[(].*[\])]\s*$/.test(c.text));
}

type Frase = { desde: number; hasta: number; texto: string };
function frases(captions: Caption[]): Frase[] {
  const out: Frase[] = [];
  let actual: Caption[] = [];
  const cerrar = () => {
    if (!actual.length) return;
    out.push({ desde: actual[0].startMs / 1000, hasta: actual[actual.length - 1].endMs / 1000, texto: actual.map((c) => c.text).join("").trim() });
    actual = [];
  };
  captions.forEach((c, i) => {
    actual.push(c);
    const sig = captions[i + 1];
    if (/[.?!…]\s*$/.test(c.text) || (sig && sig.startMs - c.endMs > 900)) cerrar();
  });
  cerrar();
  return out;
}

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${(s % 60).toFixed(1).padStart(4, "0")}`;

// ---------- 3. tramo para el Reel ----------
function elegirTramo(fr: Frase[], duracion: number, cierre: number): Tramo {
  const min = 30 - cierre;
  const max = 60 - cierre;
  if (duracion <= max) return { desde: 0, hasta: duracion };
  let mejor: (Tramo & { puntaje: number }) | null = null;
  for (let i = 0; i < fr.length; i++) {
    for (let j = i; j < fr.length; j++) {
      const d = fr[j].hasta - fr[i].desde;
      if (d > max) break;
      if (d < min) continue;
      // cerca de 45 s en total, y si empata el que arranca antes
      const puntaje = -Math.abs(d + cierre - 45);
      if (!mejor || puntaje > mejor.puntaje) mejor = { desde: fr[i].desde, hasta: fr[j].hasta, puntaje };
    }
  }
  if (mejor) return { desde: Math.max(0, mejor.desde - 0.1), hasta: Math.min(duracion, mejor.hasta + 0.3) };
  return { desde: 0, hasta: Math.min(duracion, max) };
}

// ---------- logo / marca ----------
type Marca = { carpeta: string; logo: string; variantes?: [string, string][]; colores?: [string, string, string][] };
const luminancia = (hex: string) => {
  const n = parseInt(hex.replace("#", ""), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
};

function cierre(): { logo: string; fondo: string } {
  const marcaNombre = str("marca");
  let logo = path.join(REPO, "public", "brand", "logo-horizontal-blanco.png");
  let fondo = "#111111";
  if (marcaNombre) {
    const marcas: Marca[] = JSON.parse(fs.readFileSync(path.join(REPO, "marcas", "marcas.json"), "utf8"));
    const m = marcas.find((x) => x.carpeta.toLowerCase() === marcaNombre.toLowerCase());
    if (!m) throw new Error(`No existe la marca "${marcaNombre}". Hay: ${marcas.map((x) => x.carpeta).join(", ")}`);
    const dir = path.join(REPO, "marcas", m.carpeta);
    const colores = (m.colores ?? []).map((c) => c[0]);
    const blanco = m.variantes?.find(([f]) => /blanco/i.test(f))?.[0];
    if (blanco && fs.existsSync(path.join(dir, blanco))) {
      logo = path.join(dir, blanco);
      fondo = colores.filter((c) => luminancia(c) < 0.35).sort((a, b) => luminancia(a) - luminancia(b))[0] ?? "#111111";
    } else {
      logo = path.join(dir, m.logo);
      fondo = colores.filter((c) => luminancia(c) > 0.8).sort((a, b) => luminancia(b) - luminancia(a))[0] ?? "#ffffff";
    }
  }
  if (str("logo")) logo = path.resolve(str("logo")!);
  if (str("fondo")) fondo = str("fondo")!;
  if (!fs.existsSync(logo)) throw new Error(`No encuentro el logo: ${logo}`);
  return { logo, fondo };
}

// ---------- persona recortada (para poner texto detrás) ----------
// Recorta a la persona (con lo que tenga en la mano) en los tramos pedidos con el modelo local de HyperFrames.
// ~0,65 s por cuadro en esta PC: pedir solo los tramos donde hay texto detrás.
function persona(nombre: string, tramos: string[]) {
  const dir = path.join(TRABAJO, nombre);
  const limpio = path.join(dir, "limpio.mp4");
  if (!fs.existsSync(limpio)) throw new Error(`Primero: pnpm editar preparar (no existe trabajo/${nombre})`);
  for (const t of tramos) {
    const m = t.match(/^([\d.]+)-([\d.]+)$/);
    if (!m) throw new Error(`Tramo inválido "${t}" (formato: 6.6-12.5)`);
    const base = path.join(dir, `persona-${m[1]}-${m[2]}`);
    correr(FFMPEG, ["-y", "-ss", m[1], "-i", limpio, "-t", (Number(m[2]) - Number(m[1])).toFixed(3), "-an", "-vf", `fps=${FPS}`, "-c:v", "libx264", "-crf", "14", "-pix_fmt", "yuv420p", `${base}.mp4`]);
    console.log(`  recortando ${m[1]}–${m[2]} s…`);
    const r = spawnSync(`pnpm exec hyperframes remove-background "${base}.mp4" -o "${base}.webm" --quality best`, { cwd: RAIZ, shell: true, encoding: "utf8", env: { ...process.env, PATH: `${path.dirname(FFMPEG)}${path.delimiter}${process.env.PATH}` } });
    if (r.status !== 0 || !fs.existsSync(`${base}.webm`)) throw new Error(`Falló el recorte de ${t}: ${r.stderr?.slice(-500)}`);
    fs.rmSync(`${base}.mp4`);
    console.log(`  { "tipo": "persona", "desde": ${m[1]}, "hasta": ${m[2]}, "src": "${path.basename(base)}.webm" }`);
  }
}

// ---------- efectos gráficos ----------
// El JSON tiene { colores?: {marca, fuerte, texto}, efectos: [...] } con tiempos del video ya preparado
// (los de captions.json); acá se corren al tramo y los planos de apoyo se copian a public/.
type EfectoJson = { tipo: string; desde?: number; hasta?: number; en?: number; src?: string };
function efectos(archivo: string | undefined, tramo: Tramo, pub: string, id: string) {
  if (!archivo) return {};
  const j: { colores?: unknown; efectos: EfectoJson[] } = JSON.parse(fs.readFileSync(path.resolve(archivo), "utf8"));
  const dentro = j.efectos.filter((e) => (e.en ?? e.hasta ?? 0) > tramo.desde && (e.en ?? e.desde ?? 0) < tramo.hasta);
  const lista = dentro.map((e, i) => {
    const r: EfectoJson = { ...e };
    for (const k of ["desde", "hasta", "en"] as const) if (r[k] !== undefined) r[k] = Math.max(0, r[k]! - tramo.desde);
    if (r.src) {
      const origen = path.resolve(path.dirname(path.resolve(archivo)), r.src);
      if (!fs.existsSync(origen)) throw new Error(`No existe el plano de apoyo ${origen}`);
      fs.copyFileSync(origen, path.join(pub, `apoyo-${i}${path.extname(origen)}`));
      r.src = `trabajo/${id}/apoyo-${i}${path.extname(origen)}`;
    }
    return r;
  });
  console.log(`  ${lista.length} efectos gráficos`);
  return { efectos: lista, ...(j.colores ? { colores: j.colores } : {}) };
}

// ---------- comandos ----------
// Realce suave: un poco más de contraste y saturación, y algo de nitidez (los celulares graban algo lavado).
const COLOR = "eq=contrast=1.07:saturation=1.22:brightness=0.012:gamma=0.98,unsharp=5:5:0.45";
// Voz: corta graves de ambiente, saca el ruido de fondo constante (aire, heladeras, música baja),
// empareja el volumen de la voz y le da presencia.
const VOZ = "highpass=f=85,lowpass=f=14000,afftdn=nf=-28:tn=1,acompressor=threshold=-21dB:ratio=3:attack=8:release=120:makeup=2,equalizer=f=3000:t=q:w=1.2:g=2.5,equalizer=f=250:t=q:w=1:g=-2";

function unir(nombre: string, partes: string[]) {
  if (!partes.length) throw new Error("Faltan las partes: ruta.mov:desde-hasta (o la ruta sola para usarlo entero)");
  const mejorar = !opts["sin-mejorar"];
  const entradas: string[] = [];
  const filtros: string[] = [];
  partes.forEach((p, i) => {
    const m = p.match(/^(.*):([\d.]+)-([\d.]+)(:mudo)?$/);
    const archivo = m ? m[1] : p;
    if (!fs.existsSync(archivo)) throw new Error(`No existe ${archivo}`);
    const sinAudio = !info(archivo).tieneAudio || !!m?.[4];
    entradas.push(...(m ? ["-ss", m[2], "-to", m[3]] : []), "-i", archivo);
    filtros.push(`[${i}:v]fps=${FPS},scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1${mejorar ? `,${COLOR}` : ""}[v${i}]`);
    filtros.push(sinAudio
      ? `anullsrc=r=48000:cl=stereo,atrim=duration=${m ? Number(m[3]) - Number(m[2]) : info(archivo).duracion}[a${i}]`
      : `[${i}:a]aresample=48000,aformat=channel_layouts=stereo[a${i}]`);
    console.log(`  ${i + 1}. ${path.basename(archivo)} ${m ? `${m[2]}–${m[3]} s` : "(entero)"}`);
  });
  const n = partes.length;
  filtros.push(partes.map((_, i) => `[v${i}][a${i}]`).join("") + `concat=n=${n}:v=1:a=1[v][ac]`);
  filtros.push(`[ac]${mejorar ? `${VOZ},` : ""}loudnorm=I=-14:TP=-1.5:LRA=11[a]`);
  fs.mkdirSync(TRABAJO, { recursive: true });
  const salida = path.join(TRABAJO, `${slug(nombre)}.mp4`);
  correr(FFMPEG, ["-y", ...entradas, "-filter_complex", filtros.join(";"), "-map", "[v]", "-map", "[a]", ...CODIFICAR, salida]);
  console.log(`\n✔ Unido: ${path.relative(RAIZ, salida)} (${mmss(info(salida).duracion)})\n  Siguiente: pnpm editar preparar ${path.relative(RAIZ, salida)}`);
}

const slug = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "video";

async function preparar(entrada: string) {
  if (!fs.existsSync(entrada)) throw new Error(`No existe ${entrada}`);
  const nombre = slug(path.parse(entrada).name);
  const dir = path.join(TRABAJO, nombre);
  fs.mkdirSync(dir, { recursive: true });
  const inf = info(entrada);
  console.log(`▶ ${path.basename(entrada)} — ${mmss(inf.duracion)}, ${inf.ancho}×${inf.alto}`);

  console.log("1/2 Cortando silencios…");
  const limpio = path.join(dir, "limpio.mp4");
  const c = cortarSilencios(entrada, limpio, inf);
  console.log(`    ${mmss(c.antes)} → ${mmss(c.despues)} (${c.cortes} cortes, −${(c.antes - c.despues).toFixed(1)} s)`);

  console.log("2/2 Transcribiendo (whisper.cpp, local)…");
  const captions = await transcribir(limpio, dir);
  const fr = frases(captions);
  fs.writeFileSync(path.join(dir, "captions.json"), JSON.stringify(captions, null, 1));
  fs.writeFileSync(path.join(dir, "transcripcion.txt"), fr.map((f) => `[${mmss(f.desde)} – ${mmss(f.hasta)}] ${f.texto}`).join("\n") + "\n");
  fs.writeFileSync(path.join(dir, "info.json"), JSON.stringify({ original: path.resolve(entrada), ...info(limpio), cortes: c }, null, 1));
  console.log(`\n✔ Listo: trabajo/${nombre}/  (limpio.mp4, transcripcion.txt, captions.json)`);
  return nombre;
}

function reel(nombre: string, tramoForzado?: Tramo) {
  const dir = path.join(TRABAJO, nombre);
  const limpio = path.join(dir, "limpio.mp4");
  if (!fs.existsSync(limpio)) throw new Error(`Primero: pnpm editar preparar <video>  (no existe trabajo/${nombre})`);
  const inf = info(limpio);
  const captions: Caption[] = JSON.parse(fs.readFileSync(path.join(dir, "captions.json"), "utf8"));
  const segCierre = num("cierre", 2.5);

  const tramo = tramoForzado ?? (str("desde") !== undefined || str("hasta") !== undefined
    ? { desde: num("desde", 0), hasta: Math.min(inf.duracion, num("hasta", inf.duracion)) }
    : elegirTramo(frases(captions), inf.duracion, segCierre));
  const dur = tramo.hasta - tramo.desde;
  if (dur <= 0) throw new Error("--hasta tiene que ser mayor que --desde");
  const total = dur + segCierre;
  if (total < 30 || total > 60) console.warn(`⚠ El Reel va a durar ${total.toFixed(1)} s (lo pedido es entre 30 y 60).`);

  const id = `${nombre}-${Math.round(tramo.desde)}-${Math.round(tramo.hasta)}`;
  const pub = path.join(PUBLICO, id);
  fs.mkdirSync(pub, { recursive: true });
  console.log(`▶ Reel de ${mmss(tramo.desde)} a ${mmss(tramo.hasta)} (${dur.toFixed(1)} s + ${segCierre} s de logo)`);
  // El encuadre vertical lo hace ffmpeg (mucho más rápido que desenfocar cada cuadro en Chrome);
  // Remotion después solo dibuja subtítulos y cierre encima.
  const encuadre = str("encuadre") ?? (inf.ancho > inf.alto ? "desenfoque" : "recorte");
  const vertical = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1";
  const filtro = encuadre === "desenfoque"
    ? `[0:v]fps=${FPS},split[a][b];[a]scale=270:480:force_original_aspect_ratio=increase,crop=270:480,boxblur=12:2,eq=brightness=-0.22,scale=1080:1920,setsar=1[fondo];[b]scale=1080:1920:force_original_aspect_ratio=decrease,setsar=1[frente];[fondo][frente]overlay=(W-w)/2:(H-h)/2[v]`
    : `[0:v]fps=${FPS},${vertical}[v]`;
  correr(FFMPEG, ["-y", "-ss", tramo.desde.toFixed(3), "-i", limpio, "-t", dur.toFixed(3), "-filter_complex", filtro, "-map", "[v]", "-map", "0:a?", ...CODIFICAR, path.join(pub, "clip.mp4")]);

  const { logo, fondo } = cierre();
  const extLogo = path.extname(logo);
  fs.copyFileSync(logo, path.join(pub, `logo${extLogo}`));

  const ms0 = tramo.desde * 1000;
  const subs = opts["sin-subtitulos"]
    ? []
    : captions
        .filter((c) => c.startMs >= ms0 - 50 && c.endMs <= tramo.hasta * 1000 + 250)
        .map((c) => ({
          ...c,
          startMs: Math.max(0, c.startMs - ms0),
          endMs: c.endMs - ms0,
          timestampMs: c.timestampMs === null ? null : c.timestampMs - ms0,
          // un subtítulo no mezcla el final de una frase con el arranque de la siguiente
          pageBreakAfter: /[.?!…]\s*$/.test(c.text),
        }));

  const props = {
    video: `trabajo/${id}/clip.mp4`,
    duracionClip: dur,
    captions: subs,
    logo: `trabajo/${id}/logo${extLogo}`,
    fondoCierre: fondo,
    colorResaltado: str("color") ?? "#ffd400",
    segundosCierre: segCierre,
    ...efectos(str("efectos"), tramo, pub, id),
  };
  const propsArchivo = path.join(pub, "props.json");
  fs.writeFileSync(propsArchivo, JSON.stringify(props));

  fs.mkdirSync(SALIDA, { recursive: true });
  const salida = path.join(SALIDA, str("salida") ?? `${id}-reel.mp4`);
  console.log("  Renderizando con Remotion…");
  const r = spawnSync(`pnpm exec remotion render src/index.ts Reel "${salida}" --props="${propsArchivo}" --log=warn`, { cwd: RAIZ, stdio: "inherit", shell: true });
  if (r.status !== 0) throw new Error("Falló el render de Remotion");
  console.log(`\n✔ Reel: ${path.relative(REPO, salida)}  (${total.toFixed(1)} s, 1080×1920)`);
  return salida;
}

try {
  if (comando === "preparar" && objetivo) await preparar(objetivo);
  else if (comando === "reel" && objetivo) reel(objetivo);
  else if (comando === "todo" && objetivo) reel(await preparar(objetivo));
  else if (comando === "persona" && objetivo) persona(objetivo, resto.filter((a) => !a.startsWith("--")));
  else if (comando === "unir" && objetivo) unir(objetivo, resto.filter((a, i) => !a.startsWith("--") && !(resto[i - 1]?.startsWith("--") && opts[resto[i - 1].slice(2)] === a)));
  else {
    console.log(fs.readFileSync(import.meta.filename, "utf8").split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n"));
    process.exit(comando ? 1 : 0);
  }
} catch (e) {
  console.error(`\n✖ ${(e as Error).message}`);
  process.exit(1);
}
