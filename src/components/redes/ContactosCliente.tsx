import { useState } from "react";
import { Copy, KeyRound, LayoutDashboard, Loader2, MessageCircle, Plus, RefreshCw, Send, UserCheck, UserX } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import UserAvatar from "@/components/UserAvatar";
import { Section } from "@/components/redes/PageShell";
import { useAppData } from "@/contexts/app-data-context";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { callApi } from "@/lib/redes/api";
import { assertEditable } from "@/lib/redes/vistaComo";
import { urlChatApp } from "@/lib/chatApp";
import { cn } from "@/lib/utils";
import type { Project } from "@/integrations/firebase/types";

type Acceso = "sistema" | "chat";
const VACIO = { nombre: "", email: "", telefono: "", cargo: "", password: "" };

/** Contraseña fácil de dictar y difícil de adivinar (sin letras que se confunden: 0/O, 1/l). */
function generarClave() {
  const letras = "abcdefghjkmnpqrstuvwxyz";
  const r = (n: number) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
  const parte = () => Array.from({ length: 4 }, () => letras[r(letras.length)]).join("");
  return `${parte()[0].toUpperCase()}${parte().slice(1)}-${parte()}-${10 + r(90)}`;
}

/** Texto para pasarle a la persona por WhatsApp: usuario, contraseña y dónde entrar. */
function textoAcceso(nombre: string, email: string, password: string, acceso: Acceso) {
  const sistema = window.location.origin;
  return [
    `Hola ${nombre.split(" ")[0]}! Ya tenés tu acceso a Prodi 👋`,
    ``,
    `Usuario: ${email}`,
    `Contraseña: ${password}`,
    ``,
    acceso === "sistema" ? `Sistema (tus videos y pedidos): ${sistema}` : null,
    `Prodi Chat: ${urlChatApp()}`,
    ``,
    `Para tener la app en el celular: abrí el link en Safari (iPhone) o Chrome (Android) y tocá "Agregar a inicio" / "Instalar app".`,
  ]
    .filter((l) => l !== null)
    .join("\n");
}

const copiar = (t: string, ok = "Copiado") =>
  void navigator.clipboard?.writeText(t).then(
    () => toast.success(ok),
    () => toast.error("No se pudo copiar")
  );

/**
 * Integrantes del cliente: cada persona de la empresa con su propio usuario (así no se pisan en el chat).
 * - Con acceso al sistema: ven el panel del cliente (videos, pedidos, aprobar) y están en el grupo de chat.
 * - Solo chat (contactos): solo Prodi Chat, en el grupo del cliente.
 * El super admin les puede poner la contraseña él mismo (se la pasa junto con el usuario); si no, les llega una invitación.
 */
