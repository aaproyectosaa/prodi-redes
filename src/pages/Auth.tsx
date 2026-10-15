import { useState } from "react";
import { asset } from "@/lib/asset";
import { useLocation, useNavigate } from "react-router-dom";
import { auth, db } from "@/integrations/firebase/client";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile, usarLinkDeClave } from "@/lib/auth";
import { doc, setDoc, getDoc } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { defaultRouteForRole } from "@/lib/roles";
import type { UserRole } from "@/integrations/firebase/types";
import { useTheme } from "@/hooks/use-theme";
import { temaElegido } from "@/lib/tema";
import { AvisoInstalar, BotonInstalar } from "@/components/InstalarApp";
import { BotonInstalarChat, InstalarChatHost } from "@/components/InstalarChat";
import { CHAT_APP, CHAT_APP_INGRESAR, esRutaChatApp } from "@/lib/chatApp";

const registerSchema = z.object({
  nombre: z.string().min(2, "El nombre debe tener al menos 2 caracteres").max(100),
  email: z.string().email("Email inválido").max(255),
  password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres").max(100),
  confirmPassword: z.string(),
  invitationCode: z.string().min(1, "El código de invitación es requerido")
}).refine((data) => data.password === data.confirmPassword, {
  message: "Las contraseñas no coinciden",
  path: ["confirmPassword"],
});

const loginSchema = z.object({
  email: z.string().email("Email inválido"),
  password: z.string().min(1, "La contraseña es requerida"),
});

