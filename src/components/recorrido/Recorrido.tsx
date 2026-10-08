import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, PartyPopper, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { doc, updateDoc } from "@/lib/db";
import { db } from "@/integrations/firebase/client";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { bienvenidaDe, EVENTO_RECORRIDO, NOVEDADES, novedadesPara, type Diapositiva } from "@/lib/novedades";
import { cn } from "@/lib/utils";
import { Ilustracion } from "./Ilustraciones";

/** Quien ya usaba el sistema antes de los recorridos ve las novedades, no la bienvenida completa. */
const DESDE_RECORRIDOS = "2026-10-08T00:00:00-03:00";

type Paso = Diapositiva & { etiqueta?: string };

/** Las diapositivas a pantalla completa en el celular, ventana en la compu. Animadas y con puntitos. */
function RecorridoDialog({
  open,
  titulo,
  pasos,
  onCerrar,
}: {
  open: boolean;
  titulo: string;
  pasos: Paso[];
  onCerrar: () => void;
}) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (open) setI(0);
  }, [open]);
  const p = pasos[i];
  if (!p) return null;
  const ultimo = i === pasos.length - 1;
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCerrar()}>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-w-md gap-0 overflow-hidden rounded-3xl p-0">
        <div className="flex items-center gap-2 px-5 pt-5 text-xs font-semibold uppercase tracking-wide text-primary">
          <Sparkles className="h-3.5 w-3.5" /> {p.etiqueta ?? titulo}
        </div>
        <div key={i} className="space-y-4 px-5 pb-2 pt-3 animate-in fade-in slide-in-from-right-4 duration-300 motion-reduce:animate-none">
          <Ilustracion anim={p.anim} />
          <div className="space-y-1.5 text-center">
            <DialogTitle className="text-xl">{p.titulo}</DialogTitle>
            <DialogDescription className="text-sm">{p.texto}</DialogDescription>
          </div>
        </div>
        <div className="flex justify-center gap-1.5 py-3" aria-hidden>
          {pasos.map((_, j) => (
            <button
              key={j}
              type="button"
              tabIndex={-1}
              onClick={() => setI(j)}
              className={cn("h-1.5 rounded-full transition-all", j === i ? "w-6 bg-primary" : "w-1.5 bg-muted-foreground/30")}
            />
          ))}
        </div>
        <div className="flex items-center gap-2 border-t p-3">
          {i > 0 ? (
            <Button variant="ghost" onClick={() => setI(i - 1)}>
              <ArrowLeft className="mr-1.5 h-4 w-4" /> Atrás
            </Button>
          ) : (
            <Button variant="ghost" onClick={onCerrar} className="text-muted-foreground">
              Saltar
            </Button>
          )}
          <Button className="ml-auto min-w-32" onClick={() => (ultimo ? onCerrar() : setI(i + 1))}>
            {ultimo ? (
              <>
                <PartyPopper className="mr-1.5 h-4 w-4" /> ¡Listo!
              </>
            ) : (
              <>
                Siguiente <ArrowRight className="ml-1.5 h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Se monta una vez en el sistema y en Prodi Chat. La primera vez que alguien entra le muestra la
 * bienvenida de su rol; después, cada novedad nueva una sola vez (queda anotada en su perfil).
 * Mirando "como" otro usuario no aparece nada. Los clientes tienen su propia guía en su panel.
 */
export function RecorridoAuto({ enChat = false }: { enChat?: boolean }) {
  const { user, profile, role, viewingAs } = useUserProfileContext();
  const [abierto, setAbierto] = useState<null | { titulo: string; pasos: Paso[]; tipo: "bienvenida" | "novedades" }>(null);
  const uid = user?.uid;
  const rol = role as string | undefined;
  const vistas = useMemo(() => new Set(profile?.novedades_vistas ?? []), [profile?.novedades_vistas]);
  const nuevo = !profile?.bienvenida_at && !!profile?.created_at && profile.created_at >= DESDE_RECORRIDOS;
  const esCliente = rol === "cliente";

  // Bienvenida (nuevos) o novedades pendientes (los demás). Un poco después de entrar, sin pisar otro cartel.
  useEffect(() => {
    if (!uid || !profile || viewingAs || abierto || !rol || rol === "pending") return;
    let pendiente: typeof abierto = null;
    if (nuevo && !(esCliente && !enChat)) {
      pendiente = { tipo: "bienvenida", titulo: "Bienvenido a Prodi", pasos: bienvenidaDe(rol, enChat) };
    } else {
      const lista = novedadesPara(rol, enChat).filter((n) => !vistas.has(n.id));
      if (lista.length) pendiente = { tipo: "novedades", titulo: "Novedades", pasos: lista.flatMap((n) => n.diapositivas.map((d) => ({ ...d, etiqueta: `Nuevo · ${n.titulo}` }))) };
    }
    if (!pendiente) return;
    let t = 0;
    const probar = () => {
      if (document.querySelector('[role="dialog"]')) t = window.setTimeout(probar, 1500);
      else setAbierto(pendiente);
    };
    t = window.setTimeout(probar, 1200);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, profile?.bienvenida_at, profile?.novedades_vistas?.length, rol, viewingAs, enChat]);

  // "¿Cómo se usa?" desde el menú: la bienvenida de su rol, cuando quiera.
  useEffect(() => {
    const abrir = () => setAbierto({ tipo: "bienvenida", titulo: "Cómo se usa Prodi", pasos: bienvenidaDe(rol, enChat) });
    window.addEventListener(EVENTO_RECORRIDO, abrir);
    return () => window.removeEventListener(EVENTO_RECORRIDO, abrir);
  }, [rol, enChat]);

  const cerrar = () => {
    setAbierto(null);
    if (!uid || viewingAs) return;
    // Al terminar (o saltar): bienvenida vista y todas las novedades de hoy anotadas, para no repetirlas.
    const todas = [...new Set([...vistas, ...NOVEDADES.map((n) => n.id)])];
    void updateDoc(doc(db, "profiles", uid), { bienvenida_at: profile?.bienvenida_at ?? new Date().toISOString(), novedades_vistas: todas }).catch(() => undefined);
  };

  return <RecorridoDialog open={!!abierto} titulo={abierto?.titulo ?? ""} pasos={abierto?.pasos ?? []} onCerrar={cerrar} />;
}
