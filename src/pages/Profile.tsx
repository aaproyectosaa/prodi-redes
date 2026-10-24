import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { auth, db } from "@/integrations/firebase/client";
import { onAuthStateChanged, User as FirebaseUser } from "@/lib/auth";
import { doc, getDoc, setDoc } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Upload,
  Moon,
  Sun,
  Save,
  X,
  Check,
  User as UserIcon,
  Bell,
  Camera,
  CheckCircle2,
  Mail,
  Smartphone,
  Palette,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import { useTheme } from "@/hooks/use-theme";
import { temaElegido } from "@/lib/tema";
import { Skeleton } from "@/components/ui/skeleton";
import { useUserRole } from "@/hooks/use-user-role";
import { RoleBadge } from "@/components/RoleBadge";
import { getRoleInfo } from "@/lib/roles";
import { PushNotificationSettings } from "@/components/PushNotificationSettings";
import { AvisosCorreoSonidoSettings } from "@/components/AvisosCorreoSonidoSettings";
import {
  ChangePasswordForm,
  userHasPasswordProvider,
} from "@/components/ChangePasswordForm";
import { cn } from "@/lib/utils";
import { RecorteFoto } from "@/components/RecorteFoto";
import { AVATAR_LADO, AVATAR_MAX, guardarFotoPerfil } from "@/lib/avatares";

const AVATAR_COLORS = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#eab308",
  "#84cc16",
  "#10b981",
  "#14b8a6",
  "#06b6d4",
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
];

type ProfileTab = "cuenta" | "avisos";

/** Grupo estilo "Ajustes": rótulo chico afuera y tarjeta redondeada adentro. */
function Section({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className="space-y-2">
      <div className="px-1">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
        {description && (
          <p className="text-xs text-muted-foreground/80 mt-0.5 leading-relaxed">
            {description}
          </p>
        )}
      </div>
      <div
        className={cn(
          "rounded-2xl border border-border bg-card divide-y divide-border overflow-hidden",
          className
        )}
      >
        {children}
      </div>
    </section>
  );
}

