import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { deleteDoc, doc } from "@/lib/db";
import { db } from "@/integrations/firebase/client";
import { assertEditable } from "@/lib/redes/vistaComo";
import {
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  FileText,
  Loader2,
  Plus,
  Send,
  Sparkles,
  Trash2,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageShell, EmptyState } from "@/components/redes/PageShell";
import { ClienteTag } from "@/components/redes/ClienteTag";
import { Grabador } from "@/components/redes/Grabador";
import UserAvatar from "@/components/UserAvatar";
import { useRedes } from "@/contexts/redes-data-context";
import { useAppData } from "@/contexts/app-data-context";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { actualizarReunion, compartirMinuta, crearReunion, generarMinuta, minutaVacia } from "@/lib/redes/reuniones";
import { chatClienteId } from "@/lib/redes/chat";
import { fechaHora } from "@/lib/redes/format";
import { cn } from "@/lib/utils";
import type { Minuta, Reunion } from "@/lib/redes/types";

function aLocalInput(d: Date) {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 16);
}

export default function Reuniones() {
  const { reuniones, clienteById } = useRedes();
  const { profiles } = useAppData();
  const { role } = useUserProfileContext();
  const [params, setParams] = useSearchParams();
  const abierta = reuniones.find((r) => r.id === params.get("r")) ?? null;
  const [tab, setTab] = useState<"proximas" | "pasadas">("proximas");
  const [nueva, setNueva] = useState(false);
  const esEquipo = role !== "cliente";
  const corte = Date.now() - 2 * 3600_000;

  const lista = reuniones
    .filter((r) => (tab === "proximas" ? new Date(r.fecha).getTime() >= corte && r.estado !== "realizada" : new Date(r.fecha).getTime() < corte || r.estado === "realizada"))
    .sort((a, b) => (tab === "proximas" ? a.fecha.localeCompare(b.fecha) : b.fecha.localeCompare(a.fecha)));

  const abrir = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("r", id);
    else next.delete("r");
    setParams(next, { replace: true });
  };

  return (
    <PageShell
      title="Reuniones"
      subtitle="Videollamadas gratis y minutas armadas con IA a partir de la grabación."
      actions={
        esEquipo && (
          <Button onClick={() => setNueva(true)}>
            <Plus className="mr-2 h-4 w-4" /> Nueva reunión
          </Button>
        )
      }
    >
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="mb-5">
        <TabsList>
          <TabsTrigger value="proximas">Próximas</TabsTrigger>
          <TabsTrigger value="pasadas">Realizadas</TabsTrigger>
        </TabsList>
      </Tabs>

      {lista.length === 0 ? (
        <EmptyState
          icon={Video}
          title={tab === "proximas" ? "No hay reuniones agendadas" : "Todavía no hay reuniones realizadas"}
          description="También podés arrancar una videollamada desde cualquier chat."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {lista.map((r) => {
            const cliente = clienteById(r.proyecto_id);
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => abrir(r.id)}
                className="flex flex-col gap-2 rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary/50"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold">{r.titulo}</p>
                  {r.minuta ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success/12 px-2 py-0.5 text-[11px] font-medium text-success">
                      <FileText className="h-3 w-3" /> Minuta
                    </span>
                  ) : r.estado === "realizada" ? (
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">Sin minuta</span>
                  ) : null}
                </div>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CalendarClock className="h-3.5 w-3.5" /> {fechaHora(r.fecha)}
                </p>
                <div className="flex items-center justify-between gap-2">
                  {cliente ? <ClienteTag cliente={cliente} /> : <span className="text-xs text-muted-foreground">Interna</span>}
                  <div className="flex -space-x-2">
                    {r.participantes.slice(0, 5).map((id) => {
                      const p = profiles.find((x) => x.id === id);
                      return p ? <UserAvatar key={id} profile={p} size="sm" className="ring-2 ring-card" /> : null;
                    })}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <NuevaReunionDialog open={nueva} onOpenChange={setNueva} onCreada={(id) => abrir(id)} />
      <ReunionSheet reunion={abierta} onClose={() => abrir(null)} />
    </PageShell>
  );
}

function NuevaReunionDialog({ open, onOpenChange, onCreada }: { open: boolean; onOpenChange: (v: boolean) => void; onCreada: (id: string) => void }) {
  const { clientes, chats, settings } = useRedes();
  const { profiles } = useAppData();
  const { user, profile } = useUserProfileContext();
  const [titulo, setTitulo] = useState("");
  const [clienteId, setClienteId] = useState("interna");
  const [fecha, setFecha] = useState(aLocalInput(new Date()));
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setTitulo("");
      setClienteId("interna");
      setFecha(aLocalInput(new Date(Math.ceil(Date.now() / 1800_000) * 1800_000)));
      setSel(new Set());
    }
  }, [open]);

  const cliente = clientes.find((c) => c.id === clienteId);
  // Al elegir un cliente se proponen su equipo y sus usuarios.
  useEffect(() => {
    if (!cliente) return;
    const t = cliente.team_roles ?? {};
    setSel(new Set([...(t.productor ?? []), ...(t.cliente ?? [])]));
  }, [cliente]);

  const candidatos = profiles.filter((p) => {
    if (p.id === user?.uid || !p.role || p.role === "pending" || ["cm", "pm", "disenador"].includes(p.role)) return false;
    if (p.role !== "cliente") return true;
    return cliente ? (cliente.team_roles?.cliente ?? []).includes(p.id) : false;
  });

  const save = async (ahora: boolean) => {
    if (!user) return;
    setSaving(true);
    try {
      const chat = cliente ? chats.find((c) => c.id === chatClienteId(cliente.id)) ?? null : null;
      const { id, link } = await crearReunion(
        {
          titulo: titulo || (cliente ? `Reunión con ${cliente.nombre}` : "Reunión de equipo"),
          proyecto: cliente ?? null,
          fecha: ahora ? new Date().toISOString() : new Date(fecha).toISOString(),
          participantes: Array.from(sel),
          chat,
          jitsiBase: settings.jitsi_base,
        },
        user.uid,
        profile?.nombre ?? ""
      );
      onOpenChange(false);
      onCreada(id);
      if (ahora) window.open(link, "_blank", "noopener");
      toast.success(ahora ? "Videollamada iniciada. Les avisamos a los participantes." : "Reunión agendada. Les avisamos a los participantes.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo crear");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nueva reunión</DialogTitle>
          <DialogDescription>Se crea un link de videollamada gratis (Jitsi Meet). No hace falta instalar nada.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Tema</Label>
            <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ej: Planificación de noviembre" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Cliente</Label>
              <Select value={clienteId} onValueChange={setClienteId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="interna">Reunión interna</SelectItem>
                  {clientes.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Día y hora</Label>
              <Input type="datetime-local" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Participantes</Label>
            <div className="max-h-52 space-y-1 overflow-y-auto rounded-lg border p-2">
              {candidatos.map((p) => (
                <label key={p.id} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/60">
                  <Checkbox
                    checked={sel.has(p.id)}
                    onCheckedChange={() =>
                      setSel((prev) => {
                        const n = new Set(prev);
                        if (n.has(p.id)) n.delete(p.id);
                        else n.add(p.id);
                        return n;
                      })
                    }
                  />
                  <UserAvatar profile={p} size="sm" />
                  <span className="flex-1 truncate text-sm">{p.nombre}</span>
                  <span className="text-[11px] text-muted-foreground">{p.role === "cliente" ? "Cliente" : ""}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => save(true)} disabled={saving}>
            <Video className="mr-2 h-4 w-4" /> Empezar ahora
          </Button>
          <Button onClick={() => save(false)} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Agendar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ListaEditable({
  label,
  items,
  onChange,
  editable,
}: {
  label: string;
  items: string[];
  onChange: (v: string[]) => void;
  editable: boolean;
}) {
  if (!editable) {
    if (!items.length) return null;
    return (
      <div className="space-y-1.5">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
        <ul className="space-y-1 text-sm">
          {items.map((t, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              {t}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <Textarea
        rows={Math.max(2, items.length + 1)}
        value={items.join("\n")}
        onChange={(e) => onChange(e.target.value.split("\n"))}
        placeholder="Uno por línea"
      />
    </div>
  );
}

function ReunionSheet({ reunion, onClose }: { reunion: Reunion | null; onClose: () => void }) {
  const { clienteById, chats } = useRedes();
  const { profiles } = useAppData();
  const { user, role, profile } = useUserProfileContext();
  const esEquipo = role !== "cliente";
  const [notas, setNotas] = useState("");
  const [minuta, setMinuta] = useState<Minuta | null>(null);
  const [editando, setEditando] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    setNotas(reunion?.notas ?? "");
    setMinuta(reunion?.minuta ?? null);
    setEditando(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reunion?.id, reunion?.minuta?.generado_at]);

  const grabaciones = reunion?.attachments_crudo ?? [];
  const cliente = clienteById(reunion?.proyecto_id);
  const chat = useMemo(
    () => (reunion?.chat_id ? chats.find((c) => c.id === reunion.chat_id) : cliente ? chats.find((c) => c.id === chatClienteId(cliente.id)) : undefined),
    [reunion?.chat_id, chats, cliente]
  );

  if (!reunion) return null;

  const run = async (k: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(k);
    try {
      await fn();
      if (ok) toast.success(ok);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Algo salió mal");
    } finally {
      setBusy(null);
    }
  };

  const limpiar = (m: Minuta): Minuta => ({
    ...m,
    temas: m.temas.map((t) => t.trim()).filter(Boolean),
    acuerdos: m.acuerdos.map((t) => t.trim()).filter(Boolean),
    tareas: m.tareas.filter((t) => t.tarea.trim()),
  });

  return (
    <Sheet open={!!reunion} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="space-y-1 border-b px-5 pb-4 pt-5 text-left">
          <SheetTitle className="pr-8 text-xl">{reunion.titulo}</SheetTitle>
          <SheetDescription asChild>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>{fechaHora(reunion.fecha)}</span>
              {cliente && (
                <>
                  <span>·</span>
                  <ClienteTag cliente={cliente} size="md" />
                </>
              )}
            </div>
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild>
              <a href={reunion.link} target="_blank" rel="noreferrer">
                <Video className="mr-2 h-4 w-4" /> Entrar a la videollamada
              </a>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(reunion.link);
                  toast.success("Link copiado");
                } catch {
                  toast.message(reunion.link);
                }
              }}
            >
              Copiar link
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            {reunion.participantes.map((id) => {
              const p = profiles.find((x) => x.id === id);
              return p ? (
                <span key={id} className="inline-flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2.5 text-xs">
                  <UserAvatar profile={p} size="sm" /> {p.nombre}
                </span>
              ) : null;
            })}
          </div>

          {esEquipo && (
            <section className="space-y-2.5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Grabación</h3>
              <Grabador reunion={reunion} clienteNombre={cliente?.nombre ?? "Interno"} />
              {grabaciones.length > 0 && (
                <ul className="space-y-1 text-xs">
                  {grabaciones.map((g, i) => (
                    <li key={i} className="flex items-center gap-2 text-muted-foreground">
                      <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                      <span className="truncate">{g.name}</span>
                      <span>· {(g.size / 1_048_576).toFixed(1)} MB</span>
                      {g.web_view_link && g.web_view_link !== "#" && (
                        <a href={g.web_view_link} target="_blank" rel="noreferrer" className="text-primary">
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-[11px] text-muted-foreground">
                Para grabar una videollamada: entrá a la llamada, volvé acá, tocá «Grabar videollamada» y elegí la pestaña de la llamada con «Compartir audio».
              </p>
            </section>
          )}

          {esEquipo && (
            <section className="space-y-2.5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Notas</h3>
              <Textarea
                rows={4}
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                onBlur={() => notas !== (reunion.notas ?? "") && void run("notas", () => actualizarReunion(reunion.id, { notas }))}
                placeholder="Anotá lo que se habló (si no hay grabación, la IA arma la minuta con esto)"
              />
            </section>
          )}

          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <FileText className="h-3.5 w-3.5" /> Minuta
              </h3>
              {esEquipo && (
                <div className="flex flex-wrap gap-1">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!!busy || (!grabaciones.length && !notas.trim())}
                    title={!grabaciones.length && !notas.trim() ? "Grabá la reunión o escribí notas primero" : undefined}
                    onClick={() =>
                      run(
                        "ia",
                        async () => {
                          if (notas !== (reunion.notas ?? "")) await actualizarReunion(reunion.id, { notas });
                          await generarMinuta(reunion.id, grabaciones.length ? "audio" : "notas");
                        },
                        "Minuta lista"
                      )
                    }
                  >
                    {busy === "ia" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                    {busy === "ia" ? "Escuchando la reunión…" : reunion.minuta ? "Regenerar con IA" : "Generar minuta con IA"}
                  </Button>
                  {!editando && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setMinuta(reunion.minuta ?? minutaVacia());
                        setEditando(true);
                      }}
                    >
                      {reunion.minuta ? "Editar" : "Escribir a mano"}
                    </Button>
                  )}
                </div>
              )}
            </div>

            {editando && minuta ? (
              <div className="space-y-3">
                <Textarea rows={3} value={minuta.resumen} onChange={(e) => setMinuta({ ...minuta, resumen: e.target.value })} placeholder="Resumen" />
                <ListaEditable label="Temas" items={minuta.temas} onChange={(temas) => setMinuta({ ...minuta, temas })} editable />
                <ListaEditable label="Acuerdos" items={minuta.acuerdos} onChange={(acuerdos) => setMinuta({ ...minuta, acuerdos })} editable />
                <ListaEditable
                  label="Tareas (tarea · responsable · fecha)"
                  items={minuta.tareas.map((t) => [t.tarea, t.responsable, t.fecha].filter(Boolean).join(" · "))}
                  onChange={(lines) =>
                    setMinuta({
                      ...minuta,
                      tareas: lines.map((l) => {
                        const [tarea, responsable, fecha] = l.split(" · ");
                        return { tarea: tarea ?? "", responsable: responsable || null, fecha: fecha || null };
                      }),
                    })
                  }
                  editable
                />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setEditando(false)}>
                    Cancelar
                  </Button>
                  <Button
                    size="sm"
                    onClick={() =>
                      run(
                        "guardar",
                        async () => {
                          await actualizarReunion(reunion.id, {
                            minuta: { ...limpiar(minuta), fuente: reunion.minuta?.fuente ?? "manual", generado_at: new Date().toISOString() },
                            estado: "realizada",
                          });
                          setEditando(false);
                        },
                        "Minuta guardada"
                      )
                    }
                  >
                    Guardar minuta
                  </Button>
                </div>
              </div>
            ) : reunion.minuta ? (
              <div className="space-y-4 rounded-xl border bg-card p-4">
                <p className="text-sm leading-relaxed">{reunion.minuta.resumen}</p>
                <ListaEditable label="Temas" items={reunion.minuta.temas} onChange={() => undefined} editable={false} />
                <ListaEditable label="Acuerdos" items={reunion.minuta.acuerdos} onChange={() => undefined} editable={false} />
                {reunion.minuta.tareas.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Tareas</p>
                    <div className="divide-y rounded-lg border">
                      {reunion.minuta.tareas.map((t, i) => (
                        <div key={i} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 text-sm">
                          <span className="flex-1">{t.tarea}</span>
                          {t.responsable && <span className="text-xs font-medium text-primary">{t.responsable}</span>}
                          {t.fecha && <span className="text-xs text-muted-foreground">{t.fecha}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground">
                  {reunion.minuta.fuente === "audio" ? "Armada por IA a partir de la grabación" : reunion.minuta.fuente === "notas" ? "Armada por IA a partir de las notas" : "Escrita a mano"} ·{" "}
                  {fechaHora(reunion.minuta.generado_at)}
                </p>
                {esEquipo && chat && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === "share"}
                    onClick={() => run("share", () => compartirMinuta(reunion, chat, user?.uid ?? "", profile?.nombre ?? ""), "Minuta enviada al chat")}
                  >
                    <Send className="mr-1.5 h-3.5 w-3.5" /> Mandar al chat {cliente ? `de ${cliente.nombre}` : ""}
                  </Button>
                )}
              </div>
            ) : (
              <p className={cn("rounded-xl border border-dashed p-4 text-sm text-muted-foreground")}>
                {esEquipo ? "Grabá la reunión o escribí notas y tocá «Generar minuta con IA»." : "Cuando el equipo cargue la minuta, la vas a ver acá."}
              </p>
            )}
          </section>

          {esEquipo && reunion.estado !== "realizada" && (
            <Button variant="ghost" size="sm" onClick={() => run("hecha", () => actualizarReunion(reunion.id, { estado: "realizada" }), "Marcada como realizada")}>
              <CheckCircle2 className="mr-1.5 h-4 w-4" /> Marcar como realizada
            </Button>
          )}
          {role === "admin" && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() =>
                run("del", async () => {
                  assertEditable();
                  await deleteDoc(doc(db, "reuniones", reunion.id));
                  onClose();
                }, "Reunión eliminada")
              }
            >
              <Trash2 className="mr-1.5 h-4 w-4" /> Eliminar
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
