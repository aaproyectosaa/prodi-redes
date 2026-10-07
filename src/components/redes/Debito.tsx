import { useState } from "react";
import { CheckCircle2, Copy, CreditCard, Loader2, PauseCircle, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Project } from "@/integrations/firebase/types";
import { callApi } from "@/lib/redes/api";
import { fechaCorta, formatARS } from "@/lib/redes/format";
import { comisionDe, comisionPct, montoDebito } from "@/lib/redes/facturacion";
import { cn } from "@/lib/utils";

const ESTADOS = {
  activa: { label: "Débito automático activo", icon: CheckCircle2, tone: "text-success" },
  pendiente: { label: "Falta confirmar en Mercado Pago", icon: PauseCircle, tone: "text-warning" },
  pausada: { label: "Débito pausado", icon: PauseCircle, tone: "text-warning" },
  cancelada: { label: "Débito cancelado", icon: XCircle, tone: "text-muted-foreground" },
} as const;

export function EstadoDebito({ cliente }: { cliente: Project }) {
  const s = cliente.suscripcion;
  if (!s) return null;
  const e = ESTADOS[s.estado] ?? ESTADOS.pendiente;
  const Icon = e.icon;
  return (
    <div className="space-y-1">
      <p className={cn("flex items-center gap-1.5 text-sm font-medium", e.tone)}>
        <Icon className="h-4 w-4" /> {e.label}
      </p>
      <p className="text-xs text-muted-foreground">
        {formatARS(s.monto)} por mes
        {comisionPct(s.comision_pct) ? ` (incluye ${formatARS(comisionDe(s.monto, Number(s.comision_pct)))} de comisión de Mercado Pago)` : ""} ·{" "}
        {s.payer_email}
        {s.ultimo_pago_at ? ` · último cobro ${fechaCorta(s.ultimo_pago_at)}` : ""}
      </p>
    </div>
  );
}

/** Lo que se debita por mes: el total de la boleta más la comisión de Mercado Pago (% de Ajustes). */
const debitoDe = (total: number, comision?: number) => {
  const monto = montoDebito(total, comisionPct(comision));
  return { monto, recargo: monto - total };
};

/**
 * Tarjeta del cliente en "Mi plan". `monto`: el total de la boleta del mes; `comision`: el % de
 * Mercado Pago de Ajustes, que se suma al débito.
 */
export function DebitoCliente({ cliente, monto: total, comision, email }: { cliente: Project; monto: number; comision?: number; email?: string }) {
  const [open, setOpen] = useState(false);
  const activa = cliente.suscripcion?.estado === "activa";
  const { monto, recargo } = debitoDe(total, comision);
  return (
    <div className="rounded-2xl border bg-card p-5">
      <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <CreditCard className="h-3.5 w-3.5" /> Pago del abono
      </p>
      {cliente.suscripcion ? (
        <div className="mt-2">
          <EstadoDebito cliente={cliente} />
        </div>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">
          Activá el débito automático y olvidate de pagar cada mes: se cobra solo con tu tarjeta en Mercado Pago.
        </p>
      )}
      {!activa && monto > 0 && (
        <Button className="mt-4 w-full" onClick={() => setOpen(true)}>
          {cliente.suscripcion?.estado === "pendiente" ? "Terminar de activar" : "Activar débito automático"} ·{" "}
          {formatARS(monto)}/mes
        </Button>
      )}
      {!activa && monto > 0 && recargo > 0 && (
        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          Incluye {formatARS(recargo)} de comisión de Mercado Pago. Si pagás por transferencia, no va.
        </p>
      )}
      <ActivarDebitoDialog open={open} onOpenChange={setOpen} cliente={cliente} monto={monto} recargo={recargo} email={email} redirigir />
    </div>
  );
}

/**
 * Bloque del admin en "Informe y cobros". `monto`: el total de la boleta del mes (con IVA y extras);
 * `comision`: el % de Mercado Pago de Ajustes. El débito cobra los dos (igual que `precioAbono`).
 */
