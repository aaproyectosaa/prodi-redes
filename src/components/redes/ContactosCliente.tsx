import { useState } from "react";
import { Copy, Loader2, MessageCircle, Plus, Send, UserX, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import UserAvatar from "@/components/UserAvatar";
import { Section } from "@/components/redes/PageShell";
import { useAppData } from "@/contexts/app-data-context";
import { callApi } from "@/lib/redes/api";
import { assertEditable } from "@/lib/redes/vistaComo";
import { cn } from "@/lib/utils";
import type { Project } from "@/integrations/firebase/types";

const VACIO = { nombre: "", email: "", telefono: "", cargo: "" };

/**
 * Contactos (solo chat) del cliente: gente de la empresa que usa solo Prodi Chat. Los crean el super admin o la
 * producción del cliente; quedan en el grupo del cliente y pueden chatear con el equipo asignado y su gente.
 */
export function ContactosCliente({ cliente }: { cliente: Project }) {
  const { profiles } = useAppData();
  const contactos = profiles
    .filter((p) => p.role === "contacto" && p.proyecto_id === cliente.id)
    .sort((a, b) => Number(a.activo === false) - Number(b.activo === false) || a.nombre.localeCompare(b.nombre));
  const [nuevo, setNuevo] = useState(false);
  const [form, setForm] = useState(VACIO);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [link, setLink] = useState<{ nombre: string; link: string; mail: boolean } | null>(null);

  const crear = async () => {
    setOcupado("nuevo");
    try {
      assertEditable();
      const r = await callApi<{ link: string; mail: boolean }>("/api/usuarios/contacto-crear", { proyecto_id: cliente.id, ...form });
      setNuevo(false);
      setLink({ nombre: form.nombre, link: r.link, mail: r.mail });
      setForm(VACIO);
      toast.success("Contacto creado");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo crear");
    } finally {
      setOcupado(null);
    }
  };

  const accion = async (uid: string, nombre: string, url: string, datos: Record<string, unknown>) => {
    setOcupado(uid);
    try {
      assertEditable();
      const r = await callApi<{ link?: string; mail?: boolean }>(url, { uid, ...datos });
      if (r.link) setLink({ nombre, link: r.link, mail: !!r.mail });
      else toast.success("Listo");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo");
    } finally {
      setOcupado(null);
    }
  };

  return (
    <Section
      title="Contactos (solo chat)"
      description="Gente de la empresa que usa solo Prodi Chat: están en el grupo del cliente y chatean con el equipo asignado y con su gente. No ven videos, facturas ni nada del sistema."
    >
      <div className="space-y-3 rounded-xl border bg-card p-4">
        {contactos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no hay contactos de este cliente.</p>
        ) : (
          <ul className="divide-y">
            {contactos.map((p) => {
              const off = p.activo === false;
              return (
                <li key={p.id} className={cn("flex flex-wrap items-center gap-3 py-2.5", off && "opacity-60")}>
                  <UserAvatar profile={p} size="sm" className="h-8 w-8" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {p.nombre}
                      {off && <span className="ml-2 text-xs font-normal text-muted-foreground">Desactivado</span>}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[p.cargo, p.email, p.telefono].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {!off && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!!ocupado}
                        onClick={() => void accion(p.id, p.nombre, "/api/usuarios/contacto-invitar", {})}
                        title="Link nuevo para crear la contraseña (también le llega por mail)"
                      >
                        {ocupado === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 sm:mr-1.5" />}
                        <span className="hidden sm:inline">Invitación</span>
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!!ocupado}
                      className={off ? "" : "text-muted-foreground hover:text-destructive"}
                      onClick={() => void accion(p.id, p.nombre, "/api/usuarios/contacto-activo", { activo: off })}
                    >
                      {off ? <UserCheck className="h-4 w-4 sm:mr-1.5" /> : <UserX className="h-4 w-4 sm:mr-1.5" />}
                      <span className="hidden sm:inline">{off ? "Activar" : "Desactivar"}</span>
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <Button size="sm" variant="outline" onClick={() => setNuevo(true)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" /> Agregar contacto
        </Button>
      </div>

      <Dialog open={nuevo} onOpenChange={(o) => !ocupado && setNuevo(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nuevo contacto de {cliente.nombre}</DialogTitle>
            <DialogDescription>Le llega un mail para crear su contraseña y entra directo a Prodi Chat.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void crear();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="ct-nombre">Nombre y apellido</Label>
              <Input id="ct-nombre" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} maxLength={80} autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ct-email">Mail</Label>
              <Input id="ct-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ct-cargo">Cargo (opcional)</Label>
                <Input id="ct-cargo" value={form.cargo} onChange={(e) => setForm({ ...form, cargo: e.target.value })} maxLength={80} placeholder="Ej: encargada de local" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ct-tel">Teléfono (opcional)</Label>
                <Input id="ct-tel" type="tel" value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} maxLength={40} />
              </div>
            </div>
            <DialogFooter className="gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setNuevo(false)} disabled={!!ocupado}>
                Cancelar
              </Button>
              <Button type="submit" disabled={!!ocupado || !form.nombre.trim() || !form.email.trim()}>
                {ocupado === "nuevo" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Crear y invitar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!link} onOpenChange={(o) => !o && setLink(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageCircle className="h-5 w-5 text-primary" /> Invitación de {link?.nombre}
            </DialogTitle>
            <DialogDescription>
              {link?.mail ? "Ya le mandamos el mail. " : "No se pudo mandar el mail: "}
              Pasale este link (vence en 3 días) para que cree su contraseña y entre a Prodi Chat.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input readOnly value={link?.link ?? ""} className="text-xs" onFocus={(e) => e.target.select()} />
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Copiar link"
              onClick={() => {
                void navigator.clipboard?.writeText(link?.link ?? "").then(
                  () => toast.success("Link copiado"),
                  () => toast.error("No se pudo copiar")
                );
              }}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Section>
  );
}
