import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Copy, Factory, KeyRound, Loader2, Plus, RefreshCw, Send, UserCheck, UserX } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { callApi } from "@/lib/redes/api";
import { assertEditable } from "@/lib/redes/vistaComo";
import { activarVisitas } from "@/lib/redes/visitas";
import { cn } from "@/lib/utils";
import type { Project } from "@/integrations/firebase/types";

interface Vendedor {
  uid: string;
  nombre: string;
  email: string;
  telefono: string | null;
  activo: boolean;
  ultimo_acceso: string | null;
}

/** Contraseña fácil de dictar y difícil de adivinar (sin letras que se confunden). */
function generarClave() {
  const letras = "abcdefghjkmnpqrstuvwxyz";
  const r = (n: number) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
  const parte = () => Array.from({ length: 4 }, () => letras[r(letras.length)]).join("");
  return `${parte()}-${parte()}-${10 + r(90)}`;
}

const copiar = (t: string, ok = "Copiado") =>
  void navigator.clipboard?.writeText(t).then(
    () => toast.success(ok),
    () => toast.error("No se pudo copiar")
  );

const textoAcceso = (nombre: string, email: string, password: string) =>
  [
    `Hola ${nombre.split(" ")[0]}! Ya tenés tu acceso para cargar las visitas 👋`,
    ``,
    `Usuario: ${email}`,
    `Contraseña: ${password}`,
    ``,
    `Entrá acá desde el celular: ${window.location.origin}/`,
    `Para tenerlo como app: abrí el link en Safari (iPhone) o Chrome (Android) y tocá "Agregar a inicio".`,
  ].join("\n");

/**
 * Vendedores del cliente (ej. DS Ingeniería): cada uno con su usuario, entra a un panel que solo tiene sus visitas.
 * Lo usan el super admin y la producción (ficha del cliente) y el mismo cliente (su panel). El super admin prende el
 * módulo y es el único que puede ponerles la contraseña; los demás mandan la invitación por mail.
 */
