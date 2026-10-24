import { useState } from "react";
import { BellRing, MessageCircle, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { Project } from "@/integrations/firebase/types";
import {
  borrarVendedor,
  crearVendedor,
  editarVendedor,
  linkWhatsApp,
  resumenVendedor,
  useContactos,
  useVendedores,
  type VendedorCrm,
} from "@/lib/redes/crm";
import { cn } from "@/lib/utils";

// "Equipo" del CRM: los vendedores del cliente, a quién se le reparten los contactos y cómo le va a cada uno.

const plata = (n: number) => `$ ${Math.round(n).toLocaleString("es-AR")}`;
const mesActual = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).slice(0, 7);
export const iniciales = (n: string) =>
  n
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");

function NuevoVendedor({ proyectoId, onListo }: { proyectoId: string; onListo: () => void }) {
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [busy, setBusy] = useState(false);
  const guardar = async () => {
    if (!nombre.trim()) return toast.error("Poné el nombre");
    setBusy(true);
    try {
      await crearVendedor(proyectoId, { nombre: nombre.trim(), telefono: telefono.trim() || null });
      toast.success("Vendedor agregado");
      onListo();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Nombre</Label>
        <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej.: Caro" autoFocus />
      </div>
      <div className="space-y-1.5">
        <Label>WhatsApp</Label>
        <Input value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="Para mandarle sus contactos del día" inputMode="tel" />
      </div>
      <Button className="w-full" onClick={() => void guardar()} disabled={busy}>
        Agregar al equipo
      </Button>
    </div>
  );
}

export function EquipoCrm({ cliente, nuevo, onNuevo }: { cliente: Project; nuevo: boolean; onNuevo: (v: boolean) => void }) {
  const vendedores = useVendedores(cliente.id);
  const contactos = useContactos(cliente.id) ?? [];
  const mes = mesActual();
  const sinAsignar = contactos.filter((c) => !c.vendedor_id && c.etapa !== "vendido" && c.etapa !== "perdido").length;

  // Le arma al vendedor, por WhatsApp, la lista de a quién escribirle hoy.
  const mandarDelDia = (v: VendedorCrm) => {
    const r = resumenVendedor(v, contactos, mes);
    if (!r.paraHoy.length) return toast.info(`${v.nombre} no tiene a nadie para escribir hoy`);
    const lineas = r.paraHoy.map((c) => `• ${c.nombre}${c.telefono ? ` (${c.telefono})` : ""}${c.interes ? `: ${c.interes}` : ""}`);
    window.open(linkWhatsApp(v.telefono, `¡Hola ${v.nombre.split(" ")[0]}! Hoy escribiles a:\n${lineas.join("\n")}`), "_blank");
  };

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Los contactos nuevos se reparten parejo entre los activos (le toca al que tiene menos abiertos). Igual lo podés cambiar en cada contacto.
      </p>

      {sinAsignar > 0 && (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/[0.06] px-4 py-2.5 text-sm">
          Hay <b>{sinAsignar}</b> contacto{sinAsignar === 1 ? "" : "s"} abierto{sinAsignar === 1 ? "" : "s"} sin nadie que lo{sinAsignar === 1 ? "" : "s"} atienda.
        </p>
      )}

      {vendedores && !vendedores.length && (
        <div className="rounded-2xl border border-dashed p-8 text-center">
          <UserRound className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-2 font-semibold">Todavía no cargaste a tu equipo</p>
          <p className="text-sm text-muted-foreground">Sumá a quienes contestan los mensajes y venden: cada uno ve cómo le va.</p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {(vendedores ?? []).map((v) => {
          const r = resumenVendedor(v, contactos, mes);
          return (
            <div key={v.id} className={cn("space-y-3 rounded-2xl border bg-card p-4", !v.activo && "opacity-60")}>
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#6F40FC] to-[#E040A0] text-sm font-bold text-white">{iniciales(v.nombre)}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{v.nombre}</p>
                  <p className="text-xs text-muted-foreground">{v.activo ? `${r.abiertos} contacto${r.abiertos === 1 ? "" : "s"} abierto${r.abiertos === 1 ? "" : "s"}` : "No recibe contactos nuevos"}</p>
                </div>
                <Switch checked={v.activo} onCheckedChange={(a) => void editarVendedor(v, { activo: a })} title="Recibe contactos nuevos" />
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-muted/50 p-2">
                  <p className="text-lg font-bold">{r.vendidos}</p>
                  <p className="text-[11px] text-muted-foreground">ventas</p>
                </div>
                <div className="rounded-xl bg-muted/50 p-2">
                  <p className="whitespace-nowrap text-sm font-bold leading-7">{plata(r.total)}</p>
                  <p className="text-[11px] text-muted-foreground">vendió</p>
                </div>
                <div className="rounded-xl bg-muted/50 p-2">
                  <p className="text-lg font-bold">{r.conversion != null ? `${Math.round(r.conversion * 100)}%` : "—"}</p>
                  <p className="text-[11px] text-muted-foreground">compró</p>
                </div>
              </div>
              {r.paraHoy.length > 0 && (
                <p className="flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                  <BellRing className="h-3.5 w-3.5" /> Tiene {r.paraHoy.length} para escribir hoy
                </p>
              )}
              <div className="flex items-center gap-2">
                {v.telefono && (
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => mandarDelDia(v)}>
                    <MessageCircle className="mr-1.5 h-3.5 w-3.5" /> Mandarle los de hoy
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => window.confirm(`¿Sacar a ${v.nombre} del equipo? Sus contactos quedan sin asignar.`) && void borrarVendedor(v, contactos)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={nuevo} onOpenChange={onNuevo}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nuevo vendedor</DialogTitle>
            <DialogDescription>Alguien de tu negocio que atiende los mensajes y vende.</DialogDescription>
          </DialogHeader>
          <NuevoVendedor proyectoId={cliente.id} onListo={() => onNuevo(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
