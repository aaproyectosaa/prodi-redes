import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  collection,
  doc,
  onSnapshot,
  updateDoc,
  query,
  where,
  type QueryConstraint,
} from "@/lib/db";
import { db } from "@/integrations/firebase/client";
import type { Project } from "@/integrations/firebase/types";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { useAppData } from "@/contexts/app-data-context";
import { isProjectEnabled } from "@/lib/projectEnabled";
import { trabajaEnCliente } from "@/lib/roles";
import { mesActual, sumarMeses } from "@/lib/redes/format";
import { asegurarChatProdi, noLeido, sincronizarChats } from "@/lib/redes/chat";
import { asegurarAvatar, avatarAlDia } from "@/lib/redes/avatarLogo";
import { sincronizarAvatares } from "@/lib/avatares";
import {
  DEFAULT_REDES_SETTINGS,
  type Chat,
  type Cobro,
  type Reunion,
  type PiezaIA,
  type PlanRedes,
  type RedesSettings,
  type Rodaje,
  type Video,
} from "@/lib/redes/types";

/** Meses hacia atrás que se cargan en vivo para el admin. */
const MESES_EN_VIVO = 6;

interface RedesDataValue {
  /** Clientes que este usuario puede ver (habilitados). */
  clientes: Project[];
  videos: Video[];
  rodajes: Rodaje[];
  piezas: PiezaIA[];
  cobros: Cobro[];
  planes: PlanRedes[];
  settings: RedesSettings;
  chats: Chat[];
  reuniones: Reunion[];
  /** Conversaciones con mensajes sin leer. */
  chatsNoLeidos: number;
  loading: boolean;
  clienteById: (id: string | null | undefined) => Project | undefined;
}

const Ctx = createContext<RedesDataValue | null>(null);

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Escucha una colección filtrada por proyecto (de a 30 ids, límite de `in`)
 * o completa con restricciones (admin). Devuelve docs ordenados por id.
 */
