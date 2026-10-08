// Avisos: in-app + push (Web Push) + correo. Usado por /api/avisos y por los procesos del servidor
// (pagos, informes, chat, tareas, cron diario).

import { adminDb } from "./db";
import { enviarPush } from "./push";
import { enviarMailsLote, type MailLote } from "./informe";
import { mailAvisoHtml } from "./mail-aviso";
import { sinDisenadora } from "./http";

export interface AvisoServer {
  destinatarios: string[];
  titulo: string;
  cuerpo: string;
  link: string;
  clave: string;
  proyectoId?: string | null;
  videoId?: string | null;
  /** false: no mandar el correo genérico (el evento ya manda su propio mail). */
  mail?: boolean;
}

const IN_APP = "in_app_notifications";
/** Avisos que ya mandan su mail propio (boleta emitida, recordatorio de cobro): no se duplica el correo. */
const CON_MAIL_PROPIO = ["factura:", "cobro:"];
const MAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function enviarAviso(aviso: AvisoServer, baseUrl: string): Promise<void> {
  const db = adminDb();
  const now = new Date().toISOString();
  const destinatarios = Array.from(new Set(aviso.destinatarios.filter(Boolean))).slice(0, 50);
  let conMail = aviso.mail !== false && !CON_MAIL_PROPIO.some((p) => aviso.clave.startsWith(p));
  // Reunión o tarea que ya está en Google Calendar: la invitación de Google ya es el correo.
  const cal = /^(reunion|tarea):([^:/]+)$/.exec(aviso.clave);
  if (conMail && cal) {
    const d = await db.collection(cal[1] === "reunion" ? "reuniones" : "tareas").doc(cal[2]).get().catch(() => null);
    if (d?.data()?.google_event_id) conMail = false;
  }
  const mails: MailLote[] = [];

  await Promise.all(
    destinatarios.map(async (uid) => {
      const dedupe = `${aviso.clave}:${uid}`;
      // 1) In-app (dedupe: si hay uno sin leer con la misma clave, se actualiza)
      let yaSinLeer = false;
      try {
        const existing = await db
          .collection(IN_APP)
          .where("recipient_user_id", "==", uid)
          .where("dedupe_key", "==", dedupe)
          .limit(3)
          .get();
        const unread = existing.docs.find((d) => d.data().read !== true);
        yaSinLeer = !!unread;
        const data = {
          type: "prodi",
          recipient_user_id: uid,
          title: aviso.titulo,
          body: aviso.cuerpo,
          link: aviso.link,
          task_id: aviso.videoId ?? null,
          project_id: aviso.proyectoId ?? null,
          read: false,
          available_at: now,
          dedupe_key: dedupe,
        };
        if (unread) await unread.ref.update({ ...data, updated_at: now });
        else await db.collection(IN_APP).add({ ...data, created_at: now });
      } catch (err) {
        console.warn("[aviso] in-app falló", dedupe, err);
      }

      // 2) Push y correo según el perfil
      try {
        const snap = await db.collection("profiles").doc(uid).get();
        const p = snap.data() ?? {};
        const url = `${baseUrl}${aviso.link}`;

        if (p.push_enabled) await enviarPush(uid, { title: aviso.titulo, body: aviso.cuerpo, url, tag: dedupe });

        // Correo: uno por aviso nuevo. Si ya tenía uno sin leer con la misma clave (ej. varios mensajes
        // del mismo chat), no se repite: el primero ya le llegó y todavía no lo abrió.
        const email = String(p.email ?? "").trim().toLowerCase();
        if (
          conMail &&
          !yaSinLeer &&
          p.email_avisos !== false &&
          p.activo !== false &&
          !p.demo_ejemplo &&
          MAIL_OK.test(email) &&
          !email.endsWith("@prodi.local")
        ) {
          mails.push({
            to: email,
            asunto: aviso.titulo,
            html: mailAvisoHtml({ titulo: aviso.titulo, cuerpo: aviso.cuerpo, link: url, baseUrl, nombre: String(p.nombre ?? "") }),
          });
        }
      } catch (err) {
        console.warn("[aviso] push falló", dedupe, err);
      }
    })
  );

  // 3) Correos: después de guardar todo, en un solo pedido a Resend. Si falla, solo queda en el log.
  if (mails.length) await enviarMailsLote(mails).catch((err) => console.warn("[aviso] correo falló", aviso.clave, err));
}

/** IDs de admins + equipo de un rol en un cliente. */
export async function destinatariosDe(proyectoId: string, roles: string[], incluirAdmins = true): Promise<string[]> {
  const db = adminDb();
  const out = new Set<string>();
  const snap = await db.collection("projects").doc(proyectoId).get();
  const team = (snap.data()?.team_roles ?? {}) as Record<string, string[]>;
  for (const r of roles) for (const id of team[r] ?? []) out.add(id);
  if (incluirAdmins) {
    const admins = await db.collection("profiles").where("role", "==", "admin").get();
    admins.docs.forEach((d) => out.add(d.id));
  }
  return Array.from(out);
}

/**
 * Diseñadoras de un cliente (activas): las asignadas en su ficha (team_roles.diseno).
 * Si el cliente todavía no tiene ninguna asignada, todas las de diseño (como antes).
 */
export async function disenadorasDe(proyectoId: string | null | undefined): Promise<string[]> {
  const todas = await usuariosConRol(["diseno"]);
  if (!proyectoId) return todas;
  const team = (await adminDb().collection("projects").doc(proyectoId).get()).data()?.team_roles;
  if (sinDisenadora(team)) return todas;
  const asignadas = (team as Record<string, unknown>).diseno as unknown[];
  return todas.filter((id) => asignadas.includes(id));
}

/** IDs de los usuarios con alguno de esos roles. */
export async function usuariosConRol(roles: string[]): Promise<string[]> {
  if (!roles.length) return [];
  const snap = await adminDb().collection("profiles").where("role", "in", roles.slice(0, 10)).get();
  return snap.docs.filter((d) => d.data().activo !== false).map((d) => d.id);
}
