import { useEffect, useState } from "react";
import { Check, Copy, Handshake, Loader2 } from "lucide-react";
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
  config: { codigo: string; comision_pct: number | null; meses: number | null } | null;
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
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [codigo, setCodigo] = useState("");
  const [codigoTocado, setCodigoTocado] = useState(false);
  const [pct, setPct] = useState("");
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
    setMeses(socio?.config?.meses != null ? String(socio.config.meses) : "");
    setMensaje(null);
    setCopiado(false);
  }, [open, socio]);

  const codigoOk = /^[a-z0-9][a-z0-9-]{2,29}$/.test(codigo);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
  const ok = codigoOk && (nuevo ? nombre.trim().length >= 2 && emailOk : true);

  const guardar = async () => {
    setGuardando(true);
    const config = { codigo, comision_pct: pct, meses };
    try {
      if (nuevo) {
        const r = await callApi<{ password: string }>("/api/usuarios/crear", { nombre: nombre.trim(), email: email.trim().toLowerCase(), rol: "socio", roles_extra: [], clientes: [], socio: config });
        setMensaje(
          `¡Hola ${nombre.trim().split(" ")[0]}! Ya sos socio comercial de Prodi 🤝\n\nEntrá acá: ${window.location.origin}\nMail: ${email.trim().toLowerCase()}\nContraseña: ${r.password}\n\nAdentro tenés tu link para compartir (somosprodi.com/?ref=${codigo}), el QR y un botón para cargar a los empresarios que entrevistes.`
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
          <DialogTitle className="text-xl">{mensaje ? "¡Listo! Pasale sus datos" : nuevo ? "Nuevo socio comercial" : `Editar a ${socio?.nombre}`}</DialogTitle>
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
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="sd-pct" className="text-xs font-semibold">Comisión (%)</Label>
                <Input id="sd-pct" type="number" inputMode="decimal" min={0} max={100} value={pct} onChange={(e) => setPct(e.target.value)} placeholder="Ej: 10" className="h-11 rounded-xl" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sd-meses" className="text-xs font-semibold">Durante (meses)</Label>
                <Input id="sd-meses" type="number" inputMode="numeric" min={1} max={120} value={meses} onChange={(e) => setMeses(e.target.value)} placeholder="Ej: 12" className="h-11 rounded-xl" />
              </div>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Sobre el abono neto cobrado (sin IVA, sin pauta ni reintegros), desde el alta de cada cliente que traiga.
              {(!pct || !meses) && <b className="text-amber-600 dark:text-amber-400"> Sin porcentaje y meses no se le calcula comisión.</b>}
            </p>
          </div>
        )}

        {!mensaje && (
          <DialogFooter>
            <Button onClick={() => void guardar()} disabled={!ok || guardando} className="h-12 w-full rounded-2xl bg-[#6F40FC] font-semibold text-white hover:bg-[#5d32e6]">
              {guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {nuevo ? "Crear socio" : "Guardar"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
