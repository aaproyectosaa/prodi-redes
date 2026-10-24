import { useEffect, useState } from "react";
import { Check, ExternalLink, MessageCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { doc, updateDoc } from "@/lib/db";
import { db } from "@/integrations/firebase/client";
import { hoyISO } from "@/lib/redes/format";
import { ESTADO_SERVICIO, SERVICIOS, serviciosDe, servicioInfo, urlCompleta, type EstadoServicio, type IdServicio, type ServicioCliente } from "@/lib/redes/servicios";
import { cn } from "@/lib/utils";
import { chatSoftwareId } from "@/lib/redes/chat";

/** Al dar de alta: qué más contrató además de Redes (chips para tildar). */
export function ElegirServicios({ valor, onChange }: { valor: IdServicio[]; onChange: (v: IdServicio[]) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {SERVICIOS.map((s) => {
        const on = valor.includes(s.id);
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onChange(on ? valor.filter((x) => x !== s.id) : [...valor, s.id])}
            className={cn(
              "flex items-center gap-2.5 rounded-2xl border px-3 py-2.5 text-left transition-colors",
              on ? "border-primary/50 bg-primary/[0.08]" : "border-transparent bg-muted/60 hover:bg-muted"
            )}
          >
            <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-white", s.color)}>
              <s.icon className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">{s.nombre}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{s.texto}</span>
            </span>
            <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2", on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/30")}>
              {on && <Check className="h-3 w-3" strokeWidth={3} />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** En la ficha del cliente (admin): prender cada servicio, su estado, el link y lo que ve el cliente. Se guarda solo. */
export function EditarServicios({ cliente }: { cliente: { id: string; servicios?: ServicioCliente[] | null } }) {
  const [lista, setLista] = useState<ServicioCliente[]>(serviciosDe(cliente));
  const firma = JSON.stringify(cliente.servicios ?? []);
  useEffect(() => setLista(serviciosDe(cliente)), [firma]); // eslint-disable-line react-hooks/exhaustive-deps

  const guardar = (nueva: ServicioCliente[], ok?: string) => {
    setLista(nueva);
    updateDoc(doc(db, "projects", cliente.id), { servicios: nueva })
      .then(() => ok && toast.success(ok))
      .catch((e) => toast.error(e instanceof Error ? e.message : "No se pudo guardar"));
  };
  const cambiar = (id: IdServicio, patch: Partial<ServicioCliente>, ok?: string) => guardar(lista.map((s) => (s.id === id ? { ...s, ...patch } : s)), ok);

  return (
    <div className="space-y-2 rounded-lg border border-dashed p-2.5">
      <p className="text-sm">
        Servicios contratados
        <span className="block text-[11px] text-muted-foreground">Además de Redes. Cada uno le suma un módulo a su panel. Se guarda al tocar.</span>
      </p>
      {SERVICIOS.map((s) => {
        const actual = lista.find((x) => x.id === s.id);
        return (
          <div key={s.id} className={cn("rounded-xl border p-2.5", actual ? "bg-card" : "border-transparent bg-muted/40")}>
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-white", s.color)}>
                <s.icon className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0 flex-1 text-sm font-medium">{s.nombre}</span>
              {actual && (
                <div className="inline-flex rounded-full border bg-background p-0.5">
                  {(["desarrollo", "activo"] as EstadoServicio[]).map((e) => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => actual.estado !== e && cambiar(s.id, { estado: e }, `${s.nombre}: ${ESTADO_SERVICIO[e].label.toLowerCase()}`)}
                      className={cn(
                        "h-7 rounded-full px-2.5 text-[11px] font-semibold",
                        actual.estado === e ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {ESTADO_SERVICIO[e].label}
                    </button>
                  ))}
                </div>
              )}
              <Button
                size="sm"
                variant={actual ? "ghost" : "outline"}
                className="h-7 rounded-full px-2.5 text-[11px]"
                onClick={() =>
                  actual
                    ? window.confirm(`¿Sacarle ${s.nombre}? Deja de verlo en su panel.`) && guardar(lista.filter((x) => x.id !== s.id), `${s.nombre} sacado`)
                    : guardar([...lista, { id: s.id, estado: "desarrollo", desde: hoyISO() }], `${s.nombre} agregado a su panel`)
                }
              >
                {actual ? "Sacar" : "Agregar"}
              </Button>
            </div>
            {actual && (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <CampoGuardable
                  inicial={actual.url ?? ""}
                  placeholder={s.id === "web" ? "Link de la web" : "Link para entrar"}
                  onGuardar={(v) => cambiar(s.id, { url: v.trim() || null })}
                />
                <CampoGuardable inicial={actual.detalle ?? ""} placeholder="Lo que ve el cliente (opcional)" onGuardar={(v) => cambiar(s.id, { detalle: v.trim() || null })} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CampoGuardable({ inicial, placeholder, onGuardar }: { inicial: string; placeholder: string; onGuardar: (v: string) => void }) {
  const [v, setV] = useState(inicial);
  useEffect(() => setV(inicial), [inicial]);
  return (
    <Input
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v.trim() !== inicial.trim() && onGuardar(v)}
      placeholder={placeholder}
      maxLength={300}
      className="h-9 text-xs"
    />
  );
}

/** En el panel del cliente: sus servicios, cada uno con su estado, el link para entrar y cómo pedir cambios. */
export function MisServicios({ cliente, resaltar }: { cliente: { id: string; servicios?: ServicioCliente[] | null }; resaltar?: string | null }) {
  const lista = serviciosDe(cliente);
  if (!lista.length) return <p className="py-10 text-center text-sm text-muted-foreground">Todavía no tenés otros servicios con nosotros.</p>;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {lista.map((s) => {
        const info = servicioInfo(s.id);
        const est = ESTADO_SERVICIO[s.estado];
        return (
          <div
            key={s.id}
            id={`servicio-${s.id}`}
            className={cn("flex flex-col gap-3 rounded-3xl border bg-card p-5 transition-shadow", resaltar === s.id && "border-primary/50 shadow-[0_0_32px_-14px_hsl(var(--primary)/0.9)]")}
          >
            <div className="flex items-start gap-3">
              <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-sm", info.color)}>
                <info.icon className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-lg font-semibold leading-tight">{info.nombre}</p>
                <p className="text-sm text-muted-foreground">{info.texto}</p>
              </div>
              <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold", est.clase)}>{est.label}</span>
            </div>
            {s.estado === "desarrollo" && (
              <p className="rounded-2xl bg-muted/50 p-3 text-sm text-muted-foreground">Lo estamos armando. Te avisamos apenas esté listo para usar.</p>
            )}
            {s.detalle && <p className="whitespace-pre-wrap rounded-2xl bg-muted/50 p-3 text-sm">{s.detalle}</p>}
            <div className="mt-auto flex flex-wrap gap-2">
              {s.url && (
                <Button asChild className="h-11 flex-1 rounded-2xl font-semibold">
                  <a href={urlCompleta(s.url)} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="mr-2 h-4 w-4" /> {info.abrir}
                  </a>
                </Button>
              )}
              <Button asChild variant="outline" className="h-11 flex-1 rounded-2xl font-semibold">
                <Link to={`/chat?c=${chatSoftwareId(cliente.id)}`}>
                  <MessageCircle className="mr-2 h-4 w-4" /> Pedir un cambio o ayuda
                </Link>
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
