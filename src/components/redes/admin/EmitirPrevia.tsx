// Vista previa antes de emitir y unir empresas del mismo dueño en un solo comprobante.
//
// - EmitirPrevia: al tocar "Emitir" se ve lo que le va a llegar a cada cliente (a nombre de quién, CUIT, renglones y
//   total). Si entre las elegidas hay empresas con el mismo CUIT o el mismo dueño, ofrece mandarles uno solo: la otra
//   queda "Junto con" la principal (datos de facturación) y su abono va como renglón.
// - UnirComprobanteDialog: para lo ya emitido sin CAE ni pagos: lo anula y lo pasa como renglón al de la otra empresa,
//   que vuelve a «Emitir» para revisarlo y mandarlo de nuevo.
//
// Boleta y factura no son lo mismo (la factura es el comprobante legal, con CAE de ARCA): cada texto dice cuál es.

import { useEffect, useMemo, useState } from "react";
import { Eye, Link2, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useRedes } from "@/contexts/redes-data-context";
import { armarFactura } from "../../../../api/_lib/facturacion";
import { formatARS } from "@/lib/redes/format";
import { planDe } from "@/lib/redes/planes";
import {
  agrupadasDe,
  anularFactura,
  guardarDatosFacturacion,
  pagadoDe,
  sincronizarBorrador,
  volverASinEmitir,
  type Factura,
  type FacturaDoc,
} from "@/lib/redes/facturacion";
import type { Project } from "@/integrations/firebase/types";
import { cn } from "@/lib/utils";

/** "boleta" o "factura" (no son lo mismo). */
export const nombreDoc = (t: Factura["tipo"]) => (t === "factura" ? "factura" : "boleta");
const Mayus = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** "boletas", "facturas" o "boletas y facturas" según lo que haya. */
export const nombreDocs = (lista: { tipo: Factura["tipo"] }[]) => {
  const f = lista.some((x) => x.tipo === "factura");
  const b = lista.some((x) => x.tipo !== "factura");
  return f && b ? "boletas y facturas" : f ? "facturas" : "boletas";
};

export interface FilaEmitir {
  pid: string;
  f: Factura;
  doc?: FacturaDoc;
}

const soloDigitos = (s?: string | null) => String(s ?? "").replace(/\D/g, "");

/** Empresas del mismo dueño entre las elegidas: mismo CUIT (11 dígitos) o un mismo usuario cliente. */
function gruposDe(filas: FilaEmitir[], cliente: (id: string) => Project | undefined) {
  const padre = new Map(filas.map((r) => [r.pid, r.pid]));
  const raiz = (x: string): string => (padre.get(x) === x ? x : raiz(padre.get(x)!));
  const motivo = new Map<string, "cuit" | "dueño">();
  for (let i = 0; i < filas.length; i++)
    for (let j = i + 1; j < filas.length; j++) {
      const a = filas[i];
      const b = filas[j];
      const ca = soloDigitos(a.f.cuit ?? cliente(a.pid)?.facturacion?.cuit);
      const cb = soloDigitos(b.f.cuit ?? cliente(b.pid)?.facturacion?.cuit);
      const mismoCuit = ca.length === 11 && ca === cb;
      const dueñosA = new Set(cliente(a.pid)?.team_roles?.cliente ?? []);
      const mismoDueño = (cliente(b.pid)?.team_roles?.cliente ?? []).some((u) => dueñosA.has(u));
      if (!mismoCuit && !mismoDueño) continue;
      const ra = raiz(a.pid);
      const rb = raiz(b.pid);
      if (ra !== rb) padre.set(rb, ra);
      const r = raiz(a.pid);
      if (mismoCuit) motivo.set(r, "cuit");
      else if (!motivo.has(r)) motivo.set(r, "dueño");
    }
  const porRaiz = new Map<string, FilaEmitir[]>();
  for (const r of filas) porRaiz.set(raiz(r.pid), [...(porRaiz.get(raiz(r.pid)) ?? []), r]);
  return [...porRaiz.entries()]
    .filter(([, l]) => l.length > 1)
    .map(([k, l]) => ({ clave: [...l.map((x) => x.pid)].sort().join("+"), filas: l, motivo: motivo.get(raiz(k)) ?? "dueño" }));
}