export function DebitoAdmin({ cliente, monto: total, comision }: { cliente: Project; monto: number; comision?: number }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<null | "cancelar" | "monto">(null);
  const s = cliente.suscripcion;
  const { monto, recargo } = debitoDe(total, comision);
  const run = async (accion: "cancelar" | "actualizar_monto") => {
    setBusy(accion === "cancelar" ? "cancelar" : "monto");
    try {
      await callApi("/api/pagos/suscripcion", { proyecto_id: cliente.id, accion });
      toast.success(accion === "cancelar" ? "Débito cancelado" : "Monto actualizado al total de la boleta");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo completar");
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      {s ? (
        <EstadoDebito cliente={cliente} />
      ) : (
        <p className="text-sm text-muted-foreground">
          Sin débito automático. El cliente lo activa desde “Mi plan”, o le mandás el link vos.
        </p>
      )}
      {s?.estado === "activa" && monto > 0 && s.monto !== monto && (
        <p className="rounded-lg bg-warning/10 p-2 text-xs text-warning">
          La boleta del mes (con IVA y extras fijos) es de {formatARS(total)}
          {recargo > 0 ? `; con la comisión de Mercado Pago (${formatARS(recargo)}) el débito tendría que ser de ${formatARS(monto)}` : ""} y
          hoy cobra {formatARS(s.monto)}.
        </p>
      )}
      {recargo > 0 && s?.estado !== "activa" && (
        <p className="text-xs text-muted-foreground">
          El débito sería de {formatARS(monto)}: la boleta ({formatARS(total)}) más {formatARS(recargo)} de comisión de Mercado Pago.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {s?.estado !== "activa" && (
          <Button size="sm" onClick={() => setOpen(true)} disabled={!(monto > 0)}>
            Generar link de débito
          </Button>
        )}
        {s?.estado === "activa" && s.monto !== monto && monto > 0 && (
          <Button size="sm" variant="outline" onClick={() => run("actualizar_monto")} disabled={!!busy}>
            {busy === "monto" && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Cobrar {formatARS(monto)} desde ahora
          </Button>
        )}
        {s && s.estado !== "cancelada" && (
          <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => run("cancelar")} disabled={!!busy}>
            {busy === "cancelar" && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Cancelar débito
          </Button>
        )}
      </div>
      <ActivarDebitoDialog open={open} onOpenChange={setOpen} cliente={cliente} monto={monto} recargo={recargo} email={cliente.contacto_emails?.[0]} />
    </div>
  );
}

function ActivarDebitoDialog({
  open,
  onOpenChange,
  cliente,
  monto,
  recargo,
  email: emailInicial,
  redirigir,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  cliente: Project;
  monto: number;
  /** Comisión de Mercado Pago que va incluida en `monto`. */
  recargo: number;
  email?: string;
  /** El cliente va directo a Mercado Pago; el admin recibe el link para mandarlo. */
  redirigir?: boolean;
}) {
  const [email, setEmail] = useState(emailInicial ?? "");
  const [loading, setLoading] = useState(false);
  const [link, setLink] = useState<string | null>(null);

  const go = async () => {
    setLoading(true);
    try {
      const { init_point } = await callApi<{ init_point: string }>("/api/pagos/suscribir", {
        proyecto_id: cliente.id,
        email: email.trim(),
      });
      if (redirigir) {
        onOpenChange(false);
        window.location.href = init_point;
      } else setLink(init_point);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo iniciar el débito");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setLink(null); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Débito automático del abono</DialogTitle>
          <DialogDescription>
            {formatARS(monto)} por mes (el total de la boleta
            {recargo > 0 ? ` más ${formatARS(recargo)} de comisión de Mercado Pago` : ""}), con tarjeta en Mercado Pago. Se puede
            cancelar cuando quieras.
          </DialogDescription>
        </DialogHeader>
        {link ? (
          <div className="space-y-2">
            <p className="text-sm">Mandale este link al cliente para que lo confirme con su tarjeta:</p>
            <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="text-xs" />
            <Button
              variant="outline"
              className="w-full"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(link);
                  toast.success("Link copiado");
                } catch {
                  toast.error("Copialo a mano");
                }
              }}
            >
              <Copy className="mr-2 h-4 w-4" /> Copiar link
            </Button>
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label>Mail de la cuenta de Mercado Pago que paga</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nombre@gmail.com" />
            <p className="text-[11px] text-muted-foreground">Tiene que ser el mismo mail con el que entra a Mercado Pago.</p>
          </div>
        )}
        {!link && (
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={go} disabled={loading || !/.+@.+\..+/.test(email)}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {redirigir ? "Ir a Mercado Pago" : "Generar link"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
