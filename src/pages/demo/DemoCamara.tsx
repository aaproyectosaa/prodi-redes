// Celular cámara: se escanea el QR una vez, se elige el número y queda prendido. Cuando la empresa empieza una demo,
// se suma solo; cuando termina, vuelve a esperar.
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Loader2, PlugZap, RefreshCw, SwitchCamera, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiDemo, pantallaPrendida, SalaDemo } from "@/lib/demoVivo";
import { FondoDemo, PildoraVivo, VideoVivo, useSala } from "@/components/demo/Comunes";

interface Config {
  cam: string;
  nombre: string;
}
const claveConfig = (token: string) => `prodi-demo-camara:${token.split(".")[0]}`;
function leerConfig(token: string): Config | null {
  try {
    const c = JSON.parse(localStorage.getItem(claveConfig(token)) ?? "null") as Config | null;
    return c?.cam && c.nombre ? c : null;
  } catch {
    return null;
  }
}

export default function DemoCamara() {
  const { token = "" } = useParams();
  const [config, setConfig] = useState<Config | null>(() => leerConfig(token));
  useEffect(() => {
    document.title = config ? `${config.nombre} · Demo en vivo` : "Cámara · Demo en vivo";
  }, [config]);
  if (!config) return <ElegirNombre onListo={(n) => {
    const c = { cam: Math.random().toString(36).slice(2, 12).replace(/[^a-z0-9]/g, "x").padEnd(8, "0"), nombre: n };
    try {
      localStorage.setItem(claveConfig(token), JSON.stringify(c));
    } catch {
      /* sin guardar: se vuelve a elegir la próxima vez */
    }
    setConfig(c);
  }} />;
  const olvidar = () => {
    try {
      localStorage.removeItem(claveConfig(token));
    } catch {
      /* nada */
    }
    setConfig(null);
  };
  return <Camara token={token} config={config} onCambiarNombre={() => setConfig(null)} onQuitada={olvidar} />;
}

function ElegirNombre({ onListo }: { onListo: (n: string) => void }) {
  return (
    <FondoDemo>
      <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-8 px-5 py-10">
        <div className="space-y-3">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 shadow-lg shadow-violet-600/30">
            <Video className="h-7 w-7" />
          </span>
          <h1 className="text-3xl font-bold tracking-tight">¿Qué cámara es este celular?</h1>
          <p className="text-white/60">Elegilo una sola vez. Después, cada vez que lo abras, se conecta solo.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((n) => (
            <motion.button
              key={n}
              type="button"
              whileTap={{ scale: 0.96 }}
              onClick={() => onListo(`Cámara ${n}`)}
              className="flex h-28 flex-col items-center justify-center gap-1 rounded-3xl bg-white/[0.06] ring-1 ring-white/10 transition hover:bg-white/10"
            >
              <span className="text-4xl font-bold">{n}</span>
              <span className="text-xs text-white/50">Cámara</span>
            </motion.button>
          ))}
        </div>
      </main>
    </FondoDemo>
  );
}

type Fase = "permiso" | "esperando" | "vivo" | "error";

