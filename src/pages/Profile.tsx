import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { auth, db } from "@/integrations/firebase/client";
import { onAuthStateChanged, User as FirebaseUser } from "@/lib/auth";
import { doc, getDoc, setDoc } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
} from "lucide-react";
import { toast } from "sonner";
import { useTheme } from "@/hooks/use-theme";
import { Skeleton } from "@/components/ui/skeleton";
import { useUserRole } from "@/hooks/use-user-role";
import { RoleBadge } from "@/components/RoleBadge";
import { getRoleInfo } from "@/lib/roles";
import { PageHeader } from "@/components/PageHeader";
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
    <section
      className={cn(
        "rounded-xl border border-border bg-card px-4 py-4 sm:px-5 sm:py-5 space-y-4",
        className
      )}
    >
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
            {description}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

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
        if (data.theme && data.theme !== theme) {
          setTheme(data.theme as "light" | "dark");
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
        <PageHeader title="Mi Perfil" />
        <main className="flex-1 px-4 py-4 max-w-2xl mx-auto w-full space-y-4">
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-11 w-full rounded-lg" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </main>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <PageHeader
        title="Mi Perfil"
        subtitle="Tu cuenta, avisos y preferencias"
        actions={
          tab === "cuenta" ? (
            <Button
              onClick={handleSave}
              disabled={saving}
              size="sm"
              className="gap-2"
            >
              {saving ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  <span className="hidden sm:inline">Guardando…</span>
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Guardar</span>
                  <span className="sm:hidden">Guardar</span>
                </>
              )}
            </Button>
          ) : undefined
        }
      />

      <main className="flex-1 px-4 py-4 sm:py-5 pb-[calc(var(--alto-barra)+5rem)] sm:pb-mobile-nav md:pb-8">
        <div className="max-w-2xl mx-auto space-y-4">
          {/* Resumen */}
          <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
            <div className="flex gap-4">
              <div className="relative shrink-0">
                <Avatar
                  className="h-16 w-16 sm:h-[4.5rem] sm:w-[4.5rem] ring-2 ring-border"
                  style={
                    !profileImage
                      ? { boxShadow: `0 0 0 3px ${avatarColor}44` }
                      : undefined
                  }
                >
                  {profileImage ? (
                    <AvatarImage src={profileImage} alt={nombre} className="object-cover" />
                  ) : (
                    <AvatarFallback
                      style={{ backgroundColor: avatarColor }}
                      className="text-white text-xl font-bold"
                    >
                      {getUserInitials()}
                    </AvatarFallback>
                  )}
                </Avatar>
                <button
                  type="button"
                  onClick={() => document.getElementById("image-upload")?.click()}
                  className="absolute -bottom-1 -right-1 h-8 w-8 rounded-full bg-primary text-primary-foreground shadow-md flex items-center justify-center hover:opacity-90 transition-opacity"
                  title="Cambiar foto"
                  aria-label="Cambiar foto"
                >
                  <Camera className="w-3.5 h-3.5" />
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

              <div className="flex-1 min-w-0 flex flex-col justify-center gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold truncate leading-tight">
                    {nombre || "Sin nombre"}
                  </h2>
                  {roleInfo && (
                    <RoleBadge
                      label={roleInfo.label}
                      variant="text"
                      className="text-xs shrink-0"
                    />
                  )}
                </div>
                <p className="text-sm text-muted-foreground truncate">
                  {user?.email}
                </p>
                <div className="flex flex-wrap gap-2 pt-0.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 text-xs"
                    onClick={() => document.getElementById("image-upload")?.click()}
                  >
                    <Upload className="w-3 h-3" />
                    {profileImage ? "Cambiar foto" : "Subir foto"}
                  </Button>
                  {profileImage && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1.5 text-xs text-muted-foreground"
                      onClick={() => void guardarFoto("")}
                    >
                      <X className="w-3 h-3" />
                      Quitar
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>

          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v as ProfileTab)}
            className="w-full"
          >
            <TabsList className="grid w-full grid-cols-2 h-11 p-1">
              <TabsTrigger value="cuenta" className="gap-2 text-sm data-[state=active]:shadow-sm">
                <UserIcon className="w-4 h-4" />
                Mi cuenta
              </TabsTrigger>
              <TabsTrigger value="avisos" className="gap-2 text-sm data-[state=active]:shadow-sm">
                <Bell className="w-4 h-4" />
                Notificaciones
              </TabsTrigger>
            </TabsList>

            <TabsContent value="cuenta" className="mt-4 space-y-3 focus-visible:ring-0">
              <Section
                title="Datos personales"
                description="Cómo te ven el resto del equipo en la app."
              >
                <div className="space-y-1.5">
                  <Label htmlFor="nombre" className="text-sm">
                    Nombre
                  </Label>
                  <Input
                    id="nombre"
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                    placeholder="Tu nombre"
                    required
                    className="h-10"
                  />
                </div>

                <div className="space-y-2">
                  <div>
                    <Label className="text-sm">Color del avatar</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Solo se usa si no tenés foto.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {AVATAR_COLORS.map((color) => {
                      const selected = avatarColor === color;
                      return (
                        <button
                          key={color}
                          type="button"
                          onClick={() => setAvatarColor(color)}
                          className={cn(
                            "relative h-8 w-8 rounded-full transition-transform hover:scale-110",
                            selected &&
                              "ring-2 ring-offset-2 ring-offset-card ring-foreground scale-105"
                          )}
                          style={{ backgroundColor: color }}
                          aria-label={`Elegir color ${color}`}
                          aria-pressed={selected}
                        >
                          {selected && (
                            <Check className="w-3.5 h-3.5 text-white absolute inset-0 m-auto drop-shadow" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </Section>

              <Section
                title="Apariencia"
                description="Elegí el tema de la aplicación en este dispositivo."
              >
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setTheme("light")}
                    className={cn(
                      "h-12 rounded-lg border-2 transition-all flex items-center justify-center gap-2 text-sm font-medium",
                      theme === "light"
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground"
                    )}
                  >
                    <Sun className="w-4 h-4" />
                    Claro
                  </button>
                  <button
                    type="button"
                    onClick={() => setTheme("dark")}
                    className={cn(
                      "h-12 rounded-lg border-2 transition-all flex items-center justify-center gap-2 text-sm font-medium",
                      theme === "dark"
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground"
                    )}
                  >
                    <Moon className="w-4 h-4" />
                    Oscuro
                  </button>
                </div>
              </Section>

              {user && userHasPasswordProvider(user) && (
                <ChangePasswordForm user={user} />
              )}
            </TabsContent>

            <TabsContent value="avisos" className="mt-4 space-y-3 focus-visible:ring-0">
              <div className="flex flex-wrap gap-2">
                <Badge
                  variant="outline"
                  className={cn(
                    "gap-1 font-normal",
                    emailAvisos
                      ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5"
                      : "text-muted-foreground"
                  )}
                >
                  {emailAvisos ? (
                    <CheckCircle2 className="w-3 h-3" />
                  ) : (
                    <Bell className="w-3 h-3" />
                  )}
                  Correo {emailAvisos ? "activo" : "apagado"}
                </Badge>
                <Badge
                  variant="outline"
                  className={cn(
                    "gap-1 font-normal",
                    pushEnabled
                      ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5"
                      : "text-muted-foreground"
                  )}
                >
                  {pushEnabled ? (
                    <CheckCircle2 className="w-3 h-3" />
                  ) : (
                    <Bell className="w-3 h-3" />
                  )}
                  Push {pushEnabled ? "activo" : "apagado"}
                </Badge>
              </div>

              <p className="text-sm text-muted-foreground leading-relaxed px-0.5">
                Te avisamos cuando hay algo para vos: en la app, en el teléfono
                (push) y por correo. Las reuniones y tareas con fecha te llegan
                además como invitación de Google Calendar.
              </p>

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
        <div className="sm:hidden fixed inset-x-0 bottom-[calc(var(--alto-barra)+1px)] z-20 border-t border-border bg-card/95 backdrop-blur p-3">
          <Button
            onClick={handleSave}
            disabled={saving}
            className="w-full h-11 font-semibold gap-2"
          >
            {saving ? (
              <>
                <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                Guardando…
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Guardar cambios
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
};

export default Profile;
