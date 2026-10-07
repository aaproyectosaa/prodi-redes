import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { collection, documentId, onSnapshot, query, where } from "@/lib/db";
import { db } from "@/integrations/firebase/client";
import type { Profile, Project } from "@/integrations/firebase/types";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { setNotificationAppData } from "@/lib/notificationAppData";
import { AVATARES, setAvatares } from "@/lib/avatares";

interface AppDataContextValue {
  projects: Project[];
  profiles: Profile[];
  loading: boolean;
}

const AppDataContext = createContext<AppDataContextValue | null>(null);

/**
 * Una sola suscripción compartida a projects y profiles para toda la app.
 * Evita que cada página vuelva a hacer getDocs de las mismas colecciones.
 */
export function AppDataProvider({ children }: { children: ReactNode }) {
  const { user, role } = useUserProfileContext();
  const esCliente = role === "cliente";
  const [projects, setProjects] = useState<Project[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [profilesLoading, setProfilesLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setProjects([]);
      setProfiles([]);
      setProjectsLoading(false);
      setProfilesLoading(false);
      return;
    }

    // Esperar a conocer el rol para armar la consulta correcta.
    if (!role || role === "pending") return;

    setProjectsLoading(true);
    setProfilesLoading(true);

    // Los clientes solo leen sus propios proyectos (privacidad entre clientes).
    const projectsQuery = esCliente
      ? query(
          collection(db, "projects"),
          where("team_roles.cliente", "array-contains", user.uid)
        )
      : collection(db, "projects");
    const unsubProjects = onSnapshot(
      projectsQuery,
      (snap) => {
        setProjects(
          snap.docs.map((d) => ({ id: d.id, ...d.data() } as Project))
        );
        setProjectsLoading(false);
      },
      () => setProjectsLoading(false)
    );

    // Los clientes no necesitan (ni pueden) listar al equipo completo.
    const profilesQuery = esCliente
      ? query(collection(db, "profiles"), where(documentId(), "==", user.uid))
      : collection(db, "profiles");
    const unsubProfiles = onSnapshot(
      profilesQuery,
      (snap) => {
        setProfiles(
          snap.docs.map((d) => ({ id: d.id, ...d.data() } as Profile))
        );
        setProfilesLoading(false);
      },
      () => setProfilesLoading(false)
    );

    // Fotos de perfil del equipo para los clientes (no leen esos perfiles; el servidor les da
    // solo las de quienes comparten un chat con ellos).
    const unsubAvatares = esCliente
      ? onSnapshot(
          collection(db, AVATARES),
          (snap) =>
            setAvatares(
              Object.fromEntries(
                snap.docs.map((d) => [d.id, String(d.data()?.img ?? "")] as const).filter(([, v]) => v)
              )
            ),
          () => undefined
        )
      : () => setAvatares({});

    return () => {
      unsubProjects();
      unsubProfiles();
      unsubAvatares();
    };
  }, [user?.uid, esCliente, role]);

  useEffect(() => {
    setNotificationAppData(profiles, projects);
  }, [profiles, projects]);

  return (
    <AppDataContext.Provider
      value={{
        projects,
        profiles,
        loading: projectsLoading || profilesLoading,
      }}
    >
      {children}
    </AppDataContext.Provider>
  );
}

export function useAppData(): AppDataContextValue {
  const ctx = useContext(AppDataContext);
  if (!ctx) {
    throw new Error("useAppData debe usarse dentro de AppDataProvider");
  }
  return ctx;
}
