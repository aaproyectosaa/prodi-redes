// Tareas de Prodi Software: las que se crearon desde sus chats (el grupo "Equipo Software" y los privados), muchas
// sugeridas por la IA y confirmadas por una persona. Kanban (Pendientes / Hechas) o lista; programación ve las suyas
// por defecto y el admin todas. Solo tareas con empresa "software": las de Redes no aparecen acá.

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, Check, LayoutGrid, List, MessageCircle, RotateCcw, Store } from "lucide-react";
import { toast } from "sonner";
import { collection, onSnapshot, query, where } from "@/lib/db";
import { db } from "@/integrations/firebase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import UserAvatar from "@/components/UserAvatar";
import { PageHeader } from "@/software/ui/PageHeader";
import { EmptyState } from "@/software/ui/EmptyState";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { useAppData } from "@/contexts/app-data-context";
import { hoyAR } from "@/lib/fecha";
import { marcarTarea, TAREAS } from "@/lib/redes/tareas";
import type { Tarea } from "@/lib/redes/types";
import type { Profile } from "@/integrations/firebase/types";
import { cn } from "@/lib/utils";

type Vista = "kanban" | "lista";
const CLAVE_VISTA = "prodi-sw-tareas-vista";

function useTareasSoftware(): Tarea[] {
  const [lista, setLista] = useState<Tarea[]>([]);
  useEffect(
    () =>
      // Cada uno recibe solo las que puede ver (asignadas o pedidas por él; el admin, todas): lo filtra el servidor.
      onSnapshot(
        query(collection(db, TAREAS), where("empresa", "==", "software")),
        (snap: { docs: { id: string; data: () => unknown }[] }) => setLista(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Tarea, "id">) }))),
        () => setLista([])
      ),
    []
  );
  return lista;
}

const fechaCorta = (f: string) => new Date(`${f}T12:00:00`).toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "numeric" });

