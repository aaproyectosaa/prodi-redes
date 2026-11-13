// Lo que ve el lead: entra con el link (WhatsApp o donde sea), pone su nombre y mira la demo en vivo.
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Flame, Hand, LayoutGrid, Loader2, MessageCircle, Mic, MicOff, Square, SwitchCamera, Video, VideoOff, Volume2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiDemo, SalaDemo, type EstadoDemo } from "@/lib/demoVivo";
import { AudioVivo, ChatDemo, Circulo, SonidoRemoto, FondoDemo, PildoraVivo, VideoVivo, fechaDemo, tieneVideo, useSala } from "@/components/demo/Comunes";

interface Info {
  titulo: string;
  fecha: string | null;
  estado: EstadoDemo;
  empresa: string;
}

const CLAVE_NOMBRE = "prodi-demo-nombre";
const CLAVE_MAIL = "prodi-demo-mail";
const mailOk = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());

export default function DemoLead() {
  const { token = "" } = useParams();
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nombre, setNombre] = useState(() => {
    try {
      return localStorage.getItem(CLAVE_NOMBRE) ?? "";
    } catch {
      return "";
    }
  });
  const [email, setEmail] = useState(() => {
    try {
      return localStorage.getItem(CLAVE_MAIL) ?? "";
    } catch {
      return "";
    }
  });
  const [entrando, setEntrando] = useState(false);
  const [sala, setSala] = useState<SalaDemo | null>(null);

  useEffect(() => {
    document.title = "Demo en vivo";
    apiDemo<Info>("demo-ver", { t: token })
      .then(setInfo)
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo abrir la demo"));
  }, [token]);

  useEffect(() => {
    if (!sala) return;
    const salir = () => void sala.salir();
    window.addEventListener("pagehide", salir);
    return () => {
      window.removeEventListener("pagehide", salir);
      salir();
    };
  }, [sala]);

  const entrar = async (e: FormEvent) => {
    e.preventDefault();
    const n = nombre.trim();
    if (!n || !mailOk(email)) return;
    setEntrando(true);
    try {
      localStorage.setItem(CLAVE_NOMBRE, n);
      localStorage.setItem(CLAVE_MAIL, email.trim());
    } catch {
      /* sin guardar */
    }
    try {
      const r = await apiDemo<{ d: string; pid: string; llave: string; estado: EstadoDemo }>("demo-entrar", { t: token, nombre: n, email: email.trim() });
      const s = new SalaDemo({ d: r.d, pid: r.pid, llave: r.llave }, "lead", null);
      s.estado = r.estado;
      s.iniciar();
      setSala(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo entrar");
    } finally {
      setEntrando(false);
    }
  };

  if (sala && info) return <Sala sala={sala} info={info} />;

  return (
    <FondoDemo>
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
        {!info && !error && <Loader2 className="mx-auto h-8 w-8 animate-spin text-white/50" />}
        {error && (
          <div className="rounded-3xl border border-white/10 bg-white/5 p-8 text-center backdrop-blur">
            <p className="text-lg font-semibold">{error}</p>
            <p className="mt-2 text-sm text-white/50">Pedile el link de nuevo a quien te invitó.</p>
          </div>
        )}
        {info && !error && (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-lg font-bold shadow-lg shadow-violet-600/30">
                  {info.empresa.slice(0, 1).toUpperCase()}
                </span>
                <div>
                  <p className="text-sm text-white/50">Te invita</p>
                  <p className="font-semibold">{info.empresa}</p>
                </div>
              </div>
              {info.estado === "en_vivo" ? <PildoraVivo /> : info.estado === "programada" && info.fecha ? (
                <span className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/80">Empieza {fechaDemo(info.fecha)}</span>
              ) : null}
              <h1 className="text-[2rem] font-bold leading-[1.1] tracking-tight">{info.titulo}</h1>
              <p className="text-white/60">Una demostración en vivo, con cámaras en la máquina. Mirala desde el celular o la compu, sin instalar nada.</p>
            </div>
            {info.estado === "terminada" ? (
              <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-center">
                <p className="font-semibold">Esta demo ya terminó</p>
                <p className="mt-1 text-sm text-white/50">Si querés otra, escribile a {info.empresa}.</p>
              </div>
            ) : (
              <form onSubmit={entrar} className="space-y-3">
                <input
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  placeholder="Tu nombre y empresa"
                  autoComplete="name"
                  maxLength={60}
                  className="h-14 w-full rounded-2xl border border-white/10 bg-white/5 px-5 text-[16px] placeholder:text-white/35 focus:border-violet-400 focus:outline-none"
                />
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Tu mail"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  maxLength={120}
                  className="h-14 w-full rounded-2xl border border-white/10 bg-white/5 px-5 text-[16px] placeholder:text-white/35 focus:border-violet-400 focus:outline-none"
                />
                <p className="px-1 text-xs text-white/45">Al terminar te mandamos el resumen de la demo a tu mail.</p>
                <button
                  type="submit"
                  disabled={!nombre.trim() || !mailOk(email) || entrando}
                  className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-violet-600 to-fuchsia-500 text-base font-semibold shadow-xl shadow-violet-600/30 transition hover:brightness-110 disabled:opacity-50"
                >
                  {entrando ? <Loader2 className="h-5 w-5 animate-spin" /> : info.estado === "en_vivo" ? "Entrar a la demo" : "Entrar y esperar"}
                </button>
              </form>
            )}
          </motion.div>
        )}
      </main>
    </FondoDemo>
  );
}

