import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { onAuthStateChanged, type User as FirebaseUser } from "@/lib/auth";
import { doc, onSnapshot, updateDoc } from "@/lib/db";
import { auth, db } from "@/integrations/firebase/client";
import type { Profile, UserRole } from "@/integrations/firebase/types";
import { normalizeRole, rolesDe } from "@/lib/roles";
import { guardarVistaComo, leerVistaComo, setModoVista } from "@/lib/redes/vistaComo";

interface UserProfileContextValue {
  /**
   * Usuario efectivo. En modo "ver como" es el usuario que se está mirando
   * (uid del otro, pero getIdToken sigue siendo el del admin).
   */
  user: FirebaseUser | null;
  authChecked: boolean;
  profile: Profile | undefined;
  /** Rol principal (pantalla de inicio y menú). */
  role: UserRole | undefined;
  /** Principal + roles adicionales. */
  roles: UserRole[];
  /** ¿Tiene este rol (principal o adicional)? */
  tieneRol: (r: UserRole) => boolean;
  dashboardAccess: boolean;
  loading: boolean;
  isAdmin: boolean;
  /** Cuenta real (siempre la del que inició sesión). */
  realUser: FirebaseUser | null;
  realProfile: Profile | undefined;
  realRole: UserRole | undefined;
  /** Perfil que el admin está mirando, si está en modo "ver como". */
  viewingAs: Profile | null;
  verComo: (uid: string | null) => void;
}

const UserProfileContext = createContext<UserProfileContextValue | null>(null);

function useProfileDoc(uid: string | null | undefined) {
  const [profile, setProfile] = useState<Profile | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!uid) {
      setProfile(undefined);
      setLoading(false);
      return;
    }
    setLoading(true);
    return onSnapshot(
      doc(db, "profiles", uid),
      (snap) => {
        setProfile(snap.exists() ? ({ id: snap.id, ...snap.data() } as Profile) : undefined);
        setLoading(false);
      },
      () => {
        setProfile(undefined);
        setLoading(false);
      }
    );
  }, [uid]);
  return { profile, loading };
}

export function UserProfileProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [vistaUid, setVistaUid] = useState<string | null>(() => leerVistaComo());

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthChecked(true);
      if (!u) {
        setVistaUid(null);
        guardarVistaComo(null);
      }
    });
    return () => unsub();
  }, []);

  const real = useProfileDoc(user?.uid);
  const realRole: UserRole | undefined = user
    ? real.loading
      ? undefined
      : normalizeRole(real.profile?.role as UserRole | undefined)
    : undefined;
  const puedeVer = realRole === "admin" && !!vistaUid && vistaUid !== user?.uid;
  const vista = useProfileDoc(puedeVer ? vistaUid : null);
  const viewingAs = puedeVer && vista.profile ? vista.profile : null;

  // Registrar último acceso (para reportes y gestión de usuarios).
  useEffect(() => {
    if (!user?.uid || real.loading || !real.profile) return;
    const last = real.profile.ultimo_acceso ? new Date(real.profile.ultimo_acceso).getTime() : 0;
    if (Date.now() - last < 10 * 60_000) return;
    void updateDoc(doc(db, "profiles", user.uid), { ultimo_acceso: new Date().toISOString() }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, real.loading]);

  // Se fija en el render (no en un efecto) para que ningún componente hijo
  // alcance a escribir datos antes de que el modo solo lectura esté activo.
  setModoVista(!!viewingAs || (puedeVer && vista.loading), viewingAs?.nombre ?? "", { vista: vistaUid ?? undefined, real: user?.uid });

  const verComo = useCallback((uid: string | null) => {
    guardarVistaComo(uid);
    setVistaUid(uid);
  }, []);

  const value = useMemo<UserProfileContextValue>(() => {
    const profile = viewingAs ?? real.profile;
    const role = viewingAs ? normalizeRole(viewingAs.role as UserRole | undefined) : realRole;
    const effectiveUser =
      viewingAs && user
        ? ({
            uid: viewingAs.id,
            email: viewingAs.email,
            displayName: viewingAs.nombre,
            getIdToken: (force?: boolean) => user.getIdToken(force),
            providerData: [],
          } as unknown as FirebaseUser)
        : user;
    const roles = rolesDe(role, profile?.roles_extra);
    return {
      user: effectiveUser,
      authChecked,
      profile,
      role,
      roles,
      tieneRol: (r: UserRole) => roles.includes(r),
      dashboardAccess: Boolean(profile?.dashboard_access),
      loading: real.loading || (puedeVer && vista.loading),
      isAdmin: role === "admin",
      realUser: user,
      realProfile: real.profile,
      realRole,
      viewingAs,
      verComo,
    };
  }, [viewingAs, real.profile, real.loading, realRole, user, authChecked, puedeVer, vista.loading, verComo]);

  return <UserProfileContext.Provider value={value}>{children}</UserProfileContext.Provider>;
}

export function useUserProfileContext(): UserProfileContextValue {
  const ctx = useContext(UserProfileContext);
  if (!ctx) {
    throw new Error("useUserProfileContext debe usarse dentro de UserProfileProvider");
  }
  return ctx;
}
