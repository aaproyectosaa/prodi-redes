import { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  CreditCard,
  Facebook,
  MessageCircle,
  Package,
  Palette,
  Rocket,
  Sparkles,
  UserPlus,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { collection, doc, onSnapshot, query, updateDoc, where } from "@/lib/db";
import { db } from "@/integrations/firebase/client";
import { Button } from "@/components/ui/button";
import { PlanMesDialog } from "@/components/redes/PlanMesDialog";
import { useRedes } from "@/contexts/redes-data-context";
import { useAppData } from "@/contexts/app-data-context";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { chatClienteId } from "@/lib/redes/chat";
import { PLANES_MES } from "@/lib/redes/planMes";
import { planDe } from "@/lib/redes/planes";
import { assertEditable } from "@/lib/redes/vistaComo";
import type { PlanMes } from "@/lib/redes/types";
import type { Project, ProjectTeamRole } from "@/integrations/firebase/types";
import { cn } from "@/lib/utils";

/** Pasos que se pueden tildar a mano (lo que el sistema no ve solo). Se guarda en projects.arranque_manual. */
type ClaveManual = "meta" | "facturacion";

interface Paso {
  key: string;
  icon: LucideIcon;
  label: string;
  /** Qué falta o qué hay, en una línea. */
  detalle: string;
  done: boolean;
  /** Tildado a mano (no lo detectó el sistema). */
  manual?: boolean;
  /** Se puede tildar a mano. */
  manualKey?: ClaveManual;
  hacer?: () => void;
}

const DIAS_VIEJO = 60;
const keyOculto = (id: string) => `arranque_oculto_${id}`;

const leerOculto = (id: string) => {
  try {
    return localStorage.getItem(keyOculto(id)) === "1";
  } catch {
    return false;
  }
};

/** Busca la sección por su título (h2) y la lleva a la vista, después de que cambió de pestaña. */
function irASeccion(titulo: string) {
  window.setTimeout(() => {
    const h = Array.from(document.querySelectorAll("h2")).find((el) => el.textContent?.trim() === titulo);
    h?.closest("section")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 120);
}

/**
 * "Arranque de un cliente nuevo": la lista de lo que hay que dejar listo para que nadie se olvide de un paso.
 * Casi todo se tilda solo con lo que ya está cargado; lo que el sistema no ve (Meta, facturación) se tilda a mano.
 * Completo → queda una pastilla chiquita (que se puede cerrar). Clientes de más de 60 días con videos publicados: no se muestra.
 */
export function ArranqueCliente({ cliente, onTab }: { cliente: Project; onTab: (tab: string) => void }) {
  const { planes, videos, chats } = useRedes();
  const { profiles } = useAppData();
  const { role } = useUserProfileContext();
  const isAdmin = role === "admin";
  const [planesMes, setPlanesMes] = useState<PlanMes[] | null>(null);
  const [abierto, setAbierto] = useState(true);
  const [oculto, setOculto] = useState(() => leerOculto(cliente.id));
  const [armarMes, setArmarMes] = useState(false);
  const [guardando, setGuardando] = useState<string | null>(null);

  useEffect(() => setOculto(leerOculto(cliente.id)), [cliente.id]);

  useEffect(
    () =>
      onSnapshot(
        query(collection(db, PLANES_MES), where("proyecto_id", "==", cliente.id)),
        (s) => setPlanesMes(s.docs.map((d) => ({ id: d.id, ...d.data() }) as PlanMes)),
        () => setPlanesMes([])
      ),
    [cliente.id]
  );

  // Cliente viejo que ya viene publicando: no molesta.
  const desde = cliente.alta || cliente.created_at;
  const dias = desde ? (Date.now() - new Date(desde).getTime()) / 86_400_000 : 0;
  const tienePublicados = videos.some((v) => v.proyecto_id === cliente.id && v.etapa === "publicado");
  if (dias > DIAS_VIEJO && tienePublicados) return null;

  const manual = cliente.arranque_manual ?? {};
  const plan = planDe(cliente, planes);
  const o = cliente.plan_redes_override ?? {};
  const team = cliente.team_roles ?? {};
  const piezas = o.piezas_mes ?? plan.plan?.piezas_mes ?? 0;
  const soloPauta = cliente.produccion?.servicio === "solo_pauta";
  const subeCliente = cliente.produccion?.publica === "cliente" && !soloPauta;

  // Equipo: producción, edición y pauta; diseño si el plan trae piezas. Solo pauta no lleva edición; si sube el cliente, no hay pauta.
  const rolesNecesarios: { rol: ProjectTeamRole; label: string }[] = [
    { rol: "productor", label: "producción" },
    ...(soloPauta ? [] : [{ rol: "editor" as const, label: "edición" }]),
    ...(subeCliente ? [] : [{ rol: "pauta" as const, label: "pauta" }]),
    ...(piezas > 0 ? [{ rol: "diseno" as const, label: "diseño" }] : []),
  ];
  const faltanRoles = rolesNecesarios.filter((r) => !(team[r.rol]?.length));

  const integrantes = profiles.filter(
    (p) => (p.role === "contacto" && p.proyecto_id === cliente.id) || (team.cliente ?? []).includes(p.id)
  ).length;

  const colores = (cliente.marca?.paleta?.length ?? 0) > 0 || !!cliente.marca?.colores?.trim();
  const logo = !!cliente.marca_archivos?.logo;

  const m = cliente.meta ?? {};
  const metaAuto = !!(m.conectado || m.ad_account_id || m.page_id || m.ig_user_id);

  const f = cliente.facturacion ?? {};
  const debito = cliente.suscripcion?.estado === "activa" || cliente.suscripcion?.estado === "pendiente";
  const factAuto = debito || !!(f.cuit?.trim() || f.razon_social?.trim() || f.condicion_iva);

  const enviados = (planesMes ?? []).filter((p) => p.estado !== "borrador");
  const borrador = (planesMes ?? []).some((p) => p.estado === "borrador");

  const chat = chats.find((c) => c.id === chatClienteId(cliente.id) && !c.borrado);

  const config = (seccion: string) => () => {
    onTab("config");
    irASeccion(seccion);
  };

  const pasos: Paso[] = [
    {
      key: "plan",
      icon: Package,
      label: "Plan asignado",
      detalle: plan.nombre === "Sin plan" ? "Elegí el plan o cargá uno a medida" : `${plan.nombre} · ${plan.videosMes} videos/mes`,
      done: plan.nombre !== "Sin plan",
      hacer: isAdmin ? config("Datos y plan") : undefined,
    },
    {
      key: "equipo",
      icon: Users,
      label: "Equipo asignado",
      detalle: faltanRoles.length ? `Falta: ${faltanRoles.map((r) => r.label).join(", ")}` : rolesNecesarios.map((r) => r.label).join(", "),
      done: faltanRoles.length === 0,
      hacer: isAdmin ? config("Equipo del cliente") : undefined,
    },
    {
      key: "integrantes",
      icon: UserPlus,
      label: "Integrantes del cliente",
      detalle: integrantes ? `${integrantes} ${integrantes === 1 ? "persona cargada" : "personas cargadas"}` : "Cargá a la gente de la empresa",
      done: integrantes > 0,
      hacer: config("Integrantes"),
    },
    {
      key: "marca",
      icon: Palette,
      label: "Marca: logo y colores",
      detalle: logo && colores ? "Logo y paleta cargados" : `Falta: ${[!logo && "logo", !colores && "colores"].filter(Boolean).join(" y ")}`,
      done: logo && colores,
      hacer: config("Marca"),
    },
    {
      key: "meta",
      icon: Facebook,
      label: "Accesos a redes / Meta",
      detalle: metaAuto ? "IDs de Meta cargados" : manual.meta ? "Tildado a mano" : "Cargá los IDs de Meta o tildalo si ya dio los accesos",
      done: metaAuto || !!manual.meta,
      manual: !metaAuto && !!manual.meta,
      manualKey: metaAuto ? undefined : "meta",
      hacer: config("Contacto, redes y Meta"),
    },
    {
      key: "facturacion",
      icon: CreditCard,
      label: "Facturación o débito",
      detalle: debito
        ? "Débito automático activo"
        : factAuto
          ? "Datos de facturación cargados"
          : manual.facturacion
            ? "Tildado a mano"
            : "Cargá razón social / CUIT o el débito automático",
      done: factAuto || !!manual.facturacion,
      manual: !factAuto && !!manual.facturacion,
      manualKey: factAuto ? undefined : "facturacion",
      hacer: isAdmin ? config("Facturación") : undefined,
    },
    {
      key: "plan_mes",
      icon: Sparkles,
      label: "Primer plan del mes",
      detalle: enviados.length ? "Ya se le mandó al cliente" : borrador ? "Hay un borrador sin mandar" : "Armalo con IA y mandáselo",
      done: enviados.length > 0,
      hacer: () => setArmarMes(true),
    },
    {
      key: "chat",
      icon: MessageCircle,
      label: "Grupo de chat",
      detalle: chat ? "Creado" : "Se arma solo cuando el super admin abre la app (con el equipo y los integrantes cargados)",
      done: !!chat,
    },
  ];

  const listos = pasos.filter((p) => p.done).length;
  const total = pasos.length;
  const completo = listos === total;
  const pct = Math.round((listos / total) * 100);

  const tildar = async (k: ClaveManual, v: boolean) => {
    setGuardando(k);
    try {
      assertEditable();
      await updateDoc(doc(db, "projects", cliente.id), { arranque_manual: { ...manual, [k]: v } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setGuardando(null);
    }
  };

  const ocultar = () => {
    setOculto(true);
    try {
      localStorage.setItem(keyOculto(cliente.id), "1");
    } catch {
      /* sin almacenamiento: se oculta hasta recargar */
    }
  };

  const dialogo = <PlanMesDialog open={armarMes} onOpenChange={setArmarMes} clienteId={cliente.id} />;

  if (completo) {
    if (oculto) return dialogo;
    return (
      <>
        <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-emerald-500/10 py-1 pl-3 pr-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
          <Check className="h-3.5 w-3.5" /> Arranque completo
          <button type="button" onClick={ocultar} className="flex h-5 w-5 items-center justify-center rounded-full hover:bg-emerald-500/20" aria-label="Ocultar">
            <X className="h-3 w-3" />
          </button>
        </div>
        {dialogo}
      </>
    );
  }

  return (
    <>
      <section className="mb-6 overflow-hidden rounded-2xl border bg-card shadow-sm">
        <button type="button" onClick={() => setAbierto((v) => !v)} className="flex w-full items-center gap-3 p-4 text-left" aria-expanded={abierto}>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-fuchsia-500 text-white shadow-sm">
            <Rocket className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Arranque del cliente</span>
            <span className="block text-xs text-muted-foreground">
              {listos} de {total} listos · lo que hay que dejar armado para empezar
            </span>
          </span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", abierto && "rotate-180")} />
        </button>
        <div className="px-4 pb-1">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={listos} aria-valuemin={0} aria-valuemax={total}>
            <div className="h-full rounded-full bg-gradient-to-r from-primary to-fuchsia-500 transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
        </div>
        {abierto && (
          <ul className="grid gap-2 p-4 sm:grid-cols-2">
            {pasos.map((p) => {
              const Icono = p.icon;
              const puedeTildar = isAdmin && !!p.manualKey;
              return (
                <li
                  key={p.key}
                  className={cn("flex items-center gap-3 rounded-xl p-3 transition-colors", p.done ? "bg-muted/40" : "bg-muted/60")}
                >
                  <button
                    type="button"
                    disabled={!puedeTildar || guardando === p.manualKey}
                    onClick={() => p.manualKey && void tildar(p.manualKey, !manual[p.manualKey])}
                    title={puedeTildar ? (p.done ? "Destildar" : "Tildar a mano") : p.manualKey ? "Lo tilda el super admin" : "Se tilda solo"}
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-colors",
                      p.done ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground",
                      puedeTildar && !p.done && "hover:border-primary hover:text-primary",
                      !puedeTildar && "cursor-default"
                    )}
                  >
                    {p.done ? <Check className="h-4 w-4" /> : <Icono className="h-4 w-4" />}
                  </button>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-sm font-medium", p.done && "text-muted-foreground")}>{p.label}</span>
                    <span className="block truncate text-[11px] text-muted-foreground" title={p.detalle}>
                      {p.detalle}
                    </span>
                  </span>
                  {!p.done && p.hacer && (
                    <Button size="sm" variant="ghost" className="h-8 shrink-0 px-2.5 text-xs text-primary hover:text-primary" onClick={p.hacer}>
                      Hacer <ArrowRight className="ml-1 h-3.5 w-3.5" />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {dialogo}
    </>
  );
}
