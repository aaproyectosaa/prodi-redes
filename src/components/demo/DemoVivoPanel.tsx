// Panel de la empresa (ej. DS): crea la demo, comparte el link por WhatsApp, conecta los celulares cámara y transmite.
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import QRCode from "qrcode";
import { toast } from "sonner";
import { CalendarClock, Check, Copy, Flame, Loader2, Mic, MicOff, MoreHorizontal, Play, Plus, Radio, Share2, Smartphone, Square, Trash2, Users, Video, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { apiPanel, SalaDemo, type DemoPanel } from "@/lib/demoVivo";
import { ChatDemo, PildoraVivo, VideoVivo, fechaDemo, useSala } from "@/components/demo/Comunes";

interface Lista {
  demos: DemoPanel[];
  camara_link: string;
  camaras: { pid: string; nombre: string }[];
}

const textoInvitacion = (empresa: string, d: DemoPanel) =>
  `Hola! Te invito a ver en vivo cómo trabaja nuestra máquina${d.fecha ? ` (${fechaDemo(d.fecha)})` : ""}: ${d.titulo}.\n\nEntrá desde acá, sin instalar nada:\n${d.link}\n\n${empresa}`;

export function DemoVivoPanel({ proyectoId, empresa }: { proyectoId: string; empresa: string }) {
  const [datos, setDatos] = useState<Lista | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nueva, setNueva] = useState(false);
  const [compartir, setCompartir] = useState<DemoPanel | null>(null);
  const [camaras, setCamaras] = useState(false);
  const [estudio, setEstudio] = useState<DemoPanel | null>(null);

  const traer = useCallback(() => {
    apiPanel<Lista>("demo-lista", { proyecto_id: proyectoId })
      .then((r) => {
        setDatos(r);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cargar"));
  }, [proyectoId]);
  useEffect(() => {
    traer();
    const t = setInterval(traer, 5000);
    return () => clearInterval(t);
  }, [traer]);

  const enVivo = datos?.demos.find((d) => d.estado === "en_vivo");
  const proximas = datos?.demos.filter((d) => d.estado === "programada") ?? [];
  const pasadas = datos?.demos.filter((d) => d.estado === "terminada") ?? [];

  if (error && !datos) return <p className="rounded-2xl border p-6 text-sm text-muted-foreground">{error}</p>;
  if (!datos) return <Loader2 className="mx-auto my-10 h-6 w-6 animate-spin text-muted-foreground" />;

  return (
    <div className="space-y-6">
      {/* Arriba: crear y cámaras */}
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <button
          type="button"
          onClick={() => setNueva(true)}
          className="group relative flex items-center gap-4 overflow-hidden rounded-3xl bg-gradient-to-br from-violet-600 via-violet-600 to-fuchsia-500 p-5 text-left text-white shadow-xl shadow-violet-600/20 transition hover:-translate-y-0.5 hover:shadow-2xl"
        >
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/20 backdrop-blur">
            <Plus className="h-7 w-7 transition-transform group-hover:rotate-90" />
          </span>
          <span>
            <span className="block text-lg font-bold">Nueva demo en vivo</span>
            <span className="block text-sm text-white/80">Creala y mandá el link por WhatsApp</span>
          </span>
        </button>
        <button type="button" onClick={() => setCamaras(true)} className="flex items-center gap-3 rounded-3xl border bg-card p-5 text-left transition hover:bg-accent/50">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Smartphone className="h-6 w-6" />
          </span>
          <span>
            <span className="block font-semibold">Cámaras</span>
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <span className={cn("h-2 w-2 rounded-full", datos.camaras.length ? "bg-emerald-500" : "bg-muted-foreground/40")} />
              {datos.camaras.length ? `${datos.camaras.length} ${datos.camaras.length === 1 ? "prendida" : "prendidas"}` : "Ninguna prendida"}
            </span>
          </span>
        </button>
      </div>

      {enVivo && (
        <div className="flex flex-wrap items-center gap-4 rounded-3xl border border-red-500/30 bg-red-500/5 p-5">
          <PildoraVivo />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{enVivo.titulo}</p>
            <p className="text-sm text-muted-foreground">La demo está en vivo</p>
          </div>
          <Button onClick={() => setEstudio(enVivo)} className="rounded-full">
            <Radio className="mr-1.5 h-4 w-4" /> Volver a la transmisión
          </Button>
        </div>
      )}

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground">Próximas</h3>
        {proximas.length === 0 ? (
          <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">No hay demos programadas. Creá una y compartí el link.</p>
        ) : (
          proximas.map((d) => <TarjetaDemo key={d.id} d={d} onCompartir={() => setCompartir(d)} onTransmitir={() => setEstudio(d)} onCambio={traer} />)
        )}
      </section>

      {pasadas.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground">Ya hechas</h3>
          {pasadas.map((d) => (
            <TarjetaDemo key={d.id} d={d} onCompartir={() => setCompartir(d)} onTransmitir={() => undefined} onCambio={traer} />
          ))}
        </section>
      )}

      <NuevaDemo
        abierto={nueva}
        onCerrar={() => setNueva(false)}
        proyectoId={proyectoId}
        onCreada={(d) => {
          setNueva(false);
          traer();
          setCompartir(d);
        }}
      />
      <Compartir demo={compartir} empresa={empresa} onCerrar={() => setCompartir(null)} />
      <Camaras abierto={camaras} onCerrar={() => setCamaras(false)} link={datos.camara_link} prendidas={datos.camaras} />
      {estudio && (
        <Estudio
          demo={estudio}
          empresa={empresa}
          camarasPrendidas={datos.camaras.length}
          onCompartir={() => setCompartir(estudio)}
          onCerrar={() => {
            setEstudio(null);
            traer();
          }}
        />
      )}
    </div>
  );
}

function TarjetaDemo({ d, onCompartir, onTransmitir, onCambio }: { d: DemoPanel; onCompartir: () => void; onTransmitir: () => void; onCambio: () => void }) {
  const [ver, setVer] = useState(false);
  const borrar = async () => {
    if (!confirm(`¿Borrar la demo «${d.titulo}»?`)) return;
    try {
      await apiPanel("demo-borrar", { demo_id: d.id });
      onCambio();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo");
    }
  };
  const terminada = d.estado === "terminada";
  return (
    <div className="rounded-3xl border bg-card p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl", terminada ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary")}>
          {terminada ? <Check className="h-6 w-6" /> : <CalendarClock className="h-6 w-6" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{d.titulo}</p>
          <p className="text-sm text-muted-foreground">
            {terminada
              ? `${fechaDemo(d.inicio_at ?? d.created_at)} · ${d.visitas.length} ${d.visitas.length === 1 ? "persona la vio" : "personas la vieron"}`
              : d.fecha
                ? fechaDemo(d.fecha)
                : "Sin fecha: cuando quieras"}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="Más" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent">
              <MoreHorizontal className="h-5 w-5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => void borrar()} className="text-destructive">
              <Trash2 className="mr-2 h-4 w-4" /> Borrar
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {d.interesados.length > 0 && (
        <div className="mt-3 space-y-1.5 rounded-2xl bg-amber-500/10 p-3">
          {d.interesados.map((x, i) => (
            <p key={i} className="flex items-center gap-2 text-sm">
              <Flame className="h-4 w-4 shrink-0 text-amber-500" />
              <span className="font-semibold">{x.nombre}</span>
              <span className="truncate text-muted-foreground">quiere cotizar{x.contacto ? ` · ${x.contacto}` : ""}</span>
            </p>
          ))}
        </div>
      )}

      {terminada ? (
        d.visitas.length > 0 && (
          <button type="button" onClick={() => setVer((v) => !v)} className="mt-3 text-sm font-medium text-primary">
            {ver ? "Ocultar quiénes la vieron" : "Ver quiénes la vieron"}
          </button>
        )
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={onCompartir} className="h-11 rounded-2xl">
            <Share2 className="mr-1.5 h-4 w-4" /> Invitar
          </Button>
          <Button onClick={onTransmitir} className="h-11 rounded-2xl">
            <Video className="mr-1.5 h-4 w-4" /> Transmitir
          </Button>
        </div>
      )}
      {ver && <p className="mt-2 text-sm text-muted-foreground">{[...new Set(d.visitas.map((v) => v.nombre))].join(" · ")}</p>}
    </div>
  );
}

function NuevaDemo({ abierto, onCerrar, proyectoId, onCreada }: { abierto: boolean; onCerrar: () => void; proyectoId: string; onCreada: (d: DemoPanel) => void }) {
  const [titulo, setTitulo] = useState("");
  const [cuando, setCuando] = useState<"ahora" | "fecha">("ahora");
  const [fecha, setFecha] = useState("");
  const [creando, setCreando] = useState(false);
  useEffect(() => {
    if (abierto) {
      setTitulo("");
      setCuando("ahora");
      setFecha("");
    }
  }, [abierto]);
  const crear = async (e: FormEvent) => {
    e.preventDefault();
    setCreando(true);
    try {
      const r = await apiPanel<{ demo: DemoPanel }>("demo-crear", {
        proyecto_id: proyectoId,
        titulo,
        fecha: cuando === "fecha" && fecha ? new Date(fecha).toISOString() : null,
      });
      onCreada(r.demo);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo crear");
    } finally {
      setCreando(false);
    }
  };
  return (
    <Dialog open={abierto} onOpenChange={(o) => !o && onCerrar()}>
      <DialogContent className="max-w-md rounded-3xl">
        <DialogHeader>
          <DialogTitle>Nueva demo en vivo</DialogTitle>
          <DialogDescription>Después te damos el link para mandarle al cliente.</DialogDescription>
        </DialogHeader>
        <form onSubmit={crear} className="space-y-5">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">¿Para quién es o qué pieza van a hacer?</span>
            <input
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Ej: Soldadura de bastidor para Metalúrgica López"
              autoFocus
              maxLength={120}
              className="h-12 w-full rounded-2xl border bg-background px-4 text-[16px] focus:border-primary focus:outline-none"
            />
          </label>
          <div className="space-y-2">
            <span className="text-sm font-medium">¿Cuándo?</span>
            <div className="grid grid-cols-2 gap-2">
              {(["ahora", "fecha"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCuando(c)}
                  className={cn("h-12 rounded-2xl border text-sm font-semibold transition", cuando === c ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent")}
                >
                  {c === "ahora" ? "Ahora o cuando quiera" : "Elegir día y hora"}
                </button>
              ))}
            </div>
            {cuando === "fecha" && (
              <input type="datetime-local" value={fecha} onChange={(e) => setFecha(e.target.value)} className="h-12 w-full rounded-2xl border bg-background px-4 text-[16px] focus:border-primary focus:outline-none" />
            )}
          </div>
          <Button type="submit" disabled={!titulo.trim() || creando || (cuando === "fecha" && !fecha)} className="h-12 w-full rounded-2xl text-base">
            {creando ? <Loader2 className="h-5 w-5 animate-spin" /> : "Crear demo"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Compartir({ demo, empresa, onCerrar }: { demo: DemoPanel | null; empresa: string; onCerrar: () => void }) {
  const [copiado, setCopiado] = useState(false);
  useEffect(() => setCopiado(false), [demo]);
  if (!demo) return null;
  const texto = textoInvitacion(empresa, demo);
  const copiar = async () => {
    await navigator.clipboard.writeText(demo.link).catch(() => undefined);
    setCopiado(true);
    toast.success("Link copiado");
  };
  const compartirNativo = async () => {
    try {
      await navigator.share({ title: demo.titulo, text: texto });
    } catch {
      /* canceló */
    }
  };
  return (
    <Dialog open={!!demo} onOpenChange={(o) => !o && onCerrar()}>
      <DialogContent className="max-w-md rounded-3xl">
        <DialogHeader>
          <DialogTitle>Invitá a tu cliente</DialogTitle>
          <DialogDescription>Entra desde el link, sin crear cuenta ni instalar nada.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <a
            href={`https://wa.me/?text=${encodeURIComponent(texto)}`}
            target="_blank"
            rel="noreferrer"
            className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-[#25D366] text-base font-semibold text-white shadow-lg shadow-[#25D366]/25 transition hover:brightness-105"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden>
              <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3a.4.4 0 0 0 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.7-1.2 2.2 2.2 0 0 0 .2-1.2c-.1-.1-.3-.2-.5-.3Z" />
            </svg>
            Mandar por WhatsApp
          </a>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => void copiar()} className="h-12 rounded-2xl">
              {copiado ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />} {copiado ? "Copiado" : "Copiar link"}
            </Button>
            {typeof navigator !== "undefined" && "share" in navigator ? (
              <Button variant="outline" onClick={() => void compartirNativo()} className="h-12 rounded-2xl">
                <Share2 className="mr-1.5 h-4 w-4" /> Otra app
              </Button>
            ) : (
              <Button variant="outline" asChild className="h-12 rounded-2xl">
                <a href={`mailto:?subject=${encodeURIComponent(demo.titulo)}&body=${encodeURIComponent(texto)}`}>Por mail</a>
              </Button>
            )}
          </div>
          <p className="truncate rounded-xl bg-muted px-3 py-2 font-mono text-xs text-muted-foreground">{demo.link}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Camaras({ abierto, onCerrar, link, prendidas }: { abierto: boolean; onCerrar: () => void; link: string; prendidas: { pid: string; nombre: string }[] }) {
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    if (!abierto) return;
    void QRCode.toDataURL(link, { margin: 1, width: 480, color: { dark: "#0b0a12", light: "#ffffff" } }).then(setQr);
  }, [abierto, link]);
  return (
    <Dialog open={abierto} onOpenChange={(o) => !o && onCerrar()}>
      <DialogContent className="max-w-md rounded-3xl">
        <DialogHeader>
          <DialogTitle>Sumar una cámara</DialogTitle>
          <DialogDescription>Cualquier celular sirve. Se hace una sola vez por celular.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <div className="mx-auto w-56 overflow-hidden rounded-3xl bg-white p-3 shadow-lg">{qr ? <img src={qr} alt="QR para conectar una cámara" className="h-full w-full" /> : <div className="aspect-square" />}</div>
          <ol className="space-y-2.5 text-sm">
            {["Abrí la cámara del celular y escaneá este QR.", "Elegí qué número de cámara es (1, 2, 3 o 4).", "Ponelo en su soporte, enchufado. Cuando empiece una demo, se conecta solo."].map((t, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{i + 1}</span>
                <span className="pt-0.5">{t}</span>
              </li>
            ))}
          </ol>
          <div className="rounded-2xl bg-muted/60 p-3">
            <p className="mb-2 text-xs font-semibold text-muted-foreground">Prendidas ahora</p>
            {prendidas.length === 0 ? (
              <p className="text-sm text-muted-foreground">Ninguna todavía.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {prendidas.map((c) => (
                  <span key={c.pid} className="flex items-center gap-1.5 rounded-full bg-background px-3 py-1 text-sm font-medium">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" /> {c.nombre}
                  </span>
                ))}
              </div>
            )}
          </div>
          <Button
            variant="ghost"
            onClick={() => {
              void navigator.clipboard.writeText(link).then(() => toast.success("Link copiado: abrilo en el celular"));
            }}
            className="w-full rounded-2xl text-muted-foreground"
          >
            <Copy className="mr-1.5 h-4 w-4" /> Copiar el link en vez de escanear
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Pantalla completa para transmitir: las cámaras, el micrófono, quiénes miran y las preguntas. */
function Estudio({ demo, empresa, camarasPrendidas, onCompartir, onCerrar }: { demo: DemoPanel; empresa: string; camarasPrendidas: number; onCompartir: () => void; onCerrar: () => void }) {
  const [sala, setSala] = useState<SalaDemo | null>(null);
  const [mic, setMic] = useState<MediaStream | null>(null);
  const [micPrendido, setMicPrendido] = useState(true);
  const [estado, setEstado] = useState(demo.estado);
  const [ocupado, setOcupado] = useState(false);
  const [elegida, setElegida] = useState<string | null>(null);
  const [chat, setChat] = useState(false);
  useSala(sala);

  // Entra como presentador con el micrófono.
  useEffect(() => {
    let s: SalaDemo | null = null;
    let m: MediaStream | null = null;
    let vivo = true;
    (async () => {
      m = await navigator.mediaDevices?.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).catch(() => null);
      if (!m) toast.message("Sin micrófono: los clientes van a ver las cámaras pero no te van a escuchar.");
      const r = await apiPanel<{ d: string; pid: string; llave: string }>("demo-presentar", { demo_id: demo.id });
      if (!vivo) return;
      s = new SalaDemo({ d: r.d, pid: r.pid, llave: r.llave }, "presentador", m);
      s.estado = demo.estado;
      s.iniciar();
      setSala(s);
      setMic(m);
    })().catch((e) => toast.error(e instanceof Error ? e.message : "No se pudo entrar"));
    return () => {
      vivo = false;
      void s?.salir();
      m?.getTracks().forEach((t) => t.stop());
    };
  }, [demo.id, demo.estado]);

  // Escape de atrás del celular cierra la pantalla.
  useEffect(() => {
    document.documentElement.classList.add("overflow-hidden");
    return () => document.documentElement.classList.remove("overflow-hidden");
  }, []);

  // Aviso cuando alguien quiere cotizar.
  const ultimoFuego = useMemo(() => sala?.mensajes.filter((m) => m.texto.startsWith("🔥")).at(-1)?.id ?? 0, [sala?.mensajes]);
  const [visto, setVisto] = useState(0);
  useEffect(() => {
    if (!ultimoFuego || ultimoFuego === visto || !sala) return;
    if (visto) toast.success(sala.mensajes.find((m) => m.id === ultimoFuego)?.texto ?? "Alguien quiere cotizar", { duration: 8000 });
    setVisto(ultimoFuego);
  }, [ultimoFuego, visto, sala]);

  const cambiarEstado = async (nuevo: "en_vivo" | "terminada") => {
    if (nuevo === "terminada" && !confirm("¿Terminar la demo? Los que están mirando ven que terminó.")) return;
    setOcupado(true);
    try {
      await apiPanel("demo-estado", { demo_id: demo.id, estado: nuevo });
      setEstado(nuevo);
      if (sala) sala.estado = nuevo;
      if (nuevo === "terminada") onCerrar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo");
    } finally {
      setOcupado(false);
    }
  };

  const alternarMic = () => {
    mic?.getAudioTracks().forEach((t) => (t.enabled = !micPrendido));
    setMicPrendido((v) => !v);
  };

  const camaras = sala?.remotos.filter((r) => r.tipo === "camara") ?? [];
  const leads = sala?.participantes.filter((p) => p.tipo === "lead") ?? [];
  const principal = camaras.find((c) => c.pid === elegida) ?? null;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex flex-col bg-[#07060c] text-white" role="dialog" aria-modal="true" aria-label="Transmitir demo">
      <header className="flex shrink-0 items-center gap-3 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button type="button" onClick={onCerrar} aria-label="Salir" className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/10">
          <X className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{demo.titulo}</p>
          <p className="truncate text-xs text-white/50">{empresa}</p>
        </div>
        {estado === "en_vivo" && <PildoraVivo />}
        <span className="hidden items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold sm:flex">
          <Users className="h-3.5 w-3.5" /> {leads.length}
        </span>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 px-3 pb-3 lg:flex-row">
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-3xl bg-black ring-1 ring-white/10">
          {estado !== "en_vivo" ? (
            <div className="flex h-full flex-col items-center justify-center gap-6 p-6 text-center">
              <div className="space-y-2">
                <p className="text-2xl font-bold">Todo listo para empezar</p>
                <p className="text-white/60">
                  {camarasPrendidas ? `${camarasPrendidas} ${camarasPrendidas === 1 ? "cámara prendida" : "cámaras prendidas"}.` : "No hay cámaras prendidas: prendé los celulares antes de empezar."}{" "}
                  {leads.length ? `${leads.length} ${leads.length === 1 ? "persona esperando" : "personas esperando"}.` : ""}
                </p>
              </div>
              <motion.button
                type="button"
                whileTap={{ scale: 0.97 }}
                disabled={ocupado || !sala}
                onClick={() => void cambiarEstado("en_vivo")}
                className="flex h-16 items-center gap-3 rounded-full bg-red-500 px-8 text-lg font-bold shadow-2xl shadow-red-500/40 transition hover:bg-red-400 disabled:opacity-50"
              >
                {ocupado ? <Loader2 className="h-6 w-6 animate-spin" /> : <Play className="h-6 w-6 fill-current" />} Empezar en vivo
              </motion.button>
              <button type="button" onClick={onCompartir} className="text-sm font-medium text-violet-300 hover:underline">
                Invitar a alguien
              </button>
            </div>
          ) : camaras.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-white/50" />
              <p className="font-semibold">Conectando las cámaras…</p>
              <p className="text-sm text-white/50">Si no aparecen, revisá que los celulares estén prendidos con la pantalla de la cámara abierta.</p>
            </div>
          ) : principal ? (
            <button type="button" onClick={() => setElegida(null)} className="h-full w-full">
              <VideoVivo stream={principal.stream} />
              <span className="absolute left-3 top-3 rounded-full bg-black/60 px-3 py-1 text-xs font-semibold backdrop-blur">{principal.nombre}</span>
            </button>
          ) : (
            <div className={cn("grid h-full gap-1", camaras.length === 1 ? "grid-cols-1" : camaras.length === 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2 grid-rows-2")}>
              {camaras.slice(0, 4).map((c) => (
                <button key={c.pid} type="button" onClick={() => setElegida(c.pid)} className="relative min-h-0 overflow-hidden bg-black">
                  <VideoVivo stream={c.stream} contain={camaras.length === 1} />
                  <span className="absolute left-2 top-2 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-xs font-semibold backdrop-blur">
                    <span className={cn("h-1.5 w-1.5 rounded-full", c.conectado ? "bg-emerald-400" : "bg-amber-400")} /> {c.nombre}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Costado (compu) / abajo (celular): quiénes miran y preguntas */}
        <aside className={cn("flex shrink-0 flex-col overflow-hidden rounded-3xl bg-white/[0.04] ring-1 ring-white/10 lg:h-auto lg:w-80", chat ? "h-[45dvh]" : "h-auto")}>
          <button type="button" onClick={() => setChat((c) => !c)} className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-left lg:pointer-events-none">
            <span className="text-sm font-semibold">Preguntas y personas</span>
            <span className="flex items-center gap-1.5 text-xs text-white/60">
              <Users className="h-3.5 w-3.5" /> {leads.length} mirando
            </span>
          </button>
          <div className={cn("min-h-0 flex-1 flex-col", chat ? "flex" : "hidden lg:flex")}>
            {leads.length > 0 && <p className="truncate border-b border-white/10 px-4 py-2 text-xs text-white/50">{leads.map((l) => l.nombre).join(" · ")}</p>}
            {sala && <ChatDemo sala={sala} yo={sala.cred.pid} className="flex-1" placeholder="Respondé a todos…" />}
          </div>
        </aside>
      </div>

      {/* Controles */}
      <footer className="flex shrink-0 items-center justify-center gap-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-1">
        <button
          type="button"
          onClick={alternarMic}
          disabled={!mic}
          aria-label={micPrendido ? "Apagar micrófono" : "Prender micrófono"}
          className={cn("flex h-14 w-14 items-center justify-center rounded-full transition disabled:opacity-40", micPrendido && mic ? "bg-white/15 hover:bg-white/25" : "bg-red-500 hover:bg-red-400")}
        >
          {micPrendido && mic ? <Mic className="h-6 w-6" /> : <MicOff className="h-6 w-6" />}
        </button>
        <button type="button" onClick={onCompartir} aria-label="Invitar" className="flex h-14 w-14 items-center justify-center rounded-full bg-white/15 hover:bg-white/25">
          <Share2 className="h-6 w-6" />
        </button>
        {estado === "en_vivo" && (
          <button type="button" onClick={() => void cambiarEstado("terminada")} disabled={ocupado} className="flex h-14 items-center gap-2 rounded-full bg-red-500 px-6 font-semibold hover:bg-red-400 disabled:opacity-50">
            <Square className="h-5 w-5 fill-current" /> Terminar
          </button>
        )}
      </footer>
    </div>,
    document.body
  );
}

/** Para el admin en la ficha del cliente: prender el módulo y, prendido, el mismo panel que ve la empresa. */
export function DemoVivoCliente({ proyectoId, empresa, activo, esAdmin }: { proyectoId: string; empresa: string; activo: boolean; esAdmin: boolean }) {
  const [local, setLocal] = useState<boolean | null>(null);
  useEffect(() => setLocal(null), [activo]);
  const prendido = local ?? activo;
  const [ocupado, setOcupado] = useState(false);
  const cambiar = async (v: boolean) => {
    setOcupado(true);
    try {
      await apiPanel("demo-activar", { proyecto_id: proyectoId, activo: v });
      setLocal(v);
      toast.success(v ? "Demo en vivo prendida: ya la ven en su panel" : "Demo en vivo apagada");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo");
    } finally {
      setOcupado(false);
    }
  };
  return (
    <div className="space-y-4">
      {esAdmin && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border p-4">
          <div>
            <p className="font-medium">{prendido ? "Prendida" : "Apagada"}</p>
            <p className="text-sm text-muted-foreground">La empresa transmite demos en vivo con celulares como cámaras.</p>
          </div>
          <Button variant={prendido ? "outline" : "default"} disabled={ocupado} onClick={() => void cambiar(!prendido)} className="rounded-full">
            {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : prendido ? "Apagar" : "Prender"}
          </Button>
        </div>
      )}
      {prendido && <DemoVivoPanel proyectoId={proyectoId} empresa={empresa} />}
    </div>
  );
}
