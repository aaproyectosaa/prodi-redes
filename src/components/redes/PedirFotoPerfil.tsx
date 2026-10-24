import { useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, Loader2, Shirt, Smile, Sun, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RecorteFoto } from "@/components/RecorteFoto";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { AVATAR_LADO, AVATAR_MAX, guardarFotoPerfil } from "@/lib/avatares";
import { enModoVista } from "@/lib/redes/vistaComo";

// Al equipo de Redes que no tiene foto de perfil se le pide una, estilo profesional (como LinkedIn): la ven los
// clientes en los chats. Es obligatoria: no se puede cerrar hasta subirla. Nunca sale encima de otra ventana abierta.
// Quien ya tiene foto no la ve.

/** Los roles que tratan con los clientes. */
const ROLES_CON_FOTO = ["admin", "productor", "editor", "pauta", "diseno"] as const;

const CONSEJOS = [
  { icono: UserRound, texto: "De frente, de los hombros para arriba" },
  { icono: Sun, texto: "Con buena luz, mejor natural (frente a una ventana)" },
  { icono: ImagePlus, texto: "Fondo liso y prolijo" },
  { icono: Shirt, texto: "Ropa prolija, como para una reunión" },
  { icono: Smile, texto: "Mirando a cámara y con una sonrisa" },
];

export function PedirFotoPerfil() {
  const { user, profile, viewingAs, tieneRol } = useUserProfileContext();
  const [open, setOpen] = useState(false);
  const [foto, setFoto] = useState<File | null>(null);
  const [guardando, setGuardando] = useState(false);
  const galeria = useRef<HTMLInputElement>(null);
  const camara = useRef<HTMLInputElement>(null);
  const uid = user?.uid;
  const delEquipo = ROLES_CON_FOTO.some((r) => tieneRol(r));
  const sinFoto = !!profile && !profile.profileImage && delEquipo;

  // Cuando no hay otra ventana abierta (Mi día, avisos…): se espera y se vuelve a mirar.
  useEffect(() => {
    if (!uid || !sinFoto || viewingAs || enModoVista()) return;
    let t = 0;
    const probar = () => {
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) t = window.setTimeout(probar, 8_000);
      else setOpen(true);
    };
    t = window.setTimeout(probar, 4_000);
    return () => window.clearTimeout(t);
  }, [uid, sinFoto, viewingAs]);

  const elegir = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) setFoto(f);
  };

  const guardar = async (img: string) => {
    if (!uid || !img) return;
    setGuardando(true);
    try {
      await guardarFotoPerfil(uid, img);
      setFoto(null);
      setOpen(false);
      toast.success("¡Quedó genial! Ya se ve en los chats.");
    } catch {
      toast.error("No se pudo guardar la foto");
    } finally {
      setGuardando(false);
    }
  };

  if (!uid || !sinFoto) return null;

  return (
    <>
      {/* Obligatoria: no se cierra tocando afuera, con Escape ni con la cruz. */}
      <Dialog open={open && !foto} onOpenChange={() => {}}>
        <DialogContent
          className="w-[calc(100vw-1.5rem)] max-w-md overflow-hidden rounded-3xl border-0 p-0 shadow-2xl [&>button:last-child]:hidden"
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          {/* Cabecera con un "retrato" de ejemplo. */}
          <div className="relative flex flex-col items-center bg-gradient-to-br from-primary via-violet-600 to-fuchsia-500 px-6 pb-6 pt-7 text-center text-white">
            <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/15 blur-2xl" aria-hidden />
            <div className="relative flex h-24 w-24 items-end justify-center overflow-hidden rounded-full bg-gradient-to-b from-sky-100 to-slate-200 ring-4 ring-white/40 shadow-xl">
              <span className="absolute top-[18%] h-9 w-9 rounded-full bg-amber-200" />
              <span className="relative h-10 w-16 rounded-t-full bg-slate-700" />
              <span className="absolute bottom-0 h-4 w-5 bg-white [clip-path:polygon(0_0,100%_0,50%_100%)]" />
            </div>
            <DialogTitle className="relative mt-4 text-xl font-bold text-white">Necesitamos tu foto de perfil</DialogTitle>
            <DialogDescription className="relative mt-1 text-sm text-white/85">
              Los clientes te ven en los chats: una foto estilo LinkedIn, profesional y cercana, les da confianza. Es obligatoria para seguir.
            </DialogDescription>
          </div>

          <div className="space-y-4 p-5">
            <ul className="space-y-2">
              {CONSEJOS.map(({ icono: Icono, texto }) => (
                <li key={texto} className="flex items-center gap-3 text-sm">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icono className="h-4 w-4" />
                  </span>
                  {texto}
                </li>
              ))}
            </ul>

            <input ref={galeria} type="file" accept="image/*,.heic,.heif" className="hidden" onChange={elegir} />
            <input ref={camara} type="file" accept="image/*" capture="user" className="hidden" onChange={elegir} />
            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                onClick={() => camara.current?.click()}
                className="h-11 rounded-full bg-gradient-to-r from-primary to-fuchsia-500 font-semibold shadow-lg shadow-primary/25"
                disabled={guardando}
              >
                <Camera className="mr-2 h-4 w-4" /> Sacarme una foto
              </Button>
              <Button variant="outline" onClick={() => galeria.current?.click()} className="h-11 rounded-full font-semibold" disabled={guardando}>
                {guardando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImagePlus className="mr-2 h-4 w-4" />} Elegir una foto
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Encuadrar la foto (cuadrada, centrada en la cara). */}
      <RecorteFoto file={foto} titulo="Tu foto de perfil" lado={AVATAR_LADO} maxChars={AVATAR_MAX} onListo={(img) => void guardar(img)} onCancelar={() => setFoto(null)} />
    </>
  );
}