function Sala({ sala, info }: { sala: SalaDemo; info: Info }) {
  useSala(sala);
  const camaras = sala.remotos.filter((r) => r.tipo === "camara" && r.stream.getVideoTracks().length > 0);
  const voz = sala.remotos.find((r) => r.tipo === "presentador")?.stream ?? null;
  const presentador = sala.remotos.find((r) => r.tipo === "presentador");
  const otros = sala.remotos.filter((r) => r.tipo === "lead");
  const escenario = useRef<HTMLDivElement>(null);
  // Mi micrófono y mi cámara (opcionales): solo me ve y escucha quien presenta.
  const [miMic, setMiMic] = useState<MediaStream | null>(null);
  const [miCam, setMiCam] = useState<MediaStream | null>(null);
  const [avisoMedios, setAvisoMedios] = useState<string | null>(null);
  const aplicar = (m: MediaStream | null, c: MediaStream | null) =>
    sala.cambiarLocal(m || c ? new MediaStream([...(m?.getAudioTracks() ?? []), ...(c?.getVideoTracks() ?? [])]) : null);
  const alternarMic = async () => {
    if (miMic) {
      miMic.getTracks().forEach((t) => t.stop());
      setMiMic(null);
      return aplicar(null, miCam);
    }
    const m = await navigator.mediaDevices?.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).catch(() => null);
    if (!m) return setAvisoMedios("No pudimos usar tu micrófono. Revisá el permiso del navegador.");
    setMiMic(m);
    setAvisoMedios("Ya te escuchan todos en la demo.");
    aplicar(m, miCam);
  };
  const alternarCam = async () => {
    if (miCam) {
      miCam.getTracks().forEach((t) => t.stop());
      setMiCam(null);
      return aplicar(miMic, null);
    }
    const c = await navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "user", width: { ideal: 480 }, height: { ideal: 480 }, frameRate: { ideal: 20 } } })
      .catch(() => null);
    if (!c) return setAvisoMedios("No pudimos usar tu cámara. Revisá el permiso del navegador.");
    setMiCam(c);
    setAvisoMedios("Ya te ven todos en la demo.");
    aplicar(miMic, c);
  };
  useEffect(() => {
    if (!avisoMedios) return;
    const t = setTimeout(() => setAvisoMedios(null), 4000);
    return () => clearTimeout(t);
  }, [avisoMedios]);
  useEffect(
    () => () => {
      miMic?.getTracks().forEach((t) => t.stop());
      miCam?.getTracks().forEach((t) => t.stop());
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  // ---- Mostrar mi cámara en grande (lo pido y quien presenta me autoriza) ----
  const yoMuestro = sala.mostrando?.pid === sala.cred.pid;
  const muestraOtro = sala.mostrando && !yoMuestro ? otros.find((o) => o.pid === sala.mostrando?.pid) ?? null : null;
  const [pidiendo, setPidiendo] = useState<number | null>(null);
  const [atras, setAtras] = useState(true);
  const pedirMostrar = async () => {
    try {
      await sala.pedirMostrar();
      setPidiendo(sala.mensajes.at(-1)?.id ?? 0);
      setAvisoMedios("Le pedimos a quien presenta que te deje mostrar tu cámara…");
    } catch {
      setAvisoMedios("No se pudo pedir. Probá de nuevo.");
    }
  };
  // Si no contestan en un minuto, el pedido se da por vencido.
  useEffect(() => {
    if (pidiendo === null) return;
    const t = setTimeout(() => setPidiendo(null), 60_000);
    return () => clearTimeout(t);
  }, [pidiendo]);
  // Rechazado.
  useEffect(() => {
    if (pidiendo === null) return;
    if (sala.mensajes.some((m) => m.tipo === "rechazo" && m.pid === sala.cred.pid && m.id > pidiendo)) {
      setPidiendo(null);
      setAvisoMedios("Ahora no te pueden mirar. Escribí tu pregunta en el chat.");
    }
  }, [sala.mensajes, pidiendo, sala.cred.pid]);
  // Autorizado: se prende la cámara de atrás (para mostrar algo) en buena calidad; al cortar, se apaga.
  const camaraMostrar = async (deAtras: boolean) => {
    const c = await navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: deAtras ? { ideal: "environment" } : "user", width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } })
      .catch(() => null);
    if (!c) {
      setAvisoMedios("No pudimos usar tu cámara. Revisá el permiso del navegador.");
      void sala.dejarMostrar();
      return;
    }
    miCam?.getTracks().forEach((t) => t.stop());
    setMiCam(c);
    setAtras(deAtras);
    aplicar(miMic, c);
  };
  const [mostrandoAntes, setMostrandoAntes] = useState(false);
  useEffect(() => {
    if (yoMuestro && !mostrandoAntes) {
      setPidiendo(null);
      setMostrandoAntes(true);
      void camaraMostrar(true);
    } else if (!yoMuestro && mostrandoAntes) {
      setMostrandoAntes(false);
      miCam?.getTracks().forEach((t) => t.stop());
      setMiCam(null);
      aplicar(miMic, null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yoMuestro, mostrandoAntes]);

  const [elegida, setElegida] = useState<string | null>(null);
  const [mosaico, setMosaico] = useState(false);
  const [sinSonido, setSinSonido] = useState(false);
  const [chatAbierto, setChatAbierto] = useState(false);
  const [cotizar, setCotizar] = useState(false);
  const principal = camaras.find((c) => c.pid === elegida) ?? camaras[0] ?? null;
  const bloqueado = useCallback((b: boolean) => setSinSonido(b), []);
  const ultimo = sala.mensajes[sala.mensajes.length - 1];
  const nuevos = useMemo(() => sala.mensajes.filter((m) => m.tipo === "texto").length, [sala.mensajes]);

  if (sala.estado === "terminada") {
    return (
      <FondoDemo>
        <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 px-5 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-3xl bg-white/10">
            <Square className="h-7 w-7" />
          </span>
          <div>
            <h1 className="text-2xl font-bold">La demo terminó</h1>
            <p className="mt-2 text-white/60">¡Gracias por venir! Si te interesó, pedí tu cotización y {info.empresa} te contacta.</p>
          </div>
          <BotonCotizar onClick={() => setCotizar(true)} className="w-full" />
        </main>
        <Cotizar abierto={cotizar} onCerrar={() => setCotizar(false)} sala={sala} empresa={info.empresa} />
      </FondoDemo>
    );
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[#07060c] text-white">
      <AudioVivo stream={voz} onBloqueado={bloqueado} />
      {/* Las cámaras traen micrófono (apagado salvo que alguien hable desde ahí). */}
      {/* Los otros clientes que prendieron micrófono o cámara (como una videollamada). */}
      {otros.map((o) => (
        <SonidoRemoto key={o.pid} stream={o.stream} />
      ))}
      {camaras.filter((c) => c.stream.getAudioTracks().length).map((c) => (
        <SonidoRemoto key={c.pid} stream={c.stream} />
      ))}
      {/* Arriba */}
      <header className="flex shrink-0 items-center gap-3 px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-white/50">{info.empresa}</p>
          <p className="truncate font-semibold leading-tight">{info.titulo}</p>
        </div>
        {sala.estado === "en_vivo" && <PildoraVivo />}
        <div className="hidden items-center gap-2 md:flex">
          <BotonMedio prendido={!!miMic} onClick={() => void alternarMic()} on={Mic} off={MicOff} etiqueta="micrófono" />
          <BotonMedio prendido={!!miCam} onClick={() => void alternarCam()} on={Video} off={VideoOff} etiqueta="cámara" />
          {!yoMuestro && <BotonMostrar pidiendo={pidiendo !== null} onClick={() => void pedirMostrar()} />}
        </div>
        <BotonCotizar onClick={() => setCotizar(true)} className="hidden md:flex" />
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 px-3 pb-3 md:flex-row">
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {/* Escenario */}
          <div ref={escenario} className="relative min-h-0 flex-1 overflow-hidden rounded-3xl bg-black ring-1 ring-white/10">
            {yoMuestro && miCam ? (
              <>
                <VideoVivo stream={miCam} espejo={!atras} />
                <div className="absolute inset-x-3 bottom-3 z-20 flex items-center gap-2 rounded-2xl bg-black/70 p-2 pl-4 backdrop-blur">
                  <span className="relative mr-1 flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
                  </span>
                  <p className="min-w-0 flex-1 truncate text-sm font-semibold">Todos ven tu cámara</p>
                  <button type="button" onClick={() => void camaraMostrar(!atras)} aria-label="Dar vuelta la cámara" className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 hover:bg-white/25">
                    <SwitchCamera className="h-5 w-5" />
                  </button>
                  <button type="button" onClick={() => void sala.dejarMostrar()} className="h-10 rounded-xl bg-red-500 px-3 text-sm font-semibold hover:bg-red-400">
                    Dejar de mostrar
                  </button>
                </div>
              </>
            ) : muestraOtro ? (
              <>
                <VideoVivo stream={muestraOtro.stream} />
                <Etiqueta texto={`Muestra ${muestraOtro.nombre.split(" ")[0]}`} />
              </>
            ) : camaras.length === 0 ? (
              <Esperando estado={sala.estado} fecha={info.fecha} />
            ) : mosaico && camaras.length > 1 ? (
              <div className={cn("grid h-full gap-1", camaras.length > 2 ? "grid-cols-2 grid-rows-2" : "grid-cols-1 grid-rows-2 md:grid-cols-2 md:grid-rows-1")}>
                {camaras.slice(0, 4).map((c) => (
                  <button key={c.pid} type="button" onClick={() => (setElegida(c.pid), setMosaico(false))} className="relative min-h-0 overflow-hidden bg-black">
                    <VideoVivo stream={c.stream} contain={false} />
                    <Etiqueta texto={c.nombre} />
                  </button>
                ))}
              </div>
            ) : (
              principal && (
                <>
                  <VideoVivo stream={principal.stream} />
                  <Etiqueta texto={principal.nombre} />
                </>
              )
            )}
            {sinSonido && voz && (
              <button
                type="button"
                onClick={() => {
                  document.querySelectorAll("audio").forEach((a) => void a.play().catch(() => undefined));
                  setSinSonido(false);
                }}
                className="absolute inset-x-0 top-3 mx-auto flex w-fit items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black shadow-xl"
              >
                <Volume2 className="h-4 w-4" /> Tocá para escuchar
              </button>
            )}
            {/* Quien presenta, en un círculo (se puede mover si tapa algo) */}
            {presentador && tieneVideo(presentador.stream) && (
              <motion.div
                drag
                dragConstraints={escenario}
                dragMomentum={false}
                className="absolute bottom-3 left-3 z-10 h-24 w-24 cursor-grab touch-none active:cursor-grabbing md:h-32 md:w-32"
              >
                <Circulo stream={presentador.stream} nombre={presentador.nombre.split(" ")[0]} className="h-full w-full" />
              </motion.div>
            )}
            <div className="pointer-events-none absolute right-3 top-3 z-10 flex gap-2">
              {otros.filter((o) => tieneVideo(o.stream) && o.pid !== sala.mostrando?.pid).map((o) => (
                <Circulo key={o.pid} stream={o.stream} nombre={o.nombre.split(" ")[0]} className="h-14 w-14 md:h-16 md:w-16" />
              ))}
              {miCam && !yoMuestro && <Circulo stream={miCam} espejo nombre="Vos" className="h-14 w-14 md:h-16 md:w-16" />}
            </div>
            {avisoMedios && (
              <p className="absolute inset-x-0 top-3 z-20 mx-auto w-fit max-w-[80%] rounded-full bg-black/80 px-4 py-2 text-center text-xs font-medium backdrop-blur">{avisoMedios}</p>
            )}
            {camaras.length > 1 && !sala.mostrando && (
              <button
                type="button"
                onClick={() => setMosaico((m) => !m)}
                className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-2 text-xs font-semibold backdrop-blur hover:bg-black/80"
              >
                <LayoutGrid className="h-4 w-4" /> {mosaico ? "Una grande" : "Ver todas"}
              </button>
            )}
          </div>

          {/* Cámaras */}
          {camaras.length > 1 && !mosaico && (
            <div className="flex shrink-0 gap-2 overflow-x-auto">
              {camaras.map((c) => (
                <button
                  key={c.pid}
                  type="button"
                  onClick={() => setElegida(c.pid)}
                  className={cn("relative aspect-video w-28 shrink-0 overflow-hidden rounded-2xl bg-black ring-2 transition md:w-36", principal?.pid === c.pid ? "ring-violet-400" : "ring-transparent opacity-70 hover:opacity-100")}
                >
                  <VideoVivo stream={c.stream} contain={false} />
                  <Etiqueta texto={c.nombre} chica />
                </button>
              ))}
            </div>
          )}

          {/* Celular: último mensaje y botones */}
          <div className="flex shrink-0 items-center gap-2 md:hidden">
            <BotonMedio prendido={!!miMic} onClick={() => void alternarMic()} on={Mic} off={MicOff} etiqueta="micrófono" />
            <BotonMedio prendido={!!miCam} onClick={() => void alternarCam()} on={Video} off={VideoOff} etiqueta="cámara" />
            {!yoMuestro && <BotonMostrar pidiendo={pidiendo !== null} onClick={() => void pedirMostrar()} />}
            <button type="button" onClick={() => setChatAbierto(true)} className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-2xl bg-white/10 px-4 text-left text-sm">
              <MessageCircle className="h-4 w-4 shrink-0 text-violet-300" />
              <span className="truncate text-white/70">{ultimo && ultimo.tipo === "texto" ? `${ultimo.nombre}: ${ultimo.texto}` : "Hacé una pregunta"}</span>
              {nuevos > 0 && <span className="ml-auto shrink-0 rounded-full bg-violet-600 px-2 text-xs font-bold">{nuevos}</span>}
            </button>
            <BotonCotizar onClick={() => setCotizar(true)} chico />
          </div>
        </div>

        {/* Compu: chat al costado */}
        <aside className="hidden w-80 shrink-0 flex-col overflow-hidden rounded-3xl bg-white/[0.04] ring-1 ring-white/10 md:flex">
          <p className="border-b border-white/10 px-4 py-3 text-sm font-semibold">Preguntas</p>
          <ChatDemo sala={sala} yo={sala.cred.pid} className="flex-1" />
        </aside>
      </div>

      {/* Celular: chat abierto */}
      <AnimatePresence>
        {chatAbierto && (
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            className="fixed inset-x-0 bottom-0 z-40 flex h-[70dvh] flex-col rounded-t-3xl bg-[#13111c] pb-[env(safe-area-inset-bottom)] ring-1 ring-white/10 md:hidden"
          >
            <div className="flex items-center justify-between px-4 pt-3">
              <p className="font-semibold">Preguntas</p>
              <button type="button" onClick={() => setChatAbierto(false)} aria-label="Cerrar" className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/10">
                <X className="h-5 w-5" />
              </button>
            </div>
            <ChatDemo sala={sala} yo={sala.cred.pid} className="flex-1" />
          </motion.div>
        )}
      </AnimatePresence>
      <Cotizar abierto={cotizar} onCerrar={() => setCotizar(false)} sala={sala} empresa={info.empresa} />
    </div>
  );
}

/** Pedir mostrar mi cámara en grande (para mostrar algo: una máquina, dónde va un cable). */
function BotonMostrar({ pidiendo, onClick }: { pidiendo: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pidiendo}
      aria-label="Pedir mostrar mi cámara"
      title="Pedir mostrar mi cámara en grande"
      className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl transition", pidiendo ? "animate-pulse bg-amber-400 text-black" : "bg-white/10 text-white/80 hover:bg-white/15")}
    >
      <Hand className="h-5 w-5" />
    </button>
  );
}

/** Prender o apagar mi micrófono o mi cámara (apagados al entrar). */
function BotonMedio({ prendido, onClick, on: On, off: Off, etiqueta }: { prendido: boolean; onClick: () => void; on: typeof Mic; off: typeof Mic; etiqueta: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={prendido ? `Apagar mi ${etiqueta}` : `Prender mi ${etiqueta}`}
      title={prendido ? `Apagar mi ${etiqueta}` : `Prender mi ${etiqueta} para hablar en la demo`}
      className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl transition", prendido ? "bg-white text-black" : "bg-white/10 text-white/80 hover:bg-white/15")}
    >
      {prendido ? <On className="h-5 w-5" /> : <Off className="h-5 w-5" />}
    </button>
  );
}

function Etiqueta({ texto, chica }: { texto: string; chica?: boolean }) {
  return (
    <span className={cn("absolute left-2 top-2 rounded-full bg-black/60 font-semibold backdrop-blur", chica ? "px-2 py-0.5 text-[10px]" : "px-3 py-1 text-xs")}>{texto}</span>
  );
}

function Esperando({ estado, fecha }: { estado: EstadoDemo; fecha: string | null }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="relative flex h-20 w-20 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-violet-500/30" />
        <span className="relative h-10 w-10 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500" />
      </div>
      <div>
        <p className="text-lg font-semibold">{estado === "en_vivo" ? "Conectando las cámaras…" : "La demo empieza en breve"}</p>
        <p className="mt-1 text-sm text-white/50">{estado === "en_vivo" ? "Tarda unos segundos." : fecha ? `Está programada para ${fechaDemo(fecha)}. No cierres esta pantalla.` : "No cierres esta pantalla."}</p>
      </div>
    </div>
  );
}

