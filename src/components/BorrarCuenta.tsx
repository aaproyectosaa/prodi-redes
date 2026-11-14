import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { auth } from "@/integrations/firebase/client";
import { pedirBajaCuenta, signOut } from "@/lib/auth";
import { CHAT_APP_INGRESAR, enModoChat } from "@/lib/chatApp";

/**
 * Borrar la cuenta desde la app (lo exigen App Store y Google Play). Le llega el pedido a un admin, que la borra
 * (puede haber facturas o trabajos en curso) y le confirma por mail. Se cierra la sesión en este equipo.
 */
export function BorrarCuenta() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);

  const confirmar = async () => {
    setBusy(true);
    try {
      await pedirBajaCuenta(motivo);
      toast.success("Listo. Te confirmamos por mail cuando tu cuenta esté borrada (hasta 7 días).", { duration: 10000 });
      setOpen(false);
      await signOut(auth);
      navigate(enModoChat() ? CHAT_APP_INGRESAR : "/auth", { replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo mandar el pedido");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-destructive/25 bg-destructive/5 p-4">
      <p className="text-sm font-semibold">Borrar mi cuenta</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Se borran tu usuario, tu foto y tus datos personales. Lo pedís acá y te confirmamos por mail.
      </p>
      <Button type="button" variant="outline" size="sm" className="mt-3 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setOpen(true)}>
        <Trash2 className="mr-2 h-4 w-4" /> Borrar mi cuenta
      </Button>

      <AlertDialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
        <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-sm rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar tu cuenta?</AlertDialogTitle>
            <AlertDialogDescription>
              No vas a poder volver a entrar con este usuario. Te confirmamos por mail cuando esté hecho (hasta 7 días).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="¿Por qué te vas? (opcional)" maxLength={300} className="min-h-20" />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <Button variant="destructive" onClick={() => void confirmar()} disabled={busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Borrar cuenta
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
