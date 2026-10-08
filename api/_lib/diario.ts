// Tareas diarias (cron): aviso al cliente el día antes del rodaje (o el mismo día si se agendó tarde),
// y recordatorios al cliente que no aprobó un video o no respondió el plan del mes en 48 h.

import { FieldValue, type Data } from "./db";
import { adminDb } from "./db";
import { enviarAviso } from "./notify";
import { crearTokenAprobacion } from "./aprobacion";
import { prepararFacturacion } from "./facturar";
import { asuntoRecordatorio, interesMora, mailFacturaHtml, nombreMesF, periodoDe, saldoDe, type Factura } from "./facturacion";
import { enviarMail } from "./informe";
import { hoyAR, sumarDias, sumarMeses } from "./fecha";

const H48 = 48 * 3600_000;
/** Máximo de recordatorios por video en revisión (después le escribe el equipo). */
export const MAX_RECORDATORIOS = 3;

export async function recordatoriosRodaje(base: string): Promise<number> {
  const db = adminDb();
  const hoy = hoyAR();
  const manana = sumarDias(hoy, 1);
  // Mañana, y también hoy por si el rodaje se agendó o se movió después del aviso de ayer.
  const snap = await db.collection("rodajes").where("fecha", "in", [hoy, manana]).get();
  let enviados = 0;
  for (const d of snap.docs) {
    // Se marca antes de mandar: si la función se corta a la mitad, no se repite el aviso.
    const tomado = await db.runTransaction(async (tx) => {
      const r = (await tx.get(d.ref)).data();
      if (!r || r.demo_ejemplo || r.estado !== "agendado" || r.recordatorio_at) return null;
      tx.update(d.ref, { recordatorio_at: new Date().toISOString() });
      return r;
    });
    if (!tomado) continue;
    const r = tomado;
    const esHoy = r.fecha === hoy;
    const p = (await db.collection("projects").doc(r.proyecto_id).get()).data() ?? {};
    if (p.enabled === false) continue;
    const team = (p.team_roles ?? {}) as Record<string, string[]>;
    const videos = await Promise.all(
      (r.video_ids ?? []).slice(0, 10).map((id: string) => db.collection("videos").doc(id).get())
    );
    const titulos = videos.map((v) => v.data()?.titulo).filter(Boolean) as string[];
    const cuando = `${r.hora ? `a las ${r.hora}` : ""}${r.lugar ? ` en ${r.lugar}` : ""}`.trim();
    const listo = r.preparar ? ` Tené listo: ${String(r.preparar).slice(0, 220)}` : "";

    await enviarAviso(
      {
        destinatarios: team.cliente ?? [],
        titulo: esHoy ? "Hoy filmamos 🎬" : "Mañana filmamos 🎬",
        cuerpo: `${cuando ? `${cuando[0].toUpperCase()}${cuando.slice(1)}. ` : ""}Vamos a grabar ${titulos.length} video${titulos.length === 1 ? "" : "s"}.${listo}`,
        link: "/cliente",
        clave: `rodaje_manana:${d.id}`,
        proyectoId: r.proyecto_id,
      },
      base
    );
    await enviarAviso(
      {
        destinatarios: r.productor_id ? [r.productor_id] : (team.productor ?? []),
        titulo: `${esHoy ? "Hoy" : "Mañana"}: rodaje con ${p.nombre ?? "el cliente"}`,
        cuerpo: `${cuando || "Revisá la hora y el lugar"} · ${titulos.join(", ").slice(0, 200)}`,
        link: "/rodajes",
        clave: `rodaje_manana_eq:${d.id}`,
        proyectoId: r.proyecto_id,
      },
      base
    );
    enviados++;
  }
  return enviados;
}

