import { useEffect, useState } from "react";
import { addDoc, collection, deleteDoc, doc, onSnapshot, setDoc, updateDoc } from "@/lib/db";
import { CheckCircle2, FlaskConical, HardDrive, Loader2, Plus, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { db } from "@/integrations/firebase/client";
import { assertEditable } from "@/lib/redes/vistaComo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAppData } from "@/contexts/app-data-context";
import { PageShell, Section } from "@/components/redes/PageShell";
import { useRedes } from "@/contexts/redes-data-context";
import { useDriveConnection } from "@/hooks/use-drive-connection";
import { fechaHora, formatARS } from "@/lib/redes/format";
import { callApi } from "@/lib/redes/api";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { DATOS_COBRO_DEFAULT, type DatosCobro, type PlanRedes } from "@/lib/redes/types";
import { comisionPct, montoDebito } from "@/lib/redes/facturacion";
import { ENFOQUE_PRODI_DEFAULT } from "../../../api/_lib/plan-mes";

export default function Ajustes() {
  const { planes, settings } = useRedes();
  const [precioPieza, setPrecioPieza] = useState(String(settings.precio_pieza_ia));
  const [precioImpresion, setPrecioImpresion] = useState(String(settings.precio_pieza_impresion ?? 0));
  const [dias, setDias] = useState(String(settings.dias_alerta));
  const [auto, setAuto] = useState(settings.informe_automatico);
  const [enfoque, setEnfoque] = useState(settings.ia_enfoque ?? ENFOQUE_PRODI_DEFAULT);
  const [diaVto, setDiaVto] = useState(String(settings.dia_vencimiento ?? 5));
  const [iva, setIva] = useState(String(settings.iva_pct ?? 21));
  const [comisionMp, setComisionMp] = useState(String(settings.comision_mp_pct ?? 0));
  const [cobro, setCobro] = useState<DatosCobro>({ ...DATOS_COBRO_DEFAULT, ...(settings.cobro ?? {}) });
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    setPrecioPieza(String(settings.precio_pieza_ia));
    setPrecioImpresion(String(settings.precio_pieza_impresion ?? 0));
    setDias(String(settings.dias_alerta));
    setAuto(settings.informe_automatico);
    setEnfoque(settings.ia_enfoque ?? ENFOQUE_PRODI_DEFAULT);
    setDiaVto(String(settings.dia_vencimiento ?? 5));
    setIva(String(settings.iva_pct ?? 21));
    setComisionMp(String(settings.comision_mp_pct ?? 0));
    setCobro({ ...DATOS_COBRO_DEFAULT, ...(settings.cobro ?? {}) });
  }, [settings]);

  const guardar = async (clave: string, datos: Record<string, unknown>) => {
    setSaving(clave);
    try {
      assertEditable();
      await setDoc(doc(db, "app_settings", "redes"), datos, { merge: true });
      toast.success("Ajustes guardados");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setSaving(null);
    }
  };

  return (
    <PageShell title="Ajustes" subtitle="Planes, precios, facturación, IA y conexiones.">
      <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-8">
          <Section title="Planes" description="Videos y piezas gráficas incluidos por mes. Cada cliente tiene uno (y se puede ajustar por cliente).">
            <PlanesEditor planes={planes} />
          </Section>

          <Section
            title="Cómo vende Prodi (para la IA)"
            description="La IA lo lee en todo lo que arma: plan del mes, textos, guiones y piezas. Lo de cada cliente (productos y temporadas) se carga en su ficha, pestaña Comercial."
          >
            <div className="space-y-3 rounded-xl border bg-card p-4">
              <Textarea rows={8} value={enfoque} onChange={(e) => setEnfoque(e.target.value)} maxLength={3000} />
              <div className="flex flex-wrap justify-between gap-2">
                <Button variant="ghost" size="sm" onClick={() => setEnfoque(ENFOQUE_PRODI_DEFAULT)}>
                  Volver al texto original
                </Button>
                <Button onClick={() => void guardar("ia", { ia_enfoque: enfoque.trim() })} disabled={saving === "ia"}>
                  {saving === "ia" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Guardar
                </Button>
              </div>
            </div>
          </Section>

          <Section title="Con qué IA se hace cada cosa" description="Cada tarea con la que mejor la hace. Las claves se cargan en Vercel (Settings → Environment Variables) y después se hace Redeploy.">
            <IAConexiones imagenes={settings.ia_imagenes === "gemini" ? "gemini" : "openai"} onImagenes={(v) => void guardar("ia-img", { ia_imagenes: v })} />
          </Section>
        </div>

        <div className="space-y-8">
          <Section title="Precios y alertas">
            <div className="space-y-4 rounded-xl border bg-card p-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Pieza para redes</Label>
                  <Input inputMode="numeric" value={precioPieza} onChange={(e) => setPrecioPieza(e.target.value.replace(/\D/g, ""))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Pieza para imprimir</Label>
                  <Input inputMode="numeric" value={precioImpresion} onChange={(e) => setPrecioImpresion(e.target.value.replace(/\D/g, ""))} />
                </div>
              </div>
              <p className="-mt-2 text-xs text-muted-foreground">
                Se cobran con Mercado Pago cuando el cliente ya usó las piezas que incluye su plan.
              </p>
              <div className="space-y-1.5">
                <Label>Días para marcar un video como trabado</Label>
                <Input inputMode="numeric" value={dias} onChange={(e) => setDias(e.target.value.replace(/\D/g, ""))} />
              </div>
              <label className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Informe mensual automático</p>
                  <p className="text-xs text-muted-foreground">El día 1 se manda a cada cliente el informe del mes anterior.</p>
                </div>
                <Switch checked={auto} onCheckedChange={setAuto} />
              </label>
              <Button
                onClick={() =>
                  void guardar("general", {
                    precio_pieza_ia: Number(precioPieza) || 0,
                    precio_pieza_impresion: Number(precioImpresion) || 0,
                    dias_alerta: Math.max(1, Number(dias) || 3),
                    informe_automatico: auto,
                  })
                }
                disabled={saving === "general"}
                className="w-full"
              >
                {saving === "general" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Guardar
              </Button>
            </div>
          </Section>

          <Section
            title="Facturación"
            description="Mes vencido: el 27 de cada mes se prepara sola la boleta de ese mes y se paga del 1 al día que elijas acá (el 5) del mes siguiente. Después corre un 0,5% por día. A un cliente puntual le podés cambiar los días en su ficha. Estos datos salen en las boletas."
          >
            <div className="space-y-3 rounded-xl border bg-card p-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Vence el día</Label>
                  <Input inputMode="numeric" value={diaVto} onChange={(e) => setDiaVto(e.target.value.replace(/\D/g, "").slice(0, 2))} />
                  <p className="text-[11px] text-muted-foreground">del mes siguiente al facturado (el 5)</p>
                </div>
                <div className="space-y-1.5">
                  <Label>IVA de las facturas (%)</Label>
                  <Input inputMode="numeric" value={iva} onChange={(e) => setIva(e.target.value.replace(/\D/g, "").slice(0, 2))} />
                  <p className="text-[11px] text-muted-foreground">las boletas no llevan</p>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Comisión de Mercado Pago en el débito automático (%)</Label>
                <Input
                  inputMode="decimal"
                  className="w-28"
                  value={comisionMp}
                  onChange={(e) => setComisionMp(e.target.value.replace(/[^\d.,]/g, "").slice(0, 5))}
                />
                <p className="text-[11px] text-muted-foreground">
                  Lo que se queda Mercado Pago de cada débito, con IVA (0 = sin recargo). Se le suma al débito para que te llegue el total
                  de la boleta: con {comisionPct(comisionMp.replace(",", ".")) || 0}%, una boleta de {formatARS(100000)} se debita{" "}
                  {formatARS(montoDebito(100000, comisionPct(comisionMp.replace(",", "."))))}. La boleta y la factura no cambian. Los débitos
                  ya activos siguen con su monto hasta que toques "Cobrar $X desde ahora" en la ficha del cliente.
                </p>
              </div>
              {(
                [
                  ["titular", "Titular"],
                  ["cuit", "CUIT"],
                  ["banco", "Banco"],
                  ["alias", "Alias"],
                  ["cbu", "CBU"],
                  ["email", "Mail para comprobantes (opcional)"],
                ] as [keyof DatosCobro, string][]
              ).map(([k, l]) => (
                <div key={k} className="space-y-1">
                  <Label className="text-xs">{l}</Label>
                  <Input value={cobro[k] ?? ""} onChange={(e) => setCobro((c) => ({ ...c, [k]: e.target.value }))} />
                </div>
              ))}
              <Button
                className="w-full"
                onClick={() =>
                  void guardar("fact", {
                    dia_vencimiento: Math.min(28, Math.max(1, Number(diaVto) || 5)),
                    iva_pct: Math.min(27, Number(iva) || 0),
                    comision_mp_pct: comisionPct(comisionMp.replace(",", ".")),
                    cobro,
                  })
                }
                disabled={saving === "fact"}
              >
                {saving === "fact" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Guardar
              </Button>
            </div>
          </Section>

          <Section title="Google Drive y Calendar" description="Drive guarda el crudo, los videos finales y las piezas gráficas. Calendar agenda las reuniones y las tareas con fecha.">
            <DriveCard />
          </Section>

          <Section
            title="Datos de ejemplo"
            description="Los mismos clientes, videos, chats y cobros de la demo, para mostrar el sistema andando antes de cargar los reales."
          >
            <EjemploCard />
          </Section>
        </div>
      </div>
    </PageShell>
  );
}

function PlanesEditor({ planes }: { planes: PlanRedes[] }) {
  const [adding, setAdding] = useState(false);
  const nuevo = async () => {
    assertEditable();
    setAdding(true);
    try {
      await addDoc(collection(db, "planes_redes"), {
        nombre: `Plan ${planes.length + 1}`,
        descripcion: "",
        videos_mes: 4,
        piezas_mes: 0,
        precio_mensual: 0,
        precio_video_extra: 0,
        activo: true,
        orden: planes.length,
      });
    } finally {
      setAdding(false);
    }
  };
  return (
    <div className="space-y-3">
      {planes.map((p) => (
        <PlanRow key={p.id} plan={p} />
      ))}
      {planes.length === 0 && (
        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          Todavía no hay planes. Creá los paquetes que vendés (ej. 4, 8 y 12 videos por mes).
        </p>
      )}
      <Button variant="outline" onClick={nuevo} disabled={adding}>
        <Plus className="mr-2 h-4 w-4" /> Nuevo plan
      </Button>
    </div>
  );
}

function PlanRow({ plan }: { plan: PlanRedes }) {
  // Todos los clientes, también los pausados: si no, quedan apuntando a un plan borrado.
  const { projects } = useAppData();
  const enUso = projects.filter((c) => c.plan_redes_id === plan.id).length;
  const [borrar, setBorrar] = useState(false);
  const [f, setF] = useState(plan);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) setF(plan);
  }, [plan, dirty]);
  const set = (patch: Partial<PlanRedes>) => {
    setF((p) => ({ ...p, ...patch }));
    setDirty(true);
  };
  const save = async () => {
    assertEditable();
    const { id, ...rest } = f;
    await updateDoc(doc(db, "planes_redes", id), rest as Record<string, unknown>);
    setDirty(false);
    toast.success("Plan guardado");
  };
  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2">
        <Input value={f.nombre} onChange={(e) => set({ nombre: e.target.value })} className="font-semibold" />
        <label className="flex shrink-0 items-center gap-2 text-xs">
          <Switch checked={f.activo} onCheckedChange={(v) => set({ activo: v })} /> Activo
        </label>
        <Button
          size="icon"
          variant="ghost"
          disabled={enUso > 0}
          title={enUso > 0 ? `Lo ${enUso === 1 ? "usa 1 cliente" : `usan ${enUso} clientes`}: desactivalo en vez de borrarlo` : "Eliminar plan"}
          onClick={() => setBorrar(true)}
          aria-label="Eliminar plan"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <AlertDialog open={borrar} onOpenChange={setBorrar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar el plan {plan.nombre}?</AlertDialogTitle>
            <AlertDialogDescription>No se puede deshacer. Si solo querés que no se ofrezca más, mejor desactivalo.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setBorrar(false);
                void (async () => {
                  try {
                    assertEditable();
                    await deleteDoc(doc(db, "planes_redes", plan.id));
                    toast.success("Plan eliminado");
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "No se pudo eliminar");
                  }
                })();
              }}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="space-y-1">
          <Label className="text-xs">Videos por mes</Label>
          <Input inputMode="numeric" value={f.videos_mes} onChange={(e) => set({ videos_mes: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Piezas por mes</Label>
          <Input inputMode="numeric" value={f.piezas_mes ?? 0} onChange={(e) => set({ piezas_mes: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Abono mensual</Label>
          <Input inputMode="numeric" value={f.precio_mensual} onChange={(e) => set({ precio_mensual: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Video extra</Label>
          <Input inputMode="numeric" value={f.precio_video_extra} onChange={(e) => set({ precio_video_extra: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {formatARS(f.videos_mes ? f.precio_mensual / f.videos_mes : 0)} por video
        </p>
        {dirty && (
          <Button size="sm" onClick={save}>
            Guardar
          </Button>
        )}
      </div>
    </div>
  );
}

function DriveCard() {
  const { connection, status, loading, connect, disconnect, reconnect } = useDriveConnection();
  const [busy, setBusy] = useState(false);
  // Conexiones de antes de Calendar: hay que reconectar una vez para dar el permiso nuevo.
  const sinCalendario = status === "connected" && !(connection?.scopes ?? "").includes("calendar.events");
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo completar");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex items-center gap-3">
        <HardDrive className="h-5 w-5 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          {loading ? (
            <p className="text-sm text-muted-foreground">Verificando…</p>
          ) : status === "connected" ? (
            <>
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <CheckCircle2 className="h-4 w-4 text-success" /> Conectado
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {connection?.email} · carpeta “Progreso”{sinCalendario ? "" : " · Google Calendar"}
              </p>
            </>
          ) : (
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <XCircle className="h-4 w-4 text-destructive" />
              {status === "revoked" ? "La conexión venció" : "Sin conectar"}
            </p>
          )}
        </div>
      </div>
      {sinCalendario && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-800 dark:text-amber-300">
          <p className="font-medium">Falta permitir Google Calendar</p>
          <p className="mt-0.5">
            Las reuniones y las tareas con fecha se agendan solas en el calendario de esta cuenta y les llega la invitación a
            cada participante. Para eso tocá “Reconectar con Calendar” y aceptá el permiso nuevo (una sola vez).
          </p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {status === "connected" ? (
          <>
            {sinCalendario && (
              <Button size="sm" onClick={() => run(reconnect)} disabled={busy}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Reconectar con Calendar
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => run(disconnect)} disabled={busy}>
              Desconectar
            </Button>
          </>
        ) : (
          <Button size="sm" onClick={() => run(status === "revoked" ? reconnect : connect)} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {status === "revoked" ? "Reconectar" : "Conectar Google"}
          </Button>
        )}
      </div>
    </div>
  );
}

function EjemploCard() {
  const [estado, setEstado] = useState<{ cargado_at?: string } | null>(null);
  const [busy, setBusy] = useState<null | "cargar" | "borrar">(null);
  const [confirmar, setConfirmar] = useState(false);
  useEffect(
    () => onSnapshot(doc(db, "app_settings", "demo_ejemplo"), (snap) => setEstado(snap.exists() ? (snap.data() as { cargado_at?: string }) : null)),
    []
  );
  const run = async (accion: "cargar" | "borrar") => {
    setBusy(accion);
    try {
      const r = await callApi<{ documentos: number }>(`/api/usuarios/ejemplo-${accion}`);
      toast.success(accion === "cargar" ? `Listo: se cargaron ${r.documentos} datos de ejemplo` : "Datos de ejemplo borrados");
      setConfirmar(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo completar");
    } finally {
      setBusy(null);
    }
  };
  const cargados = !!estado?.cargado_at;
  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <p className="flex items-center gap-2 text-sm font-medium">
        <FlaskConical className="h-4 w-4 text-primary" />
        {cargados ? `Cargados el ${fechaHora(estado!.cargado_at!)}` : "No hay datos de ejemplo"}
      </p>
      <p className="text-xs text-muted-foreground">
        {cargados
          ? "Las personas de ejemplo dicen “· ejemplo” y no reciben avisos ni mails. Al borrarlos se va todo lo de esos clientes, incluido lo que se haya creado después."
          : "Suma 5 clientes con videos en todas las etapas, rodajes, piezas, chats, reuniones y cobros. No toca tus datos reales ni la configuración."}
      </p>
      {!cargados ? (
        <Button size="sm" onClick={() => run("cargar")} disabled={!!busy}>
          {busy === "cargar" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Cargar datos de ejemplo
        </Button>
      ) : confirmar ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs">¿Seguro? Se borra todo lo de los clientes de ejemplo.</span>
          <Button size="sm" variant="destructive" onClick={() => run("borrar")} disabled={!!busy}>
            {busy === "borrar" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Sí, borrar
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirmar(false)}>
            Cancelar
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setConfirmar(true)}>
          Borrar datos de ejemplo
        </Button>
      )}
    </div>
  );
}

type EstadoIA = { claude: boolean; openai: boolean; gemini: boolean; modelo_claude: string };

/** Qué IA hace cada cosa, si su clave está cargada, y la elección para las imágenes. */
function IAConexiones({ imagenes, onImagenes }: { imagenes: "openai" | "gemini"; onImagenes: (v: "openai" | "gemini") => void }) {
  const [estado, setEstado] = useState<EstadoIA | null>(null);
  useEffect(() => {
    callApi<EstadoIA>("/api/ia/estado", {})
      .then(setEstado)
      .catch(() => setEstado(null));
  }, []);
  const Clave = ({ ok, nombre }: { ok?: boolean; nombre: string }) =>
    estado === null ? null : ok ? (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5" /> Conectada
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 text-xs text-destructive">
        <XCircle className="h-3.5 w-3.5" /> Falta {nombre}
      </span>
    );
  const filas: { que: string; detalle: string; con: React.ReactNode; clave: React.ReactNode }[] = [
    {
      que: "Textos",
      detalle: "@prodi en el chat, copys, guiones, plan del mes y minutas escritas",
      con: <b>Claude</b>,
      clave: <Clave ok={estado?.claude} nombre="ANTHROPIC_API_KEY" />,
    },
    {
      que: "Imágenes de las piezas",
      detalle: "ChatGPT escribe mejor el texto dentro de la imagen; Gemini es más rápido y barato",
      con: (
        <div className="grid grid-cols-2 gap-1 rounded-lg border bg-muted/40 p-0.5">
          {(["openai", "gemini"] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => p !== imagenes && onImagenes(p)}
              className={cn("rounded-md px-2.5 py-1 text-xs font-medium transition-all", imagenes === p ? "bg-background shadow-sm" : "text-muted-foreground")}
            >
              {p === "openai" ? "ChatGPT" : "Gemini"}
            </button>
          ))}
        </div>
      ),
      clave: <Clave ok={imagenes === "openai" ? estado?.openai : estado?.gemini} nombre={imagenes === "openai" ? "OPENAI_API_KEY" : "GEMINI_API_KEY"} />,
    },
    {
      que: "Minutas desde el audio",
      detalle: "Escucha la grabación de la reunión entera",
      con: <b>Gemini</b>,
      clave: <Clave ok={estado?.gemini} nombre="GEMINI_API_KEY" />,
    },
  ];
  return (
    <div className="divide-y rounded-xl border bg-card">
      {filas.map((f) => (
        <div key={f.que} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
          <div className="min-w-0 flex-1 basis-56">
            <p className="text-sm font-medium">{f.que}</p>
            <p className="text-xs text-muted-foreground">{f.detalle}</p>
          </div>
          <div className="text-sm">{f.con}</div>
          <div className="w-44 text-right">{f.clave}</div>
        </div>
      ))}
      {estado?.claude && <p className="px-4 py-2 text-[11px] text-muted-foreground">Modelo de Claude: {estado.modelo_claude}</p>}
    </div>
  );
}
