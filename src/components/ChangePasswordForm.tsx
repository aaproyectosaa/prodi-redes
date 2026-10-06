import { useState } from "react";
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
  type User,
} from "@/lib/auth";
import { Eye, EyeOff, KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const MIN_PASSWORD_LENGTH = 6;

function mapAuthError(code: string | undefined): string {
  switch (code) {
    case "auth/wrong-password":
    case "auth/invalid-credential":
    case "auth/invalid-login-credentials":
      return "La contraseña actual es incorrecta";
    case "auth/weak-password":
      return "La nueva contraseña es demasiado corta";
    case "auth/requires-recent-login":
      return "Por seguridad, volvé a ingresar tu contraseña actual";
    case "auth/too-many-requests":
      return "Demasiados intentos. Probá de nuevo en unos minutos";
    default:
      return "No se pudo actualizar la contraseña";
  }
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  disabled,
  show,
  onToggleShow,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  disabled?: boolean;
  show: boolean;
  onToggleShow: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm">
        {label}
      </Label>
      <div className="relative">
        <Input
          id={id}
          type={show ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 pr-10"
          disabled={disabled}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={onToggleShow}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/80"
          aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"}
        >
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

interface ChangePasswordFormProps {
  user: User;
  className?: string;
}

export function ChangePasswordForm({ user, className }: ChangePasswordFormProps) {
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const reset = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setShowCurrent(false);
    setShowNew(false);
    setShowConfirm(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user.email) {
      toast.error("Tu cuenta no tiene email asociado");
      return;
    }
    if (!currentPassword) {
      toast.error("Ingresá tu contraseña actual");
      return;
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      toast.error(
        `La nueva contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`
      );
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Las contraseñas nuevas no coinciden");
      return;
    }
    if (newPassword === currentPassword) {
      toast.error("La nueva contraseña debe ser distinta a la actual");
      return;
    }

    setSaving(true);
    try {
      const credential = EmailAuthProvider.credential(
        user.email,
        currentPassword
      );
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, newPassword);
      reset();
      setOpen(false);
      toast.success("Contraseña actualizada");
    } catch (err: unknown) {
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code: string }).code)
          : undefined;
      toast.error(mapAuthError(code));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      className={cn(
        "rounded-xl border border-border bg-card overflow-hidden",
        className
      )}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3.5 sm:px-5">
        <div className="flex items-start gap-3 min-w-0">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
            <KeyRound className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold leading-tight">Seguridad</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Cambiá la contraseña de acceso a tu cuenta.
            </p>
          </div>
        </div>
        {!open && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => setOpen(true)}
          >
            Cambiar
          </Button>
        )}
      </div>

      {open && (
        <form
          onSubmit={handleSubmit}
          className="border-t border-border px-4 py-4 sm:px-5 space-y-3 bg-muted/20"
        >
          <PasswordField
            id="current-password"
            label="Contraseña actual"
            value={currentPassword}
            onChange={setCurrentPassword}
            autoComplete="current-password"
            disabled={saving}
            show={showCurrent}
            onToggleShow={() => setShowCurrent((v) => !v)}
          />
          <div className="grid sm:grid-cols-2 gap-3">
            <PasswordField
              id="new-password"
              label="Contraseña nueva"
              value={newPassword}
              onChange={setNewPassword}
              autoComplete="new-password"
              disabled={saving}
              show={showNew}
              onToggleShow={() => setShowNew((v) => !v)}
            />
            <PasswordField
              id="confirm-password"
              label="Repetir nueva"
              value={confirmPassword}
              onChange={setConfirmPassword}
              autoComplete="new-password"
              disabled={saving}
              show={showConfirm}
              onToggleShow={() => setShowConfirm((v) => !v)}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Mínimo {MIN_PASSWORD_LENGTH} caracteres.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="submit" size="sm" disabled={saving} className="gap-2">
              {saving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Actualizando…
                </>
              ) : (
                "Actualizar contraseña"
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={saving}
              onClick={() => {
                reset();
                setOpen(false);
              }}
            >
              Cancelar
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

export function userHasPasswordProvider(user: User): boolean {
  return user.providerData.some((p) => p.providerId === "password");
}
