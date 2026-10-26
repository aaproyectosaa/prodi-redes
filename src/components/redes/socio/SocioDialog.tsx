import { useEffect, useState } from "react";
import { Check, Copy, Handshake, Loader2, Search, UserPlus, Users } from "lucide-react";
import UserAvatar from "@/components/UserAvatar";
import { useAppData } from "@/contexts/app-data-context";
import { getRoleInfo, ROLES_ADICIONALES } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { callApi } from "@/lib/redes/api";

// Alta (o edición) de un socio comercial desde CRM → Socios: lo mismo que en Equipo con el rol «Socio comercial»,
// sin salir de la pantalla. Al crearlo, el mensaje con sus datos para entrar, listo para copiar.

export interface SocioEditable {
  uid: string;
  nombre: string;
  config: { codigo: string; comision_pct: number | null; meses: number | null; modo?: "mensual" | "entrada" } | null;
}

const sugerirCodigo = (nombre: string) =>
  nombre
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 30);

export function SocioDialog({ socio, open, onOpenChange, onListo }: { socio: SocioEditable | null; open: boolean; onOpenChange: (v: boolean) => void; onListo: () => void }) {
  const nuevo = !socio;
  const { profiles } = useAppData();
  // Persona nueva (se le crea la cuenta) o alguien que ya tiene usuario (se le suma el rol de socio).
  const [modo, setModo] = useState<"nueva" | "existente">("nueva");
  const [busca, setBusca] = useState("");
  const [elegido, setElegido] = useState<string | null>(null);
  /** Los que pueden sumar el rol: el equipo (no clientes ni contactos) y que todavía no son socios. */
  const candidatos = profiles
    .filter((p) => p.activo !== false && ["admin", ...ROLES_ADICIONALES].includes(p.role as never) && p.role !== "socio" && !(p.roles_extra ?? []).includes("socio"))
    .sort((a, b) => (a.nombre ?? "").localeCompare(b.nombre ?? ""));
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [codigo, setCodigo] = useState("");
  const [codigoTocado, setCodigoTocado] = useState(false);
  const [pct, setPct] = useState("");
  /** Cada mes (un % de cada abono, los meses acordados) o premio de entrada (un % del primer abono, una vez). */
  const [modoCom, setModoCom] = useState<"mensual" | "entrada">("mensual");
  const [meses, setMeses] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    if (!open) return;
    setNombre(socio?.nombre ?? "");
    setEmail("");
    setCodigo(socio?.config?.codigo ?? "");
    setCodigoTocado(!!socio);
    setPct(socio?.config?.comision_pct != null ? String(socio.config.comision_pct) : "");
    setModoCom(socio?.config?.modo === "entrada" ? "entrada" : "mensual");
    setMeses(socio?.config?.meses != null ? String(socio.config.meses) : "");
    setMensaje(null);
    setCopiado(false);
    setModo("nueva");
    setBusca("");
    setElegido(null);
  }, [open, socio]);

  // Escribió el mail de alguien que ya tiene usuario: se lo ofrecemos para sumarle el rol.
  const yaExiste = modo === "nueva" && email.trim() ? profiles.find((p) => (p.email ?? "").toLowerCase() === email.trim().toLowerCase()) : undefined;
  const elegir = (id: string) => {
    const p = profiles.find((x) => x.id === id);
    setModo("existente");
    setElegido(id);
    if (p && !codigoTocado) setCodigo(sugerirCodigo(p.nombre ?? ""));
  };
  const persona = profiles.find((p) => p.id === elegido);

  const codigoOk = /^[a-z0-9][a-z0-9-]{2,29}$/.test(codigo);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
  const ok = codigoOk && (modoCom === "mensual" || Number(pct) > 0) && (!nuevo || (modo === "existente" ? !!persona : nombre.trim().length >= 2 && emailOk && !yaExiste));

  const guardar = async () => {
    setGuardando(true);
    const config = { codigo, comision_pct: pct, meses: modoCom === "entrada" ? "" : meses, modo: modoCom };
    try {
      if (nuevo && modo === "existente" && persona) {
        // Ya tiene usuario: se le suma "Socio comercial" a sus roles (no se crea otra cuenta).
        if (persona.role !== "socio") {
          const extras = [...new Set([...(persona.roles_extra ?? []), "socio"])];
          await callApi("/api/usuarios/editar", { uid: persona.id, roles_extra: extras, socio: config });
        } else await callApi("/api/usuarios/editar", { uid: persona.id, socio: config });
        setMensaje(
          `¡Hola ${(persona.nombre ?? "").split(" ")[0]}! Ahora también vendés para Prodi 🤝\n\nEntrás con tu usuario de siempre. En el menú vas a ver «Mis clientes»: tocás «Pasame un cliente», ponés nombre, empresa y teléfono, y nosotros lo llamamos. Si se hace cliente, ganás tu comisión.`
        );
      } else if (nuevo) {
        const r = await callApi<{ password: string }>("/api/usuarios/crear", { nombre: nombre.trim(), email: email.trim().toLowerCase(), rol: "socio", roles_extra: [], clientes: [], socio: config });
        setMensaje(
          `¡Hola ${nombre.trim().split(" ")[0]}! Ya vendés para Prodi 🤝\n\nEntrá acá: ${window.location.origin}\nMail: ${email.trim().toLowerCase()}\nContraseña: ${r.password}\n\nAdentro tocás «Pasame un cliente», ponés nombre, empresa y teléfono, y nosotros lo llamamos. Si se hace cliente, ganás tu comisión.`
        );
      } else {
        await callApi("/api/usuarios/editar", { uid: socio!.uid, socio: config });
        toast.success("Socio actualizado");
        onOpenChange(false);
      }
      onListo();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-w-md rounded-3xl">
        <DialogHeader className="space-y-3 text-left">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#6F40FC]/12 text-[#6F40FC]">
            <Handshake className="h-5 w-5" />
          </span>
          <DialogTitle className="text-xl">{mensaje ? "¡Listo! Pasale sus datos" : nuevo ? "Nuevo vendedor" : `Editar a ${socio?.nombre}`}</DialogTitle>
          {!mensaje && <DialogDescription>{nuevo ? "Se crea su cuenta: ve solo sus empresarios, su link y lo que gana." : "Su código y su comisión."}</DialogDescription>}
        </DialogHeader>

        {mensaje ? (
          <div className="space-y-3">
            <Textarea readOnly rows={9} value={mensaje} className="rounded-2xl text-sm leading-relaxed" />
            <Button
              variant="outline"
              className="h-11 w-full rounded-2xl font-semibold"
              onClick={() =>
                void navigator.clipboard?.writeText(mensaje).then(
                  () => setCopiado(true),
                  () => toast.error("No se pudo copiar")
                )
              }
            >
              {copiado ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />} {copiado ? "Copiado" : "Copiar mensaje"}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {nuevo && (
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted/60 p-1">
                {(
                  [
                    { k: "nueva", label: "Persona nueva", icono: UserPlus },
                    { k: "existente", label: "Ya tiene usuario", icono: Users },
                  ] as const
                ).map((x) => (
                  <button
                    key={x.k}
                    type="button"
                    onClick={() => setModo(x.k)}
                    className={cn(
                      "flex h-9 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold transition-colors",
                      modo === x.k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <x.icono className="h-3.5 w-3.5" /> {x.label}
                  </button>
                ))}
              </div>
            )}
            {nuevo && modo === "existente" && (
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">¿Quién?</Label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nombre o mail" className="h-11 rounded-xl pl-9" autoFocus />
                </div>
                <ul className="max-h-52 space-y-0.5 overflow-y-auto rounded-xl bg-muted/50 p-1">
                  {candidatos
                    .filter((p) => !busca.trim() || `${p.nombre} ${p.email}`.toLowerCase().includes(busca.trim().toLowerCase()))
                    .map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => elegir(p.id)}
                          className={cn("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors", elegido === p.id ? "bg-background shadow-sm ring-1 ring-[#6F40FC]/40" : "hover:bg-background/60")}
                        >
                          <UserAvatar profile={p} size="sm" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{p.nombre}</span>
                            <span className="block truncate text-[11px] text-muted-foreground">{getRoleInfo(p.role).label} · {p.email}</span>
                          </span>
                          {elegido === p.id && <Check className="h-4 w-4 shrink-0 text-[#6F40FC]" />}
                        </button>
                      </li>
                    ))}
                  {!candidatos.length && <li className="px-2.5 py-2 text-xs text-muted-foreground">No hay nadie del equipo para sumar.</li>}
                </ul>
                <p className="text-[11px] text-muted-foreground">Sigue entrando con su usuario de siempre: se le suma «Vendedor» a lo que ya hace.</p>
              </div>
            )}
            {nuevo && modo === "nueva" && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="sd-nombre" className="text-xs font-semibold">Nombre</Label>
                  <Input
                    id="sd-nombre"
                    value={nombre}
                    onChange={(e) => {
                      setNombre(e.target.value);
                      if (!codigoTocado) setCodigo(sugerirCodigo(e.target.value));
                    }}
                    placeholder="Ej: Juan Pérez"
                    className="h-11 rounded-xl"
                    autoFocus
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sd-mail" className="text-xs font-semibold">Mail</Label>
                  <Input id="sd-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="juan@mail.com" className="h-11 rounded-xl" />
                  {yaExiste && (
                    <div className="flex items-center gap-2 rounded-xl bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-200">
                      <span className="min-w-0 flex-1">
                        Ese mail ya es de <b>{yaExiste.nombre}</b> ({getRoleInfo(yaExiste.role).label}).
                      </span>
                      {candidatos.some((p) => p.id === yaExiste.id) ? (
                        <Button size="sm" className="h-8 shrink-0 rounded-full" onClick={() => elegir(yaExiste.id)}>
                          Sumarle el rol
                        </Button>
                      ) : (
                        <span className="shrink-0 font-semibold">{yaExiste.role === "socio" || (yaExiste.roles_extra ?? []).includes("socio") ? "Ya es vendedor" : "No se puede"}</span>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="sd-codigo" className="text-xs font-semibold">Código de su link</Label>
              <Input
                id="sd-codigo"
                value={codigo}
                onChange={(e) => {
                  setCodigoTocado(true);
                  setCodigo(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
                }}
                placeholder="juanperez"
                maxLength={30}
                className="h-11 rounded-xl"
              />
              <p className="text-[11px] text-muted-foreground">
                somosprodi.com/?ref={codigo || "codigo"}
                {codigo && !codigoOk && <span className="text-destructive"> · mínimo 3 letras o números</span>}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Cómo cobra</Label>
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted/60 p-1">
                {(
                  [
                    { k: "mensual", label: "Cada mes", ayuda: "Ej: 10% × 12 meses" },
                    { k: "entrada", label: "Premio de entrada", ayuda: "Ej: 50% del 1er mes" },
                  ] as const
                ).map((x) => (
                  <button
                    key={x.k}
                    type="button"
                    onClick={() => setModoCom(x.k)}
                    className={cn("rounded-lg px-2 py-1.5 text-center transition-colors", modoCom === x.k ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}
                  >
                    <span className="block text-xs font-semibold">{x.label}</span>
                    <span className="block text-[10px] text-muted-foreground">{x.ayuda}</span>
                  </button>
                ))}
              </div>
            </div>
            {modoCom === "mensual" ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="sd-pct" className="text-xs font-semibold">Comisión (%)</Label>
                  <Input id="sd-pct" type="number" inputMode="decimal" min={0} max={100} value={pct} onChange={(e) => setPct(e.target.value)} placeholder="Estándar" className="h-11 rounded-xl" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sd-meses" className="text-xs font-semibold">Durante (meses)</Label>
                  <Input id="sd-meses" type="number" inputMode="numeric" min={1} max={120} value={meses} onChange={(e) => setMeses(e.target.value)} placeholder="Estándar" className="h-11 rounded-xl" />
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="sd-pct" className="text-xs font-semibold">% del primer abono</Label>
                <Input id="sd-pct" type="number" inputMode="decimal" min={0} max={100} value={pct} onChange={(e) => setPct(e.target.value)} placeholder="Ej: 50" className="h-11 rounded-xl" />
              </div>
            )}
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Solo por clientes nuevos que traiga, sobre el abono neto cobrado (sin IVA, sin pauta ni reintegros).
              {modoCom === "mensual" ? (!pct || !meses) && <b> Vacío = la estándar de su grupo (del equipo o de afuera).</b> : " Se paga una vez, cuando el cliente paga su primer mes."}
            </p>
          </div>
        )}

        {!mensaje && (
          <DialogFooter>
            <Button onClick={() => void guardar()} disabled={!ok || guardando} className="h-12 w-full rounded-2xl bg-[#6F40FC] font-semibold text-white hover:bg-[#5d32e6]">
              {guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {!nuevo ? "Guardar" : modo === "existente" ? "Sumar como vendedor" : "Crear vendedor"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
