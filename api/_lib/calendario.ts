// Google Calendar: reuniones y tareas con fecha van al calendario principal de la cuenta de Google
// conectada en Ajustes (la misma de Drive). Cada participante es invitado (sendUpdates=all): le llega
// la invitación por mail y le aparece en su propio Google Calendar.
//
// Idempotente: el id del evento sale de la clave del documento (siempre el mismo), así que crear dos
// veces actualiza en vez de duplicar. En el documento quedan google_event_id y google_event_hash.
// Si Calendar no está conectado (o la conexión no tiene el permiso), no hace nada (solo log).
// Nunca tira: un error de Google no rompe la acción principal.

import { adminDb, type Data } from "./db";
import { getAppDriveAccessToken } from "./drive-connection";
import { sumarDias, ZONA } from "./fecha";

export const SCOPE_CALENDARIO = "https://www.googleapis.com/auth/calendar.events";
const API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const MAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export interface EventoCalendario {
  /** Clave estable del documento, ej. "reuniones/abc123" o "tareas/xyz". */
  id: string;
  titulo: string;
  descripcion?: string;
  /** ISO con hora, o "YYYY-MM-DD" para un evento de día completo. */
  inicio: string;
  /** ISO / "YYYY-MM-DD". Default: inicio + 60 min, o el día siguiente si es de día completo. */
  fin?: string | null;
  /** Mails de los invitados. */
  emails: string[];
  /** Link absoluto para abrir en Prodi (va en la descripción). */
  link?: string;
  /** Ubicación (ej. el link de la videollamada). */
  ubicacion?: string;
}

