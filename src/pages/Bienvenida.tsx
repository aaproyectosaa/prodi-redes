import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, MessageCircle, PartyPopper, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InstalarDialog } from "@/components/InstalarApp";
import { InstalarChatDialog } from "@/components/InstalarChat";

// Después de aceptar un presupuesto: ya es cliente y está adentro. Le mostramos cómo instalar las dos apps
// (el panel de Prodi y Prodi Chat) y lo mandamos a su panel.

export default function Bienvenida() {
  const navigate = useNavigate();
  const [app, setApp] = useState(false);
  const [chat, setChat] = useState(false);
  return (
    <div className="min-h-dvh bg-[#0B0A12] px-5 py-12 text-white">
      <div className="mx-auto max-w-md space-y-6 text-center">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6F40FC] to-[#E040A0]">
          <PartyPopper className="h-8 w-8" />
        </span>
        <div>
          <h1 className="text-3xl font-extrabold">¡Bienvenido a Prodi!</h1>
          <p className="mt-2 text-white/70">Ya sos parte. Instalá las dos apps en tu celular: así te llegan los avisos cuando tengas un video para aprobar o un mensaje del equipo.</p>
        </div>

        <div className="space-y-3 text-left">
          <button type="button" onClick={() => setApp(true)} className="flex w-full items-center gap-4 rounded-2xl bg-white/[0.06] p-4 transition-colors hover:bg-white/[0.1]">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#6F40FC]">
              <Smartphone className="h-6 w-6" />
            </span>
            <span className="flex-1">
              <span className="block font-semibold">1. Tu panel de Prodi</span>
              <span className="block text-sm text-white/60">Tus videos, aprobaciones, resultados y tu plan.</span>
            </span>
            <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-[#14121F]">Instalar</span>
          </button>
          <button type="button" onClick={() => setChat(true)} className="flex w-full items-center gap-4 rounded-2xl bg-white/[0.06] p-4 transition-colors hover:bg-white/[0.1]">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-500">
              <MessageCircle className="h-6 w-6" />
            </span>
            <span className="flex-1">
              <span className="block font-semibold">2. Prodi Chat</span>
              <span className="block text-sm text-white/60">Para hablar con tu equipo, como WhatsApp.</span>
            </span>
            <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-[#14121F]">Instalar</span>
          </button>
        </div>

        <Button onClick={() => navigate("/cliente", { replace: true })} className="h-12 w-full rounded-xl bg-gradient-to-r from-[#6F40FC] to-[#E040A0] text-base font-bold text-white">
          Ir a mi panel <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
      <InstalarDialog open={app} onOpenChange={setApp} />
      <InstalarChatDialog open={chat} onOpenChange={setChat} />
    </div>
  );
}