/** Videos esperando el OK del cliente hace más de 48 h: recordatorio con el link para aprobar sin entrar. */
export async function recordatoriosAprobacion(base: string): Promise<number> {
  const db = adminDb();
  const limite = new Date(Date.now() - H48).toISOString();
  const vence = (v: Data) =>
    v.etapa === "revision_cliente" &&
    !v.demo_ejemplo &&
    String(v.etapa_desde ?? "") <= limite &&
    Number(v.recordatorios_cliente ?? 0) < MAX_RECORDATORIOS &&
    (!v.recordatorio_cliente_at || String(v.recordatorio_cliente_at) <= limite);
  const snap = await db.collection("videos").where("etapa", "==", "revision_cliente").get();
  const proyectos = new Map<string, Data>();
  let enviados = 0;
  for (const d of snap.docs) {
    if (!vence(d.data())) continue;
    const pid = String(d.data().proyecto_id);
    if (!proyectos.has(pid)) proyectos.set(pid, (await db.collection("projects").doc(pid).get()).data() ?? {});
    const p = proyectos.get(pid)!;
    const team = (p.team_roles ?? {}) as Record<string, string[]>;
    if (p.enabled === false || !(team.cliente ?? []).length) continue;
    // Se marca antes de mandar: si la función se corta, no se repite el aviso.
    const v = await db.runTransaction(async (tx) => {
      const x = (await tx.get(d.ref)).data();
      if (!x || !vence(x)) return null;
      tx.update(d.ref, { recordatorios_cliente: FieldValue.increment(1), recordatorio_cliente_at: new Date().toISOString() });
      return x;
    });
    if (!v) continue;
    const n = Number(v.recordatorios_cliente ?? 0) + 1;
    await enviarAviso(
      {
        destinatarios: team.cliente ?? [],
        titulo: n === 1 ? "Tu video te está esperando 👀" : "¿Pudiste ver tu video?",
        cuerpo: `“${v.titulo}” está listo. Miralo y decinos si va, es un toque: con tu OK lo publicamos.`,
        link: `/aprobar/${crearTokenAprobacion(d.id, Number(v.rondas ?? 0))}`,
        clave: `recordatorio_aprobar:${d.id}:${n}`,
        proyectoId: pid,
        videoId: d.id,
      },
      base
    );
    // Al último recordatorio, producción se entera para escribirle personalmente.
    if (n >= MAX_RECORDATORIOS) {
      await enviarAviso(
        {
          destinatarios: v.productor_id ? [v.productor_id] : (team.productor ?? []),
          titulo: `${p.nombre ?? "El cliente"} no aprueba hace ${n * 2} días`,
          cuerpo: `“${v.titulo}”: ya le mandamos ${n} recordatorios. Escribile o llamalo.`,
          link: `/videos?video=${d.id}`,
          clave: `sin_respuesta:${d.id}`,
          proyectoId: pid,
          videoId: d.id,
        },
        base
      );
    }
    enviados++;
  }
  return enviados;
}

/** Plan del mes mandado al cliente y sin respuesta en 48 h (hasta 2 recordatorios). */
export async function recordatoriosPlan(base: string): Promise<number> {
  const db = adminDb();
  const limite = new Date(Date.now() - H48).toISOString();
  const vence = (x: Data) =>
    x.estado === "enviado" &&
    !x.demo_ejemplo &&
    String(x.enviado_at ?? "") <= limite &&
    Number(x.recordatorios ?? 0) < 2 &&
    (!x.recordatorio_at || String(x.recordatorio_at) <= limite);
  const snap = await db.collection("planes_mes").where("estado", "==", "enviado").get();
  let enviados = 0;
  for (const d of snap.docs) {
    if (!vence(d.data())) continue;
    const plan = await db.runTransaction(async (tx) => {
      const x = (await tx.get(d.ref)).data();
      if (!x || !vence(x)) return null;
      tx.update(d.ref, { recordatorios: FieldValue.increment(1), recordatorio_at: new Date().toISOString() });
      return x;
    });
    if (!plan) continue;
    const p = (await db.collection("projects").doc(plan.proyecto_id).get()).data() ?? {};
    if (p.enabled === false) continue;
    const team = (p.team_roles ?? {}) as Record<string, string[]>;
    const n = (plan.ideas ?? []).length;
    await enviarAviso(
      {
        destinatarios: team.cliente ?? [],
        titulo: "Te esperan las ideas del mes 🎬",
        cuerpo: `Tenés ${n === 1 ? "1 idea" : `${n} ideas`} para elegir. Con tu OK arrancamos a filmar.`,
        link: `/cliente?plan=${plan.mes}`,
        clave: `recordatorio_plan:${d.id}:${Number(plan.recordatorios ?? 0) + 1}`,
        proyectoId: plan.proyecto_id,
      },
      base
    );
    enviados++;
  }
  return enviados;
}

/**
 * El 27 de cada mes se prepara la facturación de ese mes (mes vencido: se paga del 1 al 5 del siguiente)
 * y se le avisa al super admin. Las boletas se guardan con `mes` = el mes de hoy (ver facturacion.ts).
 */