/** Id del evento en Google (base32hex: 0-9 y a-v), derivado de la clave del documento. */
export function idEvento(clave: string): string {
  const ALFA = "0123456789abcdefghijklmnopqrstuv";
  let bits = 0;
  let val = 0;
  let out = "";
  for (const b of Buffer.from(clave, "utf8")) {
    val = (val << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALFA[(val >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALFA[(val << (5 - bits)) & 31];
  return `prodi${out}`.slice(0, 1000);
}

/** ¿La conexión de Google tiene el permiso de Calendar? */
export async function calendarioConectado(): Promise<boolean> {
  const c = (await adminDb().collection("app_settings").doc("drive_connection").get()).data();
  return !!c && c.status === "connected" && String(c.scopes ?? "").split(/\s+/).includes(SCOPE_CALENDARIO);
}

async function token(): Promise<string | null> {
  if (!(await calendarioConectado())) {
    console.info("[calendario] Google Calendar sin conectar: se saltea (reconectar Google en Ajustes)");
    return null;
  }
  return (await getAppDriveAccessToken()).accessToken;
}

async function llamar(t: string, metodo: string, url: string, body?: unknown): Promise<Response> {
  return fetch(url, {
    method: metodo,
    headers: { Authorization: `Bearer ${t}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(5_000),
  });
}

const fechaHora = (iso: string) => ({ dateTime: new Date(iso).toISOString(), timeZone: ZONA });

/**
 * Crea o actualiza el evento (mismo `id` → mismo evento). Devuelve el id del evento en Google,
 * o null si no está conectado o falló.
 */
export async function agendarEnCalendario(ev: EventoCalendario): Promise<string | null> {
  try {
    const t = await token();
    if (!t) return null;
    const diaCompleto = FECHA.test(ev.inicio);
    let start: Record<string, string>;
    let end: Record<string, string>;
    if (diaCompleto) {
      start = { date: ev.inicio };
      end = { date: ev.fin && FECHA.test(ev.fin) && ev.fin > ev.inicio ? ev.fin : sumarDias(ev.inicio, 1) };
    } else {
      const ini = new Date(ev.inicio);
      if (Number.isNaN(ini.getTime())) return null;
      const fin = ev.fin ? new Date(ev.fin) : null;
      start = fechaHora(ini.toISOString());
      end = fechaHora((fin && fin > ini ? fin : new Date(ini.getTime() + 60 * 60_000)).toISOString());
    }
    const emails = Array.from(new Set(ev.emails.map((e) => e.trim().toLowerCase()).filter((e) => MAIL_OK.test(e) && !e.endsWith("@prodi.local"))));
    const id = idEvento(ev.id);
    const descripcion = [ev.descripcion, ev.link ? `Abrir en Prodi: ${ev.link}` : ""].filter(Boolean).join("\n\n");
    const cuerpo = {
      id,
      summary: ev.titulo.slice(0, 200),
      description: descripcion.slice(0, 4000),
      location: ev.ubicacion || undefined,
      start,
      end,
      status: "confirmed",
      attendees: emails.map((email) => ({ email })),
      guestsCanSeeOtherGuests: true,
      reminders: { useDefault: true },
      ...(ev.link && /^https:\/\//.test(ev.link) ? { source: { title: "Prodi", url: ev.link } } : {}),
    };
    let r = await llamar(t, "POST", `${API}?sendUpdates=all`, cuerpo);
    // Ya existe (o existió y se canceló): se actualiza y vuelve a quedar confirmado.
    if (r.status === 409) r = await llamar(t, "PUT", `${API}/${id}?sendUpdates=all`, cuerpo);
    if (!r.ok) {
      console.warn("[calendario] no se pudo agendar", ev.id, r.status, (await r.text().catch(() => "")).slice(0, 300));
      return null;
    }
    return id;
  } catch (err) {
    console.warn("[calendario] agendar falló", ev.id, err);
    return null;
  }
}

/** Cancela el evento (a los invitados les llega la cancelación). `clave` = la misma de agendarEnCalendario. */
export async function cancelarEnCalendario(clave: string): Promise<boolean> {
  try {
    const t = await token();
    if (!t) return false;
    const r = await llamar(t, "DELETE", `${API}/${idEvento(clave)}?sendUpdates=all`);
    if (r.ok || r.status === 404 || r.status === 410) return true;
    console.warn("[calendario] no se pudo cancelar", clave, r.status);
    return false;
  } catch (err) {
    console.warn("[calendario] cancelar falló", clave, err);
    return false;
  }
}

async function emailsDe(uids: unknown): Promise<string[]> {
  const ids = Array.isArray(uids) ? Array.from(new Set(uids.filter((u): u is string => typeof u === "string" && !!u))).slice(0, 50) : [];
  const perfiles = await Promise.all(ids.map((u) => adminDb().collection("profiles").doc(u).get()));
  return perfiles
    .map((p) => p.data())
    .filter((p) => p && p.activo !== false && !p.demo_ejemplo)
    .map((p) => String(p!.email ?? ""));
}

/** Arma el evento de una reunión o tarea (null = no va al calendario). */
async function eventoDe(col: "reuniones" | "tareas", id: string, d: Data, baseUrl: string): Promise<EventoCalendario | null> {
  if (col === "reuniones") {
    if (!d.fecha) return null;
    const ini = new Date(String(d.fecha));
    if (Number.isNaN(ini.getTime())) return null;
    const fin = d.fin ? String(d.fin) : new Date(ini.getTime() + (Number(d.duracion_min) || 60) * 60_000).toISOString();
    return {
      id: `reuniones/${id}`,
      titulo: String(d.titulo ?? "Reunión"),
      descripcion: d.link ? `Videollamada: ${d.link}` : undefined,
      inicio: ini.toISOString(),
      fin,
      emails: await emailsDe(d.participantes),
      link: baseUrl ? `${baseUrl}/reuniones?r=${id}` : undefined,
      ubicacion: d.link ? String(d.link) : undefined,
    };
  }
  const vence = String(d.vence ?? "");
  if (!FECHA.test(vence)) return null;
  return {
    id: `tareas/${id}`,
    titulo: `Tarea: ${String(d.titulo ?? "")}`,
    descripcion: d.creada_por_nombre ? `Pedida por ${d.creada_por_nombre}` : undefined,
    inicio: vence,
    emails: await emailsDe(d.asignados),
    link: baseUrl ? `${baseUrl}/chat?tareas=1` : undefined,
  };
}

/**
 * Pone al día el evento de un documento de `reuniones` o `tareas` (crear, mover, cambiar invitados o
 * cancelar si se borró o se le sacó la fecha). Llamarla después de guardar el documento.
 * `antes`: el documento antes del cambio (hace falta cuando se borró, para saber si tenía evento).
 */
export async function sincronizarCalendario(col: "reuniones" | "tareas", id: string, baseUrl: string, antes?: Data | null): Promise<void> {
  try {
    const ref = adminDb().collection(col).doc(id);
    const d = (await ref.get()).data() ?? null;
    const tenia = (d ?? antes)?.google_event_id;
    if (d?.demo_ejemplo || antes?.demo_ejemplo) return;
    const ev = d ? await eventoDe(col, id, d, baseUrl) : null;
    if (!ev) {
      if (tenia && (await cancelarEnCalendario(`${col}/${id}`)) && d) await ref.update({ google_event_id: null, google_event_hash: null });
      return;
    }
    const hash = JSON.stringify([ev.titulo, ev.inicio, ev.fin ?? null, [...ev.emails].sort(), ev.ubicacion ?? null]);
    if (d!.google_event_hash === hash && d!.google_event_id) return;
    const gid = await agendarEnCalendario(ev);
    if (gid) await ref.update({ google_event_id: gid, google_event_hash: hash });
  } catch (err) {
    console.warn("[calendario] sincronizar falló", col, id, err);
  }
}
