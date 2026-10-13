// Stickers del chat (como WhatsApp): emojis animados de Google (Noto Animated Emoji, licencia libre).
// No se sube nada: el mensaje guarda el código del sticker y la imagen viene de Google.

import { useState } from "react";
import { Sticker } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const CATEGORIAS: { nombre: string; stickers: string[] }[] = [
  { nombre: "Caras", stickers: ["😂", "🤣", "😅", "😍", "🥰", "😘", "😎", "🤩", "🥳", "🤗", "🥹", "😉", "🙃", "🤔", "🙄", "😬", "😮", "😱", "🤯", "😭", "😤", "😡", "😴", "🫠"] },
  { nombre: "Gestos", stickers: ["👍", "👏", "🙌", "🙏", "💪", "👌", "✌️", "🤝", "👋", "🫶", "🤞", "👀", "🙈"] },
  { nombre: "Trabajo", stickers: ["🎬", "📸", "🔥", "💯", "✅", "❌", "⏰", "🚀", "💡", "📈", "💸", "☕", "🏆"] },
  { nombre: "Fiesta", stickers: ["🎉", "🎊", "✨", "❤️", "💜", "💔", "💀", "🤡", "👻"] },
];

/** "😂" → "1f602" (sin el selector de variante, como lo nombra Google). */
export function codigoSticker(emoji: string): string {
  return [...emoji]
    .map((c) => c.codePointAt(0)!)
    .filter((c) => c !== 0xfe0f)
    .map((c) => c.toString(16))
    .join("_");
}

/** Solo códigos con forma válida (lo que guarda el mensaje lo puede tocar cualquiera). */
const CODIGO_OK = /^[0-9a-f]{2,6}(_[0-9a-f]{2,6}){0,6}$/;

export function urlSticker(codigo: string): string | null {
  return CODIGO_OK.test(codigo) ? `https://fonts.gstatic.com/s/e/notoemoji/latest/${codigo}/512.webp` : null;
}

/** El sticker dentro del chat: grande y sin globo. */
export function StickerMensaje({ codigo, emoji }: { codigo: string; emoji: string }) {
  const url = urlSticker(codigo);
  const [fallo, setFallo] = useState(false);
  if (!url || fallo) return <span className="block text-7xl leading-none">{emoji}</span>;
  return <img src={url} alt={emoji} width={128} height={128} loading="lazy" className="h-32 w-32 select-none" draggable={false} onError={() => setFallo(true)} />;
}

/** Botón y panel para elegir un sticker. */
export function BotonStickers({ onElegir, disabled }: { onElegir: (emoji: string, codigo: string) => void; disabled?: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const [cat, setCat] = useState(0);
  return (
    <Popover open={abierto} onOpenChange={setAbierto}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          disabled={disabled}
          className="-ml-1 h-11 w-11 shrink-0 rounded-full text-muted-foreground min-[380px]:-ml-2"
          aria-label="Stickers"
          title="Mandar un sticker"
        >
          <Sticker className="h-5 w-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-[min(22rem,calc(100vw-1.5rem))] rounded-2xl p-2">
        <div className="mb-2 flex gap-1 overflow-x-auto [scrollbar-width:none]">
          {CATEGORIAS.map((c, i) => (
            <button
              key={c.nombre}
              type="button"
              onClick={() => setCat(i)}
              className={cn(
                "shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                cat === i ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted"
              )}
            >
              {c.nombre}
            </button>
          ))}
        </div>
        <div className="grid max-h-64 grid-cols-5 gap-1 overflow-y-auto sm:grid-cols-6">
          {CATEGORIAS[cat].stickers.map((e) => {
            const codigo = codigoSticker(e);
            return (
              <button
                key={codigo}
                type="button"
                onClick={() => {
                  setAbierto(false);
                  onElegir(e, codigo);
                }}
                className="flex aspect-square items-center justify-center rounded-xl transition-transform hover:bg-muted active:scale-90"
                aria-label={`Sticker ${e}`}
              >
                <img src={urlSticker(codigo) ?? ""} alt={e} loading="lazy" className="h-12 w-12" draggable={false} />
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
