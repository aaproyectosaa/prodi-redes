import { useEffect, useState } from "react";
import { Bell, BellOff, Loader2, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { callApi } from "@/lib/redes/api";
import {
  detectPushPlatform,
  isRunningAsInstalledPwa,
  isWebPushSupported,
  subscribeWebPush,
  unsubscribeWebPush,
} from "@/lib/webPush";

interface PushNotificationSettingsProps {
  userId: string;
  pushEnabled: boolean;
  onPushEnabledChange: (enabled: boolean) => void;
}

export function PushNotificationSettings({
  userId,
  pushEnabled,
  onPushEnabledChange,
}: PushNotificationSettingsProps) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [probando, setProbando] = useState(false);
  const platform = detectPushPlatform();

  // Prueba de punta a punta: el servidor manda un aviso a cada dispositivo y dice qué pasó.
  const probar = async () => {
    setProbando(true);
    try {
      const r = await callApi<{ configurado: boolean; dispositivos: { equipo: string; ok: boolean; estado?: number; error?: string }[] }>(
        "/api/auth/push-prueba"
      );
      if (!r.configurado) {
        toast.error("El servidor no tiene las claves de avisos (VAPID). Hay que cargarlas en Vercel.");
      } else if (!r.dispositivos.length) {
        toast.error("No hay ningún dispositivo suscripto. Tocá \"Volver a activar en este dispositivo\".");
      } else {
        const bien = r.dispositivos.filter((d) => d.ok).length;
        const mal = r.dispositivos.filter((d) => !d.ok);
        if (bien) toast.success(`Enviada a ${bien} dispositivo${bien === 1 ? "" : "s"}. Si no te llega, revisá los permisos de notificaciones del teléfono.`, { duration: 10000 });
        for (const d of mal) toast.error(`${d.equipo}: no se pudo (${d.estado ?? "error"}). ${d.estado === 403 ? "Las claves VAPID no coinciden: volvé a activar." : ""}`, { duration: 12000 });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo probar");
    } finally {
      setProbando(false);
    }
  };
  const isPwa = isRunningAsInstalledPwa();
  const needsIosInstall = platform === "ios" && !isPwa;

  useEffect(() => {
    void isWebPushSupported().then(setSupported);
  }, []);

  const handleToggle = async (next: boolean) => {
    if (!next) {
      setBusy(true);
      try {
        await unsubscribeWebPush(userId);
        onPushEnabledChange(false);
        toast.success("Avisos del teléfono desactivados");
      } catch (err) {
        console.error(err);
        toast.error("No se pudieron desactivar los avisos");
      } finally {
        setBusy(false);
      }
      return;
    }

    setBusy(true);
    try {
      await subscribeWebPush(userId);
      onPushEnabledChange(true);
      toast.success(
        platform === "android"
          ? "Avisos activados en este Android"
          : "Avisos push activados"
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo activar";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  if (supported === false) {
    return (
      <Card>
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-start gap-3 mb-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
              <BellOff className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Avisos en el teléfono</h3>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                Este navegador no soporta avisos push. Abrí la aplicación desde el celular:
                en Android con Chrome, en iPhone con Safari, y creá el acceso directo
                a la pantalla de inicio.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4 sm:p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
            <Bell className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Avisos en el teléfono</h3>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              Los mismos avisos de la app, en el celular o la compu. Al tocarlos se abre lo que corresponde.
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-muted/40 px-3 py-3 text-sm space-y-2">
          <div className="flex gap-2 text-muted-foreground">
            <Smartphone className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="space-y-2 min-w-0">
              <p className="text-foreground font-medium text-sm leading-snug">
                Para recibir avisos, usá la aplicación desde el acceso directo en tu celular
              </p>
              {platform === "ios" || needsIosInstall ? (
                <ol className="list-decimal list-inside space-y-1 text-xs leading-relaxed">
                  <li>Abrí esta página en <strong className="text-foreground">Safari</strong> (no Chrome).</li>
                  <li>
                    Tocá <strong className="text-foreground">Compartir</strong> →{" "}
                    <strong className="text-foreground">Agregar a pantalla de inicio</strong>.
                  </li>
                  <li>Abrí la aplicación desde el ícono nuevo y activá los avisos acá.</li>
                </ol>
              ) : platform === "android" ? (
                <ol className="list-decimal list-inside space-y-1 text-xs leading-relaxed">
                  <li>Abrí la aplicación en <strong className="text-foreground">Chrome</strong> del celular.</li>
                  <li>
                    Menú (⋮) → <strong className="text-foreground">Instalar app</strong> o{" "}
                    <strong className="text-foreground">Agregar a pantalla de inicio</strong>.
                  </li>
                  <li>Abrí desde el ícono y tocá <strong className="text-foreground">Activar en este dispositivo</strong>.</li>
                </ol>
              ) : (
                <ol className="list-decimal list-inside space-y-1 text-xs leading-relaxed">
                  <li>
                    <strong className="text-foreground">Android:</strong> Chrome → menú → Instalar app /
                    Agregar a pantalla de inicio.
                  </li>
                  <li>
                    <strong className="text-foreground">iPhone:</strong> Safari → Compartir → Agregar a
                    pantalla de inicio.
                  </li>
                  <li>Abrí la aplicación desde el ícono del celular y activá los avisos acá.</li>
                </ol>
              )}
              {isPwa && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400">
                  Ya estás usando el acceso directo. Podés activar los avisos abajo.
                </p>
              )}
              {needsIosInstall && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Todavía no estás en la app de pantalla de inicio: hasta crearla, no se
                  pueden activar los avisos en iPhone.
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 pt-1">
          <Label htmlFor="push-enabled" className="text-sm font-medium">
            Recibir avisos push
          </Label>
          <div className="flex items-center gap-2">
            {busy && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
            <Switch
              id="push-enabled"
              checked={pushEnabled}
              disabled={busy || supported !== true || needsIosInstall}
              onCheckedChange={(v) => void handleToggle(v)}
            />
          </div>
        </div>

        {!pushEnabled && !needsIosInstall && supported && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full"
            disabled={busy}
            onClick={() => void handleToggle(true)}
          >
            Activar en este dispositivo
          </Button>
        )}

        {pushEnabled && !needsIosInstall && supported && (
          <div className="grid gap-2 sm:grid-cols-2">
            {/* En iPhone, Prodi y Prodi Chat se activan por separado: el interruptor puede estar prendido por la otra. */}
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void handleToggle(true)}>
              Volver a activar en este dispositivo
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={probando} onClick={() => void probar()}>
              {probando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Mandarme una notificación de prueba
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
