// Tareas (colección `tareas`): las crea @prodi desde el chat ("recordale a Lucía que mande el guion el viernes").
// Las ven quienes las tienen asignadas, quien las pidió y el admin (api/_lib/reglas.ts). Se marcan hechas desde la app.

import { adminDb } from "./db";
import { enviarAviso } from "./notify";
import { fechaAR, sumarDias } from "./fecha";
import { sincronizarCalendario } from "./calendario";

export interface NuevaTarea {
  titulo: string;
  asignados: string[];
  /** YYYY-MM-DD o null. */
  vence: string | null;
  creada_por: string;
  creada_por_nombre: string;
  chat_id: string | null;
  proyecto_id: string | null;
}

const fechaCorta = (f: string) => `${Number(f.slice(8, 10))}/${Number(f.slice(5, 7))}`;

export async function crearTarea(t: NuevaTarea, baseUrl: string): Promise<string> {
  const ref = adminDb().collection("tareas").doc();
  await ref.create({
    ...t,
    titulo: t.titulo.slice(0, 200),
    asignados: Array.from(new Set(t.asignados)),
    // Día completo en hora de AR (ISO), para calendario: de 00:00 del día que vence a 00:00 del siguiente.
    vence_inicio: t.vence ? new Date(`${t.vence}T00:00:00-03:00`).toISOString() : null,
    vence_fin: t.vence ? new Date(`${sumarDias(t.vence, 1)}T00:00:00-03:00`).toISOString() : null,
    hecha: false,
    hecha_at: null,
    hecha_por: null,
    recordada: null,
    origen: "prodi",
    created_at: new Date().toISOString(),
  });
  // Con fecha: evento de día completo en Google Calendar (invitación a los asignados). Nunca tira.
  if (t.vence) await sincronizarCalendario("tareas", ref.id, baseUrl);
  const otros = t.asignados.filter((u) => u !== t.creada_por);
  if (otros.length) {
    await enviarAviso(
      {
        destinatarios: otros,
        titulo: "Tarea nueva",
        cuerpo: `${t.creada_por_nombre || "Te pidieron"}: ${t.titulo.slice(0, 120)}${t.vence ? ` · para el ${fechaCorta(t.vence)}` : ""}`,
        link: "/chat?tareas=1",
        clave: `tarea:${ref.id}`,
        proyectoId: t.proyecto_id,
      },
      baseUrl
    ).catch((err) => console.warn("[tareas] aviso falló", err));
  }
  return ref.id;
}

/** Cron diario: avisa las tareas sin hacer que vencen hoy (una vez). */
export async function recordatoriosTareas(baseUrl: string): Promise<string> {
  const db = adminDb();
  const hoy = fechaAR();
  const snap = await db.collection("tareas").where("hecha", "==", false).where("vence", "==", hoy).get();
  let n = 0;
  for (const d of snap.docs) {
    const t = d.data()!;
    if (t.recordada === hoy) continue;
    await d.ref.update({ recordada: hoy });
    await enviarAviso(
      {
        destinatarios: (t.asignados ?? []) as string[],
        titulo: "Tarea para hoy",
        cuerpo: String(t.titulo ?? "").slice(0, 140),
        link: "/chat?tareas=1",
        clave: `tarea:${d.id}`,
        proyectoId: (t.proyecto_id as string | null) ?? null,
      },
      baseUrl
    ).catch(() => undefined);
    n++;
  }
  return `${n} avisadas`;
}
