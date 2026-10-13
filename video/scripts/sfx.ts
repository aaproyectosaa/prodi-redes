// Efectos de sonido sintetizados con ffmpeg (sin descargas ni créditos).
//
//   pnpm sfx crear                         genera la biblioteca en video/sfx/*.wav
//   pnpm sfx mezclar <voz> <cues.json> <salida.m4a> [--duracion 35.5]
//        cues.json = [["whoosh", 8.95], ["golpe", 10.75, -4], ...]  (nombre, segundo, dB opcional)
//        mezcla la voz con los efectos (los efectos van ~10 dB por debajo de la voz) y normaliza a -14 LUFS

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(import.meta.dirname, "..");
const DIR = path.join(RAIZ, "sfx");

function ffmpeg(args: string[]) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
}

// Cada efecto: [duración en s, expresión aevalsrc (estéreo con "|"), filtros extra]
const LIBRERIA: Record<string, [number, string, string]> = {
  // aire que pasa: ruido con envolvente lenta de entrada y caída rápida, barrido por el phaser
  whoosh: [0.7, "(random(0)*2-1)*pow(sin(PI*t/0.7),3)*(0.6+0.4*sin(2*PI*3*t))", "lowpass=f=2400,highpass=f=180,aphaser=type=t:speed=2:decay=0.6,volume=1.6"],
  "whoosh-corto": [0.35, "(random(0)*2-1)*pow(sin(PI*t/0.35),2)", "bandpass=f=1800:w=1600,volume=1.4"],
  // golpe grave: seno que cae de 60 a 30 Hz + chasquido de ruido
  golpe: [1.4, "0.9*sin(2*PI*(62-22*t)*t)*exp(-3.2*t)+0.5*(random(0)*2-1)*exp(-28*t)", "lowpass=f=900,aecho=0.6:0.5:60|120:0.35|0.2,volume=1.8"],
  "golpe-suave": [0.6, "0.8*sin(2*PI*(110-50*t)*t)*exp(-7*t)+0.25*(random(0)*2-1)*exp(-40*t)", "lowpass=f=1600,volume=1.3"],
  // glitch digital: ráfagas entrecortadas y bit-crush
  glitch: [0.45, "(random(0)*2-1)*gt(sin(2*PI*23*t),0.2)*(0.6+0.4*gt(sin(2*PI*61*t),0))", "highpass=f=400,acrusher=bits=5:samples=12:mix=0.9,volume=0.9"],
  // zumbido de tubo de neón
  neon: [0.6, "0.4*(sin(2*PI*120*t)+0.5*sin(2*PI*240*t)+0.3*sin(2*PI*360*t))*gt(sin(2*PI*14*t),-0.6)*exp(-1.5*t)", "highpass=f=90,volume=0.9"],
  // subida holográfica: barrido ascendente + brillo
  subida: [1.6, "0.35*sin(2*PI*(180*t+260*t*t))*pow(t/1.6,2)+0.25*(random(0)*2-1)*pow(t/1.6,3)", "highpass=f=120,aecho=0.7:0.6:80|160:0.3|0.2,volume=1.5"],
  brillo: [1.2, "0.25*(sin(2*PI*1568*t)+sin(2*PI*2093*t)+0.6*sin(2*PI*3136*t))*exp(-3*t)*(0.7+0.3*sin(2*PI*9*t))", "aecho=0.8:0.7:90|180:0.4|0.25,volume=0.9"],
  pop: [0.16, "sin(2*PI*(950-2400*t)*t)*exp(-28*t)", "volume=1.2"],
  clic: [0.05, "(random(0)*2-1)*exp(-160*t)+0.6*sin(2*PI*2400*t)*exp(-120*t)", "highpass=f=900,volume=1.1"],
  ding: [1.0, "0.45*(sin(2*PI*1319*t)+0.7*sin(2*PI*1976*t))*exp(-4*t)", "aecho=0.8:0.6:70:0.3,volume=1.0"],
  monedas: [0.8, "0.35*(sin(2*PI*2637*t)*exp(-14*t)+between(t,0.09,1)*sin(2*PI*3136*(t-0.09))*exp(-12*(t-0.09))+between(t,0.18,1)*sin(2*PI*3951*(t-0.18))*exp(-9*(t-0.18)))", "aecho=0.7:0.5:40:0.3,volume=1.1"],
};

function crear() {
  fs.mkdirSync(DIR, { recursive: true });
  for (const [nombre, [dur, expr, filtros]] of Object.entries(LIBRERIA)) {
    // leve diferencia entre canales para que suene más abierto
    const der = expr.replaceAll("random(0)", "random(1)");
    const crudo = path.join(DIR, `_${nombre}.wav`);
    ffmpeg(["-f", "lavfi", "-i", `aevalsrc=exprs='${expr}|${der}':s=48000:d=${dur}`, "-af", `${filtros},afade=t=out:st=${Math.max(0, dur - 0.05)}:d=0.05`, crudo]);
    // todos al mismo pico (-3 dBFS) para que la mezcla se controle solo con el dB de cada cue
    const det = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", crudo, "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" }).stderr;
    const pico = Number(det.match(/max_volume: (-?[\d.]+) dB/)?.[1] ?? 0);
    ffmpeg(["-i", crudo, "-af", `volume=${(-3 - pico).toFixed(1)}dB,alimiter=limit=0.75`, path.join(DIR, `${nombre}.wav`)]);
    fs.rmSync(crudo);
    console.log(`  ${nombre}.wav`);
  }
  console.log(`✔ ${Object.keys(LIBRERIA).length} efectos en video/sfx/`);
}

function mezclar(voz: string, cuesArchivo: string, salida: string, duracion?: number) {
  if (!fs.existsSync(path.join(DIR, "whoosh.wav"))) crear();
  const cues: [string, number, number?][] = JSON.parse(fs.readFileSync(cuesArchivo, "utf8"));
  const entradas = ["-i", voz];
  const filtros: string[] = [];
  cues.forEach(([nombre, t, db = 0], i) => {
    const f = path.join(DIR, `${nombre}.wav`);
    if (!fs.existsSync(f)) throw new Error(`No existe el efecto "${nombre}"`);
    entradas.push("-i", f);
    const ms = Math.round(t * 1000);
    filtros.push(`[${i + 1}:a]adelay=${ms}|${ms},volume=${(-10 + db).toFixed(1)}dB[s${i}]`);
  });
  const todos = cues.map((_, i) => `[s${i}]`).join("");
  filtros.push(`[0:a]aresample=48000,aformat=channel_layouts=stereo[v]`);
  filtros.push(`${todos}amix=inputs=${cues.length}:normalize=0[fx]`);
  filtros.push(`[v][fx]amix=inputs=2:normalize=0,${duracion ? `apad=whole_dur=${duracion},atrim=0:${duracion},` : ""}loudnorm=I=-14:TP=-1.5[out]`);
  ffmpeg([...entradas, "-filter_complex", filtros.join(";"), "-map", "[out]", "-ar", "48000", "-c:a", "aac", "-b:a", "192k", salida]);
  console.log(`✔ Mezcla: ${salida} (${cues.length} efectos)`);
}

const [cmd, ...a] = process.argv.slice(2);
const dIdx = a.indexOf("--duracion");
const dur = dIdx >= 0 ? Number(a[dIdx + 1]) : undefined;
if (cmd === "crear") crear();
else if (cmd === "mezclar" && a.length >= 3) mezclar(a[0], a[1], a[2], dur);
else console.log(fs.readFileSync(import.meta.filename, "utf8").split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n"));