function useScopedCollection<T extends { id: string }>(
  name: string,
  enabled: boolean,
  projectIds: string[] | "all",
  extra: QueryConstraint[] = [],
  extraKey = "",
  /** Clientes: una consulta "==" por proyecto (las reglas de Firestore lo exigen). */
  porProyecto = false
): { data: T[]; loading: boolean } {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const idsKey = projectIds === "all" ? "all" : projectIds.slice().sort().join(",");

  useEffect(() => {
    if (!enabled) {
      setData([]);
      setLoading(false);
      return;
    }
    if (projectIds !== "all" && projectIds.length === 0) {
      setData([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const groups = projectIds === "all" ? [null] : chunk(projectIds, porProyecto ? 1 : 30);
    const partial = new Map<number, T[]>();
    const unsubs = groups.map((ids, idx) => {
      const constraints: QueryConstraint[] = ids
        ? [porProyecto ? where("proyecto_id", "==", ids[0]) : where("proyecto_id", "in", ids)]
        : [...extra];
      return onSnapshot(
        query(collection(db, name), ...constraints),
        (snap) => {
          partial.set(
            idx,
            snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T)
          );
          setData(Array.from(partial.values()).flat());
          if (partial.size >= groups.length) setLoading(false);
        },
        (err) => {
          console.error(`[redes] error escuchando ${name}`, err);
          setLoading(false);
        }
      );
    });
    return () => unsubs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, enabled, idsKey, extraKey, porProyecto]);

  return { data, loading };
}

export function RedesDataProvider({ children }: { children: ReactNode }) {
  const { user, role } = useUserProfileContext();
  const { projects, loading: appLoading } = useAppData();
  const uid = user?.uid;
  const isAdmin = role === "admin";
  // Diseño ve sus clientes y los que todavía no tienen diseñadora asignada (trabajaEnCliente).
  const finanzas = isAdmin || role === "administracion";
  const global = finanzas;
  const activo = !!uid && !!role && role !== "pending";
  // Contacto (solo chat): no ve nada del sistema, solo sus chats.
  const soloChat = role === "contacto";

  const clientes = useMemo(() => {
    const enabled = projects.filter(isProjectEnabled);
    if (global) return enabled.sort((a, b) => a.nombre.localeCompare(b.nombre));
    if (!uid) return [];
    return enabled.filter((p) => trabajaEnCliente(role, uid, p)).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [projects, global, uid, role]);

  const scope: string[] | "all" = global ? "all" : clientes.map((c) => c.id);
  const conVideos = activo && role !== "diseno" && !soloChat;
  const desdeMes = sumarMeses(mesActual(), -(MESES_EN_VIVO - 1));
  const porProyecto = role === "cliente";

  const videosQ = useScopedCollection<Video>(
    "videos",
    conVideos,
    scope,
    [where("mes", ">=", desdeMes)],
    desdeMes,
    porProyecto
  );
  const rodajesQ = useScopedCollection<Rodaje>(
    "rodajes",
    conVideos,
    scope,
    [where("fecha", ">=", `${desdeMes}-01`)],
    desdeMes,
    porProyecto
  );
  const piezasQ = useScopedCollection<PiezaIA>(
    "piezas_ia",
    activo && role !== "editor" && role !== "pauta" && !soloChat,
    scope,
    [where("created_at", ">=", `${desdeMes}-01`)],
    desdeMes,
    porProyecto
  );
  const cobrosQ = useScopedCollection<Cobro>(
    "cobros",
    activo && (finanzas || role === "cliente"),
    scope,
    [where("created_at", ">=", `${desdeMes}-01`)],
    desdeMes,
    porProyecto
  );

  // ---- Chats (donde el usuario es miembro) ----
  const [chats, setChats] = useState<Chat[]>([]);
  const [chatsListos, setChatsListos] = useState(false);
  useEffect(() => {
    if (!activo || !uid) {
      setChats([]);
      return;
    }
    return onSnapshot(
      query(collection(db, "chats"), where("miembros", "array-contains", uid)),
      (snap) => {
        setChatsListos(true);
        setChats(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() }) as Chat)
            .sort(
              (a, b) =>
                // Prodi siempre arriba; después las que tienen mensajes (la más reciente arriba) y los grupos vacíos.
                Number(b.tipo === "prodi") - Number(a.tipo === "prodi") ||
                (b.ultimo?.at ?? "").localeCompare(a.ultimo?.at ?? "") ||
                (a.tipo === "equipo" ? -1 : b.tipo === "equipo" ? 1 : 0) ||
                (a.nombre ?? "").localeCompare(b.nombre ?? "")
            )
        );
      },
      (err) => console.error("[redes] chats", err)
    );
  }, [activo, uid]);

  // El super admin mantiene al día los grupos de chat (equipo y uno por cliente).
  const { profiles } = useAppData();
  const { viewingAs } = useUserProfileContext();
  const syncKey = useMemo(
    () =>
      JSON.stringify([
        projects.map((p) => [p.id, p.nombre, p.enabled, p.team_roles]),
        profiles.map((p) => [p.id, p.role]),
        chats.map((c) => [c.id, c.miembros, c.nombre]),
      ]),
    [projects, profiles, chats]
  );
  useEffect(() => {
    if (!isAdmin || viewingAs || appLoading || profiles.length === 0) return;
    const t = window.setTimeout(() => void sincronizarChats(projects, profiles, chats), 1200);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncKey, isAdmin, viewingAs, appLoading]);

  // Cada persona del equipo tiene su chat con Prodi (se crea la primera vez).
  const yaProdi = useRef(false);
  useEffect(() => {
    if (!chatsListos || !uid || viewingAs || yaProdi.current) return;
    if (!["admin", "productor", "editor", "pauta", "diseno", "administracion"].includes(role ?? "")) return;
    yaProdi.current = true;
    const nombre = profiles.find((p) => p.id === uid)?.nombre ?? "";
    void asegurarChatProdi(uid, nombre, chats).catch((err) => console.warn("[redes] chat Prodi", err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatsListos, uid, role, viewingAs]);

  // Y copia a avatares/ las fotos de perfil (así los clientes ven la del equipo), una vez por sesión.
  useEffect(() => {
    if (!isAdmin || viewingAs || appLoading || profiles.length === 0) return;
    const t = window.setTimeout(() => void sincronizarAvatares(profiles), 3000);
    return () => window.clearTimeout(t);
  }, [isAdmin, viewingAs, appLoading, profiles]);

  // Gente desactivada que quedó en el equipo de algún cliente (desactivada antes de que se limpiara sola): se saca.
  useEffect(() => {
    if (!isAdmin || viewingAs || appLoading || profiles.length === 0) return;
    const inactivos = new Set(profiles.filter((p) => p.activo === false).map((p) => p.id));
    if (!inactivos.size) return;
    for (const p of projects) {
      const team = p.team_roles ?? {};
      const cambia = Object.values(team).some((ids) => (ids ?? []).some((id) => inactivos.has(id)));
      if (!cambia) continue;
      const limpio = Object.fromEntries(Object.entries(team).map(([k, ids]) => [k, (ids ?? []).filter((id) => !inactivos.has(id))]));
      void updateDoc(doc(db, "projects", p.id), { team_roles: limpio }).catch((err) => console.warn("[redes] equipo", p.id, err));
    }
  }, [isAdmin, viewingAs, appLoading, profiles, projects]);

  // Foto de perfil de cada cliente armada con su logo (centrado y sin márgenes): las que falten o sean de un logo viejo.
  useEffect(() => {
    if (!isAdmin || viewingAs || appLoading) return;
    const t = window.setTimeout(async () => {
      for (const p of projects) if (!avatarAlDia(p)) await asegurarAvatar(p);
    }, 5000);
    return () => window.clearTimeout(t);
  }, [isAdmin, viewingAs, appLoading, projects]);

  // ---- Reuniones ----
  const [reunionesRaw, setReunionesRaw] = useState<Reunion[]>([]);
  const clienteIdsKey = clientes.map((c) => c.id).join(",");
  useEffect(() => {
    if (!activo || !uid || soloChat) {
      setReunionesRaw([]);
      return;
    }
    const parts = new Map<string, Reunion[]>();
    const push = (k: string) => (snap: { docs: { id: string; data: () => unknown }[] }) => {
      parts.set(k, snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as Reunion));
      const all = new Map<string, Reunion>();
      parts.forEach((list) => list.forEach((r) => all.set(r.id, r)));
      setReunionesRaw(Array.from(all.values()));
    };
    const onErr = (err: unknown) => console.error("[redes] reuniones", err);
    const subs: (() => void)[] = [];
    if (isAdmin) {
      subs.push(onSnapshot(query(collection(db, "reuniones"), where("fecha", ">=", `${desdeMes}-01`)), push("all"), onErr));
    } else if (role === "cliente") {
      for (const c of clientes) {
        subs.push(onSnapshot(query(collection(db, "reuniones"), where("proyecto_id", "==", c.id)), push(c.id), onErr));
      }
    } else {
      subs.push(onSnapshot(query(collection(db, "reuniones"), where("participantes", "array-contains", uid)), push("mias"), onErr));
    }
    return () => subs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activo, uid, isAdmin, role, clienteIdsKey, desdeMes, soloChat]);
  const reuniones = useMemo(
    () => [...reunionesRaw].sort((a, b) => b.fecha.localeCompare(a.fecha)),
    [reunionesRaw]
  );

  const [planes, setPlanes] = useState<PlanRedes[]>([]);
  const [settings, setSettings] = useState<RedesSettings>(DEFAULT_REDES_SETTINGS);

  useEffect(() => {
    if (!activo) return;
    const u1 = onSnapshot(
      collection(db, "planes_redes"),
      (snap) =>
        setPlanes(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() }) as PlanRedes)
            .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
        ),
      (err) => console.error("[redes] planes", err)
    );
    const u2 = onSnapshot(
      doc(db, "app_settings", "redes"),
      (snap) =>
        setSettings({
          ...DEFAULT_REDES_SETTINGS,
          ...((snap.exists() ? snap.data() : {}) as Partial<RedesSettings>),
        }),
      (err) => console.error("[redes] settings", err)
    );
    return () => {
      u1();
      u2();
    };
  }, [activo]);

  // Los clientes solo ven lo que es de sus proyectos (y nada interno de proyectos deshabilitados).
  const clienteIds = useMemo(() => new Set(clientes.map((c) => c.id)), [clientes]);
  const videos = useMemo(
    () => videosQ.data.filter((v) => clienteIds.has(v.proyecto_id)),
    [videosQ.data, clienteIds]
  );
  const rodajes = useMemo(
    () => rodajesQ.data.filter((r) => clienteIds.has(r.proyecto_id)),
    [rodajesQ.data, clienteIds]
  );
  const piezas = useMemo(
    () =>
      piezasQ.data
        .filter((p) => clienteIds.has(p.proyecto_id))
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [piezasQ.data, clienteIds]
  );
  const cobros = useMemo(
    () =>
      cobrosQ.data
        .filter((c) => clienteIds.has(c.proyecto_id))
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [cobrosQ.data, clienteIds]
  );

  const value = useMemo<RedesDataValue>(
    () => ({
      clientes,
      videos,
      rodajes,
      piezas,
      cobros,
      planes,
      settings,
      loading: appLoading || videosQ.loading || rodajesQ.loading,
      clienteById: (id) => (id ? projects.find((p) => p.id === id) : undefined),
      chats,
      reuniones,
      chatsNoLeidos: chats.filter((c) => noLeido(c, uid)).length,
    }),
    [clientes, videos, rodajes, piezas, cobros, planes, settings, appLoading, videosQ.loading, rodajesQ.loading, projects, chats, reuniones, uid]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRedes(): RedesDataValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useRedes debe usarse dentro de RedesDataProvider");
  return ctx;
}