const Auth = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [invitationCode, setInvitationCode] = useState("");
  const navigate = useNavigate();
  // Entrando desde Prodi Chat (/chat-app/ingresar): después de ingresar se vuelve a los chats.
  const enChat = esRutaChatApp(useLocation().pathname);
  const { setTheme } = useTheme();
  // Link para crear o cambiar la contraseña: /auth?clave=<token>
  const linkClave = new URLSearchParams(window.location.search).get("clave");

  const handleLinkClave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) return toast.error("La contraseña tiene que tener al menos 6 caracteres");
    if (password !== confirmPassword) return toast.error("Las contraseñas no coinciden");
    setLoading(true);
    try {
      await usarLinkDeClave(linkClave!, password);
      toast.success("¡Listo! Ya podés usar tu contraseña nueva.");
      window.history.replaceState(null, "", enChat ? CHAT_APP_INGRESAR : "/auth");
      navigate(enChat ? CHAT_APP : "/");
    } catch (err) {
      const error = err as { message?: string; code?: string };
      toast.error(error.message || "No se pudo guardar la contraseña");
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const validatedData = registerSchema.parse({ nombre, email, password, confirmPassword, invitationCode });

      // El código de invitación lo valida el servidor.
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        validatedData.email,
        validatedData.password,
        validatedData.nombre,
        validatedData.invitationCode
      );

      // Update profile with display name
      await updateProfile(userCredential.user, {
        displayName: validatedData.nombre,
      });

      // Create profile document in Firestore
      // Los nuevos usuarios quedan en `pending`: no tienen acceso a la app
      // hasta que un admin les asigne un rol desde "Usuarios".
      await setDoc(doc(db, "profiles", userCredential.user.uid), {
        id: userCredential.user.uid,
        nombre: validatedData.nombre,
        email: validatedData.email,
        role: "pending",
        dashboard_access: false,
        project_permissions: [],
        created_at: new Date().toISOString(),
      });

      toast.success("¡Registro exitoso! Ahora puedes iniciar sesión");
      setIsLogin(true);
      setPassword("");
      setConfirmPassword("");
      setInvitationCode("");
    } catch (err) {
      const error = err as { message?: string; code?: string };
      if (err instanceof z.ZodError) {
        toast.error(err.errors[0].message);
      } else if (error.code === "auth/email-already-in-use") {
        toast.error("Este email ya está registrado");
      } else {
        toast.error(error.message || "Error al registrarse");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const validatedData = loginSchema.parse({ email, password });

      const userCredential = await signInWithEmailAndPassword(
        auth,
        validatedData.email,
        validatedData.password
      );

      // Verificar si el perfil existe en Firestore
      const profileRef = doc(db, "profiles", userCredential.user.uid);
      const profileSnap = await getDoc(profileRef);

      // Si no existe, crear el perfil como pendiente de aprobación.
      if (!profileSnap.exists()) {
        await setDoc(profileRef, {
          id: userCredential.user.uid,
          nombre:
            userCredential.user.displayName ||
            userCredential.user.email?.split("@")[0] ||
            "Usuario",
          email: userCredential.user.email || "",
          role: "pending",
          dashboard_access: false,
          project_permissions: [],
          created_at: new Date().toISOString(),
        });
        console.log("Perfil creado para usuario existente (pendiente)");
      }

      // Redirigir al inicio del rol. Si es pendiente (o un rol del sistema
      // anterior), PendingRoleGate lo bloquea hasta que el admin lo asigne.
      const profileData = profileSnap.exists() ? profileSnap.data() : null;
      const role = profileData?.role as UserRole | undefined;

      if (!temaElegido() && (profileData?.theme === "light" || profileData?.theme === "dark")) {
        setTheme(profileData.theme);
      }

      toast.success("¡Bienvenido!");
      navigate(enChat ? CHAT_APP : defaultRouteForRole(role) === "/auth" ? "/" : defaultRouteForRole(role));
    } catch (err) {
      const error = err as { message?: string; code?: string };
      if (err instanceof z.ZodError) {
        toast.error(err.errors[0].message);
      } else if (error.code === "auth/invalid-credential" || error.code === "auth/wrong-password" || error.code === "auth/user-not-found") {
        toast.error("Email o contraseña incorrectos");
      } else {
        toast.error(error.message || "Error al iniciar sesión");
      }
    } finally {
      setLoading(false);
    }
  };

  const titulo = linkClave ? "Creá tu contraseña" : isLogin ? (enChat ? "Ingresar a Prodi Chat" : "Ingresar al gestor") : "Crear cuenta";
  const subtitulo = linkClave
    ? "Elegí una contraseña de al menos 6 caracteres."
    : isLogin
      ? enChat
        ? "Tus chats con el equipo de Prodi"
        : "Producción de videos y pauta"
      : "Necesitás el código de invitación del equipo";

  return (
    <div className="dark relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-background px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[max(1.5rem,env(safe-area-inset-top))] text-foreground">
      {/* Fondo: dos manchas de color suaves */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 left-1/2 h-[480px] w-[480px] -translate-x-1/2 rounded-full bg-gradient-to-br from-primary to-fuchsia-500 opacity-20 blur-[120px] dark:opacity-25" />
        <div className="absolute -bottom-48 -right-32 h-[380px] w-[380px] rounded-full bg-fuchsia-500 opacity-10 blur-[120px] dark:opacity-15" />
      </div>

      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-[22px] bg-gradient-to-br from-primary to-fuchsia-500 shadow-lg shadow-primary/25">
            <img src={asset("/brand/isotipo.png")} alt="" className="h-9 w-auto brightness-0 invert" />
          </div>
          <img src={asset("/brand/logo-horizontal-blanco.png")} alt="Prodi" className="mb-5 hidden h-6 w-auto dark:block" />
          <img src={asset("/brand/logo-horizontal-negro.png")} alt="Prodi" className="mb-5 h-6 w-auto dark:hidden" />
          <h1 className="text-[26px] font-bold leading-tight tracking-tight">{titulo}</h1>
          <p className="mt-1.5 text-[15px] text-muted-foreground">{subtitulo}</p>
        </div>

        <div className="rounded-[28px] border border-border/60 bg-card/80 p-5 shadow-xl shadow-black/5 backdrop-blur-xl sm:p-6 dark:shadow-black/30">
          {linkClave ? (
            <form onSubmit={handleLinkClave} className="space-y-4">
              <Campo id="nueva" label="Contraseña nueva">
                <InputClave id="nueva" value={password} onChange={setPassword} disabled={loading} autoFocus autoComplete="new-password" />
              </Campo>
              <Campo id="repetir" label="Repetila">
                <InputClave id="repetir" value={confirmPassword} onChange={setConfirmPassword} disabled={loading} autoComplete="new-password" />
              </Campo>
              <div className="pt-1">
                <Button type="submit" className={BOTON} disabled={loading}>
                  {loading && <Loader2 className="h-5 w-5 animate-spin" />}
                  {loading ? "Guardando..." : "Guardar y entrar"}
                </Button>
              </div>
            </form>
          ) : (
            <>
              <form onSubmit={isLogin ? handleLogin : handleRegister} className="space-y-4">
                {!isLogin && (
                  <Campo id="nombre" label="Nombre">
                    <Input
                      id="nombre"
                      type="text"
                      value={nombre}
                      onChange={(e) => setNombre(e.target.value)}
                      required
                      disabled={loading}
                      placeholder="Tu nombre"
                      autoComplete="name"
                      className={INPUT}
                    />
                  </Campo>
                )}
                <Campo id="email" label="Email">
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={loading}
                    placeholder="tu@email.com"
                    autoComplete="email"
                    inputMode="email"
                    className={INPUT}
                  />
                </Campo>
                <Campo id="password" label="Contraseña">
                  <InputClave
                    id="password"
                    value={password}
                    onChange={setPassword}
                    disabled={loading}
                    placeholder="••••••••"
                    autoComplete={isLogin ? "current-password" : "new-password"}
                  />
                </Campo>
                {!isLogin && (
                  <Campo id="confirmPassword" label="Repetir contraseña">
                    <InputClave
                      id="confirmPassword"
                      value={confirmPassword}
                      onChange={setConfirmPassword}
                      disabled={loading}
                      placeholder="••••••••"
                      autoComplete="new-password"
                    />
                  </Campo>
                )}
                {!isLogin && (
                  <Campo id="invitationCode" label="Código de invitación">
                    <Input
                      id="invitationCode"
                      type="text"
                      value={invitationCode}
                      onChange={(e) => setInvitationCode(e.target.value)}
                      required
                      disabled={loading}
                      placeholder="Código del equipo"
                      className={INPUT}
                    />
                  </Campo>
                )}
                <div className="pt-1">
                  <Button type="submit" className={BOTON} disabled={loading}>
                    {loading && <Loader2 className="h-5 w-5 animate-spin" />}
                    {loading ? "Procesando..." : isLogin ? "Ingresar" : "Registrarme"}
                  </Button>
                </div>
              </form>
              <div className="mt-5 text-center text-sm">
                {/* Crear cuenta (con el código del equipo) solo con ?registro=1: a los clientes les damos el usuario nosotros. */}
                {isLogin && !new URLSearchParams(window.location.search).has("registro") ? (
                  <p className="text-muted-foreground">¿No tenés usuario? Pedíselo a tu contacto de Prodi.</p>
                ) : (
                  <button type="button" onClick={() => setIsLogin(!isLogin)} className="font-medium text-primary hover:underline" disabled={loading}>
                    {isLogin ? "¿No tenés cuenta? Registrate" : "¿Ya tenés cuenta? Ingresá"}
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        <div className="mt-5">
          {enChat ? <BotonInstalarChat className="justify-center" /> : <BotonInstalar className="justify-center" />}
        </div>
      </div>
      {enChat ? <InstalarChatHost /> : <AvisoInstalar />}
    </div>
  );
};

const INPUT =
  "h-14 rounded-2xl border-transparent bg-muted/60 px-4 text-base focus-visible:border-primary focus-visible:bg-background focus-visible:ring-4 focus-visible:ring-primary/15 focus-visible:ring-offset-0";
const BOTON = "h-14 w-full gap-2 rounded-2xl text-base font-semibold shadow-lg shadow-primary/25";

function Campo({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="pl-1 text-sm font-medium text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

/** Campo de contraseña con el ojito para mostrarla u ocultarla. */
function InputClave({
  id,
  value,
  onChange,
  disabled,
  placeholder,
  autoFocus,
  autoComplete,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  autoComplete?: string;
}) {
  const [ver, setVer] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={ver ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        disabled={disabled}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        className={`${INPUT} pr-14`}
      />
      <button
        type="button"
        onClick={() => setVer((v) => !v)}
        disabled={disabled}
        aria-label={ver ? "Ocultar contraseña" : "Mostrar contraseña"}
        className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
      >
        {ver ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
      </button>
    </div>
  );
}

export default Auth;
