/* eslint-disable @typescript-eslint/no-explicit-any */
// La misma persona en un solo lead: si escribe por WhatsApp y ya es lead por Instagram (u otro lado) con ese teléfono,
// se suma a ese lead; y si quedaron dos, se unen desde la ficha. También la foto cargada a mano (WhatsApp no da la
// foto de perfil a sistemas externos).

import { borrarDoc, enTransaccion, getPool, guardarDoc, leerDoc } from "./db";
import { adminDb } from "./db";
import { HttpError } from "./http";

const COL = "leads_web";

/** Los últimos 10 dígitos del teléfono (así "+54 9 3482 25-6152" y "3482256152" son el mismo). */
export const claveTelefono = (t: unknown) => {
  const d = String(t ?? "").replace(/\D/g, "");
  return d.length >= 8 ? d.slice(-10) : "";
};

/** El lead que ya tiene ese teléfono (si hay varios, el más nuevo), o null. */
export async function leadPorTelefono(telefono: string, menos?: string): Promise<{ id: string; data: any } | null> {
  const clave = claveTelefono(telefono);
  if (!clave) return null;
  const snap = await adminDb().collection(COL).get();
  const iguales = snap.docs
    .filter((d) => d.id !== menos && claveTelefono(d.data().telefono) === clave)
    .sort((a, b) => String(b.data().updated_at ?? "").localeCompare(String(a.data().updated_at ?? "")));
  return iguales[0] ? { id: iguales[0].id, data: iguales[0].data() } : null;
}

/** Une `otro` en `id`: completa los datos que falten, junta la línea de tiempo y las notas, y borra `otro`. */
export async function unirLeads(id: string, otro: string, quien: { uid: string; nombre: string }) {
  if (!id || !otro || id === otro) throw new HttpError(400, "Elegí dos leads distintos");
  return enTransaccion(async (cli) => {
    const a = (await leerDoc(cli, COL, id, true)) as any;
    const b = (await leerDoc(cli, COL, otro, true)) as any;
    if (!a || !b) throw new HttpError(404, "No encontramos alguno de los dos leads");
    const campos = ["nombre", "email", "telefono", "instagram", "ubicacion", "rubro", "facturacion_label", "inversion_label", "ya_pauto", "cuando"];
    const unido: any = { ...a };
    for (const k of campos) if (!String(unido[k] ?? "").trim() && String(b[k] ?? "").trim()) unido[k] = b[k];
    // Datos de Meta de los dos (conversación de Instagram, WhatsApp, foto…); manda lo del que queda.
    unido.meta = { ...(b.meta ?? {}), ...(a.meta ?? {}) };
    if (!unido.meta.foto && b.meta?.foto) unido.meta.foto = b.meta.foto;
    if (!unido.meta.foto_manual && b.meta?.foto_manual) unido.meta.foto_manual = b.meta.foto_manual;
    if (b.meta?.wa_id) unido.meta.wa_id = b.meta.wa_id;
    unido.notas = [a.notas, b.notas].map((x) => String(x ?? "").trim()).filter(Boolean).join("\n\n").slice(0, 4000);
    const at = new Date().toISOString();
    unido.historial = [...(Array.isArray(a.historial) ? a.historial : []), ...(Array.isArray(b.historial) ? b.historial : [])]
      .filter((h: any) => !(h.de === null && h.a)) // los "Entró como…" del otro se reemplazan por la marca de unión
      .concat([{ at, tipo: "nota", texto: `Se unió con el lead de ${b.fuente || b.negocio || "otro canal"}`, por: quien.uid, por_nombre: quien.nombre }])
      .sort((x: any, y: any) => String(x.at).localeCompare(String(y.at)))
      .slice(-100);
    // Si alguno tenía el "Entró como…" original, va primero.
    const entrada = (Array.isArray(a.historial) ? a.historial : []).find((h: any) => h.de === null && h.a);
    if (entrada) unido.historial.unshift(entrada);
    unido.created_at = [a.created_at, b.created_at].filter(Boolean).sort()[0] ?? a.created_at;
    unido.updated_at = at;
    unido.unidos = [...(Array.isArray(a.unidos) ? a.unidos : []), otro];
    await guardarDoc(cli, COL, id, unido);
    await borrarDoc(cli, COL, otro);
    return { ok: true };
  });
}

/** Foto cargada a mano (data URL chica, ya achicada en el navegador). Vacía: se saca. */
export async function fotoManual(id: string, foto: string) {
  const f = String(foto ?? "");
  if (f && !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(f)) throw new HttpError(400, "Formato de foto inválido");
  if (f.length > 300_000) throw new HttpError(400, "La foto es muy pesada");
  const pool = getPool();
  const d = (await leerDoc(pool, COL, id)) as any;
  if (!d) throw new HttpError(404, "No encontramos ese lead");
  await guardarDoc(pool, COL, id, { ...d, meta: { ...(d.meta ?? {}), foto_manual: f || null }, updated_at: new Date().toISOString() });
  return { ok: true };
}