function BotonCotizar({ onClick, className, chico }: { onClick: () => void; className?: string; chico?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex shrink-0 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 font-semibold text-black shadow-lg shadow-orange-500/25 transition hover:brightness-110",
        chico ? "h-12 px-4 text-sm" : "h-12 px-5",
        className
      )}
    >
      <Flame className="h-[18px] w-[18px]" /> Quiero cotizar
    </button>
  );
}

function Cotizar({ abierto, onCerrar, sala, empresa }: { abierto: boolean; onCerrar: () => void; sala: SalaDemo; empresa: string }) {
  const [contacto, setContacto] = useState("");
  const [estado, setEstado] = useState<"form" | "enviando" | "listo">("form");
  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setEstado("enviando");
    try {
      await apiDemo("demo-interes", { ...sala.cred, contacto });
      setEstado("listo");
    } catch {
      setEstado("form");
    }
  };
  return (
    <AnimatePresence>
      {abierto && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center" onClick={onCerrar}>
          <motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-3xl bg-[#13111c] p-6 text-white ring-1 ring-white/10"
          >
            {estado === "listo" ? (
              <div className="space-y-4 text-center">
                <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/20 text-2xl">✓</span>
                <p className="text-lg font-semibold">¡Listo! {empresa} ya sabe que querés cotizar.</p>
                <button type="button" onClick={onCerrar} className="h-12 w-full rounded-2xl bg-white/10 font-semibold hover:bg-white/15">
                  Seguir mirando
                </button>
              </div>
            ) : (
              <form onSubmit={enviar} className="space-y-4">
                <div>
                  <p className="text-lg font-semibold">Pedí tu cotización</p>
                  <p className="mt-1 text-sm text-white/55">Dejá tu WhatsApp o mail y {empresa} te escribe.</p>
                </div>
                <input
                  value={contacto}
                  onChange={(e) => setContacto(e.target.value)}
                  placeholder="WhatsApp o mail"
                  maxLength={80}
                  autoFocus
                  className="h-12 w-full rounded-2xl border border-white/10 bg-white/5 px-4 text-[16px] placeholder:text-white/35 focus:border-amber-400 focus:outline-none"
                />
                <button type="submit" disabled={estado === "enviando"} className="flex h-12 w-full items-center justify-center rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 font-semibold text-black disabled:opacity-60">
                  {estado === "enviando" ? <Loader2 className="h-5 w-5 animate-spin" /> : "Enviar"}
                </button>
              </form>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
