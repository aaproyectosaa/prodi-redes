import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Check, CheckCircle2, Clock, Download, Eye, EyeOff, Loader2, Lock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { entrarConToken } from "@/lib/auth";
import type { ItemPresupuesto } from "@/lib/redes/presupuestos";
import { cn } from "@/lib/utils";
import { PropuestaVista } from "@/components/redes/PropuestaVista";
import type { Propuesta } from "../../api/_lib/propuesta";

// El link del presupuesto (/p/:token): el cliente lo ve sin usuario, lo acepta, crea su usuario y contraseña y entra.
// Después va a /bienvenida a instalar las apps.

interface Vista {
  numero: number | null;
  empresa: string;
  contacto: { nombre: string | null; email: string | null };
  items: ItemPresupuesto[];
  moneda: "ARS" | "USD";
  tipo: "factura" | "boleta";
  validez: string | null;
  nota: string | null;
  propuesta: Propuesta | null;
  estado: string;
  totales: { mensual: number; unico: number; iva_pct: number; mensual_final: number; unico_final: number };
}

const plata = (n: number, moneda: string) => `${moneda === "USD" ? "US$" : "$"} ${Math.round(n).toLocaleString("es-AR")}`;
const fecha = (f: string) => new Date(`${f.slice(0, 10)}T12:00:00`).toLocaleDateString("es-AR", { day: "numeric", month: "long" });

