/* eslint-disable @typescript-eslint/no-explicit-any */
/* /api simulado para la demo: IA, Mercado Pago e informes sin servidor. */
import { addDoc, arrayRemove, arrayUnion, collection, deleteDoc, demoStore, doc, increment, setDoc, updateDoc } from "./firestore-mock";
import { renderInformeHtml } from "../api/_lib/informe-html";
import { FORMATOS_PIEZA, leerPedidoPieza, piezaDoc, precioPieza } from "../api/_lib/piezas";
import { armarFactura, totalMensual } from "../api/_lib/facturacion";
import {
  limpiarComercial,
  aprendizajeAjuste,
  aprendizajeCliente,
  aprendizajeEquipo,
  fechasDelMes,
  limpiarIdeas,
  nombreMes,
  nuevoIdIdea,
  sumarEjemplo,
  type EjemploMemoria,
  type IdeaPlan,
  type MemoriaIA,
} from "../api/_lib/plan-mes";
import { asset } from "@/lib/asset";

const db = {};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

async function prepararDemo(mes: string, proyectoIds: string[] | null) {
      const settings = demoStore.get("app_settings", "redes") ?? {};
      const hoy = new Date().toISOString().slice(0, 10);
      let creadas = 0;
      let existentes = 0;
      const elegidos: string[] | null = proyectoIds?.length ? proyectoIds : null;
      for (const p of demoStore.all("projects")) {
        if (p.enabled === false) continue;
        if (elegidos && !elegidos.includes(p.id)) continue;
        const plan = demoStore.get("planes_redes", p.plan_redes_id);
        const abono = p.plan_redes_override?.precio_mensual ?? plan?.precio_mensual ?? 0;
        if (!elegidos && !plan && !abono) continue;
        if (!elegidos && p.facturacion?.pausada) continue;
        const id = `${p.id}_${mes}`;
        if (demoStore.get("facturas", id)) {
          existentes++;
          continue;
        }
        const debitado = demoStore.all("cobros").some((c: any) => c.proyecto_id === p.id && c.tipo === "abono" && c.ref_id === mes && c.estado === "aprobado");
        const f = armarFactura(
          { id: p.id, nombre: p.nombre, abono, planNombre: plan?.nombre, facturacion: p.facturacion, debitoActivo: p.suscripcion?.estado === "activa", abonoDebitado: debitado },
          mes,
          { ivaPct: settings.iva_pct ?? 21, diaVencimiento: settings.dia_vencimiento ?? 5, por: "u_lucas", hoy }
        );
        await setDoc(doc(db, "facturas", id), f);
        creadas++;
      }
  return { creadas, existentes };
}

export async function callApi<T = unknown>(path: string, body: Record<string, any> = {}): Promise<T> {
  const r = await handle(path, body);
  return r as T;
}

/** En la demo el "token" del link de aprobación es el id del video en base64. */
const tokenDemo = (id: string) => btoa(id).replace(/=+$/, "");
const leerTokenDemo = (t: string) => {
  try {
    return atob(t);
  } catch {
    return "";
  }
};

export async function callPublico<T = unknown>(path: string, body: Record<string, any> = {}): Promise<T> {
  return (await handle(path, body)) as T;
}

export function urlMediaPublica(_token: string, fileId: string, mime: string): { url: string; tipo: "video" | "imagen" } {
  if (fileId.startsWith("demo/")) return { url: asset(fileId), tipo: "imagen" };
  return { url: fileId.startsWith("blob:") ? fileId.slice(5) : fileId, tipo: mime.startsWith("image/") ? "imagen" : "video" };
}

export async function imagenParaSubir(file: File, max = 420): Promise<{ data: string; mime: string; nombre: string }> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * k);
  canvas.height = Math.round(bmp.height * k);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return { data: canvas.toDataURL("image/png"), mime: "image/png", nombre: file.name };
}

/** Lo que cobra el débito: el total de la boleta (con IVA y extras fijos), igual que en el servidor. */
function precioAbonoDemo(pid: string): number {
  const p = demoStore.get("projects", pid);
  const plan = demoStore.get("planes_redes", p?.plan_redes_id);
  const settings = demoStore.get("app_settings", "redes") ?? {};
  const abono = Number(p?.plan_redes_override?.precio_mensual ?? plan?.precio_mensual ?? 0);
  return abono > 0 ? totalMensual({ abono, facturacion: p?.facturacion ?? null }, settings.iva_pct ?? 21) : 0;
}

async function videoPublico(t: string) {
  const id = leerTokenDemo(t);
  const v = demoStore.get("videos", id);
  if (!v) throw new Error("Link inválido");
  const p = demoStore.get("projects", v.proyecto_id) ?? {};
  const estado =
    v.etapa === "revision_cliente" ? "para_aprobar"
    : v.etapa === "para_publicar" || v.etapa === "publicado" ? "aprobado"
    : v.etapa === "edicion" && v.feedback_cliente ? "en_cambios" : "en_proceso";
  return {
    id, titulo: v.titulo, cliente: { nombre: p.nombre, color: p.color }, estado,
    idea: v.idea, copy: estado === "en_proceso" ? null : v.copy, rondas: v.rondas ?? 0,
    final: estado === "en_proceso" ? [] : (v.attachments_finalizado ?? []).map((a: any) => ({ drive_file_id: a.drive_file_id, name: a.name, mime_type: a.mime_type })),
  };
}

