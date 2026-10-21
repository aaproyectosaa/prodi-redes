import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Copy, ExternalLink, FileText, Loader2, MessageCircle, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageShell } from "@/components/redes/PageShell";
import { FilaKpis, Kpi, Vacio } from "@/components/redes/admin/AdminUI";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { InputNumero } from "@/components/ui/input-numero";
import { useRedes } from "@/contexts/redes-data-context";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import {
  borrarPresupuesto,
  crearPresupuesto,
  ESTADO_PRESUPUESTO,
  estadoVisible,
  guardarPresupuesto,
  linkPresupuesto,
  totalesPresupuesto,
  usePresupuestos,
  type ItemPresupuesto,
  type Presupuesto,
} from "@/lib/redes/presupuestos";
import { cn } from "@/lib/utils";

// Presupuestos para clientes nuevos: se arman acá, se manda el link y el cliente lo acepta, crea su usuario y queda
// como cliente (api/_lib/presupuestos.ts).

const zona = "America/Argentina/Buenos_Aires";
const enDias = (n: number) => new Date(Date.now() + n * 86_400_000).toLocaleDateString("en-CA", { timeZone: zona });
const dia = (f: string) => new Date(`${f.slice(0, 10)}T12:00:00`).toLocaleDateString("es-AR", { day: "numeric", month: "short" });
const plata = (n: number, moneda: string) => `${moneda === "USD" ? "US$" : "$"} ${Math.round(n).toLocaleString("es-AR")}`;
const nuevoItem = (periodo: ItemPresupuesto["periodo"] = "mensual"): ItemPresupuesto => ({ id: `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, concepto: "", cantidad: 1, precio: 0, periodo });

type Borrador = Omit<Presupuesto, "id" | "token" | "created_at" | "estado" | "numero" | "created_by">;

function Editor({ inicial, id, onClose }: { inicial: Borrador; id: string | null; onClose: () => void }) {
  const { planes, settings } = useRedes();
  const { user } = useUserProfileContext();
  const [p, setP] = useState<Borrador>(inicial);
  const [busy, setBusy] = useState(false);
  const lista = usePresupuestos(true);
  const set = <K extends keyof Borrador>(k: K, v: Borrador[K]) => setP((x) => ({ ...x, [k]: v }));
  const setItem = (iid: string, cambios: Partial<ItemPresupuesto>) => set("items", p.items.map((i) => (i.id === iid ? { ...i, ...cambios } : i)));
  const tot = totalesPresupuesto(p.items, p.tipo, settings.iva_pct ?? 21);

  const elegirPlan = (planId: string) => {
    const plan = planes.find((x) => x.id === planId);
    const sinPlan = p.items.filter((i) => !i.id.startsWith("plan-"));
    if (!plan) return setP((x) => ({ ...x, plan_id: null, items: sinPlan }));
    const item: ItemPresupuesto = {
      id: `plan-${plan.id}`,
      concepto: `Plan ${plan.nombre}`,
      detalle: `${plan.videos_mes} videos por mes${plan.piezas_mes ? ` + ${plan.piezas_mes} piezas gráficas` : ""}, publicación y pauta en Meta`,
      cantidad: 1,
      precio: plan.precio_mensual,
      periodo: "mensual",
    };
    setP((x) => ({ ...x, plan_id: plan.id, items: [item, ...sinPlan] }));
  };

  const guardar = async () => {
    if (!p.empresa.trim()) return toast.error("Poné el nombre de la empresa");
    const items = p.items.filter((i) => i.concepto.trim() && i.precio > 0);
    if (!items.length) return toast.error("Agregá al menos un ítem con precio");
    setBusy(true);
    try {
      const datos = { ...p, empresa: p.empresa.trim(), items };
      if (id) await guardarPresupuesto(id, datos);
      else await crearPresupuesto({ ...datos, created_by: user?.uid ?? "" }, Math.max(0, ...(lista ?? []).map((x) => x.numero ?? 0)) + 1);
      toast.success("Presupuesto guardado");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Empresa</Label>
          <Input value={p.empresa} onChange={(e) => set("empresa", e.target.value)} placeholder="Ej.: Pizzería Don Tano" />
        </div>
        <div className="space-y-1.5">
          <Label>Contacto</Label>
          <Input value={p.contacto.nombre ?? ""} onChange={(e) => set("contacto", { ...p.contacto, nombre: e.target.value })} placeholder="Nombre" />
        </div>
        <div className="space-y-1.5">
          <Label>WhatsApp</Label>
          <Input value={p.contacto.telefono ?? ""} onChange={(e) => set("contacto", { ...p.contacto, telefono: e.target.value })} placeholder="Ej.: 3492 123456" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Plan</Label>
        <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={p.plan_id ?? ""} onChange={(e) => elegirPlan(e.target.value)}>
          <option value="">Sin plan (solo ítems sueltos)</option>
          {planes
            .filter((x) => x.activo !== false)
            .map((x) => (
              <option key={x.id} value={x.id}>
                {x.nombre} · {x.videos_mes} videos · ${x.precio_mensual.toLocaleString("es-AR")}/mes
              </option>
            ))}
        </select>
      </div>

      <div className="space-y-2">
        <Label>Ítems</Label>
        {p.items.map((i) => (
          <div key={i.id} className="space-y-2 rounded-xl border p-3">
            <div className="flex gap-2">
              <Input value={i.concepto} onChange={(e) => setItem(i.id, { concepto: e.target.value })} placeholder="Concepto (ej.: Jornada de filmación)" />
              <Button size="icon" variant="ghost" className="shrink-0" onClick={() => set("items", p.items.filter((x) => x.id !== i.id))} aria-label="Quitar">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <Input value={i.detalle ?? ""} onChange={(e) => setItem(i.id, { detalle: e.target.value })} placeholder="Detalle (opcional)" className="text-xs" />
            <div className="grid grid-cols-3 gap-2">
              <InputNumero value={String(i.cantidad)} onChange={(e) => setItem(i.id, { cantidad: Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1) })} aria-label="Cantidad" />
              <InputNumero value={i.precio ? String(i.precio) : ""} onChange={(e) => setItem(i.id, { precio: Number(e.target.value.replace(/\D/g, "")) || 0 })} placeholder="Precio" aria-label="Precio" />
              <select className="h-10 rounded-md border bg-background px-2 text-sm" value={i.periodo} onChange={(e) => setItem(i.id, { periodo: e.target.value as ItemPresupuesto["periodo"] })}>
                <option value="mensual">Por mes</option>
                <option value="unico">Una vez</option>
              </select>
            </div>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => set("items", [...p.items, nuevoItem("mensual")])}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Ítem mensual
          </Button>
          <Button size="sm" variant="outline" onClick={() => set("items", [...p.items, nuevoItem("unico")])}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Ítem de una vez
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label>Moneda</Label>
          <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={p.moneda} onChange={(e) => set("moneda", e.target.value as "ARS" | "USD")}>
            <option value="ARS">Pesos</option>
            <option value="USD">Dólares</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label>Comprobante</Label>
          <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={p.tipo} onChange={(e) => set("tipo", e.target.value as "factura" | "boleta")}>
            <option value="factura">Factura (+ IVA)</option>
            <option value="boleta">Boleta (sin IVA)</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label>Vale hasta</Label>
          <Input type="date" value={p.validez} onChange={(e) => set("validez", e.target.value)} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Mensaje para el cliente (opcional)</Label>
        <Textarea value={p.nota ?? ""} onChange={(e) => set("nota", e.target.value)} rows={3} placeholder="Ej.: ¡Hola Martín! Como charlamos, arrancamos con 4 videos por mes y la pauta en Instagram." />
      </div>

      <div className="rounded-xl border bg-muted/30 p-3 text-sm">
        {tot.mensual > 0 && (
          <p className="flex justify-between">
            <span>Por mes{tot.iva_pct ? ` (+ IVA ${tot.iva_pct}%)` : ""}</span>
            <b className="tabular-nums">{plata(tot.mensual_final, p.moneda)}</b>
          </p>
        )}
        {tot.unico > 0 && (
          <p className="flex justify-between">
            <span>Una vez{tot.iva_pct ? ` (+ IVA ${tot.iva_pct}%)` : ""}</span>
            <b className="tabular-nums">{plata(tot.unico_final, p.moneda)}</b>
          </p>
        )}
        {!tot.mensual && !tot.unico && <p className="text-muted-foreground">Agregá ítems para ver el total.</p>}
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button onClick={() => void guardar()} disabled={busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Guardar
        </Button>
      </div>
    </div>
  );
}

function Fila({ p, onEditar }: { p: Presupuesto; onEditar: () => void }) {
  const navigate = useNavigate();
  const { settings } = useRedes();
  const est = estadoVisible(p);
  const tot = totalesPresupuesto(p.items, p.tipo, settings.iva_pct ?? 21);
  const link = linkPresupuesto(p);
  const marcarEnviado = () => p.estado === "borrador" && void guardarPresupuesto(p.id, { estado: "enviado", enviado_at: new Date().toISOString() });
  const copiar = async () => {
    await navigator.clipboard.writeText(link);
    marcarEnviado();
    toast.success("Link copiado");
  };
  const whatsapp = () => {
    const tel = String(p.contacto.telefono ?? "").replace(/\D/g, "");
    const texto = `¡Hola${p.contacto.nombre ? ` ${p.contacto.nombre.split(" ")[0]}` : ""}! Te paso el presupuesto de Prodi para ${p.empresa}. Lo podés ver y aceptar desde acá: ${link}`;
    window.open(`https://wa.me/${tel ? (tel.startsWith("54") ? tel : `549${tel}`) : ""}?text=${encodeURIComponent(texto)}`, "_blank");
    marcarEnviado();
  };
  return (
    <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          <span className="text-muted-foreground">#{p.numero}</span> {p.empresa}
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", ESTADO_PRESUPUESTO[est].clase)}>{ESTADO_PRESUPUESTO[est].label}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          {tot.mensual ? `${plata(tot.mensual_final, p.moneda)}/mes` : ""}
          {tot.mensual && tot.unico ? " + " : ""}
          {tot.unico ? `${plata(tot.unico_final, p.moneda)} una vez` : ""}
          {` · vale hasta el ${dia(p.validez)}`}
          {p.visto_at && est !== "aceptado" ? ` · lo vio el ${dia(p.visto_at)}` : ""}
          {p.aceptado ? ` · aceptó ${p.aceptado.nombre} el ${dia(p.aceptado.at)}` : ""}
        </p>
      </div>
      <div className="flex flex-wrap gap-1">
        {p.aceptado ? (
          <Button size="sm" variant="outline" onClick={() => navigate(`/clientes/${p.aceptado!.proyecto_id}`)}>
            Ver cliente
          </Button>
        ) : (
          <>
            <Button size="sm" onClick={whatsapp}>
              <MessageCircle className="mr-1.5 h-3.5 w-3.5" /> WhatsApp
            </Button>
            <Button size="sm" variant="outline" onClick={() => void copiar()}>
              <Copy className="mr-1.5 h-3.5 w-3.5" /> Link
            </Button>
            <Button size="icon" variant="ghost" className="h-9 w-9" onClick={() => window.open(link, "_blank")} aria-label="Ver como el cliente">
              <ExternalLink className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" className="h-9 w-9" onClick={onEditar} aria-label="Editar">
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-9 w-9 text-muted-foreground hover:text-destructive"
              onClick={() => window.confirm(`¿Borrar el presupuesto de ${p.empresa}?`) && void borrarPresupuesto(p.id)}
              aria-label="Borrar"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

export default function Presupuestos() {
  const lista = usePresupuestos(true);
  const [editando, setEditando] = useState<{ id: string | null; datos: Borrador } | null>(null);
  const nuevo = (): Borrador => ({ empresa: "", contacto: {}, plan_id: null, items: [], moneda: "ARS", tipo: "factura", validez: enDias(15), nota: "" });
  const kpis = useMemo(() => {
    const l = lista ?? [];
    const est = l.map(estadoVisible);
    return {
      abiertos: est.filter((e) => e === "enviado" || e === "visto").length,
      vistos: est.filter((e) => e === "visto").length,
      aceptados: est.filter((e) => e === "aceptado").length,
      total: l.length,
    };
  }, [lista]);

  return (
    <PageShell
      title="Presupuestos"
      subtitle="Armá el presupuesto, mandale el link y el cliente lo acepta, crea su usuario y queda adentro."
      actions={
        <Button onClick={() => setEditando({ id: null, datos: nuevo() })}>
          <Plus className="mr-2 h-4 w-4" /> Nuevo presupuesto
        </Button>
      }
    >
      <FilaKpis className="mb-4">
        <Kpi icono={FileText} label="Esperando respuesta" valor={String(kpis.abiertos)} sub={`${kpis.vistos} ya lo vieron`} />
        <Kpi icono={FileText} tono="verde" label="Aceptados" valor={String(kpis.aceptados)} sub={kpis.total ? `${Math.round((kpis.aceptados / kpis.total) * 100)}% de los ${kpis.total}` : undefined} />
      </FilaKpis>

      {lista === null ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </div>
      ) : lista.length === 0 ? (
        <Vacio icono={FileText} titulo="Todavía no hay presupuestos" texto="Tocá «Nuevo presupuesto», elegí el plan y mandale el link al cliente." />
      ) : (
        <div className="overflow-hidden rounded-2xl border bg-card">
          {lista.map((p) => (
            <Fila key={p.id} p={p} onEditar={() => setEditando({ id: p.id, datos: { empresa: p.empresa, contacto: p.contacto ?? {}, plan_id: p.plan_id ?? null, items: p.items ?? [], moneda: p.moneda, tipo: p.tipo, validez: p.validez, nota: p.nota ?? "" } })} />
          ))}
        </div>
      )}

      <Dialog open={!!editando} onOpenChange={(o) => !o && setEditando(null)}>
        <DialogContent className="max-h-[92dvh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editando?.id ? "Editar presupuesto" : "Nuevo presupuesto"}</DialogTitle>
            <DialogDescription>Al guardar, copiá el link o mandalo por WhatsApp. El cliente lo acepta y crea su usuario ahí mismo.</DialogDescription>
          </DialogHeader>
          {editando && <Editor key={editando.id ?? "nuevo"} inicial={editando.datos} id={editando.id} onClose={() => setEditando(null)} />}
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

