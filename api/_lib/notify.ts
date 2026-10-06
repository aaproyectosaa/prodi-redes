// Avisos: in-app + push (Web Push) + cola de WhatsApp. Usado por /api/avisos y
// por los procesos del servidor (pagos, informes).

import { adminDb } from "./db";
import { enviarPush } from "./push";

export interface AvisoServer {
  destinatarios: string[];
  titulo: string;
  cuerpo: string;
  link: string;
  clave: string;
  proyectoId?: string | null;
  videoId?: string | null;
}

const IN_APP = "in_app_notifications";

export async function enviarAviso(aviso: AvisoServer, baseUrl: string): Promise<void> {
  const db = adminDb();
  const now = new Date().toISOString();
  const destinatarios = Array.from(new Set(aviso.destinatarios.filter(Boolean))).slice(0, 50);

  await Promise.all(
    destinatarios.map(async (uid) => {
      const dedupe = `${aviso.clave}:${uid}`;
      // 1) In-app (dedupe: si hay uno sin leer con la misma clave, se actualiza)
      try {
        const existing = await db
          .collection(IN_APP)
          .where("recipient_user_id", "==", uid)
          .where("dedupe_key", "==", dedupe)
          .limit(3)
          .get();
        const unread = existing.docs.find((d) => d.data().read !== true);
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

      // 2) Push y WhatsApp según el perfil
      try {
        const snap = await db.collection("profiles").doc(uid).get();
        const p = snap.data() ?? {};
        const url = `${baseUrl}${aviso.link}`;

        if (p.push_enabled) await enviarPush(uid, { title: aviso.titulo, body: aviso.cuerpo, url, tag: dedupe });

        const phone = String(p.whatsapp_phone ?? "").replace(/\D/g, "");
        if (p.whatsapp_enabled && phone && p.whatsapp_phone_verified !== false) {
          // El bot de WhatsApp lee esta cola. Para type "prodi_aviso" debe
          // mandar payload.text tal cual (ver docs/DESPLIEGUE.md).
          await db.collection("notification_queue").add({
            type: "prodi_aviso",
            task_id: aviso.videoId ?? null,
            recipient_user_id: uid,
            phone,
            send_whatsapp: true,
            send_push: false,
            payload: {
              text: `*${aviso.titulo}*\n${aviso.cuerpo}\n${url}`,
              title: aviso.titulo,
              body: aviso.cuerpo,
              url,
            },
            dedupe_key: dedupe,
            scheduled_at: now,
            status: "pending",
            created_at: now,
          });
        }
      } catch (err) {
        console.warn("[aviso] push/whatsapp falló", dedupe, err);
      }
    })
  );
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

/** IDs de los usuarios con alguno de esos roles (ej. "diseno": Karen hace la gráfica de todos los clientes). */
export async function usuariosConRol(roles: string[]): Promise<string[]> {
  if (!roles.length) return [];
  const snap = await adminDb().collection("profiles").where("role", "in", roles.slice(0, 10)).get();
  return snap.docs.filter((d) => d.data().activo !== false).map((d) => d.id);
}
