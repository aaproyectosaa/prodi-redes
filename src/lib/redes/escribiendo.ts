// "Escribiendo…" y "grabando audio…" en el chat, como WhatsApp.
// Mientras alguien escribe se avisa cada 4 s (el aviso vence solo a los 7 s); si deja de tipear 5 s, se apaga.

import { useCallback, useEffect, useRef, useState } from "react";
import { avisarEscribiendo, suscribirEscribiendo, type Escribe } from "@/lib/db";
import { enModoVista } from "@/lib/redes/vistaComo";

type Estado = "escribiendo" | "grabando";

/** Devuelve una función para avisar en este chat que estoy escribiendo / grabando (null: terminé). */
export function useAvisarEscribiendo(chatId: string) {
  const ultimo = useRef<{ estado: Estado; at: number } | null>(null);
  const apagar = useRef<ReturnType<typeof setTimeout> | null>(null);

  const avisar = useCallback(
    (estado: Estado | null) => {
      if (enModoVista()) return;
      if (apagar.current) clearTimeout(apagar.current);
      apagar.current = null;
      const u = ultimo.current;
      if (!estado) {
        if (u) {
          ultimo.current = null;
          void avisarEscribiendo(chatId, null);
        }
        return;
      }
      const ahora = Date.now();
      if (!u || u.estado !== estado || ahora - u.at > 4_000) {
        ultimo.current = { estado, at: ahora };
        void avisarEscribiendo(chatId, estado);
      }
      // Si deja de tipear, a los 5 s deja de figurar (el audio se apaga al terminar de grabar).
      if (estado === "escribiendo") {
        apagar.current = setTimeout(() => {
          apagar.current = null;
          if (ultimo.current?.estado === "escribiendo") {
            ultimo.current = null;
            void avisarEscribiendo(chatId, null);
          }
        }, 5_000);
      }
    },
    [chatId]
  );

  // Al salir del chat (o cambiar a otro), deja de figurar.
  useEffect(
    () => () => {
      if (apagar.current) clearTimeout(apagar.current);
      if (ultimo.current) void avisarEscribiendo(chatId, null);
      ultimo.current = null;
    },
    [chatId]
  );

  return avisar;
}

/** Quién está escribiendo ahora en mis chats. */
export function useEscriben(): Escribe[] {
  const [lista, setLista] = useState<Escribe[]>([]);
  useEffect(() => suscribirEscribiendo(setLista), []);
  return lista;
}

/** "escribiendo…", "Nati está escribiendo…", "Nati y Lucía están escribiendo…", "grabando audio…". */
export function textoEscribiendo(lista: Escribe[], chatId: string, directo: boolean): string | null {
  const aca = lista.filter((e) => e.chat_id === chatId);
  if (!aca.length) return null;
  const graban = aca.filter((e) => e.estado === "grabando");
  const grupo = graban.length === aca.length ? graban : aca.filter((e) => e.estado !== "grabando");
  const verbo = graban.length === aca.length ? "grabando audio…" : "escribiendo…";
  if (directo) return verbo;
  const nombres = grupo.map((e) => (e.nombre || "Alguien").split(" ")[0]);
  if (nombres.length === 1) return `${nombres[0]} está ${verbo}`;
  if (nombres.length === 2) return `${nombres[0]} y ${nombres[1]} están ${verbo}`;
  return `${nombres.length} personas están ${verbo}`;
}
