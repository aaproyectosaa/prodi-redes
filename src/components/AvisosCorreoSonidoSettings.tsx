import { useState } from "react";
import { Mail, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { doc, setDoc } from "@/lib/db";
import { db } from "@/integrations/firebase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { setSonidoActivo, sonarProdi, sonidoActivo } from "@/lib/sonido";

interface Props {
  userId: string;
  email: string | null | undefined;
  emailAvisos: boolean;
  onEmailAvisosChange: (v: boolean) => void;
}

/** Avisos por correo (en el perfil, para todos sus dispositivos) y sonido (en este dispositivo). */
export function AvisosCorreoSonidoSettings({ userId, email, emailAvisos, onEmailAvisosChange }: Props) {
  const [busy, setBusy] = useState(false);
  const [sonido, setSonido] = useState(sonidoActivo);

  const cambiarCorreo = async (v: boolean) => {
    setBusy(true);
    try {
      await setDoc(doc(db, "profiles", userId), { email_avisos: v }, { merge: true });
      onEmailAvisosChange(v);
      toast.success(v ? "Te vamos a mandar los avisos por correo" : "Listo, sin avisos por correo");
    } catch (err) {
      console.error(err);
      toast.error("No se pudo guardar");
    } finally {
      setBusy(false);
    }
  };

  const cambiarSonido = (v: boolean) => {
    setSonidoActivo(v);
    setSonido(v);
    if (v) sonarProdi({ forzar: true });
  };

  return (
    <Card>
      <CardContent className="p-4 sm:p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
            <Mail className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold">Avisos por correo</h3>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              Te mandamos cada aviso a {email ? <strong className="text-foreground">{email}</strong> : "tu mail"}. Si llegan varios
              del mismo tema seguidos, te llega uno solo hasta que lo abras.
            </p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="email-avisos" className="text-sm font-medium">
            Recibir avisos por correo
          </Label>
          <Switch id="email-avisos" checked={emailAvisos} disabled={busy} onCheckedChange={(v) => void cambiarCorreo(v)} />
        </div>

        <div className="border-t border-border pt-4 flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
            <Volume2 className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold">Sonido de notificaciones</h3>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              Un sonido suave cuando te llega un aviso con la app abierta. Se guarda en este dispositivo.
            </p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="sonido-avisos" className="text-sm font-medium">
            Sonido de notificaciones
          </Label>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={() => sonarProdi({ forzar: true })}>
              Probar
            </Button>
            <Switch id="sonido-avisos" checked={sonido} onCheckedChange={cambiarSonido} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