function videoPedidoDemo(pid: string, mes: string, p: any, nota: string) {
  const team = demoStore.get("projects", pid)?.team_roles ?? {};
  const ts = new Date().toISOString();
  return {
    proyecto_id: pid, titulo: p.titulo, idea: p.idea, objetivo: p.objetivo, referencias: null, mes, extra: false,
    etapa: "planificado", etapa_desde: ts, rodaje_id: null, productor_id: team.productor?.[0] ?? null,
    editor_id: team.editor?.[0] ?? null, pauta_id: team.pauta?.[0] ?? null, attachments_crudo: [], attachments_finalizado: [],
    copy: null, feedback_interno: null, feedback_cliente: null, rondas: 0, cliente_rating: null, publicacion: null, pauta: null,
    resultados: null, meta: null, pedido_cliente: true, fecha_deseada: p.fecha_deseada ?? null, historial: [{ at: ts, by: p.pedido_por, accion: nota, nota: null }],
    created_at: ts, created_by: p.pedido_por, updated_at: ts,
  };
}

async function aprobarCobro(id: string) {
  const c = demoStore.get("cobros", id);
  if (!c || c.estado === "aprobado") return;
  await updateDoc(doc(db, "cobros", id), { estado: "aprobado", pagado_at: new Date().toISOString(), mp_payment_id: String(Date.now()) });
  if (c.tipo === "pieza_ia") await updateDoc(doc(db, "piezas_ia", c.ref_id), { estado: "pagada" });
  else await updateDoc(doc(db, "projects", c.proyecto_id), { [`creditos_extra.${c.ref_id}`]: increment(c.cantidad) });
  if (c.pedido) await setDoc(doc(db, "videos", `pedido_${id}`), videoPedidoDemo(c.proyecto_id, c.ref_id, c.pedido, "Pedido y pagado por el cliente (video extra)"));
}

// ---- Plan del mes (sin IA real: ideas de un banco, filtrando lo que se descartó) ----

function bancoIdeas(p: any, mes: string): Omit<IdeaPlan, "id" | "origen">[] {
  const rubro = String(p?.marca?.rubro ?? "tu rubro").toLowerCase();
  const nombre = p?.nombre ?? "la marca";
  const fecha = fechasDelMes(mes)[0];
  const lista = [
    ...(fecha
      ? [{ titulo: `Especial ${fecha.replace(/ \(.*\)/, "")}`, idea: `Video pensado para ${fecha}: arrancamos con una pregunta que enganche ("¿Ya sabés qué vas a hacer?"), mostramos 3 propuestas de ${nombre} en tomas cortas y cerramos con "Reservá o pedí por WhatsApp".`, objetivo: "Conseguir mensajes por la fecha", porque: `Es la fecha comercial más fuerte de ${nombreMes(mes).split(" ")[0]} y la gente busca ideas esos días.` }]
      : []),
    { titulo: "Un día detrás del mostrador", idea: `Arrancamos con la persiana subiendo y mostramos en tomas cortas cómo se prepara todo antes de abrir. Cierra con el equipo saludando: "Te esperamos".`, objetivo: "Mostrar el local y generar confianza", porque: "Los detrás de escena suelen traer más mensajes que las promos solas." },
    { titulo: "Lo más pedido del mes", idea: `Top 3 de lo que más sale en ${nombre}, con un plano lindo de cada uno y el número en pantalla. Cierre: "¿Cuál es el tuyo? Escribinos".`, objetivo: "Conseguir pedidos por WhatsApp", porque: "Los rankings se miran hasta el final y generan comentarios." },
    { titulo: "Clientes que vuelven", idea: "Tres clientes habituales dicen en una frase por qué vuelven. Sin guion, natural, mirando a cámara. Cierre con el logo.", objetivo: "Generar confianza", porque: "El testimonio fue de lo que mejor funcionó en otros clientes del rubro." },
    { titulo: "Respondemos la pregunta de siempre", idea: `La pregunta que más les hacen por WhatsApp aparece escrita en pantalla y alguien del equipo la responde a cámara en 15 segundos, mostrando el producto.`, objetivo: "Sacar dudas y conseguir mensajes", porque: "Ahorra mensajes repetidos y le da cara a la marca." },
    { titulo: "Antes y después", idea: `Mostramos el proceso de ${rubro} de principio a fin en cámara rápida, con un corte justo en el momento del resultado final.`, objetivo: "Mostrar calidad", porque: "Los videos de proceso retienen mucho y funcionan bien en Reels." },
    { titulo: "Conocé al equipo", idea: "Cada persona del equipo dice su nombre y qué hace en 3 segundos, con un gesto o chiste propio. Cierra todo el equipo junto.", objetivo: "Humanizar la marca", porque: "Acerca a la gente y suele tener muchas interacciones." },
    { titulo: "La promo de la semana", idea: "Promo a definir con el cliente. Gancho con el precio tachado en pantalla, producto en primer plano y cuenta regresiva de los días que dura.", objetivo: "Vender", porque: "Una promo concreta con fecha límite empuja a escribir." },
    { titulo: "Tres cosas que no sabías", idea: `Tres datos curiosos de ${nombre} (de dónde viene el nombre, un secreto de la casa, algo del equipo) con texto en pantalla y tomas del local.`, objetivo: "Generar interés", porque: "Formato de curiosidades: mucho guardado y compartido." },
    { titulo: "Unboxing del pedido", idea: "Seguimos un pedido desde que se arma hasta que lo abre el cliente en su casa. Plano cenital al abrirlo y reacción.", objetivo: "Conseguir pedidos", porque: "Muestra el servicio completo, no solo el producto." },
    { titulo: "El error más común", idea: `Alguien del equipo cuenta el error más común que comete la gente con ${rubro} y cómo evitarlo. Cierre: "Si tenés dudas, escribinos".`, objetivo: "Posicionarse como expertos", porque: "Los consejos útiles se guardan y traen consultas." },
  ];
  return lista;
}

