// Sonido de aviso de Prodi: un arpegio corto y cálido (tres notas que suben, con una cola suave),
// sintetizado con Web Audio (sin archivos). Suena solo con la pestaña a la vista y si está activado.
// Los navegadores no dejan sonar nada hasta que la persona toca la página: el contexto se
// "desbloquea" con el primer toque o tecla (prepararSonido). Nunca tira errores.

const CLAVE = "prodi:sonido-avisos";
/** Entre dos sonidos, al menos esto (si llegan varios avisos juntos, suena una vez). */
const PAUSA_MS = 3000;

let ctx: AudioContext | null = null;
let ultimo = 0;
let preparado = false;

export function sonidoActivo(): boolean {
  try {
    return localStorage.getItem(CLAVE) !== "0";
  } catch {
    return true;
  }
}

export function setSonidoActivo(v: boolean) {
  try {
    localStorage.setItem(CLAVE, v ? "1" : "0");
  } catch {
    /* sin almacenamiento: queda el default */
  }
}

function contexto(): AudioContext | null {
  try {
    if (ctx) return ctx;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    return ctx;
  } catch {
    return null;
  }
}

/** Desbloquea el audio con la primera interacción (llamar una vez al arrancar la app). */
export function prepararSonido() {
  if (preparado || typeof window === "undefined") return;
  preparado = true;
  const desbloquear = () => {
    const c = contexto();
    if (c && c.state === "suspended") void c.resume().catch(() => undefined);
    window.removeEventListener("pointerdown", desbloquear);
    window.removeEventListener("keydown", desbloquear);
  };
  window.addEventListener("pointerdown", desbloquear, { passive: true });
  window.addEventListener("keydown", desbloquear);
}

/** Una nota: seno + triángulo apenas desafinado, ataque suave y caída exponencial. */
function nota(c: AudioContext, destino: AudioNode, frec: number, t0: number, dur: number, vol: number) {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.018);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  g.connect(destino);
  const tipos: [OscillatorType, number, number][] = [
    ["sine", 0, 1],
    ["triangle", 6, 0.35],
  ];
  for (const [tipo, cents, nivel] of tipos) {
    const o = c.createOscillator();
    const og = c.createGain();
    o.type = tipo;
    o.frequency.setValueAtTime(frec, t0);
    o.detune.setValueAtTime(cents, t0);
    og.gain.value = nivel;
    o.connect(og).connect(g);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }
}

/** El sonido de Prodi (≈0,9 s). No suena si está apagado, si la pestaña no está a la vista o si sonó hace un instante. */
export function sonarProdi(opts: { forzar?: boolean } = {}) {
  try {
    if (!opts.forzar && (!sonidoActivo() || document.visibilityState !== "visible")) return;
    const ahora = Date.now();
    if (!opts.forzar && ahora - ultimo < PAUSA_MS) return;
    ultimo = ahora;
    const c = contexto();
    if (!c) return;
    if (c.state === "suspended") void c.resume().catch(() => undefined);
    if (c.state === "closed") return;

    const t = c.currentTime + 0.02;
    const salida = c.createGain();
    salida.gain.value = 0.16; // bajito
    // Filtro tibio: saca el brillo metálico.
    const filtro = c.createBiquadFilter();
    filtro.type = "lowpass";
    filtro.frequency.value = 3200;
    filtro.connect(salida).connect(c.destination);
    // "Reverb" casera: dos ecos cortos y suaves para la cola.
    const eco = c.createDelay(0.5);
    eco.delayTime.value = 0.11;
    const ecoVol = c.createGain();
    ecoVol.gain.value = 0.22;
    eco.connect(ecoVol).connect(filtro);
    ecoVol.connect(eco);

    const mezcla = c.createGain();
    mezcla.connect(filtro);
    mezcla.connect(eco);

    // Re mayor con novena: D5 · F#5 · A5, y una E6 muy suave encima de la última (la firma).
    nota(c, mezcla, 587.33, t, 0.42, 0.55);
    nota(c, mezcla, 739.99, t + 0.09, 0.42, 0.5);
    nota(c, mezcla, 880.0, t + 0.18, 0.7, 0.55);
    nota(c, mezcla, 1318.51, t + 0.2, 0.55, 0.12);
    // Se corta la cola de ecos para no dejar nodos colgados.
    window.setTimeout(() => {
      try {
        ecoVol.disconnect();
        salida.disconnect();
      } catch {
        /* nada */
      }
    }, 1100);
  } catch {
    /* nunca rompe la app por un sonido */
  }
}