function Camara({ token, config, onCambiarNombre, onQuitada }: { token: string; config: Config; onCambiarNombre: () => void; onQuitada: () => void }) {
  const [frente, setFrente] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [fase, setFase] = useState<Fase>("permiso");
  const [error, setError] = useState<string | null>(null);
  const [empresa, setEmpresa] = useState("");
  const [titulo, setTitulo] = useState("");
  const [sala, setSala] = useState<SalaDemo | null>(null);
  const salaRef = useRef<SalaDemo | null>(null);
  const quitadaRef = useRef(onQuitada);
  quitadaRef.current = onQuitada;
  useSala(sala);

  const prender = async (deFrente = frente) => {
    setError(null);
    try {
      stream?.getTracks().forEach((t) => t.stop());
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: deFrente ? "user" : { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
        audio: false,
      });
      setStream(s);
      setFrente(deFrente);
      setFase((f) => (f === "permiso" || f === "error" ? "esperando" : f));
      salaRef.current?.cambiarLocal(s);
    } catch {
      setFase("error");
      setError("No pudimos usar la cámara. Revisá que el navegador tenga permiso para usarla.");
    }
  };

  // Si ya dio permiso antes, se prende sola.
  useEffect(() => {
    const permisos = navigator.permissions as Permissions | undefined;
    permisos
      ?.query({ name: "camera" as PermissionName })
      .then((p) => p.state === "granted" && void prender(false))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pantalla siempre prendida.
  useEffect(() => {
    if (!stream) return;
    let soltar: (() => void) | undefined;
    void pantallaPrendida().then((f) => (soltar = f));
    return () => soltar?.();
  }, [stream]);

  // Avisa que está prendida y se suma a la demo en vivo cuando empieza.
  useEffect(() => {
    if (!stream) return;
    let vivo = true;
    let t = 0;
    const revisar = async () => {
      if (!vivo) return;
      const actual = salaRef.current;
      if (actual && actual.estado !== "terminada" && !actual.fuera) {
        t = window.setTimeout(revisar, 3000);
        return;
      }
      if (actual) {
        void actual.salir();
        salaRef.current = null;
        setSala(null);
        setFase("esperando");
      }
      try {
        const r = await apiDemo<{ empresa: string; demo: { d: string; pid: string; llave: string; titulo: string } | null }>("demo-camara", { c: token, cam: config.cam, nombre: config.nombre });
        setEmpresa(r.empresa);
        if (r.demo && vivo) {
          const s = new SalaDemo({ d: r.demo.d, pid: r.demo.pid, llave: r.demo.llave }, "camara", stream);
          s.iniciar();
          salaRef.current = s;
          setSala(s);
          setTitulo(r.demo.titulo);
          setFase("vivo");
        }
        setError(null);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Sin conexión";
        // La quitaron desde el panel: se apaga y vuelve a elegir número (por si la quieren sumar de nuevo).
        if (/se quitó/.test(msg)) {
          vivo = false;
          stream.getTracks().forEach((tr) => tr.stop());
          alert("Quitaron esta cámara desde el panel. Si la querés volver a usar, elegí el número de nuevo.");
          quitadaRef.current();
          return;
        }
        setError(msg);
      }
      t = window.setTimeout(revisar, 3000);
    };
    void revisar();
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [stream, token, config]);

  useEffect(
    () => () => {
      void salaRef.current?.salir();
      stream?.getTracks().forEach((t) => t.stop());
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  if (fase === "permiso" || (fase === "error" && !stream)) {
    return (
      <FondoDemo>
        <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-5 text-center">
          <span className="mx-auto flex h-20 w-20 items-center justify-center rounded-[1.75rem] bg-gradient-to-br from-violet-500 to-fuchsia-500 text-3xl font-bold shadow-xl shadow-violet-600/30">
            {config.nombre.replace(/\D/g, "") || <Video className="h-9 w-9" />}
          </span>
          <div>
            <h1 className="text-2xl font-bold">{config.nombre}</h1>
            <p className="mt-2 text-white/60">{error ?? "Tocá para prender la cámara. El celular te va a pedir permiso."}</p>
          </div>
          <button type="button" onClick={() => void prender(false)} className="h-14 rounded-2xl bg-gradient-to-r from-violet-600 to-fuchsia-500 text-base font-semibold shadow-xl shadow-violet-600/30">
            Prender cámara
          </button>
          <button type="button" onClick={onCambiarNombre} className="text-sm text-white/50 underline-offset-4 hover:underline">
            No es {config.nombre}
          </button>
        </main>
      </FondoDemo>
    );
  }

  const mirando = sala ? sala.participantes.filter((p) => p.tipo !== "camara").length : 0;
  return (
    <div className="fixed inset-0 bg-black text-white">
      <VideoVivo stream={stream} contain={false} espejo={frente} />
      {/* Estado arriba */}
      <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/80 to-transparent px-4 pb-10 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/15 text-lg font-bold backdrop-blur">{config.nombre.replace(/\D/g, "") || "•"}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{config.nombre}</p>
            <p className="truncate text-xs text-white/60">{empresa}</p>
          </div>
          {fase === "vivo" ? <PildoraVivo /> : (
            <span className="flex items-center gap-1.5 rounded-full bg-amber-400/20 px-2.5 py-1 text-[11px] font-semibold text-amber-200">
              <span className="h-2 w-2 animate-pulse rounded-full bg-amber-300" /> Lista
            </span>
          )}
        </div>
      </div>
      {/* Abajo */}
      <div className="absolute inset-x-0 bottom-0 space-y-3 bg-gradient-to-t from-black/85 to-transparent px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-14">
        <div className="rounded-2xl bg-black/40 px-4 py-3 backdrop-blur">
          {fase === "vivo" ? (
            <>
              <p className="font-semibold">{titulo}</p>
              <p className="text-sm text-white/60">{mirando === 0 ? "Conectando…" : `La están mirando ${mirando} ${mirando === 1 ? "persona" : "personas"}`}</p>
            </>
          ) : (
            <>
              <p className="font-semibold">Esperando que empiece una demo</p>
              <p className="text-sm text-white/60">Dejala así, enchufada. Cuando empiece, se conecta sola.</p>
            </>
          )}
          {error && <p className="mt-1 text-xs text-red-300">{error}</p>}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void prender(!frente)} className="flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-white/15 text-sm font-semibold backdrop-blur hover:bg-white/20">
            <SwitchCamera className="h-[18px] w-[18px]" /> Dar vuelta
          </button>
          <button type="button" onClick={() => location.reload()} aria-label="Reconectar" className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 backdrop-blur hover:bg-white/20">
            <RefreshCw className="h-[18px] w-[18px]" />
          </button>
        </div>
        <p className={cn("flex items-center justify-center gap-1.5 text-center text-[11px] text-white/45")}>
          <PlugZap className="h-3.5 w-3.5" /> Con el cargador puesto y la pantalla prendida
        </p>
      </div>
      {!stream && <Loader2 className="absolute inset-0 m-auto h-8 w-8 animate-spin" />}
    </div>
  );
}