export async function facturacionDel27(base: string): Promise<string> {
  const hoy = hoyAR();
  if (hoy.slice(8) !== "27") return "no es 27";
  const mes = hoy.slice(0, 7);
  const r = await prepararFacturacion(mes, "cron");
  if (r.creadas > 0) {
    const admins = await adminDb().collection("profiles").where("role", "in", ["admin", "administracion"]).get();
    await enviarAviso(
      {
        destinatarios: admins.docs.map((d) => d.id),
        titulo: "Hoy es 27: a emitir las boletas 🧾",
        cuerpo: `Están listas las de ${nombreMesF(periodoDe(mes))} de ${r.creadas} cliente${r.creadas === 1 ? "" : "s"} (se pagan del 1 al 5 de ${nombreMesF(sumarMeses(mes, 1)).split(" ")[0]}, o en el plazo de cada cliente). Entrá a Cobros, elegí a quién emitirle y les llega por la app y por mail.`,
        link: `/cobros?mes=${mes}`,
        clave: `facturacion:${mes}`,
      },
      base
    );
  }
  return `creadas ${r.creadas}`;
}

/** Cuotas de créditos, convenios con ARCA e impuestos: aviso 3 días antes y el día que vencen. */
export async function vencimientosObligaciones(base: string): Promise<number> {
  const db = adminDb();
  const hoy = hoyAR();
  const en3 = sumarDias(hoy, 3);
  const snap = await db.collection("obligaciones").where("activa", "==", true).get();
  const avisos: { titulo: string; cuerpo: string; clave: string }[] = [];
  const ars = (n: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n || 0);
  for (const d of snap.docs) {
    const o = d.data();
    if (o.demo_ejemplo) continue;
    for (const c of (o.cuotas ?? []) as { n: number; vence: string; monto: number; pagada: boolean }[]) {
      if (c.pagada || (c.vence !== hoy && c.vence !== en3)) continue;
      const cuando = c.vence === hoy ? "hoy" : `el ${c.vence.split("-").reverse().slice(0, 2).join("/")}`;
      avisos.push({
        titulo: c.vence === hoy ? `Vence hoy: ${o.nombre}` : `En 3 días vence ${o.nombre}`,
        cuerpo: `${ars(c.monto)}${o.tipo === "impuesto" ? "" : ` · cuota ${c.n} de ${(o.cuotas ?? []).length}`} · vence ${cuando}`,
        clave: `vence:${d.id}:${c.n}:${c.vence === hoy ? "hoy" : "3d"}`,
      });
    }
  }
  if (!avisos.length) return 0;
  const quienes = await db.collection("profiles").where("role", "in", ["admin", "administracion"]).get();
  const destinatarios = quienes.docs.filter((x) => x.data().activo !== false).map((x) => x.id);
  for (const a of avisos) await enviarAviso({ destinatarios, ...a, link: "/deudas" }, base);
  return avisos.length;
}

/**
 * Recordatorio automático de cobro a los clientes que deben: 2 días antes del vencimiento y a los
 * 1, 7 y 15 días de vencida. Les llega en la app (y push si lo tienen activado) y por mail.
 * No se manda a los que pagan con débito automático ni a los que tienen "sin recordatorios".
 */