async function pedir<T>(accion: string, body: Record<string, unknown>): Promise<T> {
  const r = await fetch(`/api/publico/${accion}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error ?? "No se pudo");
  return j as T;
}

export default function PresupuestoPublico() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const [p, setP] = useState<Vista | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aceptando, setAceptando] = useState(false);
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [clave, setClave] = useState("");
  const [ver, setVer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errForm, setErrForm] = useState<string | null>(null);

  useEffect(() => {
    pedir<Vista>("presupuesto", { t: token })
      .then((v) => {
        setP(v);
        setNombre(v.contacto.nombre ?? "");
        setEmail(v.contacto.email ?? "");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo abrir"));
  }, [token]);

  const aceptar = async () => {
    setErrForm(null);
    if (clave.length < 8) return setErrForm("La contraseña tiene que tener al menos 8 caracteres");
    setBusy(true);
    try {
      const r = await pedir<{ token: string }>("presupuesto-aceptar", { t: token, nombre, email, password: clave });
      await entrarConToken(r.token);
      navigate("/bienvenida", { replace: true });
    } catch (e) {
      setErrForm(e instanceof Error ? e.message : "No se pudo");
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#0B0A12] p-6 text-center text-white">
        <div>
          <p className="text-lg font-semibold">{error}</p>
          <p className="mt-1 text-sm text-white/60">Escribinos y te mandamos uno nuevo.</p>
        </div>
      </div>
    );
  }
  if (!p) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#0B0A12] text-white/70">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const cerrado = p.estado === "aceptado" || p.estado === "rechazado" || p.estado === "vencido";
  const mensuales = p.items.filter((i) => i.periodo === "mensual");
  const unicos = p.items.filter((i) => i.periodo === "unico");

  const aceptar_ = cerrado ? (
      <div className={cn("flex items-center gap-3 rounded-2xl p-5", p.estado === "aceptado" ? "bg-emerald-500/15" : "bg-white/[0.06]")}>
        {p.estado === "aceptado" ? <CheckCircle2 className="h-6 w-6 text-emerald-400" /> : <Clock className="h-6 w-6 text-amber-300" />}
        <div>
          <p className="font-semibold">{p.estado === "aceptado" ? "¡Ya lo aceptaste!" : p.estado === "vencido" ? "Este presupuesto venció" : "Este presupuesto ya no está vigente"}</p>
          <p className="text-sm text-white/70">{p.estado === "aceptado" ? "Entrá con tu mail y tu contraseña." : "Escribinos y te mandamos uno actualizado."}</p>
        </div>
        {p.estado === "aceptado" && (
          <Button className="ml-auto" onClick={() => navigate("/auth")}>
            Entrar
          </Button>
        )}
      </div>
    ) : !aceptando ? (
      <Button onClick={() => setAceptando(true)} className="h-14 w-full rounded-2xl bg-gradient-to-r from-[#6F40FC] to-[#E040A0] text-lg font-bold text-white shadow-lg shadow-fuchsia-500/20 hover:opacity-95">
        <Sparkles className="mr-2 h-5 w-5" /> Aceptar presupuesto
      </Button>
    ) : (
      <div className="space-y-4 rounded-2xl bg-white p-5 text-[#14121F] shadow-xl">
        <div>
          <p className="text-lg font-bold">¡Genial! Creá tu usuario</p>
          <p className="text-sm text-black/60">Con esto entrás a tu panel de Prodi: ahí ves tus videos, los aprobás y hablás con el equipo.</p>
        </div>
        <div className="space-y-1.5">
          <Label className="text-black/70">Tu nombre</Label>
          <Input value={nombre} onChange={(e) => setNombre(e.target.value)} className="h-11 border-black/10 bg-white text-black" autoComplete="name" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-black/70">Tu mail</Label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-11 border-black/10 bg-white text-black" autoComplete="email" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-black/70">Elegí una contraseña</Label>
          <div className="relative">
            <Input
              type={ver ? "text" : "password"}
              value={clave}
              onChange={(e) => setClave(e.target.value)}
              className="h-11 border-black/10 bg-white pr-10 text-black"
              autoComplete="new-password"
              placeholder="Al menos 8 caracteres"
            />
            <button type="button" onClick={() => setVer(!ver)} className="absolute right-3 top-1/2 -translate-y-1/2 text-black/40" aria-label={ver ? "Ocultar" : "Mostrar"}>
              {ver ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        {errForm && <p className="text-sm font-medium text-red-600">{errForm}</p>}
        <Button onClick={() => void aceptar()} disabled={busy || !nombre.trim() || !email.trim()} className="h-12 w-full rounded-xl bg-[#6F40FC] text-base font-bold text-white hover:bg-[#6F40FC]/90">
          {busy ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Lock className="mr-2 h-4 w-4" />}
          Aceptar y crear mi usuario
        </Button>
        <p className="text-center text-xs text-black/45">Al aceptar, el presupuesto queda confirmado y te contactamos para arrancar.</p>
      </div>
    );

  // Formato propuesta comercial (como los PDF de Prodi): se ve igual que el PDF y abajo se acepta.
  if (p.propuesta) {
    return (
      <div className="min-h-dvh bg-black text-white [-webkit-print-color-adjust:exact] [print-color-adjust:exact]">
        <PropuestaVista p={p.propuesta} validez={p.validez} className="mx-auto max-w-[860px]" />
        <div className="mx-auto max-w-[860px] space-y-3 px-6 pb-16 sm:px-12 print:hidden">
          {aceptar_}
          <button type="button" onClick={() => window.print()} className="mx-auto flex items-center gap-1.5 text-sm text-white/60 hover:text-white">
            <Download className="h-4 w-4" /> Descargar en PDF
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[#0B0A12] text-white">
      <div className="relative overflow-hidden bg-gradient-to-br from-[#6F40FC] via-[#9B3FD8] to-[#E040A0] px-5 pb-16 pt-10">
        <div className="mx-auto max-w-2xl">
          <p className="text-sm font-bold tracking-[0.2em] text-white/80">PRODI</p>
          <h1 className="mt-6 text-3xl font-extrabold leading-tight sm:text-4xl">Presupuesto para {p.empresa}</h1>
          <p className="mt-2 text-sm text-white/80">
            {p.numero ? `N.º ${p.numero} · ` : ""}
            {p.validez ? `Vale hasta el ${fecha(p.validez)}` : ""}
          </p>
        </div>
      </div>

      <div className="mx-auto -mt-10 max-w-2xl space-y-4 px-4 pb-16">
        {p.nota && <div className="rounded-2xl bg-white/[0.06] p-5 text-[15px] leading-relaxed backdrop-blur">{p.nota}</div>}

        <div className="overflow-hidden rounded-2xl bg-white text-[#14121F] shadow-xl">
          {[
            ["Todos los meses", mensuales],
            ["Una sola vez", unicos],
          ].map(([titulo, lista]) =>
            (lista as ItemPresupuesto[]).length ? (
              <div key={titulo as string} className="border-b border-black/5 p-5 last:border-0">
                <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-[#6F40FC]">{titulo as string}</p>
                <ul className="space-y-3">
                  {(lista as ItemPresupuesto[]).map((i) => (
                    <li key={i.id} className="flex items-start gap-3">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#6F40FC]/10 text-[#6F40FC]">
                        <Check className="h-3 w-3" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">
                          {i.cantidad > 1 ? `${i.cantidad} × ` : ""}
                          {i.concepto}
                        </p>
                        {i.detalle && <p className="text-sm text-black/55">{i.detalle}</p>}
                      </div>
                      <p className="shrink-0 font-semibold tabular-nums">{plata(i.precio * i.cantidad, p.moneda)}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null
          )}
          <div className="space-y-1 bg-[#F6F4FF] p-5">
            {p.totales.mensual > 0 && (
              <p className="flex items-end justify-between">
                <span className="text-sm text-black/60">Por mes{p.totales.iva_pct ? ` (IVA ${p.totales.iva_pct}% incluido)` : ""}</span>
                <span className="text-2xl font-extrabold tabular-nums">{plata(p.totales.mensual_final, p.moneda)}</span>
              </p>
            )}
            {p.totales.unico > 0 && (
              <p className="flex items-end justify-between">
                <span className="text-sm text-black/60">Una sola vez{p.totales.iva_pct ? ` (IVA ${p.totales.iva_pct}% incluido)` : ""}</span>
                <span className="text-xl font-bold tabular-nums">{plata(p.totales.unico_final, p.moneda)}</span>
              </p>
            )}
            {p.moneda === "USD" && <p className="text-xs text-black/50">En dólares. Se paga en pesos al dólar del día de la factura.</p>}
          </div>
        </div>

        {aceptar_}
      </div>
    </div>
  );
}
