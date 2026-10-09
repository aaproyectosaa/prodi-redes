// Repasa los links que ya se pasaron en los chats (antes de que Prodi los guardara solo) y hace lo mismo que
// api/_lib/chat-links.ts: los guarda en la ficha del cliente (solo si estaba vacío) y en su memoria para la IA.
// Uso: pnpm exec tsx --env-file=.env scripts/links-de-chats.ts            → SIMULA
//      pnpm exec tsx --env-file=.env scripts/links-de-chats.ts --aplicar  → escribe

import { adminDb } from "../api/_lib/db";
import { clasificar, claveDe, clientePorNombre, leerPagina, normalizarUrl, URL_RE } from "../api/_lib/chat-links";
import { clientesNombrados, type Proyecto } from "../api/_lib/chat-contexto";
import { guardarNotasChat } from "../api/_lib/chat-memoria";

const APLICAR = process.argv.includes("--aplicar");

(async () => {
  const db = adminDb();
  const proyectos = (await db.collection("projects").get()).docs
    .map((d) => ({ id: d.id, ...(d.data() ?? {}) }) as Proyecto)
    .filter((p) => p.enabled !== false && typeof p.nombre === "string");
  const chats = await db.collection("chats").get();
  const vistos = new Set<string>();
  for (const c of chats.docs) {
    const chat = c.data() ?? {};
    const delChat = typeof chat.proyecto_id === "string" ? proyectos.find((p) => p.id === chat.proyecto_id) ?? null : null;
    const msgs = (await db.collection(`chats/${c.id}/mensajes`).orderBy("at", "asc").get()).docs.map((d) => d.data() ?? {});
    msgs.forEach((m, i) => {
      if (m.by === "prodi") return;
      const texto = String(m.texto ?? m.leyenda ?? "");
      for (const x of texto.matchAll(URL_RE)) {
        if (texto[(x.index ?? 0) - 1] === "@") continue;
        const u = normalizarUrl(x[0].replace(/[.,;:!?]+$/, ""));
        const cl = u && clasificar(u);
        if (!u || !cl) continue;
        let cliente = delChat ?? clientePorNombre(claveDe(u, cl), proyectos);
        if (!cliente) {
          const charla = msgs.slice(Math.max(0, i - 7), i + 1).map((y) => String(y.texto ?? "")).join("\n");
          const n = clientesNombrados(charla, proyectos);
          cliente = n.length === 1 ? n[0] : null;
        }
        if (!cliente || vistos.has(`${cliente.id}|${cl.valor}`)) continue;
        vistos.add(`${cliente.id}|${cl.valor}`);
        const redes = (cliente.redes ?? {}) as Record<string, string>;
        const vacio = !String(redes[cl.tipo] ?? "").trim();
        console.log(`${cliente.nombre} · ${cl.tipo} · ${cl.valor}${vacio ? "  → a la ficha" : `  (ya tenía ${redes[cl.tipo]})`}  [chat ${chat.nombre ?? c.id}]`);
        (cliente as Record<string, unknown>)._pend = [...(((cliente as Record<string, unknown>)._pend as unknown[]) ?? []), { u, cl, vacio, chat: c.id, por: m.by }];
        if (vacio) redes[cl.tipo] = cl.valor, (cliente.redes = redes);
      }
    });
  }
  if (!APLICAR) {
    console.log("\nSIMULACIÓN: agregá --aplicar para guardar.");
    process.exit(0);
  }
  for (const p of proyectos) {
    const pend = ((p as Record<string, unknown>)._pend ?? []) as { u: URL; cl: { tipo: string; valor: string }; vacio: boolean; chat: string; por: string }[];
    for (const x of pend) {
      if (x.vacio) await db.collection("projects").doc(p.id).update({ [`redes.${x.cl.tipo}`]: x.cl.valor });
      const pagina = x.cl.tipo === "web" ? await leerPagina(x.u) : null;
      const nombre = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", web: "Página web" }[x.cl.tipo];
      await guardarNotasChat(p.id, x.chat, [`${nombre} de ${p.nombre}: ${x.cl.valor}${pagina ? ` (${pagina})` : ""}`], x.por);
    }
  }
  console.log("Listo.");
  process.exit(0);
})();
