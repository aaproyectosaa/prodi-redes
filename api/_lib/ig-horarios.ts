/* eslint-disable @typescript-eslint/no-explicit-any */
// Cuándo están conectados los seguidores de Instagram de un cliente (online_followers de Meta, últimos 7 días), para
// recomendarle a qué hora publicar. Meta lo da solo en cuentas con 100 seguidores o más. Las horas vienen en horario
// del Pacífico (como el resto de las métricas por hora de Meta): se pasan a hora de Argentina.
// Se guarda en projects.ig_horarios = { horas: [24 promedios, hora AR], dias: n, at }.

import { adminDb } from "./db";

/** Diferencia en horas entre Argentina (UTC-3) y el Pacífico en esa fecha (PST UTC-8 / PDT UTC-7). */
function desfasePacifico(fechaIso: string): number {
  const d = new Date(fechaIso);
  const pac = new Date(d.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const ar = new Date(d.toLocaleString("en-US", { timeZone: "America/Argentina/Buenos_Aires" }));
  return Math.round((ar.getTime() - pac.getTime()) / 3_600_000);
}

/**
 * Trae online_followers y lo guarda en la ficha. `pedir` es el GET a la Graph API (de meta-cuenta.ts, con el token).
 * Devuelve cuántos días trajo (0 si Meta no lo da para esta cuenta).
 */
export async function guardarHorariosIg(pid: string, igId: string, pedir: (path: string, params: Record<string, string>) => Promise<any>): Promise<number> {
  const hasta = Math.floor(Date.now() / 1000);
  const j = await pedir(`${igId}/insights`, { metric: "online_followers", period: "lifetime", since: String(hasta - 7 * 86_400), until: String(hasta) }).catch(() => null);
  const valores = ((j?.data ?? [])[0]?.values ?? []) as { value?: Record<string, number>; end_time?: string }[];
  const suma = new Array(24).fill(0);
  let dias = 0;
  for (const v of valores) {
    if (!v.value || !Object.keys(v.value).length) continue;
    const desfase = v.end_time ? desfasePacifico(v.end_time) : 4;
    for (const [h, n] of Object.entries(v.value)) {
      const ar = (((Number(h) + desfase) % 24) + 24) % 24;
      suma[ar] += Number(n) || 0;
    }
    dias++;
  }
  if (!dias) return 0;
  await adminDb()
    .collection("projects")
    .doc(pid)
    .update({ ig_horarios: { horas: suma.map((x) => Math.round(x / dias)), dias, at: new Date().toISOString() } });
  return dias;
}
