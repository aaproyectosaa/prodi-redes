import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MessageCircle, Clock, CheckCircle2, Loader2, Unlink } from "lucide-react";
import { toast } from "sonner";
import type { UserRole, WhatsAppNotificationPreferences } from "@/integrations/firebase/types";
import {
  formatWhatsAppPhoneDisplay,
  getNotificationsForRole,
  getRoleDefaultForNotification,
  isNotificationGloballyEnabled,
  isValidWhatsAppPhone,
  normalizeWhatsAppPhone,
  WHATSAPP_SCHEDULE_END,
  WHATSAPP_SCHEDULE_START,
  type WhatsAppBotSettings,
} from "@/lib/whatsappNotifications";
import {
  confirmPhoneVerification,
  requestPhoneVerification,
  unlinkWhatsAppPhone,
  VERIFICATION_CODE_LENGTH,
} from "@/lib/whatsappPhoneVerification";

export interface WhatsAppUserSettings {
  whatsapp_enabled: boolean;
  whatsapp_phone: string;
  whatsapp_phone_verified: boolean;
  whatsapp_notifications: WhatsAppNotificationPreferences;
}

interface WhatsAppNotificationSettingsProps {
  userId: string;
  role: UserRole | undefined;
  botSettings: WhatsAppBotSettings;
  value: WhatsAppUserSettings;
  onChange: (next: WhatsAppUserSettings) => void;
}