export function EmitirPrevia({
  filas,
  mes,
  onClose,
  onVer,
  onEmitir,
}: {
  filas: FilaEmitir[] | null;
  mes: string;
  onClose: () => void;
  onVer: (f: Factura) => void;
  /** Emite a estos clientes (ya unidas las empresas que se juntaron). */
  onEmitir: (pids: string[]) => Promise<void>;
}) {
  const { clientes, planes, settings, clienteById } = useRedes();
  const ivaPct = settings.iva_pct ?? 21;
  const lista = filas ?? [];
  const grupos = useMemo(() => gruposDe(lista, clienteById), [lista, clienteById]);
  // Por grupo: si se unen (por defecto sí con el mismo CUIT) y a nombre de qué empresa va.
  const [unir, setUnir] = useState<Record<string, boolean>>({});
  const [principal, setPrincipal] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!filas) return;
    setUnir(Object.fromEntries(grupos.map((g) => [g.clave, g.motivo === "cuit"])));
    setPrincipal(
      Object.fromEntries(grupos.map((g) => [g.clave, (g.filas.find((r) => r.f.razon_social) ?? [...g.filas].sort((a, b) => a.f.cliente.localeCompare(b.f.cliente))[0]).pid]))
    );
    // Solo al abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filas]);

  // Los clientes como quedarían (las que se unen, "Junto con" la principal).
  const juntoCon = new Map<string, string>();
  for (const g of grupos) if (unir[g.clave]) for (const r of g.filas) if (r.pid !== principal[g.clave]) juntoCon.set(r.pid, principal[g.clave]);
  const clientesNuevos = clientes.map((c) => (juntoCon.has(c.id) ? { ...c, facturacion: { ...(c.facturacion ?? {}), factura_con: juntoCon.get(c.id)! } } : c));
  const abonoDe = (c: Project) => planDe(c, planes).precioMensual;

  /** Lo que va a salir: una entrada por comprobante (las unidas, armadas juntas). */
  const salen = lista
    .filter((r) => !juntoCon.has(r.pid))
    .map((r) => {
      const unidas = lista.filter((x) => juntoCon.get(x.pid) === r.pid);
      if (!unidas.length) return { r, f: r.f, unidas };
      const c = clientesNuevos.find((x) => x.id === r.pid);
      if (!c) return { r, f: r.f, unidas };
      const plan = planDe(c, planes);
      const f = armarFactura(
        {
          id: c.id,
          nombre: c.nombre,
          abono: plan.precioMensual,
          planNombre: plan.nombre,
          facturacion: c.facturacion ?? null,
          agrupadas: agrupadasDe(c.id, clientesNuevos, abonoDe),
          debitoActivo: c.suscripcion?.estado === "activa",
        },
        mes,
        { ivaPct, diaVencimiento: settings.dia_vencimiento ?? 5, por: "", hoy: new Date().toISOString().slice(0, 10) }
      );
      // Los renglones cargados a mano en la que ya estaba armada se mantienen.
      const aMano = (r.doc?.items ?? []).filter((i) => !(i.id === "abono" || /^fijo\d+$/.test(i.id) || /^grupo\d+(fijo\d+)?$/.test(i.id)));
      const items = [...f.items, ...aMano];
      const neto = items.reduce((a, i) => a + i.neto, 0);
      const iva = f.tipo === "factura" ? Math.round(neto * (ivaPct / 100)) : 0;
      return { r, f: { ...f, items, neto, iva, bruto: neto + iva }, unidas };
    });
  const total = salen.reduce((a, s) => a + s.f.bruto, 0);
  const editadaAMano = (g: (typeof grupos)[number]) => !!lista.find((r) => r.pid === principal[g.clave])?.doc?.editada_a_mano;

  const confirmar = async () => {
    setBusy(true);
    try {
      for (const g of grupos) {
        if (!unir[g.clave]) continue;
        const pid = principal[g.clave];
        for (const r of g.filas) {
          if (r.pid === pid) continue;
          const c = clienteById(r.pid);
          await guardarDatosFacturacion(r.pid, { ...(c?.facturacion ?? {}), factura_con: pid });
          if (r.doc) await anularFactura(r.doc);
        }
        // La principal ya armada: se le suman ya los renglones de las otras (si no, se arman al emitir).
        const p = g.filas.find((r) => r.pid === pid);
        const c = clientesNuevos.find((x) => x.id === pid);
        if (p?.doc && c) await sincronizarBorrador(p.doc, c, abonoDe(c), ivaPct, agrupadasDe(pid, clientesNuevos, abonoDe));
      }
      await onEmitir(salen.map((s) => s.r.pid));
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo emitir");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!filas} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-h-[94dvh] w-[calc(100vw-1.5rem)] max-w-lg overflow-y-auto rounded-2xl">
        <DialogHeader className="text-left">
          <DialogTitle>Revisá antes de emitir</DialogTitle>
          <DialogDescription>
            Así le llega a cada cliente: a su panel y por mail. {salen.length === 1 ? `Sale 1 ${nombreDoc(salen[0]?.f.tipo ?? "factura")}` : `Salen ${salen.length} ${nombreDocs(salen.map((s) => s.f))}`}.
          </DialogDescription>
        </DialogHeader>

        {grupos.map((g) => (
          <div key={g.clave} className="space-y-2 rounded-xl border border-primary/30 bg-primary/[0.05] p-3">
            <label className="flex cursor-pointer items-start gap-3">
              <Switch checked={!!unir[g.clave]} onCheckedChange={(v) => setUnir((x) => ({ ...x, [g.clave]: v }))} disabled={editadaAMano(g)} className="mt-0.5" />
              <span className="text-sm">
                <b>{g.filas.map((r) => r.f.cliente).join(" y ")}</b> tienen {g.motivo === "cuit" ? "el mismo CUIT" : "el mismo dueño"}. ¿Una sola{" "}
                {nombreDoc(g.filas.find((r) => r.pid === principal[g.clave])?.f.tipo ?? "factura")} para {g.filas.length === 2 ? "las dos" : "todas"}?
              </span>
            </label>
            {editadaAMano(g) && <p className="text-[11px] text-muted-foreground">La principal se editó a mano: para juntarlas, sumá el renglón con «Editar».</p>}
            {unir[g.clave] && (
              <div className="flex flex-wrap items-center gap-2 pl-11 text-xs text-muted-foreground">
                A nombre de
                <Select value={principal[g.clave]} onValueChange={(v) => setPrincipal((x) => ({ ...x, [g.clave]: v }))}>
                  <SelectTrigger className="h-8 w-auto min-w-[160px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {g.filas.map((r) => (
                      <SelectItem key={r.pid} value={r.pid}>
                        {r.f.razon_social || r.f.cliente}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="w-full">Queda guardado: los meses que vienen también sale una sola.</span>
              </div>
            )}
          </div>
        ))}

        <ul className="space-y-2">
          {salen.map(({ r, f, unidas }) => (
            <li key={r.pid} className={cn("rounded-xl border bg-card p-3", unidas.length > 0 && "border-primary/40")}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">
                    {Mayus(nombreDoc(f.tipo))} · {f.razon_social || f.cliente}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {f.cuit ? `CUIT ${f.cuit}` : "Sin CUIT cargado"}
                    {unidas.length > 0 && ` · incluye ${unidas.map((u) => u.f.cliente).join(", ")}`}
                  </p>
                </div>
                <span className="shrink-0 font-bold tabular-nums">{formatARS(f.bruto)}</span>
              </div>
              <ul className="mt-2 space-y-0.5 text-xs">
                {f.items.map((i) => (
                  <li key={i.id} className="flex justify-between gap-3">
                    <span className="min-w-0 truncate text-muted-foreground">{i.concepto}</span>
                    <span className="shrink-0 tabular-nums">{formatARS(i.neto)}</span>
                  </li>
                ))}
                {f.iva > 0 && (
                  <li className="flex justify-between gap-3">
                    <span className="text-muted-foreground">IVA {f.iva_pct}%</span>
                    <span className="tabular-nums">{formatARS(f.iva)}</span>
                  </li>
                )}
              </ul>
              {r.doc && pagadoDe(r.doc) > 0 && <p className="mt-1 text-[11px] text-emerald-700 dark:text-emerald-400">Ya pagó {formatARS(pagadoDe(r.doc))} a cuenta</p>}
              <div className="mt-2 flex justify-end">
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onVer(f)}>
                  <Eye className="mr-1 h-3.5 w-3.5" /> Ver como le llega
                </Button>
              </div>
            </li>
          ))}
        </ul>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Volver
          </Button>
          <Button onClick={() => void confirmar()} disabled={busy || !salen.length}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            Emitir {salen.length === 1 ? `la ${nombreDoc(salen[0].f.tipo)}` : `${salen.length} ${nombreDocs(salen.map((s) => s.f))}`} · {formatARS(total)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Ya emitida (sin CAE ni pagos): pasa como renglón al comprobante de otra empresa del mismo dueño. */
export function UnirComprobanteDialog({ f, delMes, onClose }: { f: FacturaDoc | null; delMes: FacturaDoc[]; onClose: () => void }) {
  const { clienteById } = useRedes();
  const [destino, setDestino] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setDestino(""), [f?.id]);
  if (!f) return null;
  const c = clienteById(f.proyecto_id);
  const dueños = new Set(c?.team_roles?.cliente ?? []);
  const cuit = soloDigitos(f.cuit ?? c?.facturacion?.cuit);
  const afin = (x: FacturaDoc) =>
    (cuit.length === 11 && soloDigitos(x.cuit ?? clienteById(x.proyecto_id)?.facturacion?.cuit) === cuit) ||
    (clienteById(x.proyecto_id)?.team_roles?.cliente ?? []).some((u) => dueños.has(u));
  const candidatas = delMes
    .filter((x) => x.id !== f.id && (x.estado === "borrador" || x.estado === "pendiente") && !x.arca?.cae && !pagadoDe(x) && !Number(x.debitado ?? 0))
    .sort((a, b) => Number(afin(b)) - Number(afin(a)) || a.cliente.localeCompare(b.cliente));
  const elegida = candidatas.find((x) => x.id === destino);
  const unir = async () => {
    if (!elegida) return;
    setBusy(true);
    try {
      await guardarDatosFacturacion(f.proyecto_id, { ...(c?.facturacion ?? {}), factura_con: elegida.proyecto_id });
      await anularFactura(f);
      // La otra vuelve a «Emitir» (ya con las dos): se revisa y se manda de nuevo.
      if (elegida.estado === "pendiente") await volverASinEmitir(elegida);
      toast.success(`Listo: ${elegida.cliente} vuelve a «Emitir» con las dos. Revisala y emitila de nuevo.`, { duration: 8000 });
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo unir");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={!!f} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-w-md rounded-2xl">
        <DialogHeader className="text-left">
          <DialogTitle>Unir con otra empresa</DialogTitle>
          <DialogDescription>
            La {nombreDoc(f.tipo)} de {f.cliente} se anula y su abono pasa como renglón a la de la empresa que elijas (a su razón social y CUIT). Esa vuelve a «Emitir» para que la
            revises y la mandes de nuevo.
          </DialogDescription>
        </DialogHeader>
        {candidatas.length ? (
          <Select value={destino} onValueChange={setDestino}>
            <SelectTrigger>
              <SelectValue placeholder="¿Con cuál va?" />
            </SelectTrigger>
            <SelectContent>
              {candidatas.map((x) => (
                <SelectItem key={x.id} value={x.id}>
                  {x.cliente} · {nombreDoc(x.tipo)} {formatARS(x.bruto)}
                  {afin(x) ? " (mismo dueño)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <p className="text-sm text-muted-foreground">No hay otra de este mes que se pueda unir (sin CAE y sin pagos).</p>
        )}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={() => void unir()} disabled={busy || !elegida}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Link2 className="mr-2 h-4 w-4" />} Unir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
