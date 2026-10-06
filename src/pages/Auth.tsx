import { useState } from "react";
import { asset } from "@/lib/asset";
import { useNavigate } from "react-router-dom";
import { auth, db } from "@/integrations/firebase/client";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile, usarLinkDeClave } from "@/lib/auth";
import { doc, setDoc, getDoc } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { z } from "zod";
import { defaultRouteForRole } from "@/lib/roles";
import type { UserRole } from "@/integrations/firebase/types";
import { useTheme } from "@/hooks/use-theme";
import { AvisoInstalar, BotonInstalar } from "@/components/InstalarApp";

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
      window.history.replaceState(null, "", "/auth");
      navigate("/");
    } catch (error: any) {
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
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        toast.error(error.errors[0].message);
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

      if (profileData?.theme === "light" || profileData?.theme === "dark") {
        setTheme(profileData.theme);
      }

      toast.success("¡Bienvenido!");
      navigate(defaultRouteForRole(role) === "/auth" ? "/" : defaultRouteForRole(role));
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        toast.error(error.errors[0].message);
      } else if (error.code === "auth/invalid-credential" || error.code === "auth/wrong-password" || error.code === "auth/user-not-found") {
        toast.error("Email o contraseña incorrectos");
      } else {
        toast.error(error.message || "Error al iniciar sesión");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="dark relative flex min-h-dvh items-center justify-center overflow-hidden bg-black p-4 text-foreground">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-prodi/25 blur-[120px]"
      />
      <Card className="relative w-full max-w-md border-white/10 bg-zinc-950/80 text-white backdrop-blur">
        <CardHeader className="items-center text-center">
          <img
            src={asset("/brand/logo-horizontal-blanco.png")}
            alt="Prodi"
            className="mb-4 h-10 w-auto"
          />
          <CardTitle className="text-xl">
            {linkClave ? "Creá tu contraseña" : isLogin ? "Ingresar al gestor" : "Crear cuenta"}
          </CardTitle>
          <CardDescription className="text-zinc-400">
            {linkClave
              ? "Elegí una contraseña de al menos 6 caracteres."
              : isLogin
                ? "Producción de videos y pauta"
                : "Necesitás el código de invitación del equipo"}
          </CardDescription>
        </CardHeader>

        <CardContent>
          {linkClave ? (
            <form onSubmit={handleLinkClave} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="nueva">Contraseña nueva</Label>
                <Input id="nueva" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required disabled={loading} autoFocus />
              </div>
              <div className="space-y-2">
                <Label htmlFor="repetir">Repetila</Label>
                <Input id="repetir" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required disabled={loading} />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Guardando..." : "Guardar y entrar"}
              </Button>
            </form>
          ) : (
          <>
          <form onSubmit={isLogin ? handleLogin : handleRegister} className="space-y-4">
            {!isLogin && (
              <div className="space-y-2">
                <Label htmlFor="nombre">Nombre</Label>
                <Input
                  id="nombre"
                  type="text"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  required
                  disabled={loading}
                  placeholder="Tu nombre"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
                placeholder="tu@email.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Contraseña</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
                placeholder="••••••••"
              />
            </div>
            {!isLogin && (
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Repetir contraseña</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  disabled={loading}
                  placeholder="••••••••"
                />
              </div>
            )}
            {!isLogin && (
              <div className="space-y-2">
                <Label htmlFor="invitationCode">Código de invitación</Label>
                <Input
                  id="invitationCode"
                  type="text"
                  value={invitationCode}
                  onChange={(e) => setInvitationCode(e.target.value)}
                  required
                  disabled={loading}
                  placeholder="Código del equipo"
                />
              </div>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Procesando..." : isLogin ? "Ingresar" : "Registrarme"}
            </Button>
          </form>
          <div className="mt-4 text-center text-sm">
            <button
              type="button"
              onClick={() => setIsLogin(!isLogin)}
              className="text-primary hover:underline"
              disabled={loading}
            >
              {isLogin ? "¿No tenés cuenta? Registrate" : "¿Ya tenés cuenta? Ingresá"}
            </button>
          </div>
          </>
          )}
          <div className="mt-3 border-t pt-3">
            <BotonInstalar className="justify-center" />
          </div>
        </CardContent>
      </Card>
      <AvisoInstalar />
    </div>
  );
};

export default Auth;
