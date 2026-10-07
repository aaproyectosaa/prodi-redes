/* eslint-disable @typescript-eslint/no-explicit-any */
// Datos de ejemplo en el sistema real: los mismos clientes, videos, chats y cobros de la demo,
// para mostrar el sistema funcionando. Se cargan y se borran desde Ajustes (solo super admin).
// Cada documento queda marcado con `demo_ejemplo: true` y la lista se guarda en app_settings/demo_ejemplo.

import { adminDb } from "./db";
import { HttpError } from "./auth";
import { seed } from "./ejemplo-datos";

const REGISTRO = "demo_ejemplo";
// No se tocan: la configuración real (Drive, precios) ni el admin real.
const NO_CARGAR = new Set(["app_settings"]);

export async function cargarEjemplo(adminUid: string): Promise<{ documentos: number }> {
  const db = adminDb();
  const reg = db.collection("app_settings").doc(REGISTRO);
  if ((await reg.get()).data()?.cargado_at) throw new HttpError(409, "Los datos de ejemplo ya están cargados");

  // El admin de la demo pasa a ser el admin real (así ve sus chats, avisos y reuniones).
  const datos = JSON.parse(JSON.stringify(seed()).split('"u_lucas"').join(JSON.stringify(adminUid))) as Record<
    string,
    Record<string, any>
  >;

  const ids: Record<string, string[]> = {};
  const escrituras: { path: string; data: any }[] = [];
  for (const [col, docs] of Object.entries(datos)) {
    if (NO_CARGAR.has(col)) continue;
    for (const [id, data] of Object.entries(docs)) {
      if (col === "profiles") {
        if (id === adminUid) continue; // el perfil real no se pisa
        data.nombre = `${data.nombre} · ejemplo`;
        data.email = `ejemplo+${id}@prodi.local`;
        data.email_avisos = false;
        data.push_enabled = false;
      }
      if (col === "projects") data.contacto_emails = []; // que el informe no le llegue a nadie
      escrituras.push({ path: `${col}/${id}`, data: { ...data, demo_ejemplo: true } });
      (ids[col] ??= []).push(id);
    }
  }

  for (let i = 0; i < escrituras.length; i += 400) {
    const batch = db.batch();
    for (const w of escrituras.slice(i, i + 400)) batch.set(db.doc(w.path), w.data);
    await batch.commit();
  }
  await reg.set({ cargado_at: new Date().toISOString(), cargado_por: adminUid, ids: JSON.stringify(ids) });
  return { documentos: escrituras.length };
}

export async function borrarEjemplo(): Promise<{ documentos: number }> {
  const db = adminDb();
  const reg = db.collection("app_settings").doc(REGISTRO);
  const data = (await reg.get()).data();
  if (!data?.ids) throw new HttpError(404, "No hay datos de ejemplo cargados");
  const ids = JSON.parse(String(data.ids)) as Record<string, string[]>;
  const paths: string[] = [];
  for (const [col, lista] of Object.entries(ids)) for (const id of lista) paths.push(`${col}/${id}`);
  // Lo que se haya creado después sobre esos clientes (videos nuevos, mensajes) también se va.
  const proyectos = ids.projects ?? [];
  proyectos.forEach((pid) => paths.push(`ia_memoria/${pid}`));
  for (const col of ["videos", "rodajes", "piezas_ia", "cobros", "reuniones", "planes_mes", "facturas"]) {
    for (let i = 0; i < proyectos.length; i += 10) {
      const q = await db.collection(col).where("proyecto_id", "in", proyectos.slice(i, i + 10)).get();
      q.docs.forEach((d) => paths.push(`${col}/${d.id}`));
    }
  }
  for (const chatId of ids.chats ?? []) {
    for (const sub of ["mensajes", "audios"]) {
      const ms = await db.collection(`chats/${chatId}/${sub}`).get();
      ms.docs.forEach((d) => paths.push(`chats/${chatId}/${sub}/${d.id}`));
    }
  }
  const unicos = Array.from(new Set(paths));
  for (let i = 0; i < unicos.length; i += 400) {
    const batch = db.batch();
    for (const p of unicos.slice(i, i + 400)) batch.delete(db.doc(p));
    await batch.commit();
  }
  await reg.delete();
  return { documentos: unicos.length };
}