function ideasDemo(p: any, mes: string, cantidad: number, evitar: string[], memoria: MemoriaIA | null, pista?: string | null): IdeaPlan[] {
  const fuera = new Set(
    [...evitar, ...(memoria?.ejemplos ?? []).flatMap((e: EjemploMemoria) => e.descartadas ?? [])].map((x) => x.toLowerCase().trim())
  );
  const usados = new Set(demoStore.all("videos").filter((v: any) => v.proyecto_id === p?.id).map((v: any) => String(v.titulo).toLowerCase()));
  const banco = bancoIdeas(p, mes).filter((i) => !fuera.has(i.titulo.toLowerCase()) && !usados.has(i.titulo.toLowerCase()));
  // Mezcla para que "otra idea" traiga algo distinto.
  const mezcla = banco.map((i) => ({ i, k: Math.random() })).sort((a, b) => a.k - b.k).map((x) => x.i);
  return mezcla.slice(0, cantidad).map((i) => ({
    ...i,
    id: nuevoIdIdea(),
    origen: "ia" as const,
    porque: pista ? `Pediste: "${pista}". ${i.porque}` : memoria?.notas_equipo ? `${i.porque} Respeta las indicaciones del equipo.` : i.porque,
  }));
}

/** Resumen de lo aprendido sin IA (en el sistema real lo escribe Gemini). */
function resumenDemo(m: MemoriaIA): string {
  const ej = m.ejemplos ?? [];
  const lineas: string[] = [];
  const corto = (s: string) => s.split(":")[0].trim();
  const aprob = ej.flatMap((e) => e.aprobadas ?? []);
  const desc = ej.flatMap((e) => e.descartadas ?? []);
  const edit = ej.flatMap((e) => e.editadas ?? []);
  const ok = ej.flatMap((e) => e.cliente_ok ?? []);
  const cambios = ej.flatMap((e) => e.cliente_cambios ?? []);
  if (ok.length) lineas.push(`- Al cliente le gustan ideas como “${ok.slice(-3).join("”, “")}”.`);
  for (const c of cambios.slice(-2)) lineas.push(`- El cliente pidió en “${c.titulo}”: ${c.comentario}`);
  for (const e of edit.slice(-2)) lineas.push(`- Producción ajustó “${corto(e.antes)}” → “${corto(e.despues)}”: seguir ese enfoque.`);
  if (desc.length) lineas.push(`- Evitar: “${Array.from(new Set(desc)).slice(-4).join("”, “")}”.`);
  if (aprob.length) lineas.push(`- Quedan tal cual ideas como “${aprob.slice(-3).join("”, “")}”.`);
  return lineas.slice(0, 8).join("\n");
}

async function aprenderDemo(pid: string, e: EjemploMemoria) {
  const m = (demoStore.get("ia_memoria", pid) ?? {}) as MemoriaIA;
  const ejemplos = sumarEjemplo(m, e);
  await setDoc(doc(db, "ia_memoria", pid), { ...m, proyecto_id: pid, ejemplos, resumen: resumenDemo({ ...m, ejemplos }), actualizado_at: new Date().toISOString() });
}

function libresDemo(pid: string, mes: string) {
  const proj = demoStore.get("projects", pid);
  const plan = demoStore.get("planes_redes", proj?.plan_redes_id) ?? {};
  const cupo = (proj?.plan_redes_override?.videos_mes ?? plan.videos_mes ?? 0) + (proj?.creditos_extra?.[mes] ?? 0);
  const usados = demoStore.all("videos").filter((v: any) => v.proyecto_id === pid && v.mes === mes && !v.extra).length;
  return Math.max(0, cupo - usados);
}

function videoPlanDemo(pid: string, mes: string, i: { titulo: string; idea: string | null; objetivo: string | null }, by: string, nota: string, comentario: string | null, ideaId: string) {
  const v: any = videoPedidoDemo(pid, mes, { ...i, pedido_por: by }, nota);
  v.pedido_cliente = false;
  v.plan_idea_id = ideaId;
  v.historial[0].nota = comentario;
  return v;
}