export function VendedoresCliente({ cliente, desdeCliente = false }: { cliente: Project; desdeCliente?: boolean }) {
  const { realRole } = useUserProfileContext();
  const esAdmin = realRole === "admin";
  // Se ve al toque al prenderlo (el cliente se actualiza solo en unos segundos).
  const [local, setLocal] = useState<boolean | null>(null);
  useEffect(() => setLocal(null), [cliente.visitas_activo]);
  const activo = local ?? cliente.visitas_activo === true;
  const [vendedores, setVendedores] = useState<Vendedor[] | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const [form, setForm] = useState({ nombre: "", email: "", telefono: "", password: "" });
  const [datos, setDatos] = useState<{ nombre: string; texto: string } | null>(null);
  const [link, setLink] = useState<{ nombre: string; link: string; mail: boolean } | null>(null);
  const [claveDe, setClaveDe] = useState<Vendedor | null>(null);
  const [nuevaClave, setNuevaClave] = useState("");

  const traer = useCallback(() => {
    if (!activo) return;
    callApi<{ vendedores: Vendedor[] }>("/api/usuarios/vendedor-lista", { proyecto_id: cliente.id })
      .then((r) => setVendedores(r.vendedores))
      .catch(() => setVendedores([]));
  }, [activo, cliente.id]);
  useEffect(traer, [traer]);

  const prender = async (v: boolean) => {
    setOcupado("activar");
    try {
      await activarVisitas(cliente.id, v);
      setLocal(v);
      toast.success(v ? "Listo: ya pueden cargar visitas" : "Visitas apagadas");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo");
    } finally {
      setOcupado(null);
    }
  };

  const crear = async () => {
    setOcupado("nuevo");
    try {
      assertEditable();
      const r = await callApi<{ link?: string; mail?: boolean; password?: string }>("/api/usuarios/vendedor-crear", {
        proyecto_id: cliente.id,
        nombre: form.nombre,
        email: form.email,
        telefono: form.telefono,
        ...(esAdmin && form.password.trim() ? { password: form.password.trim() } : {}),
      });
      setNuevo(false);
      if (r.password) setDatos({ nombre: form.nombre, texto: textoAcceso(form.nombre, form.email.trim().toLowerCase(), r.password) });
      else if (r.link) setLink({ nombre: form.nombre, link: r.link, mail: !!r.mail });
      else toast.success(r.mail ? `Le mandamos el mail a ${form.nombre.split(" ")[0]} para que cree su contraseña` : "Se creó, pero no pudimos mandar el mail. Probá con «Invitación».");
      setForm({ nombre: "", email: "", telefono: "", password: "" });
      traer();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo crear");
    } finally {
      setOcupado(null);
    }
  };

  const accion = async (v: Vendedor, url: string, extra: Record<string, unknown> = {}) => {
    setOcupado(v.uid);
    try {
      assertEditable();
      const r = await callApi<{ link?: string; mail?: boolean }>(url, { uid: v.uid, ...extra });
      if (r.link) setLink({ nombre: v.nombre, link: r.link, mail: !!r.mail });
      else toast.success(url.endsWith("invitar") ? (r.mail ? "Le mandamos el mail de nuevo" : "No se pudo mandar el mail") : "Listo");
      traer();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo");
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
      setDatos({ nombre: claveDe.nombre, texto: textoAcceso(claveDe.nombre, claveDe.email, r.password) });
      setClaveDe(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo cambiar");
    } finally {
      setOcupado(null);
    }
  };

  // El cliente lo ve solo si está prendido.
  if (desdeCliente && !activo) return null;

  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      {esAdmin && !desdeCliente && (
        <label className="flex items-start justify-between gap-3">
          <span className="text-sm">
            <span className="font-medium">Visitas de vendedores</span>
            <span className="block text-xs text-muted-foreground">Sus vendedores cargan desde el celular las visitas a fábricas, con videos y fotos.</span>
          </span>
          <Switch checked={activo} onCheckedChange={(v) => void prender(v)} disabled={ocupado === "activar"} />
        </label>
      )}
      {!activo ? (
        !esAdmin && <p className="text-sm text-muted-foreground">Las visitas de vendedores no están prendidas para este cliente.</p>
      ) : (
        <>
          {vendedores === null ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : vendedores.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no hay vendedores. Sumá al primero.</p>
          ) : (
            <ul className="divide-y">
              {vendedores.map((v) => (
                <li key={v.uid} className={cn("flex flex-wrap items-center gap-3 py-2.5", !v.activo && "opacity-60")}>
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                    {v.nombre
                      .split(" ")
                      .map((x) => x[0])
                      .slice(0, 2)
                      .join("")
                      .toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {v.nombre} {!v.activo && <span className="text-xs font-normal text-muted-foreground">· Desactivado</span>}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[v.email, v.telefono, v.ultimo_acceso ? `entró el ${new Date(v.ultimo_acceso).toLocaleDateString("es-AR", { day: "numeric", month: "short" })}` : "todavía no entró"]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {esAdmin && v.activo && (
                      <Button size="sm" variant="ghost" disabled={!!ocupado} onClick={() => (setNuevaClave(generarClave()), setClaveDe(v))} title="Ponerle una contraseña">
                        <KeyRound className="h-4 w-4 sm:mr-1.5" />
                        <span className="hidden sm:inline">Contraseña</span>
                      </Button>
                    )}
                    {v.activo && (
                      <Button size="sm" variant="ghost" disabled={!!ocupado} onClick={() => void accion(v, "/api/usuarios/vendedor-invitar")} title="Mandarle de nuevo el mail para crear la contraseña">
                        {ocupado === v.uid ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 sm:mr-1.5" />}
                        <span className="hidden sm:inline">Invitación</span>
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!!ocupado}
                      className={v.activo ? "text-muted-foreground hover:text-destructive" : ""}
                      onClick={() => void accion(v, "/api/usuarios/vendedor-activo", { activo: !v.activo })}
                    >
                      {v.activo ? <UserX className="h-4 w-4 sm:mr-1.5" /> : <UserCheck className="h-4 w-4 sm:mr-1.5" />}
                      <span className="hidden sm:inline">{v.activo ? "Desactivar" : "Activar"}</span>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => (setForm({ nombre: "", email: "", telefono: "", password: esAdmin ? generarClave() : "" }), setNuevo(true))}>
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Agregar vendedor
            </Button>
            {!desdeCliente && (
              <Button size="sm" variant="outline" asChild>
                <Link to={`/visitas`}>
                  <Factory className="mr-1.5 h-3.5 w-3.5" /> Ver las visitas
                </Link>
              </Button>
            )}
          </div>
        </>
      )}

      <Dialog open={nuevo} onOpenChange={(o) => !ocupado && setNuevo(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nuevo vendedor de {cliente.nombre}</DialogTitle>
            <DialogDescription>Entra con su usuario a un panel donde solo carga sus visitas.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void crear();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="vd-nombre">Nombre y apellido</Label>
              <Input id="vd-nombre" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} maxLength={80} autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vd-email">Mail (es su usuario)</Label>
              <Input id="vd-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vd-tel">Teléfono (opcional)</Label>
              <Input id="vd-tel" type="tel" value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} maxLength={40} />
            </div>
            {esAdmin ? (
              <div className="space-y-1.5">
                <Label htmlFor="vd-clave">Contraseña</Label>
                <div className="flex gap-2">
                  <Input id="vd-clave" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Vacía: le llega un mail para crearla" autoComplete="off" className="font-mono" />
                  <Button type="button" variant="outline" size="icon" aria-label="Generar otra" onClick={() => setForm({ ...form, password: generarClave() })}>
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Le llega un mail para crear su contraseña.</p>
            )}
            <DialogFooter className="pt-1">
              <Button type="submit" disabled={!!ocupado || !form.nombre.trim() || !form.email.trim()}>
                {ocupado === "nuevo" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                {esAdmin && form.password.trim() ? "Crear" : "Crear e invitar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

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
              {ocupado === "clave" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Guardar contraseña
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!datos} onOpenChange={(o) => !o && setDatos(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Acceso de {datos?.nombre}</DialogTitle>
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

      <Dialog open={!!link} onOpenChange={(o) => !o && setLink(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Invitación de {link?.nombre}</DialogTitle>
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
    </div>
  );
}