export async function recordatoriosCobro(base: string): Promise<number> {
  const db = adminDb();
  const hoy = hoyAR();
  const dias = (a: string, b: string) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000);
  const snap = await db.collection("facturas").where("estado", "==", "pendiente").get();
  const ars = (n: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n || 0);
  let enviados = 0;
  for (const d of snap.docs) {
    const f = d.data() as Factura & { recordatorios?: Record<string, string>; demo_ejemplo?: boolean };
    // Con débito automático no se recuerda, salvo que haya quedado saldo (el débito no llegó al total).
    const saldo = f.debitado ? saldoDe(f) : 0;
    if ((f.debito && !saldo) || f.demo_ejemplo) continue;
    const atraso = dias(hoy, f.vencimiento);
    const etapa = atraso === -2 ? "antes" : atraso === 1 ? "d1" : atraso === 7 ? "d7" : atraso === 15 ? "d15" : null;
    if (!etapa || f.recordatorios?.[etapa]) continue;
    const p = (await db.collection("projects").doc(f.proyecto_id).get()).data() ?? {};
    if (p.facturacion?.sin_recordatorios || p.enabled === false) continue;
    const vencida = atraso > 0;
    const doc = f.tipo === "factura" ? "factura" : "boleta";
    const vto = f.vencimiento.split("-").reverse().slice(0, 2).join("/");
    const que = saldo ? `El saldo de tu ${doc} (${ars(saldo)})` : `Tu ${doc} de ${ars(f.bruto)}`;
    // Vencida: interés simple del 0,5% diario desde el día siguiente al vencimiento hasta hoy.
    const mora = interesMora(f, hoy);
    const texto = vencida
      ? `${que} venció el ${vto}. Con ${mora.dias} día${mora.dias === 1 ? "" : "s"} de interés (0,5% por día) hoy son ${ars(mora.totalConInteres)}. Si ya la pagaste, avisanos y la marcamos.`
      : `${que} vence el ${vto}. Pagala hasta ese día: después corre un interés del 0,5% por día.`;
    const link = `/cliente?tab=plan&factura=${d.id}`;
    const clientes = ((p.team_roles?.cliente ?? []) as string[]).filter(Boolean);
    if (clientes.length) {
      await enviarAviso({ destinatarios: clientes, titulo: vencida ? "Tenés un pago vencido" : "Tu pago vence pronto", cuerpo: texto, link, clave: `cobro:${d.id}:${etapa}` }, base);
    }
    const perfiles = clientes.length ? await Promise.all(clientes.map((u) => db.collection("profiles").doc(u).get())) : [];
    const mails = [...new Set([...((p.contacto_emails ?? []) as string[]), ...perfiles.map((x) => String(x.data()?.email ?? ""))].filter((m) => /@/.test(m)))];
    if (mails.length) {
      await enviarMail(mails, asuntoRecordatorio(f, vencida), mailFacturaHtml(f, `${base}${link}`, base, texto, hoy)).catch((err) => console.warn("[cobro] mail", err));
    }
    await d.ref.update({ [`recordatorios.${etapa}`]: new Date().toISOString() });
    enviados++;
  }
  return enviados;
}

/** "jue 15/10" */
const ddmmSemana = (fecha: string) => {
  const [y, m, d] = fecha.split("-").map(Number);
  return `${["dom", "lun", "mar", "mié", "jue", "vie", "sáb"][new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d}/${m}`;
};

/**
 * Entregas de edición: el día antes, aviso a la editora; si se pasó la fecha y sigue en edición, aviso
 * a la productora y a la editora. Una vez por fecha (si producción cambia la fecha, se vuelve a avisar).
 */
export async function recordatoriosEdicion(base: string): Promise<number> {
  const db = adminDb();
  const hoy = hoyAR();
  const manana = sumarDias(hoy, 1);
  const snap = await db.collection("videos").where("etapa", "==", "edicion").get();
  let enviados = 0;
  for (const d of snap.docs) {
    const v0 = d.data();
    const fecha = String(v0.entrega_edicion ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || v0.demo_ejemplo) continue;
    const caso = fecha === manana ? "manana" : fecha < hoy ? "tarde" : null;
    if (!caso) continue;
    const marca = `${caso}:${fecha}`;
    // Se marca antes de mandar: si la función se corta a la mitad, no se repite el aviso.
    const v = await db.runTransaction(async (tx) => {
      const x = (await tx.get(d.ref)).data();
      if (!x || x.etapa !== "edicion" || x.entrega_edicion !== fecha || x.entrega_aviso === marca) return null;
      tx.update(d.ref, { entrega_aviso: marca });
      return x;
    });
    if (!v) continue;
    const p = (await db.collection("projects").doc(v.proyecto_id).get()).data() ?? {};
    if (p.enabled === false) continue;
    const team = (p.team_roles ?? {}) as Record<string, string[]>;
    const editora = v.editor_id ? [v.editor_id] : (team.editor ?? []);
    const productora = v.productor_id ? [v.productor_id] : (team.productor ?? []);
    const nombre = `${p.nombre ?? "Cliente"} · ${v.titulo}`;
    if (caso === "manana") {
      await enviarAviso(
        { destinatarios: editora, titulo: "Mañana se entrega este video", cuerpo: `${nombre} · entregar el ${ddmmSemana(fecha)}`, link: `/videos?video=${d.id}`, clave: `entrega_manana:${d.id}`, proyectoId: v.proyecto_id, videoId: d.id },
        base
      );
    } else {
      await enviarAviso(
        { destinatarios: [...new Set([...productora, ...editora])], titulo: "Video atrasado en edición", cuerpo: `${nombre} · era para el ${ddmmSemana(fecha)}`, link: `/videos?video=${d.id}`, clave: `entrega_tarde:${d.id}`, proyectoId: v.proyecto_id, videoId: d.id },
        base
      );
    }
    enviados++;
  }
  return enviados;
}
