import { useNavigate } from "react-router-dom";
import { signOut } from "@/lib/auth";
import { auth } from "@/integrations/firebase/client";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Hourglass, LogOut } from "lucide-react";

const PendingRoleGate = () => {
  const navigate = useNavigate();
  const { user, role, loading } = useUserProfileContext();

  const handleLogout = async () => {
    await signOut(auth);
    navigate("/auth");
  };

  if (!user) return null;
  if (loading) return null;
  if (role !== "pending") return null;

  return (
    <Dialog open={true}>
      <DialogContent
        className="max-w-md"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <div className="w-12 h-12 rounded-full bg-amber-500/15 flex items-center justify-center mx-auto mb-2">
            <Hourglass className="w-6 h-6 text-amber-500" />
          </div>
          <DialogTitle className="text-center">
            Cuenta pendiente de asignación
          </DialogTitle>
          <DialogDescription className="text-center">
            Todavía no tenés un rol asignado (o tu rol era del sistema
            anterior). El administrador te tiene que asignar un rol y los
            clientes en los que vas a trabajar.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border bg-secondary/30 p-3 text-xs space-y-1">
          <p className="font-semibold">Mientras tanto:</p>
          <p className="text-muted-foreground">
            • Avisale al administrador que ya te registraste.
          </p>
          <p className="text-muted-foreground">
            • Esta pantalla se actualiza sola apenas te aprueben.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleLogout} className="w-full gap-2">
            <LogOut className="w-4 h-4" />
            Cerrar sesión
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default PendingRoleGate;