async function handle(path: string, b: Record<string, any>): Promise<unknown> {
  switch (path) {
    case "/api/avisos":
      return { ok: true };

    // ---- Aprobación por link ----
    case "/api/publico/link":
      await wait(300);
      return { url: `${window.location.href.split("#")[0]}#/aprobar/${tokenDemo(b.video_id)}` };
    case "/api/publico/video":
      await wait(400);
      return videoPublico(b.t);
    case "/api/publico/responder": {
      await wait(600);
      const id = leerTokenDemo(b.t);
      const v = demoStore.get("videos", id);
      if (!v || v.etapa !== "revision_cliente") throw new Error("Este video ya fue respondido");
      const p = demoStore.get("projects", v.proyecto_id) ?? {};
      const by = p.team_roles?.cliente?.[0] ?? "cliente";
      const ts = new Date().toISOString();
      if (b.decision === "aprobar") {
        await updateDoc(doc(db, "videos", id), {
          etapa: "para_publicar", etapa_desde: ts, updated_at: ts, feedback_cliente: null, cliente_rating: b.rating ?? null,
          historial: arrayUnion({ at: ts, by, accion: "Aprobado por el cliente (desde el link)", nota: null }),
        });
      } else {
        await updateDoc(doc(db, "videos", id), {
          etapa: "edicion", etapa_desde: ts, updated_at: ts, feedback_cliente: b.nota, feedback_interno: null, feedback_marcas: null,
          rondas: increment(1), cliente_rating: b.rating ?? null,
          historial: arrayUnion({ at: ts, by, accion: "El cliente pidió cambios (desde el link)", nota: b.nota }),
        });
      }
      return { ok: true };
    }

    // ---- Resultados de Meta ----
    case "/api/informes/meta": {
      await wait(900);
      const v = demoStore.get("videos", b.video_id);
      if (!v?.meta?.ad_id) throw new Error("Este video no tiene el ID del anuncio de Meta");
      const base = v.resultados ?? {};
      const crece = (x: number | null | undefined, min: number) => Math.round((x ?? min) * (1.04 + Math.random() * 0.08));
      const resultados = {
        alcance: crece(base.alcance, 8000), impresiones: crece(base.impresiones, 14000),
        reproducciones: crece(base.reproducciones, 5000), interacciones: crece(base.interacciones, 300),
        mensajes: crece(base.mensajes, 25), clics: crece(base.clics, 120), gasto: crece(base.gasto, 30000),
        actualizado_at: new Date().toISOString(), actualizado_por: "meta",
      };
      await updateDoc(doc(db, "videos", b.video_id), { resultados });
      return { ok: true, resultados };
    }

    // ---- Débito automático ----
    case "/api/pagos/suscribir": {
      await wait(700);
      const monto = precioAbonoDemo(b.proyecto_id);
      const ts = new Date().toISOString();
      await updateDoc(doc(db, "projects", b.proyecto_id), {
        suscripcion: { mp_preapproval_id: `pre_${Date.now()}`, estado: "activa", monto, payer_email: b.email, init_point: null, creada_at: ts, actualizada_at: ts, ultimo_pago_at: ts },
      });
      const d = new Date();
      await setDoc(doc(db, "cobros", `abono_${Date.now()}`), {
        proyecto_id: b.proyecto_id, tipo: "abono", concepto: `Abono ${MESES[d.getMonth()]} ${d.getFullYear()} · débito automático`,
        ref_id: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, cantidad: 1, monto, moneda: "ARS",
        estado: "aprobado", mp_payment_id: String(Date.now()), created_by: "mercadopago", created_at: ts, pagado_at: ts,
      });
      return { init_point: "#/cliente?tab=plan&suscripcion=ok" };
    }
    case "/api/pagos/suscripcion": {
      await wait(500);
      if (b.accion === "cancelar") await updateDoc(doc(db, "projects", b.proyecto_id), { "suscripcion.estado": "cancelada" });
      else await updateDoc(doc(db, "projects", b.proyecto_id), { "suscripcion.monto": precioAbonoDemo(b.proyecto_id) });
      return { ok: true };
    }

    // ---- Marca, guion y rodaje ----
    case "/api/ia/marca-subir": {
      await wait(500);
      const att = { drive_file_id: b.data, name: b.nombre ?? "imagen.png", mime_type: b.mime, web_view_link: "#", size: 0, uploaded_at: new Date().toISOString(), uploaded_by: "demo", folder_path: "Progreso/Marca" };
      if (b.tipo === "logo") await updateDoc(doc(db, "projects", b.proyecto_id), { "marca_archivos.logo": att });
      else await updateDoc(doc(db, "projects", b.proyecto_id), { "marca_archivos.referencias": arrayUnion(att) });
      return { ok: true, archivo: att };
    }
    case "/api/ia/marca-info": {
      await wait(400);
      const datos: Record<string, string> = { "marca.rubro": b.rubro, "marca.descripcion": b.descripcion };
      if (b.publico) datos["marca.publico"] = b.publico;
      if (b.colores) datos["marca.colores"] = b.colores;
      if (b.instagram) datos["redes.instagram"] = b.instagram;
      await updateDoc(doc(db, "projects", b.proyecto_id), datos);
      return { ok: true };
    }
    case "/api/ia/marca-colores": {
      await wait(300);
      const paleta = (b.paleta ?? []).filter((c: string) => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 12);
      await updateDoc(doc(db, "projects", b.proyecto_id), { "marca.paleta": paleta, "marca.colores": paleta.join(", ") });
      return { ok: true, paleta };
    }
    case "/api/ia/marca-quitar": {
      const p = demoStore.get("projects", b.proyecto_id) ?? {};
      if (b.tipo === "logo") await updateDoc(doc(db, "projects", b.proyecto_id), { "marca_archivos.logo": null });
      else await updateDoc(doc(db, "projects", b.proyecto_id), { "marca_archivos.referencias": (p.marca_archivos?.referencias ?? []).filter((r: any) => r.drive_file_id !== b.drive_file_id) });
      return { ok: true };
    }
    case "/api/ia/guion": {
      await wait(1400);
      const v = demoStore.get("videos", b.video_id) ?? {};
      const p = demoStore.get("projects", v.proyecto_id) ?? {};
      const out = {
        guion: `Escena 1 (0-3 s) · Gancho: primer plano del producto con texto en pantalla "${String(v.titulo ?? "").toUpperCase()}".\nEscena 2 (3-12 s) · Mostramos el local y a la persona que atiende contando en una frase qué lo hace distinto.\nEscena 3 (12-25 s) · Detalles: manos trabajando, producto terminado, cliente disfrutándolo.\nEscena 4 (25-30 s) · Cierre con logo de ${p.nombre ?? "la marca"} y llamado a la acción: "Escribinos por WhatsApp".`,
        tomas: [
          "Plano detalle del producto estrella (cenital y a 45°)",
          "Plano general de la fachada con el cartel",
          "Persona que atiende hablando a cámara (2 o 3 tomas)",
          "Manos preparando / armando el producto",
          "Cliente recibiendo el producto y sonriendo",
          "Toma con el logo o el mostrador para el cierre",
        ],
      };
      await updateDoc(doc(db, "videos", b.video_id), out);
      return out;
    }
    case "/api/ia/plan-mes": {
      await wait(b.idea_id ? 1200 : 2200);
      const id = `${b.proyecto_id}_${b.mes}`;
      const plan = demoStore.get("planes_mes", id);
      if (plan && plan.estado !== "borrador") throw new Error("Este plan ya se mandó al cliente");
      const p = { id: b.proyecto_id, ...demoStore.get("projects", b.proyecto_id) };
      const memoria = demoStore.get("ia_memoria", b.proyecto_id) ?? null;
      const now = new Date().toISOString();
      if (b.idea_id) {
        const vieja = (plan?.ideas ?? []).find((i: IdeaPlan) => i.id === b.idea_id);
        if (!vieja) throw new Error("Esa idea ya no está");
        const [nueva] = ideasDemo(p, b.mes, 1, [...plan.ideas.map((i: IdeaPlan) => i.titulo), ...(plan.descartadas ?? [])], memoria, b.pista);
        if (!nueva) throw new Error("No hay más ideas en la demo. Escribí una propia.");
        await updateDoc(doc(db, "planes_mes", id), {
          ideas: plan.ideas.map((i: IdeaPlan) => (i.id === vieja.id ? nueva : i)),
          ideas_ia: [...(plan.ideas_ia ?? []), nueva],
          descartadas: vieja.origen === "ia" ? arrayUnion(vieja.titulo) : plan.descartadas ?? [],
          updated_at: now,
        });
        return { ok: true, idea: nueva };
      }
      const libres = libresDemo(b.proyecto_id, b.mes);
      if (libres <= 0) throw new Error(`El plan de ${nombreMes(b.mes)} ya tiene todos sus videos cargados`);
      const antes = (plan?.ideas ?? []).filter((i: IdeaPlan) => i.origen === "ia").map((i: IdeaPlan) => i.titulo);
      const ideas = ideasDemo(p, b.mes, Math.min(libres, 6), [...antes, ...(plan?.descartadas ?? [])], memoria, b.pista);
      await setDoc(doc(db, "planes_mes", id), {
        proyecto_id: b.proyecto_id, mes: b.mes, estado: "borrador", ideas, ideas_ia: ideas,
        descartadas: Array.from(new Set([...(plan?.descartadas ?? []), ...antes])), cupo: libres,
        nota_equipo: plan?.nota_equipo ?? null, generado_at: now, generado_por: "u_lucia", updated_at: now,
      });
      return { ok: true, ideas };
    }
    case "/api/ia/plan-enviar": {
      await wait(900);
      const id = `${b.proyecto_id}_${b.mes}`;
      const plan = demoStore.get("planes_mes", id);
      if (!plan) throw new Error("Primero armá el plan");
      if (plan.estado !== "borrador") throw new Error("Este plan ya se mandó al cliente");
      const ideas = limpiarIdeas(b.ideas).map((i) => ({ ...i, respuesta: null, video_id: null }));
      if (!ideas.length) throw new Error("El plan no tiene ideas");
      const now = new Date().toISOString();
      await updateDoc(doc(db, "planes_mes", id), { ideas, nota_equipo: b.nota_equipo ?? null, estado: "enviado", enviado_at: now, enviado_por: "u_lucia", recordatorios: 0, updated_at: now });
      await aprenderDemo(b.proyecto_id, aprendizajeEquipo(b.mes, plan.ideas_ia ?? [], ideas, plan.descartadas ?? []));
      return { ok: true };
    }
    case "/api/ia/plan-responder": {
      await wait(900);
      const id = `${b.proyecto_id}_${b.mes}`;
      const plan = demoStore.get("planes_mes", id);
      if (!plan || plan.estado !== "enviado") throw new Error("Este plan ya fue respondido");
      const by = demoStore.get("projects", b.proyecto_id)?.team_roles?.cliente?.[0] ?? "cliente";
      const resp = new Map((b.respuestas ?? []).map((r: any) => [r.id, r]));
      const out: IdeaPlan[] = [];
      for (const i of plan.ideas as IdeaPlan[]) {
        const r: any = resp.get(i.id);
        if (!r) throw new Error("Decinos qué te parece cada idea");
        let video_id: string | null = null;
        if (r.ok) {
          const ref = await addDoc(collection(db, "videos"), videoPlanDemo(b.proyecto_id, b.mes, i, by, "Idea del plan del mes aprobada por el cliente", null, i.id));
          video_id = ref.id;
        }
        out.push({ ...i, respuesta: { ok: !!r.ok, comentario: r.ok ? null : r.comentario }, video_id });
      }
      const cambios = out.filter((i) => !i.respuesta?.ok).length;
      const now = new Date().toISOString();
      await updateDoc(doc(db, "planes_mes", id), { ideas: out, estado: cambios ? "respondido" : "cerrado", nota_cliente: b.nota ?? null, respondido_at: now, respondido_por: by, updated_at: now });
      await aprenderDemo(b.proyecto_id, aprendizajeCliente(b.mes, out, b.nota ?? null));
      return { ok: true, aprobadas: out.length - cambios, cambios };
    }
    case "/api/ia/plan-ajustar": {
      await wait(700);
      const id = `${b.proyecto_id}_${b.mes}`;
      const plan = demoStore.get("planes_mes", id);
      if (!plan || plan.estado !== "respondido") throw new Error("Este plan no tiene cambios pendientes");
      const i = (plan.ideas as IdeaPlan[]).find((x) => x.id === b.idea_id);
      if (!i || i.respuesta?.ok !== false || i.video_id || i.descartada) throw new Error("Esta idea ya se resolvió");
      const descartar = b.accion === "descartar";
      let video_id: string | null = null;
      if (!descartar) {
        const ref = await addDoc(collection(db, "videos"), videoPlanDemo(b.proyecto_id, b.mes, { titulo: b.titulo, idea: b.idea || null, objetivo: b.objetivo ?? i.objetivo }, "u_lucia", "Idea del plan ajustada con el pedido del cliente", i.respuesta?.comentario ?? null, i.id));
        video_id = ref.id;
      }
      const ideas = (plan.ideas as IdeaPlan[]).map((x) => (x.id === i.id ? (descartar ? { ...x, descartada: true } : { ...x, titulo: b.titulo, idea: b.idea, video_id }) : x));
      const pend = ideas.filter((x) => x.respuesta?.ok === false && !x.video_id && !x.descartada).length;
      await updateDoc(doc(db, "planes_mes", id), { ideas, estado: pend ? "respondido" : "cerrado", updated_at: new Date().toISOString() });
      await aprenderDemo(b.proyecto_id, aprendizajeAjuste(b.mes, i, { titulo: b.titulo, idea: b.idea }, descartar));
      return { ok: true, video_id };
    }
    case "/api/ia/comercial-ver": {
      await wait(250);
      return { comercial: demoStore.get("ia_memoria", b.proyecto_id)?.comercial ?? {} };
    }
    case "/api/ia/comercial-guardar": {
      await wait(500);
      const comercial = { ...limpiarComercial(b.comercial), actualizado_at: new Date().toISOString() };
      await setDoc(doc(db, "ia_memoria", b.proyecto_id), { proyecto_id: b.proyecto_id, comercial }, { merge: true });
      return { ok: true, comercial };
    }
    case "/api/pagos/pedir-pieza": {
      await wait(700);
      const pedido = leerPedidoPieza(b);
      if (typeof pedido === "string") throw new Error(pedido);
      const proj = demoStore.get("projects", b.proyecto_id) ?? {};
      const plan = demoStore.get("planes_redes", proj.plan_redes_id) ?? {};
      const incluidas = proj.plan_redes_override?.piezas_mes ?? plan.piezas_mes ?? 0;
      const d = new Date();
      const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const usadas = demoStore.all("piezas_ia").filter((x: any) => x.proyecto_id === b.proyecto_id && x.mes === mes && x.incluida && !["cancelada", "rechazada"].includes(x.estado)).length;
      const by = proj.team_roles?.cliente?.[0] ?? "u_cli1";
      if (usadas < incluidas) {
        const ref = await addDoc(collection(db, "piezas_ia"), piezaDoc(b.proyecto_id, by, mes, pedido, true, 0));
        return { estado: "creada", pieza_id: ref.id };
      }
      const monto = precioPieza(demoStore.get("app_settings", "redes") ?? {}, pedido.formato);
      const ref = await addDoc(collection(db, "piezas_ia"), piezaDoc(b.proyecto_id, by, mes, pedido, false, monto));
      const cobro = await addDoc(collection(db, "cobros"), {
        proyecto_id: b.proyecto_id, tipo: "pieza_ia", concepto: `Pieza gráfica · ${FORMATOS_PIEZA[pedido.formato].label}`, ref_id: ref.id,
        cantidad: 1, monto, moneda: "ARS", estado: "pendiente", created_by: by, created_at: new Date().toISOString(),
      });
      await updateDoc(doc(db, "piezas_ia", ref.id), { cobro_id: cobro.id });
      return { estado: "pago", pieza_id: ref.id, cobro_id: cobro.id, monto, init_point: `#/cliente?tab=piezas&cobro=${cobro.id}&pago=ok` };
    }
    case "/api/pagos/emitir": {
      await wait(700);
      if (Array.isArray(b.proyecto_ids) && b.proyecto_ids.length && b.mes) {
        await prepararDemo(b.mes, b.proyecto_ids);
        b.ids = [...new Set([...(b.ids ?? []), ...b.proyecto_ids.map((pid: string) => `${pid}_${b.mes}`)])];
      }
      let emitidas = 0;
      let mails = 0;
      const sin_mail: string[] = [];
      for (const id of b.ids ?? []) {
        const f = demoStore.get("facturas", id);
        if (!f || f.estado !== "borrador") continue;
        const p = demoStore.get("projects", f.proyecto_id) ?? {};
        const conMail = (p.contacto_emails ?? []).length > 0;
        await updateDoc(doc(db, "facturas", id), {
          estado: "pendiente", emitida_at: new Date().toISOString(),
          ...(conMail ? { mail_enviado_at: new Date().toISOString(), mail_destinos: p.contacto_emails } : {}),
        });
        emitidas++;
        if (conMail) mails++;
        else sin_mail.push(f.cliente);
      }
      return { ok: true, emitidas, mails, sin_mail };
    }
    case "/api/pagos/facturar": {
      await wait(900);
      return { ok: true, ...(await prepararDemo(b.mes, Array.isArray(b.proyecto_ids) ? b.proyecto_ids : null)) };
    }
    case "/api/ia/memoria-notas": {
      await wait(400);
      await setDoc(doc(db, "ia_memoria", b.proyecto_id), { proyecto_id: b.proyecto_id, notas_equipo: String(b.notas ?? "").trim() }, { merge: true });
      return { ok: true };
    }

    case "/api/ia/preparar": {
      await wait(900);
      return { texto: "Tené listos los productos que vamos a mostrar, el local ordenado y con buena luz, y a la persona que va a hablar a cámara con ropa lisa (sin logos de otras marcas). Calculá una hora y media de grabación." };
    }

    case "/api/ia/copy": {
      await wait(900);
      const v = demoStore.get("videos", b.video_id) ?? {};
      const t = v.titulo ?? "este video";
      return {
        opciones: [
          `🔥 ${t}\nLo que estabas esperando ya está acá.\n👉 Escribinos por WhatsApp y te contamos todo.\n#promo #reconquista`,
          `¿Ya lo viste? ${t} 👀\nVení a conocernos o pedí por WhatsApp, te respondemos al toque.\n#novedades #local`,
          `${t}.\nHecho con dedicación, como siempre. Consultanos por mensaje directo y reservá el tuyo.\n#calidad #santafe`,
        ],
      };
    }

    case "/api/ia/pieza": {
      await wait(1800);
      const p = demoStore.get("piezas_ia", b.pieza_id);
      const n = (p?.versiones?.length ?? 0) + 1;
      const img = [1, 2, 3, 4][(n + (p?.proyecto_id?.length ?? 0)) % 4];
      await updateDoc(doc(db, "piezas_ia", b.pieza_id), {
        estado: "en_proceso",
        versiones: arrayUnion({
          id: `v${n}_${Date.now()}`,
          drive_file_id: `demo/pieza-${img}.jpg`,
          name: `pieza-v${n}.jpg`,
          mime_type: "image/jpeg",
          web_view_link: "#",
          prompt: p?.pedido ?? "",
          created_at: new Date().toISOString(),
          created_by: "demo",
        }),
      });
      return { ok: true };
    }

    case "/api/pagos/pedir-video": {
      await wait(700);
      const proj = demoStore.get("projects", b.proyecto_id);
      const plan = demoStore.get("planes_redes", proj?.plan_redes_id) ?? {};
      const incluidos = proj?.plan_redes_override?.videos_mes ?? plan.videos_mes ?? 0;
      const precio = proj?.plan_redes_override?.precio_video_extra ?? plan.precio_video_extra ?? 0;
      const cupo = incluidos + (proj?.creditos_extra?.[b.mes] ?? 0);
      const usados = demoStore.all("videos").filter((v: any) => v.proyecto_id === b.proyecto_id && v.mes === b.mes && !v.extra).length;
      if (b.fecha_deseada) b.mes = String(b.fecha_deseada).slice(0, 7);
      const pedido = { titulo: b.titulo, idea: b.idea || null, objetivo: b.objetivo || null, fecha_deseada: b.fecha_deseada ?? null, pedido_por: "u_cli1" };
      if (usados < cupo) {
        const ref = await addDoc(collection(db, "videos"), videoPedidoDemo(b.proyecto_id, b.mes, pedido, "Pedido por el cliente"));
        return { estado: "creado", video_id: ref.id };
      }
      const [y, m] = String(b.mes).split("-").map(Number);
      const ref = await addDoc(collection(db, "cobros"), {
        proyecto_id: b.proyecto_id, tipo: "video_extra", concepto: `Video extra · ${MESES[m - 1]} ${y}: ${b.titulo}`, ref_id: b.mes,
        cantidad: 1, monto: precio, moneda: "ARS", estado: "pendiente", pedido, created_by: "demo", created_at: new Date().toISOString(),
      });
      return { estado: "pago", cobro_id: ref.id, monto: precio, init_point: `#/cliente?cobro=${ref.id}&pago=ok` };
    }

    case "/api/pagos/crear": {
      await wait(600);
      let proyecto_id: string, monto: number, concepto: string, ref_id: string, cantidad = 1, tab: string;
      if (b.tipo === "pieza_ia") {
        const p = demoStore.get("piezas_ia", b.pieza_id);
        proyecto_id = p.proyecto_id;
        monto = precioPieza(demoStore.get("app_settings", "redes") ?? {}, p.formato);
        concepto = `Pieza gráfica · ${FORMATOS_PIEZA[p.formato]?.label ?? "diseño"}`;
        ref_id = b.pieza_id;
        tab = "piezas";
      } else {
        proyecto_id = b.proyecto_id;
        cantidad = b.cantidad ?? 1;
        const proj = demoStore.get("projects", proyecto_id);
        const plan = demoStore.get("planes_redes", proj.plan_redes_id);
        monto = (proj.plan_redes_override?.precio_video_extra ?? plan?.precio_video_extra ?? 0) * cantidad;
        const [y, m] = String(b.mes).split("-").map(Number);
        concepto = `${cantidad} video${cantidad === 1 ? "" : "s"} extra · ${MESES[m - 1]} ${y}`;
        ref_id = b.mes;
        tab = "plan";
      }
      const ref = await addDoc(collection(db, "cobros"), {
        proyecto_id, tipo: b.tipo, concepto, ref_id, cantidad, monto, moneda: "ARS", estado: "pendiente",
        created_by: "demo", created_at: new Date().toISOString(),
      });
      if (b.tipo === "pieza_ia") await updateDoc(doc(db, "piezas_ia", ref_id), { cobro_id: ref.id, precio: monto });
      // En el sistema real acá se abre el checkout de Mercado Pago; la demo lo da por pagado.
      return { cobro_id: ref.id, init_point: `#/cliente?tab=${tab}&cobro=${ref.id}&pago=ok` };
    }

    case "/api/pagos/verificar": {
      await wait(400);
      const c = demoStore.get("cobros", b.cobro_id);
      if (!c) return { estado: "pendiente" };
      const url = window.location.hash;
      if (url.includes("pago=ok")) {
        await aprobarCobro(b.cobro_id);
        return { estado: "aprobado" };
      }
      return { estado: c.estado };
    }

    case "/api/pagos/reembolsar": {
      const p = demoStore.get("piezas_ia", b.pieza_id);
      if (p?.cobro_id) await updateDoc(doc(db, "cobros", p.cobro_id), { estado: "reembolsado" });
      await updateDoc(doc(db, "piezas_ia", b.pieza_id), { estado: "rechazada", nota_equipo: b.nota ?? "" });
      return { ok: true };
    }

    case "/api/ia/minuta": {
      await wait(2200);
      const r = demoStore.get("reuniones", b.reunion_id);
      const notas: string = r?.notas ?? "";
      await updateDoc(doc(db, "reuniones", b.reunion_id), {
        estado: "realizada",
        minuta: {
          resumen: notas
            ? `Se repasó lo anotado: ${notas.slice(0, 160)}${notas.length > 160 ? "…" : ""}`
            : `Reunión «${r?.titulo}». Se revisaron los videos en curso, se definieron prioridades y próximos pasos con el cliente.`,
          temas: ["Videos en curso", "Próximo rodaje", "Pauta del mes"],
          acuerdos: ["Mantener el presupuesto de pauta", "Sumar un video para la promo del fin de semana"],
          tareas: [
            { tarea: "Agendar el próximo rodaje", responsable: "Lucía", fecha: "esta semana" },
            { tarea: "Enviar referencias de videos que le gustan", responsable: "Cliente", fecha: null },
          ],
          generado_at: new Date().toISOString(),
          fuente: b.usar === "notas" ? "notas" : "audio",
        },
      });
      return { ok: true };
    }

    case "/api/usuarios/crear": {
      await wait(500);
      const id = `u_${Date.now()}`;
      await setDoc(doc(db, "profiles", id), { nombre: b.nombre, email: b.email, role: b.rol, activo: true, created_at: new Date().toISOString() });
      for (const pid of b.clientes ?? []) {
        const campo = b.rol;
        if (["productor", "editor", "pauta", "cliente"].includes(campo)) await updateDoc(doc(db, "projects", pid), { [`team_roles.${campo}`]: arrayUnion(id) });
      }
      return { ok: true, uid: id, password: "Prodi-demo1234" };
    }
    case "/api/usuarios/editar": {
      await wait(400);
      const patch: Record<string, unknown> = {};
      if (b.nombre) patch.nombre = b.nombre;
      if (b.email) patch.email = b.email;
      if (b.rol) patch.role = b.rol;
      await updateDoc(doc(db, "profiles", b.uid), patch);
      if (b.clientes) {
        for (const p of demoStore.all("projects")) {
          for (const k of ["productor", "editor", "pauta", "cliente"]) {
            const has = (p.team_roles?.[k] ?? []).includes(b.uid);
            const want = k === b.rol && b.clientes.includes(p.id);
            if (has && !want) await updateDoc(doc(db, "projects", p.id), { [`team_roles.${k}`]: arrayRemove(b.uid) });
            if (!has && want) await updateDoc(doc(db, "projects", p.id), { [`team_roles.${k}`]: arrayUnion(b.uid) });
          }
        }
      }
      return { ok: true };
    }
    case "/api/usuarios/ejemplo-cargar":
      await wait(600);
      await setDoc(doc(db, "app_settings", "demo_ejemplo"), { cargado_at: new Date().toISOString() });
      return { documentos: 180 };
    case "/api/usuarios/ejemplo-borrar":
      await wait(600);
      await deleteDoc(doc(db, "app_settings", "demo_ejemplo"));
      return { documentos: 180 };
    case "/api/usuarios/desactivar":
      await updateDoc(doc(db, "profiles", b.uid), { activo: !!b.activo });
      return { ok: true };
    case "/api/usuarios/eliminar":
      await deleteDoc(doc(db, "profiles", b.uid));
      return { ok: true };
    case "/api/usuarios/clave":
      return { ok: true, link: "https://prodi-redes.vercel.app/__/auth/action?mode=resetPassword&oobCode=DEMO" };

    case "/api/informes/enviar": {
      await wait(500);
      const p = demoStore.get("projects", b.proyecto_id);
      const vids = demoStore.all("videos").filter((v: any) => v.proyecto_id === b.proyecto_id && v.mes === b.mes);
      const pub = vids.filter((v: any) => v.etapa === "publicado");
      const sum = (k: string) => pub.reduce((a: number, v: any) => a + (v.resultados?.[k] ?? 0), 0);
      const plan = demoStore.get("planes_redes", p.plan_redes_id);
      const [y, m] = String(b.mes).split("-").map(Number);
      const html = renderInformeHtml({
        nombre: p.nombre,
        label: `${MESES[m - 1].replace(/^./, (c: string) => c.toUpperCase())} ${y}`,
        baseUrl: window.location.href.split("#")[0].replace(/\/[^/]*$/, ""),
        resumen: {
          publicados: pub.length,
          cupo: (plan?.videos_mes ?? 0) + (p.creditos_extra?.[b.mes] ?? 0),
          alcance: sum("alcance"),
          reproducciones: sum("reproducciones"),
          mensajes: sum("mensajes"),
          gasto: sum("gasto"),
        },
        publicados: pub.map((v: any) => ({ ...v, attachments_finalizado: [] })),
      });
      if (b.solo_vista) return { html };
      return { ok: true, enviados: p.contacto_emails ?? [] };
    }
  }
  throw new Error(`Demo: ${path} no disponible`);
}