export default function TareasSoftware() {
  const { user, roles } = useUserProfileContext();
  const { profiles } = useAppData();
  const uid = user?.uid ?? "";
  const esAdmin = roles.includes("admin");
  const tareas = useTareasSoftware();
  // Programación: por defecto, las suyas. El admin: todas.
  const [persona, setPersona] = useState<string>(esAdmin ? "todas" : uid || "todas");
  const [cliente, setCliente] = useState<string>("todos");
  const [vista, setVistaState] = useState<Vista>(() => {
    try {
      return localStorage.getItem(CLAVE_VISTA) === "lista" ? "lista" : "kanban";
    } catch {
      return "kanban";
    }
  });
  const setVista = (v: Vista) => {
    setVistaState(v);
    try {
      localStorage.setItem(CLAVE_VISTA, v);
    } catch {
      /* sin storage */
    }
  };
  useEffect(() => {
    if (!esAdmin && uid && persona === "todas") setPersona(uid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  const perfilDe = (id: string): Profile | undefined => profiles.find((p) => p.id === id);
  const nombre = (id: string) => (id === uid ? "Yo" : perfilDe(id)?.nombre?.split(" ")[0] ?? "Alguien");
  const personas = useMemo(() => [...new Set(tareas.flatMap((t) => t.asignados))].sort((a, b) => nombre(a).localeCompare(nombre(b))), [tareas, profiles]); // eslint-disable-line react-hooks/exhaustive-deps
  const clientes = useMemo(
    () =>
      [...new Map(tareas.filter((t) => t.cliente_software_id).map((t) => [t.cliente_software_id!, t.cliente_software_nombre ?? "Cliente"])).entries()].sort((a, b) =>
        a[1].localeCompare(b[1])
      ),
    [tareas]
  );
  const filtradas = tareas
    .filter((t) => persona === "todas" || t.asignados.includes(persona))
    .filter((t) => cliente === "todos" || (cliente === "sin" ? !t.cliente_software_id : t.cliente_software_id === cliente))
    .sort((a, b) => (a.vence ?? "9999").localeCompare(b.vence ?? "9999") || b.created_at.localeCompare(a.created_at));
  const pendientes = filtradas.filter((t) => !t.hecha);
  const hechas = filtradas.filter((t) => t.hecha).sort((a, b) => String(b.hecha_at ?? "").localeCompare(String(a.hecha_at ?? "")));

  const cambiar = (t: Tarea) =>
    void marcarTarea(t.id, !t.hecha, uid)
      .then(() => toast.success(t.hecha ? "Volvió a pendientes" : "¡Hecha!"))
      .catch((err) => toast.error(err instanceof Error ? err.message : "No se pudo"));

  const tarjeta = (t: Tarea) => <TarjetaTarea key={t.id} t={t} nombre={nombre} perfilDe={perfilDe} onCambiar={() => cambiar(t)} />;

  return (
    <div>
      <PageHeader
        title="Tareas"
        sub="Lo que sale de los chats de Software. La IA sugiere y una persona confirma; acá se marcan hechas con un toque."
        actions={
          <div className="flex items-center gap-1 rounded-lg border p-0.5">
            {(
              [
                ["kanban", LayoutGrid, "Kanban"],
                ["lista", List, "Lista"],
              ] as const
            ).map(([v, Icono, t]) => (
              <Button key={v} size="sm" variant={vista === v ? "default" : "ghost"} className="h-8 text-xs" onClick={() => setVista(v)}>
                <Icono className="mr-1.5 h-3.5 w-3.5" /> {t}
              </Button>
            ))}
          </div>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Select value={persona} onValueChange={setPersona}>
          <SelectTrigger className="w-full sm:w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas las personas</SelectItem>
            {uid && !personas.includes(uid) && <SelectItem value={uid}>Mis tareas</SelectItem>}
            {personas.map((p) => (
              <SelectItem key={p} value={p}>
                {p === uid ? "Mis tareas" : perfilDe(p)?.nombre ?? nombre(p)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={cliente} onValueChange={setCliente}>
          <SelectTrigger className="w-full sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos los clientes</SelectItem>
            <SelectItem value="sin">Sin cliente</SelectItem>
            {clientes.map(([id, n]) => (
              <SelectItem key={id} value={id}>
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {tareas.length === 0 ? (
        <EmptyState title="Todavía no hay tareas">
          Cuando en el chat «Equipo Software» alguien pide algo («Agus, para el jueves arreglá el login de…»), aparece «¿Crear tarea?» debajo del mensaje.
        </EmptyState>
      ) : vista === "kanban" ? (
        <div className="grid gap-3 md:grid-cols-2">
          {(
            [
              ["Pendientes", pendientes, "bg-primary"],
              ["Hechas", hechas, "bg-emerald-500"],
            ] as const
          ).map(([titulo, items, dot]) => (
            <div key={titulo} className="flex flex-col rounded-2xl border bg-muted/30">
              <div className="flex items-center justify-between px-3 pt-3">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <span className={cn("h-2 w-2 rounded-full", dot)} /> {titulo}
                </p>
                <span className="rounded-full bg-background px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">{items.length}</span>
              </div>
              <div className="flex min-h-[120px] flex-col gap-2 p-2 md:max-h-[calc(100dvh-280px)] md:overflow-y-auto">
                {items.map(tarjeta)}
                {items.length === 0 && <p className="py-6 text-center text-xs text-muted-foreground/70">{titulo === "Pendientes" ? "Nada pendiente 👌" : "Vacío"}</p>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {[...pendientes, ...hechas].map(tarjeta)}
          {filtradas.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No hay tareas con esos filtros.</p>}
        </div>
      )}
    </div>
  );
}

function TarjetaTarea({ t, nombre, perfilDe, onCambiar }: { t: Tarea; nombre: (id: string) => string; perfilDe: (id: string) => Profile | undefined; onCambiar: () => void }) {
  const hoy = hoyAR();
  const vencida = !t.hecha && !!t.vence && t.vence < hoy;
  return (
    <div className={cn("flex items-start gap-3 rounded-xl border bg-card p-3 transition-opacity", t.hecha && "opacity-60")}>
      <button
        type="button"
        onClick={onCambiar}
        className={cn(
          "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
          t.hecha ? "border-emerald-500 bg-emerald-500 text-white" : "border-muted-foreground/40 hover:border-primary"
        )}
        aria-label={t.hecha ? "Volver a pendiente" : "Marcar hecha"}
        title={t.hecha ? "Volver a pendiente" : "Marcar hecha"}
      >
        {t.hecha ? <Check className="h-3.5 w-3.5" /> : null}
      </button>
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className={cn("text-sm font-medium leading-snug", t.hecha && "line-through")}>{t.titulo}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="flex -space-x-1.5">
              {t.asignados.slice(0, 3).map((u) => (
                <UserAvatar key={u} profile={perfilDe(u) ?? ({ id: u, nombre: nombre(u), email: "" } as Profile)} size="sm" />
              ))}
            </span>
            {t.asignados.map(nombre).join(", ")}
          </span>
          {t.vence && (
            <span className={cn("flex items-center gap-1", vencida && "font-semibold text-destructive")}>
              <CalendarDays className="h-3.5 w-3.5" /> {vencida ? "Venció " : ""}
              {fechaCorta(t.vence)}
            </span>
          )}
          {t.cliente_software_nombre && (
            <span className="flex items-center gap-1">
              <Store className="h-3.5 w-3.5" /> {t.cliente_software_nombre}
            </span>
          )}
          {t.chat_id && (
            <Link to={`/chat?c=${t.chat_id}${t.mensaje_id ? `&m=${t.mensaje_id}` : ""}`} className="flex items-center gap-1 text-primary hover:underline">
              <MessageCircle className="h-3.5 w-3.5" /> Ver en el chat
            </Link>
          )}
          {t.hecha && (
            <button type="button" onClick={onCambiar} className="flex items-center gap-1 hover:text-foreground">
              <RotateCcw className="h-3 w-3" /> Deshacer
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