/** Fila de ajuste: chip de ícono a la izquierda, contenido a la derecha. */
function Row({
  icon: Icon,
  children,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start gap-3 px-4 py-3.5", className)}>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

const SPINNER = (
  <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
);

const Profile = () => {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profileImage, setProfileImage] = useState<string>("");
  const [avatarColor, setAvatarColor] = useState<string>("#3b82f6");
  const [nombre, setNombre] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<ProfileTab>("cuenta");
  const { role } = useUserRole(user?.uid);
  const roleInfo = role ? getRoleInfo(role) : undefined;
  const [pushEnabled, setPushEnabled] = useState(false);
  const [emailAvisos, setEmailAvisos] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUser(user);
      if (!user) {
        navigate("/auth");
      } else {
        await loadProfile(user.uid);
      }
    });
    return () => unsubscribe();
  }, [navigate]);

  const loadProfile = async (userId: string) => {
    try {
      const profileRef = doc(db, "profiles", userId);
      const profileDoc = await getDoc(profileRef);
      if (profileDoc.exists()) {
        const data = profileDoc.data();
        setNombre(data.nombre || "");
        setProfileImage(data.profileImage || "");
        setAvatarColor(data.avatarColor || "#3b82f6");
        if (!temaElegido() && data.theme && data.theme !== theme) {
          setTheme(data.theme as "light" | "dark" | "violeta");
        }
        setPushEnabled(Boolean(data.push_enabled));
        setEmailAvisos(data.email_avisos !== false);
      }
    } catch (error) {
      console.error("Error al cargar perfil:", error);
      toast.error("Error al cargar perfil");
    }
    setLoading(false);
  };

  // Cualquier foto (también HEIC en Safari): se encuadra, se achica a un JPEG cuadrado y se guarda al toque.
  const [fotoElegida, setFotoElegida] = useState<File | null>(null);
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) setFotoElegida(file);
  };

  const guardarFoto = async (img: string) => {
    if (!user) return;
    try {
      await guardarFotoPerfil(user.uid, img);
      setProfileImage(img);
      setFotoElegida(null);
      toast.success(img ? "Foto actualizada" : "Foto quitada");
    } catch (error) {
      console.error("Error al guardar la foto:", error);
      toast.error("No se pudo guardar la foto");
    }
  };

  const handleSave = async () => {
    if (!user) return;
    if (!nombre.trim()) {
      toast.error("El nombre es requerido");
      setTab("cuenta");
      return;
    }
    setSaving(true);
    try {
      const profileRef = doc(db, "profiles", user.uid);
      await setDoc(
        profileRef,
        {
          avatarColor,
          nombre: nombre.trim(),
          email: user.email,
          theme,
        },
        { merge: true }
      );

      toast.success("Perfil actualizado correctamente");
    } catch (error) {
      console.error("Error al guardar perfil:", error);
      toast.error("Error al guardar perfil");
    } finally {
      setSaving(false);
    }
  };

  const getUserInitials = () => {
    if (!nombre) return user?.email?.[0].toUpperCase() || "U";
    return nombre
      .split(" ")
      .map((word) => word[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  if (loading) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <main className="flex-1 px-4 py-5 max-w-2xl mx-auto w-full space-y-4">
          <div className="space-y-2">
            <Skeleton className="h-8 w-40 rounded-xl" />
            <Skeleton className="h-4 w-56 rounded-lg" />
          </div>
          <div className="flex flex-col items-center gap-3 rounded-2xl bg-muted/60 py-6">
            <Skeleton className="h-24 w-24 rounded-full" />
            <Skeleton className="h-5 w-36 rounded-lg" />
            <Skeleton className="h-4 w-48 rounded-lg" />
          </div>
          <Skeleton className="h-12 w-full rounded-2xl" />
          <Skeleton className="h-48 w-full rounded-2xl" />
        </main>
      </div>
    );
  }

  const estadoAviso = (activo: boolean) => (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold",
        activo ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
      )}
    >
      {activo && <CheckCircle2 className="h-3.5 w-3.5" />}
      {activo ? "Activo" : "Apagado"}
    </span>
  );

  const botonGuardar = (className?: string) => (
    <Button
      onClick={handleSave}
      disabled={saving}
      className={cn(
        "w-full h-12 rounded-2xl text-[15px] font-semibold gap-2 shadow-lg shadow-primary/25",
        className
      )}
    >
      {saving ? (
        <>
          {SPINNER}
          Guardando…
        </>
      ) : (
        <>
          <Save className="w-4 h-4" />
          Guardar cambios
        </>
      )}
    </Button>
  );

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <main className="flex-1 px-4 py-5 sm:py-6 pb-[calc(var(--alto-barra)+5.5rem)] sm:pb-mobile-nav md:pb-8">
        <div className="max-w-2xl mx-auto space-y-5">
          <header className="space-y-1">
            <h1 className="text-[26px] font-bold leading-tight tracking-tight">Mi perfil</h1>
            <p className="text-sm text-muted-foreground">Tu cuenta, avisos y preferencias.</p>
          </header>

          {/* Hero */}
          <div className="relative overflow-hidden rounded-2xl border border-border bg-card px-4 pb-5 pt-6">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-r from-primary/15 to-fuchsia-500/15"
            />
            <div className="relative flex flex-col items-center text-center">
              <div className="relative">
                <Avatar
                  className="h-24 w-24 ring-4 ring-card shadow-lg"
                  style={
                    !profileImage
                      ? { boxShadow: `0 0 0 4px ${avatarColor}44` }
                      : undefined
                  }
                >
                  {profileImage ? (
                    <AvatarImage src={profileImage} alt={nombre} className="object-cover" />
                  ) : (
                    <AvatarFallback
                      style={{ backgroundColor: avatarColor }}
                      className="text-white text-3xl font-bold"
                    >
                      {getUserInitials()}
                    </AvatarFallback>
                  )}
                </Avatar>
                <button
                  type="button"
                  onClick={() => document.getElementById("image-upload")?.click()}
                  className="absolute bottom-0 right-0 h-9 w-9 rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/25 ring-4 ring-card flex items-center justify-center hover:opacity-90 transition-opacity"
                  title="Cambiar foto"
                  aria-label="Cambiar foto"
                >
                  <Camera className="w-4 h-4" />
                </button>
                <input
                  id="image-upload"
                  type="file"
                  accept="image/*,.heic,.heif"
                  onChange={handleImageUpload}
                  className="hidden"
                />
                <RecorteFoto
                  file={fotoElegida}
                  titulo="Tu foto de perfil"
                  lado={AVATAR_LADO}
                  maxChars={AVATAR_MAX}
                  onListo={guardarFoto}
                  onCancelar={() => setFotoElegida(null)}
                />
              </div>

              <h2 className="mt-3 max-w-full truncate text-xl font-bold leading-tight tracking-tight">
                {nombre || "Sin nombre"}
              </h2>
              <p className="mt-0.5 max-w-full truncate text-sm text-muted-foreground">
                {user?.email}
              </p>
              {roleInfo && (
                <RoleBadge
                  label={roleInfo.label}
                  variant="text"
                  className="mt-2.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold"
                />
              )}

              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-9 gap-1.5 rounded-full bg-muted/60 px-3.5 text-xs font-semibold hover:bg-muted"
                  onClick={() => document.getElementById("image-upload")?.click()}
                >
                  <Upload className="w-3.5 h-3.5" />
                  {profileImage ? "Cambiar foto" : "Subir foto"}
                </Button>
                {profileImage && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-9 gap-1.5 rounded-full px-3.5 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => void guardarFoto("")}
                  >
                    <X className="w-3.5 h-3.5" />
                    Quitar
                  </Button>
                )}
              </div>
            </div>
          </div>

          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v as ProfileTab)}
            className="w-full"
          >
            <TabsList className="grid w-full grid-cols-2 h-12 rounded-2xl bg-muted/60 p-1">
              <TabsTrigger
                value="cuenta"
                className="h-full gap-2 rounded-xl text-sm font-semibold data-[state=active]:shadow-sm"
              >
                <UserIcon className="w-4 h-4" />
                Mi cuenta
              </TabsTrigger>
              <TabsTrigger
                value="avisos"
                className="h-full gap-2 rounded-xl text-sm font-semibold data-[state=active]:shadow-sm"
              >
                <Bell className="w-4 h-4" />
                Notificaciones
              </TabsTrigger>
            </TabsList>

            <TabsContent value="cuenta" className="mt-5 space-y-5 focus-visible:ring-0">
              <Section
                title="Datos personales"
                description="Cómo te ven el resto del equipo en la app."
              >
                <Row icon={UserIcon}>
                  <Label htmlFor="nombre" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Nombre
                  </Label>
                  <Input
                    id="nombre"
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                    placeholder="Tu nombre"
                    required
                    className="mt-1.5 h-12 rounded-2xl border-transparent bg-muted/60 text-[15px] focus-visible:border-primary focus-visible:bg-background focus-visible:ring-4 focus-visible:ring-primary/15 focus-visible:ring-offset-0"
                  />
                </Row>

                <Row icon={Palette}>
                  <Label className="text-sm font-semibold">Color del avatar</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Solo se usa si no tenés foto.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2.5">
                    {AVATAR_COLORS.map((color) => {
                      const selected = avatarColor === color;
                      return (
                        <button
                          key={color}
                          type="button"
                          onClick={() => setAvatarColor(color)}
                          className={cn(
                            "relative h-9 w-9 rounded-full transition-transform hover:scale-110",
                            selected &&
                              "ring-2 ring-offset-2 ring-offset-card ring-foreground scale-105"
                          )}
                          style={{ backgroundColor: color }}
                          aria-label={`Elegir color ${color}`}
                          aria-pressed={selected}
                        >
                          {selected && (
                            <Check className="w-4 h-4 text-white absolute inset-0 m-auto drop-shadow" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </Row>
              </Section>

              <Section
                title="Apariencia"
                description="Elegí el tema de la aplicación en este dispositivo."
                className="p-2"
              >
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { k: "light", label: "Claro", icon: Sun },
                      { k: "dark", label: "Oscuro", icon: Moon },
                      { k: "violeta", label: "Violeta", icon: Palette },
                    ] as const
                  ).map((x) => (
                    <button
                      key={x.k}
                      type="button"
                      onClick={() => setTheme(x.k)}
                      className={cn(
                        "flex flex-col items-center justify-center gap-2 rounded-xl border-2 py-4 text-sm font-semibold transition-all",
                        theme === x.k
                          ? "border-primary bg-primary/5 text-primary"
                          : "border-transparent bg-muted/60 text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <span className={cn("flex h-10 w-10 items-center justify-center rounded-xl", theme === x.k ? "bg-primary/10" : "bg-background")}>
                        <x.icon className="w-5 h-5" />
                      </span>
                      {x.label}
                    </button>
                  ))}
                </div>
              </Section>

              {user && userHasPasswordProvider(user) && (
                <ChangePasswordForm user={user} />
              )}

              {/* En compu el guardar va al final; en el teléfono queda fijo abajo. */}
              <div className="hidden sm:block pt-1">{botonGuardar()}</div>
            </TabsContent>

            <TabsContent value="avisos" className="mt-5 space-y-5 focus-visible:ring-0">
              <Section title="Estado">
                <div className="flex items-center gap-3 px-4 py-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Mail className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1 text-[15px] font-medium">Correo</span>
                  {estadoAviso(emailAvisos)}
                </div>
                <div className="flex items-center gap-3 px-4 py-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Smartphone className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1 text-[15px] font-medium">Push en el teléfono</span>
                  {estadoAviso(pushEnabled)}
                </div>
              </Section>

              <div className="flex gap-3 rounded-2xl bg-muted/60 px-4 py-3.5">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Te avisamos cuando hay algo para vos: en la app, en el teléfono
                  (push) y por correo. Las reuniones y tareas con fecha te llegan
                  además como invitación de Google Calendar.
                </p>
              </div>

              <AvisosCorreoSonidoSettings
                userId={user!.uid}
                email={user?.email}
                emailAvisos={emailAvisos}
                onEmailAvisosChange={setEmailAvisos}
              />
              <PushNotificationSettings
                userId={user!.uid}
                pushEnabled={pushEnabled}
                onPushEnabledChange={setPushEnabled}
              />
            </TabsContent>
          </Tabs>
        </div>
      </main>

      {tab === "cuenta" && (
        <div className="sm:hidden fixed inset-x-0 bottom-[calc(var(--alto-barra)+1px)] z-20 border-t border-border bg-card/90 backdrop-blur-xl px-4 py-3">
          {botonGuardar()}
        </div>
      )}
    </div>
  );
};

export default Profile;
