import { useState } from "react";
import { CheckCircle2, Eye, Link2, MessageCircle, Pencil, Play, TrendingUp, Users } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { asset } from "@/lib/asset";
import { cn } from "@/lib/utils";

// Demo del portal del cliente para que el socio se la muestre al empresario: cómo aprueba los videos por link y
// cómo ve sus resultados. Solo lectura, con datos de ejemplo (no toca la base ni manda nada).

const VIDEOS = [
  { titulo: "Promo de verano", estado: "Para aprobar", img: "/demo/video-1.jpg", tono: "bg-amber-500 text-white" },
  { titulo: "Conocé el local", estado: "Publicado", img: "/demo/video-2.jpg", tono: "bg-emerald-500 text-white" },
  { titulo: "Detrás de escena", estado: "En edición", img: "/demo/crudo-1.jpg", tono: "bg-[#6F40FC] text-white" },
];

type Pestania = "videos" | "link" | "resultados";

export function DemoPortalCliente({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [tab, setTab] = useState<Pestania>("videos");
  const [aprobado, setAprobado] = useState(false);
  const demo = (texto: string) => toast.info(texto, { description: "Es una demo: en la app real se guarda al toque." });
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) {
          setTab("videos");
          setAprobado(false);
        }
      }}
    >
      <DialogContent className="w-[calc(100vw-1rem)] max-w-sm gap-0 overflow-hidden rounded-[2rem] border-0 bg-[#0a0a0a] p-0 font-[Poppins,Inter,sans-serif] text-white">
        <div className="px-5 pb-3 pt-5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#a98bff]">Demo · así lo ve tu cliente</p>
          <DialogTitle className="mt-1 text-xl font-bold text-white">Panel de Don Tano</DialogTitle>
          <DialogDescription className="text-xs text-white/60">Datos de ejemplo. No se guarda nada.</DialogDescription>
        </div>
        <div className="mx-4 grid grid-cols-3 gap-1 rounded-2xl bg-white/10 p-1">
          {(
            [
              { k: "videos", label: "Videos" },
              { k: "link", label: "Por link" },
              { k: "resultados", label: "Resultados" },
            ] as const
          ).map((x) => (
            <button
              key={x.k}
              type="button"
              onClick={() => setTab(x.k)}
              className={cn("h-9 rounded-xl text-xs font-semibold transition-colors", tab === x.k ? "bg-white text-[#0a0a0a]" : "text-white/70 hover:text-white")}
            >
              {x.label}
            </button>
          ))}
        </div>

        <div className="max-h-[62dvh] min-h-[22rem] overflow-y-auto bg-[#f7f7fb] p-4 text-[#0a0a0a]">
          {tab === "videos" && (
            <div className="space-y-3">
              <p className="text-sm font-semibold">Tus videos de este mes</p>
              {VIDEOS.map((v, i) => (
                <div key={v.titulo} className="flex items-center gap-3 rounded-2xl bg-white p-2.5 shadow-sm">
                  <div className="relative h-16 w-12 shrink-0 overflow-hidden rounded-xl bg-neutral-200">
                    <img src={asset(v.img)} alt="" className="h-full w-full object-cover" />
                    <Play className="absolute inset-0 m-auto h-5 w-5 fill-white text-white drop-shadow" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{v.titulo}</p>
                    <span className={cn("mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold", i === 0 && aprobado ? "bg-emerald-500 text-white" : v.tono)}>
                      {i === 0 && aprobado ? "Aprobado" : v.estado}
                    </span>
                  </div>
                </div>
              ))}
              {!aprobado ? (
                <div className="space-y-2 rounded-2xl bg-white p-3 shadow-sm">
                  <p className="text-sm font-semibold">«Promo de verano» espera tu OK</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setAprobado(true);
                        demo("¡Aprobado! Prodi lo publica y lo pauta.");
                      }}
                      className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-[#6F40FC] text-sm font-semibold text-white"
                    >
                      <CheckCircle2 className="h-4 w-4" /> Aprobar
                    </button>
                    <button type="button" onClick={() => demo("Escribe qué cambiar y le llega al editor.")} className="flex h-11 items-center justify-center gap-1.5 rounded-xl border text-sm font-semibold">
                      <Pencil className="h-4 w-4" /> Pedir cambio
                    </button>
                  </div>
                </div>
              ) : (
                <p className="rounded-2xl bg-emerald-50 p-3 text-center text-sm font-medium text-emerald-700">Listo: un toque y ya está aprobado 🎉</p>
              )}
            </div>
          )}

          {tab === "link" && (
            <div className="space-y-3">
              <div className="rounded-2xl bg-white p-3 shadow-sm">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-[#6F40FC]">
                  <MessageCircle className="h-3.5 w-3.5" /> WhatsApp de Prodi
                </p>
                <p className="mt-1.5 text-sm">Hola Carlos 👋 Ya está tu video «Promo de verano». Miralo y aprobalo acá:</p>
                <p className="mt-1 flex items-center gap-1 break-all text-sm font-medium text-[#6F40FC]">
                  <Link2 className="h-3.5 w-3.5 shrink-0" /> Tocá acá para verlo →
                </p>
              </div>
              <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
                <div className="relative aspect-[9/12] bg-neutral-200">
                  <img src={asset("/demo/video-1.jpg")} alt="" className="h-full w-full object-cover" />
                  <Play className="absolute inset-0 m-auto h-10 w-10 fill-white text-white drop-shadow-lg" />
                </div>
                <div className="grid grid-cols-2 gap-2 p-3">
                  <button type="button" onClick={() => demo("Sin usuario ni contraseña: aprueba desde el link.")} className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-[#6F40FC] text-sm font-semibold text-white">
                    <CheckCircle2 className="h-4 w-4" /> Aprobar
                  </button>
                  <button type="button" onClick={() => demo("Escribe o graba un audio con el cambio.")} className="flex h-11 items-center justify-center gap-1.5 rounded-xl border text-sm font-semibold">
                    <Pencil className="h-4 w-4" /> Cambiar algo
                  </button>
                </div>
              </div>
              <p className="text-center text-xs text-neutral-500">No necesita bajar nada ni acordarse una contraseña.</p>
            </div>
          )}

          {tab === "resultados" && (
            <div className="space-y-3">
              <p className="text-sm font-semibold">Este mes, tus videos…</p>
              <div className="grid grid-cols-2 gap-2">
                <Dato icono={Eye} valor="48.300" label="personas los vieron" />
                <Dato icono={MessageCircle} valor="62" label="te escribieron" />
                <Dato icono={Users} valor="+310" label="seguidores nuevos" />
                <Dato icono={TrendingUp} valor="$4.800" label="te costó cada mensaje" />
              </div>
              <div className="rounded-2xl bg-white p-3 shadow-sm">
                <p className="text-xs font-semibold text-neutral-500">En criollo</p>
                <p className="mt-1 text-sm leading-relaxed">
                  Tus anuncios trajeron <b>62 mensajes</b> por WhatsApp. El video que más vendió fue <b>«Promo de verano»</b>.
                </p>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Dato({ icono: Icono, valor, label }: { icono: React.ElementType; valor: string; label: string }) {
  return (
    <div className="rounded-2xl bg-white p-3 shadow-sm">
      <Icono className="h-4 w-4 text-[#6F40FC]" />
      <p className="mt-1.5 text-lg font-bold tabular-nums">{valor}</p>
      <p className="text-[11px] leading-tight text-neutral-500">{label}</p>
    </div>
  );
}