export function ContactosCliente({ cliente }: { cliente: Project }) {
  const { profiles } = useAppData();
  const { realRole } = useUserProfileContext();
  const esAdmin = realRole === "admin";
  const delSistema = new Set(cliente.team_roles?.cliente ?? []);
  const integrantes = profiles
    .filter((p) => (p.role === "contacto" && p.proyecto_id === cliente.id) || (p.role === "cliente" && delSistema.has(p.id)))
    .sort(
      (a, b) =>
        Number(a.activo === false) - Number(b.activo === false) ||
        Number(a.role === "contacto") - Number(b.role === "contacto") ||
        a.nombre.localeCompare(b.nombre)
    );
  const [nuevo, setNuevo] = useState(false);
  const [form, setForm] = useState(VACIO);
  const [acceso, setAcceso] = useState<Acceso>("sistema");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [link, setLink] = useState<{ nombre: string; link: string; mail: boolean } | null>(null);
  const [datos, setDatos] = useState<{ texto: string; nombre: string } | null>(null);
  const [claveDe, setClaveDe] = useState<{ uid: string; nombre: string; email: string; acceso: Acceso } | null>(null);
  const [nuevaClave, setNuevaClave] = useState("");

  const abrirNuevo = () => {
    setForm({ ...VACIO, password: esAdmin ? generarClave() : "" });
    setAcceso(esAdmin ? "sistema" : "chat");
    setNuevo(true);
  };

  const crear = async () => {
    setOcupado("nuevo");
    try {
      assertEditable();
      const r = await callApi<{ link?: string; mail?: boolean; password?: string }>("/api/usuarios/contacto-crear", {
        proyecto_id: cliente.id,
        nombre: form.nombre,
        email: form.email,
        telefono: form.telefono,
        cargo: form.cargo,
        ...(esAdmin ? { acceso, ...(form.password.trim() ? { password: form.password.trim() } : {}) } : {}),
      });
      setNuevo(false);
      if (r.password) setDatos({ nombre: form.nombre, texto: textoAcceso(form.nombre, form.email.trim().toLowerCase(), r.password, acceso) });
      else if (r.link) setLink({ nombre: form.nombre, link: r.link, mail: !!r.mail });
      setForm(VACIO);
      toast.success(`${form.nombre.split(" ")[0]} ya está en ${cliente.nombre}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo crear");
    } finally {
      setOcupado(null);
    }
  };

  const accion = async (uid: string, nombre: string, url: string, extra: Record<string, unknown>) => {
    setOcupado(uid);
    try {
      assertEditable();
      const r = await callApi<{ link?: string; mail?: boolean }>(url, { uid, ...extra });
      if (r.link) setLink({ nombre, link: r.link, mail: !!r.mail });
      else toast.success("Listo");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo");
    } finally {
      setOcupado(null);
    }
  };

  const ponerClave = async () => {
    if (!claveDe) return;
    setOcupado("clave");
    try {
      assertEditable();
      const r = await callApi<{ password: string }>("/api/usuarios/contacto-clave", { uid: claveDe.uid, password: nuevaClave.trim() });
      setDatos({ nombre: claveDe.nombre, texto: textoAcceso(claveDe.nombre, claveDe.email, r.password, claveDe.acceso) });
      setClaveDe(null);
      toast.success("Contraseña cambiada");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo cambiar");
    } finally {
      setOcupado(null);
    }
  };

  return (
    <Section
      title="Integrantes"
      description="Cada persona de la empresa con su propio usuario, así en el chat se sabe quién escribe. Todos quedan en el grupo de chat del cliente."
    >
      <div className="space-y-3 rounded-xl border bg-card p-4">
        {integrantes.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no hay integrantes de este cliente.</p>
        ) : (
          <ul className="divide-y">
            {integrantes.map((p) => {
              const off = p.activo === false;
              const esContacto = p.role === "contacto";
              return (
                <li key={p.id} className={cn("flex flex-wrap items-center gap-3 py-2.5", off && "opacity-60")}>
                  <UserAvatar profile={p} size="sm" className="h-8 w-8" />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate text-sm font-medium">
                      <span className="truncate">{p.nombre}</span>
                      <span
                        className={cn(
                          "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                          esContacto ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"
                        )}
                      >
                        {esContacto ? <MessageCircle className="h-3 w-3" /> : <LayoutDashboard className="h-3 w-3" />}
                        {esContacto ? "Solo chat" : "Sistema + chat"}
                      </span>
                      {off && <span className="text-xs font-normal text-muted-foreground">Desactivado</span>}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{[p.cargo, p.email, p.telefono].filter(Boolean).join(" · ")}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    {esAdmin && !off && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!!ocupado}
                        onClick={() => {
                          setNuevaClave(generarClave());
                          setClaveDe({ uid: p.id, nombre: p.nombre, email: p.email ?? "", acceso: esContacto ? "chat" : "sistema" });
                        }}
                        title="Ponerle una contraseña"
                      >
                        <KeyRound className="h-4 w-4 sm:mr-1.5" />
                        <span className="hidden sm:inline">Contraseña</span>
                      </Button>
                    )}
                    {esContacto && !off && (
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
                    {esContacto && (
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
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <Button size="sm" onClick={abrirNuevo}>
          <Plus className="mr-1.5 h-3.5 w-3.5" /> Agregar integrante
        </Button>
      </div>

      {/* Nuevo integrante */}
      <Dialog open={nuevo} onOpenChange={(o) => !ocupado && setNuevo(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nuevo integrante de {cliente.nombre}</DialogTitle>
            <DialogDescription>Con su propio usuario. Queda en el grupo de chat del cliente.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void crear();
            }}
          >
            {esAdmin && (
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["sistema", LayoutDashboard, "Sistema + chat", "Ve videos, pide y aprueba"],
                    ["chat", MessageCircle, "Solo chat", "Solo Prodi Chat"],
                  ] as const
                ).map(([v, Icon, t, d]) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setAcceso(v)}
                    className={cn(
                      "flex flex-col items-start gap-1 rounded-xl border-2 p-3 text-left transition-colors",
                      acceso === v ? "border-primary bg-primary/10" : "border-transparent bg-muted/60 hover:bg-muted"
                    )}
                  >
                    <Icon className={cn("h-4 w-4", acceso === v ? "text-primary" : "text-muted-foreground")} />
                    <span className="text-sm font-semibold">{t}</span>
                    <span className="text-[11px] text-muted-foreground">{d}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="ct-nombre">Nombre y apellido</Label>
              <Input id="ct-nombre" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} maxLength={80} autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ct-email">Mail (es su usuario)</Label>
              <Input id="ct-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            {esAdmin && (
              <div className="space-y-1.5">
                <Label htmlFor="ct-clave">Contraseña</Label>
                <div className="flex gap-2">
                  <Input
                    id="ct-clave"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    placeholder="Vacía: le llega un mail para crearla"
                    autoComplete="off"
                    className="font-mono"
                  />
                  <Button type="button" variant="outline" size="icon" aria-label="Generar otra" title="Generar otra" onClick={() => setForm({ ...form, password: generarClave() })}>
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">Al menos 8 caracteres. Se la pasás vos junto con el usuario.</p>
              </div>
            )}
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
                {form.password.trim() ? "Crear" : "Crear y invitar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Ponerle la contraseña a alguien que ya está */}
      <Dialog open={!!claveDe} onOpenChange={(o) => !ocupado && !o && setClaveDe(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Contraseña de {claveDe?.nombre}</DialogTitle>
            <DialogDescription>Si ya estaba usando la app, tiene que volver a entrar con esta.</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input value={nuevaClave} onChange={(e) => setNuevaClave(e.target.value)} autoComplete="off" className="font-mono" />
            <Button type="button" variant="outline" size="icon" aria-label="Generar otra" onClick={() => setNuevaClave(generarClave())}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => void ponerClave()} disabled={ocupado === "clave" || nuevaClave.trim().length < 8}>
              {ocupado === "clave" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Guardar contraseña
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Usuario y contraseña listos para mandar */}
      <Dialog open={!!datos} onOpenChange={(o) => !o && setDatos(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-primary" /> Acceso de {datos?.nombre}
            </DialogTitle>
            <DialogDescription>Copialo y mandáselo por WhatsApp. La contraseña no se vuelve a mostrar.</DialogDescription>
          </DialogHeader>
          <pre className="whitespace-pre-wrap break-words rounded-xl border bg-muted/50 p-3 text-xs leading-relaxed">{datos?.texto}</pre>
          <DialogFooter>
            <Button onClick={() => datos && copiar(datos.texto, "Copiado: pegalo en WhatsApp")}>
              <Copy className="mr-1.5 h-4 w-4" /> Copiar mensaje
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invitación (sin contraseña puesta) */}
      <Dialog open={!!link} onOpenChange={(o) => !o && setLink(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageCircle className="h-5 w-5 text-primary" /> Invitación de {link?.nombre}
            </DialogTitle>
            <DialogDescription>
              {link?.mail ? "Ya le mandamos el mail. " : "No se pudo mandar el mail: "}
              Pasale este link (vence en 3 días) para que cree su contraseña y entre.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input readOnly value={link?.link ?? ""} className="text-xs" onFocus={(e) => e.target.select()} />
            <Button type="button" variant="outline" size="icon" aria-label="Copiar link" onClick={() => copiar(link?.link ?? "", "Link copiado")}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Section>
  );
}