export const WhatsAppNotificationSettings = ({
  userId,
  role,
  botSettings,
  value,
  onChange,
}: WhatsAppNotificationSettingsProps) => {
  const [draftPhone, setDraftPhone] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [awaitingCode, setAwaitingCode] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [confirmingCode, setConfirmingCode] = useState(false);
  const [unlinking, setUnlinking] = useState(false);

  const available = useMemo(() => getNotificationsForRole(role), [role]);

  if (available.length === 0) {
    return (
      <Card>
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
              <MessageCircle className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">WhatsApp</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Tu rol no recibe avisos por WhatsApp por ahora.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const botGloballyOn = botSettings.bot_enabled;
  const phoneVerified = value.whatsapp_phone_verified && !!value.whatsapp_phone;
  const draftValid = !draftPhone || isValidWhatsAppPhone(draftPhone);

  const activeNotifications = available.filter(
    (def) =>
      isNotificationGloballyEnabled(def.key, botSettings) &&
      getRoleDefaultForNotification(role, def.key, botSettings)
  );

  const handleSendCode = async () => {
    if (!draftPhone.trim()) {
      toast.error("Ingresá tu número de WhatsApp");
      return;
    }
    if (!isValidWhatsAppPhone(draftPhone)) {
      toast.error("El número no es válido");
      return;
    }

    setSendingCode(true);
    try {
      await requestPhoneVerification(userId, draftPhone);
      setAwaitingCode(true);
      setVerificationCode("");
      toast.success("Te enviamos un código por WhatsApp");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo enviar el código");
    } finally {
      setSendingCode(false);
    }
  };

  const handleConfirmCode = async () => {
    setConfirmingCode(true);
    try {
      const normalized = await confirmPhoneVerification(userId, verificationCode);
      onChange({
        ...value,
        whatsapp_phone: normalized,
        whatsapp_phone_verified: true,
        whatsapp_enabled: true,
        whatsapp_notifications: {},
      });
      setAwaitingCode(false);
      setDraftPhone("");
      setVerificationCode("");
      toast.success("Número verificado y vinculado");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Código incorrecto");
    } finally {
      setConfirmingCode(false);
    }
  };

  const handleUnlink = async () => {
    setUnlinking(true);
    try {
      await unlinkWhatsAppPhone(userId);
      onChange({
        ...value,
        whatsapp_phone: "",
        whatsapp_phone_verified: false,
        whatsapp_enabled: false,
        whatsapp_notifications: {},
      });
      setAwaitingCode(false);
      setDraftPhone("");
      setVerificationCode("");
      toast.success("Número desvinculado");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo desvincular");
    } finally {
      setUnlinking(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-4 sm:p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
              <MessageCircle className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">WhatsApp</h3>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                Vinculá tu número para recibir avisos. Qué avisos llegan lo define
                el administrador.
              </p>
            </div>
          </div>
          {!botGloballyOn && (
            <Badge variant="secondary" className="shrink-0 text-[10px]">
              Bot desactivado
            </Badge>
          )}
        </div>

        {!botGloballyOn && (
          <p className="text-xs text-amber-600 dark:text-amber-400 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2">
            El administrador desactivó el bot. Podés vincular tu número; los avisos
            empezarán cuando lo habilite.
          </p>
        )}

        <div className="space-y-3 rounded-lg border px-3 py-3">
          <Label className="text-sm font-medium">Número de WhatsApp</Label>

          {phoneVerified ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  className="gap-1 text-emerald-600 border-emerald-500/40 bg-emerald-500/5"
                >
                  <CheckCircle2 className="w-3 h-3" />
                  Verificado
                </Badge>
                <span className="text-sm font-medium">
                  {formatWhatsAppPhoneDisplay(value.whatsapp_phone)}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Recibirás los avisos que el admin tenga activos para tu rol.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5 text-destructive hover:text-destructive"
                onClick={handleUnlink}
                disabled={unlinking}
              >
                {unlinking ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Unlink className="w-3.5 h-3.5" />
                )}
                Desvincular número
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Ingresá tu número y te enviamos un código por WhatsApp para confirmarlo.
              </p>
              <Input
                id="whatsapp-phone"
                value={draftPhone}
                onChange={(e) => setDraftPhone(e.target.value)}
                placeholder="Ej: 11 2345 6789 o +5491123456789"
                className="h-11"
                disabled={awaitingCode || sendingCode}
              />
              {draftPhone && (
                <p
                  className={`text-xs ${draftValid ? "text-muted-foreground" : "text-destructive"}`}
                >
                  {draftValid
                    ? `Se enviará a ${formatWhatsAppPhoneDisplay(normalizeWhatsAppPhone(draftPhone))}`
                    : "Ingresá un número argentino válido (código de área + número)."}
                </p>
              )}

              {!awaitingCode ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSendCode}
                  disabled={sendingCode || !draftPhone.trim() || !draftValid}
                >
                  {sendingCode && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />}
                  Enviar código por WhatsApp
                </Button>
              ) : (
                <div className="space-y-2 pt-1">
                  <Label htmlFor="whatsapp-code" className="text-xs font-medium">
                    Código de {VERIFICATION_CODE_LENGTH} dígitos
                  </Label>
                  <Input
                    id="whatsapp-code"
                    value={verificationCode}
                    onChange={(e) =>
                      setVerificationCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                    placeholder="000000"
                    className="h-11 tracking-[0.3em] text-center font-mono"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleConfirmCode}
                      disabled={confirmingCode || verificationCode.length < VERIFICATION_CODE_LENGTH}
                    >
                      {confirmingCode && (
                        <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                      )}
                      Verificar y vincular
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleSendCode}
                      disabled={sendingCode}
                    >
                      Reenviar código
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setAwaitingCode(false);
                        setVerificationCode("");
                      }}
                    >
                      Cancelar
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {phoneVerified && activeNotifications.length > 0 && (
          <div className="rounded-lg border border-border/80 bg-secondary/20 px-3 py-3 space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Avisos configurados para tu rol
            </p>
            <ul className="space-y-1.5">
              {activeNotifications.map((def) => (
                <li key={def.key} className="text-xs text-foreground/90">
                  <span className="font-medium">{def.label}</span>
                  <span className="text-muted-foreground"> — {def.description}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Clock className="w-3.5 h-3.5 shrink-0" />
          <span>
            Horario de envío: {botSettings.schedule_start_hour ?? WHATSAPP_SCHEDULE_START}:00 a{" "}
            {botSettings.schedule_end_hour ?? WHATSAPP_SCHEDULE_END}:00. Fuera de ese horario, los
            avisos se encolan para las {botSettings.schedule_start_hour ?? WHATSAPP_SCHEDULE_START}
            :00 del día siguiente.
          </span>
        </div>
      </CardContent>
    </Card>
  );
};

/** Estado local inicial desde el perfil de Firestore. */
export const whatsappSettingsFromProfile = (
  data: Record<string, unknown> | undefined
): WhatsAppUserSettings => {
  const phone = (data?.whatsapp_phone as string) ?? "";
  const verifiedField = data?.whatsapp_phone_verified;
  const verified =
    verifiedField === true
      ? true
      : verifiedField === false
        ? false
        : !!phone;

  return {
    whatsapp_enabled: verified ? Boolean(data?.whatsapp_enabled ?? true) : false,
    whatsapp_phone: phone,
    whatsapp_phone_verified: verified,
    whatsapp_notifications: {},
  };
};
