// Tareas diarias (cron): aviso al cliente el día antes del rodaje (o el mismo día si se agendó tarde),
// y recordatorios al cliente que no aprobó un video o no respondió el plan del mes en 48 h.

import { revisoresSinAdmin, supervisoresRevision } from "./revisores";
import { FieldValue, type Data } from "./db";
import { adminDb } from "./db";
import { enviarAviso } from "./notify";
import { crearTokenAprobacion } from "./aprobacion";
import { prepararFacturacion } from "./facturar";
import { asuntoRecordatorio, interesMora, mailFacturaHtml, nombreMesF, periodoDe, saldoDe, pagoUnaParte, type Factura } from "./facturacion";
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
      (r.video_ids ?? []).slice(0, 30).map((id: string) => db.collection("videos").doc(id).get())
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
    // Campaña de varios meses: un solo recordatorio (el del primer mes), con el link a la campaña entera.
    const campania = Array.isArray(plan.enviado_en_campania) && plan.enviado_en_campania.length > 1 ? (plan.enviado_en_campania as string[]) : null;
    if (campania && plan.mes !== campania[0]) continue;
    const p = (await db.collection("projects").doc(plan.proyecto_id).get()).data() ?? {};
    if (p.enabled === false) continue;
    const team = (p.team_roles ?? {}) as Record<string, string[]>;
    const n = (plan.ideas ?? []).length;
    await enviarAviso(
      {
        destinatarios: team.cliente ?? [],
        titulo: campania ? "Te espera la campaña 🎬" : "Te esperan las ideas del mes 🎬",
        cuerpo: campania
          ? "Tenés las ideas de la campaña para elegir. Con tu OK organizamos el rodaje."
          : `Tenés ${n === 1 ? "1 idea" : `${n} ideas`} para elegir. Con tu OK arrancamos a filmar.`,
        link: `/cliente?plan=${campania ? campania.join(",") : plan.mes}`,
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
    const saldo = pagoUnaParte(f) ? saldoDe(f) : 0;
    if ((f.debito && !saldo) || f.demo_ejemplo) continue;
    // Nunca se le mandó la boleta (p. ej. se registró un pago a cuenta sin emitirla): no se le recuerda.
    if (!f.emitida_at) continue;
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

// ---------------------------------------------------------------------------
// Revisión interna: si producción no aprueba (o pide cambios), avisos seguidos hasta que lo haga.
// Corre cada vez que alguien usa Prodi (no solo una vez por día): ver api/db cambios.
// ---------------------------------------------------------------------------

/** Desde cuánto tiempo en revisión interna se empieza a avisar, y cada cuánto. */
const INTERNO_CADA_MS = 2 * 3600_000;
/** Al tercer aviso sin respuesta, también se entera quien supervisa la revisión (no el admin). */
const INTERNO_ESCALAR = 3;

function horaAR(): number {
  return Number(new Date().toLocaleString("en-US", { timeZone: "America/Argentina/Buenos_Aires", hour: "numeric", hour12: false })) % 24;
}

export async function recordatoriosRevisionInterna(base: string, o: { todoElDia?: boolean } = {}): Promise<number> {
  // De 9 a 21 (de noche no se molesta a nadie).
  const hora = horaAR();
  if (!o.todoElDia && (hora < 9 || hora >= 21)) return 0;
  const db = adminDb();
  const limite = new Date(Date.now() - INTERNO_CADA_MS).toISOString();
  // Los avisos cuentan desde que entró a esta revisión (si vuelve a revisión, arranca de cero).
  const vence = (v: Data) => {
    if (v.etapa !== "revision_interna" || v.demo_ejemplo) return false;
    const desde = String(v.etapa_desde ?? "");
    if (!desde || desde > limite) return false;
    const ultimo = String(v.recordatorio_interno_at ?? "");
    return !ultimo || ultimo < desde || ultimo <= limite;
  };
  const snap = await db.collection("videos").where("etapa", "==", "revision_interna").get();
  const proyectos = new Map<string, Data>();
  let supervisores: string[] | null = null;
  let enviados = 0;
  for (const d of snap.docs) {
    if (!vence(d.data())) continue;
    const v = await db.runTransaction(async (tx) => {
      const x = (await tx.get(d.ref)).data();
      if (!x || !vence(x)) return null;
      const ultimo = String(x.recordatorio_interno_at ?? "");
      const n = !ultimo || ultimo < String(x.etapa_desde ?? "") ? 1 : Number(x.recordatorios_interno ?? 0) + 1;
      tx.update(d.ref, { recordatorios_interno: n, recordatorio_interno_at: new Date().toISOString() });
      return { ...(x as Data), n } as Data & { n: number };
    });
    if (!v) continue;
    const pid = String(v.proyecto_id ?? "");
    if (!proyectos.has(pid)) proyectos.set(pid, (await db.collection("projects").doc(pid).get()).data() ?? {});
    const p = proyectos.get(pid)!;
    if (p.enabled === false) continue;
    const team = (p.team_roles ?? {}) as Record<string, string[]>;
    const productores = await revisoresSinAdmin(v.productor_id ? [String(v.productor_id)] : (team.productor ?? []));
    const horas = Math.max(2, Math.round((Date.now() - new Date(String(v.etapa_desde)).getTime()) / 3600_000));
    const cliente = String(p.nombre ?? "Cliente");
    await enviarAviso(
      {
        destinatarios: productores,
        titulo: v.n === 1 ? "Tenés un video para aprobar 🎬" : `⏰ Sigue esperando tu OK (hace ${horas} h)`,
        cuerpo: `${cliente} · “${v.titulo}”. Miralo y aprobalo (o pedí cambios) para que le llegue al cliente.`,
        link: `/videos?video=${d.id}`,
        clave: `revision_interna_rec:${d.id}:${v.etapa_desde}:${v.n}`,
        proyectoId: pid,
        videoId: d.id,
        // Seguido por la app; por mail solo la primera vez.
        mail: v.n === 1,
      },
      base
    );
    if (v.n >= INTERNO_ESCALAR) {
      supervisores ??= await supervisoresRevision();
      const avisar = supervisores.filter((a) => !productores.includes(a));
      if (avisar.length)
        await enviarAviso(
          {
            destinatarios: avisar,
            titulo: `${cliente}: video sin aprobar hace ${horas} h`,
            cuerpo: `“${v.titulo}” está en revisión interna y producción no lo aprobó (${v.n} avisos).`,
            link: `/videos?video=${d.id}`,
            clave: `revision_interna_admin:${d.id}:${v.etapa_desde}:${v.n}`,
            proyectoId: pid,
            videoId: d.id,
            mail: v.n === INTERNO_ESCALAR,
          },
          base
        );
    }
    enviados++;
  }
  // Piezas gráficas: mismo circuito que los videos (diseño entrega → producción revisa).
  const vencePieza = (v: Data) => {
    if (v.estado !== "revision_interna") return false;
    const desde = String(v.revision_desde ?? "");
    if (!desde || desde > limite) return false;
    const ultimo = String(v.recordatorio_interno_at ?? "");
    return !ultimo || ultimo < desde || ultimo <= limite;
  };
  const piezas = await db.collection("piezas_ia").where("estado", "==", "revision_interna").get();
  for (const d of piezas.docs) {
    if (!vencePieza(d.data())) continue;
    const v = await db.runTransaction(async (tx) => {
      const x = (await tx.get(d.ref)).data();
      if (!x || !vencePieza(x)) return null;
      const ultimo = String(x.recordatorio_interno_at ?? "");
      const n = !ultimo || ultimo < String(x.revision_desde ?? "") ? 1 : Number(x.recordatorios_interno ?? 0) + 1;
      tx.update(d.ref, { recordatorios_interno: n, recordatorio_interno_at: new Date().toISOString() });
      return { ...(x as Data), n } as Data & { n: number };
    });
    if (!v) continue;
    const pid = String(v.proyecto_id ?? "");
    if (!proyectos.has(pid)) proyectos.set(pid, (await db.collection("projects").doc(pid).get()).data() ?? {});
    const p = proyectos.get(pid)!;
    if (p.enabled === false) continue;
    const productores = await revisoresSinAdmin(((p.team_roles ?? {}) as Record<string, string[]>).productor ?? []);
    const horas = Math.max(2, Math.round((Date.now() - new Date(String(v.revision_desde)).getTime()) / 3600_000));
    const cliente = String(p.nombre ?? "Cliente");
    const que = String(v.producto || v.pedido || "pieza").slice(0, 80);
    await enviarAviso(
      {
        destinatarios: productores,
        titulo: v.n === 1 ? "Tenés una pieza para aprobar 🎨" : `⏰ La pieza sigue esperando tu OK (hace ${horas} h)`,
        cuerpo: `${cliente} · “${que}”. Mirala y aprobala (o pedí cambios) para que le llegue al cliente.`,
        link: `/piezas?pieza=${d.id}`,
        clave: `pieza_revision_rec:${d.id}:${v.revision_desde}:${v.n}`,
        proyectoId: pid,
        mail: v.n === 1,
      },
      base
    );
    if (v.n >= INTERNO_ESCALAR) {
      supervisores ??= await supervisoresRevision();
      const avisar = supervisores.filter((a) => !productores.includes(a));
      if (avisar.length)
        await enviarAviso(
          {
            destinatarios: avisar,
            titulo: `${cliente}: pieza sin aprobar hace ${horas} h`,
            cuerpo: `“${que}” está en revisión interna y producción no la aprobó (${v.n} avisos).`,
            link: `/piezas?pieza=${d.id}`,
            clave: `pieza_revision_admin:${d.id}:${v.revision_desde}:${v.n}`,
            proyectoId: pid,
            mail: v.n === INTERNO_ESCALAR,
          },
          base
        );
    }
    enviados++;
  }
  return enviados;
}

// ---------------------------------------------------------------------------
// Cumplir el mes: a la productora y al de pauta de cada cliente (nunca al admin), un aviso por día con sus clientes.
// - La última semana del mes, los clientes que todavía no publicaron todos los videos del plan.
// - Los clientes que hace 5 días o más no publican nada (videos o piezas marcados como publicados).
// ---------------------------------------------------------------------------

/** Desde cuántos días antes de fin de mes se avisa lo que falta publicar. */
const AVISO_FIN_DE_MES = 7;
/** Cuántos días sin publicar nada para avisar. */
const DIAS_SIN_PUBLICAR = 5;

/** Presupuestos mandados que hace 3 días nadie mira ni responde: aviso a quien lo armó para que lo llame. */
const DIAS_PRESUPUESTO_QUIETO = 3;
export async function presupuestosQuietos(base: string): Promise<number> {
  const hoy = hoyAR();
  const snap = await adminDb().collection("presupuestos").get();
  let n = 0;
  for (const d of snap.docs) {
    const p = d.data();
    if (!["enviado", "visto"].includes(String(p.estado)) || !p.created_by) continue;
    if (p.validez && String(p.validez) < hoy) continue;
    const ultima = [p.ultima_apertura, p.pdf_at, p.visto_at, p.enviado_at].map((x) => String(x ?? "")).sort().pop() ?? "";
    if (!ultima) continue;
    const dias = Math.floor((Date.now() - Date.parse(ultima)) / 86_400_000);
    if (dias < DIAS_PRESUPUESTO_QUIETO) continue;
    n++;
    await enviarAviso(
      {
        destinatarios: [String(p.created_by)],
        titulo: `${p.empresa ?? "Un cliente"}: ${dias} días sin respuesta a la propuesta`,
        cuerpo: p.aperturas ? `La abrió ${p.aperturas === 1 ? "1 vez" : `${p.aperturas} veces`}, la última hace ${dias} días. Escribile o llamalo.` : "Todavía no la abrió. Fijate si le llegó el link.",
        link: "/presupuestos",
        // Un aviso por cada vez que se queda quieto (si vuelve a abrirla y se enfría de nuevo, otro).
        clave: `presupuesto_quieto:${d.id}:${ultima.slice(0, 16)}`,
        mail: false,
      },
      base
    ).catch((e) => console.warn("[presupuesto quieto]", d.id, e));
  }
  return n;
}

export async function alertasPublicacion(base: string): Promise<{ fin_de_mes: number; sin_publicar: number }> {
  const db = adminDb();
  const hoy = hoyAR();
  const mes = hoy.slice(0, 7);
  const finMes = sumarDias(`${sumarMeses(mes, 1)}-01`, -1);
  const quedan = Math.round((Date.parse(finMes) - Date.parse(hoy)) / 86_400_000) + 1;
  const ultimaSemana = quedan <= AVISO_FIN_DE_MES;
  const [proys, planes, admins, videosMes, publicados, piezas] = await Promise.all([
    db.collection("projects").get(),
    db.collection("planes_redes").get(),
    db.collection("profiles").where("role", "==", "admin").get(),
    db.collection("videos").where("mes", "==", mes).get(),
    db.collection("videos").where("etapa", "==", "publicado").get(),
    db.collection("piezas_ia").get(),
  ]);
  const sinAdmin = new Set(admins.docs.map((d) => d.id));
  const videosDePlan = new Map(planes.docs.map((d) => [d.id, Number(d.data().videos_mes ?? 0)]));
  // La última publicación de cada cliente (videos y piezas).
  const ultima = new Map<string, string>();
  const anotar = (pid: unknown, at: unknown) => {
    const f = String(at ?? "").slice(0, 10);
    if (!pid || !/^\d{4}-\d{2}-\d{2}$/.test(f)) return;
    if (f > (ultima.get(String(pid)) ?? "")) ultima.set(String(pid), f);
  };
  for (const d of publicados.docs) anotar(d.data().proyecto_id, d.data().publicacion?.publicado_at ?? d.data().etapa_desde);
  for (const d of piezas.docs) anotar(d.data().proyecto_id, d.data().publicada_at);

  // Por persona: qué clientes le faltan este mes y cuáles no publican hace días.
  const falta = new Map<string, string[]>();
  const quietos = new Map<string, string[]>();
  const sumar = (m: Map<string, string[]>, uids: string[], linea: string) =>
    uids.forEach((u) => m.set(u, [...(m.get(u) ?? []), linea]));
  for (const d of proys.docs) {
    const p = d.data();
    if (p.enabled === false || p.demo_ejemplo) continue;
    const cupo = Number(p.plan_redes_override?.videos_mes ?? videosDePlan.get(String(p.plan_redes_id ?? "")) ?? 0) + Number(p.creditos_extra?.[mes] ?? 0);
    if (cupo <= 0) continue; // sin videos en el plan (solo pauta, software…)
    const team = (p.team_roles ?? {}) as Record<string, string[]>;
    const quienes = [...new Set([...(team.productor ?? []), ...(team.pauta ?? [])])].filter((u) => !sinAdmin.has(u));
    if (!quienes.length) continue;
    const nombre = String(p.nombre ?? "Cliente");
    if (ultimaSemana) {
      const hechos = videosMes.docs.filter((v) => v.data().proyecto_id === d.id && v.data().etapa === "publicado").length;
      if (hechos < cupo) sumar(falta, quienes, `${nombre}: faltan ${cupo - hechos} de ${cupo}`);
    }
    // Sin ninguna publicación registrada no se avisa (todavía no marcan lo publicado en la app).
    const u = ultima.get(d.id);
    const dias = u ? Math.round((Date.parse(hoy) - Date.parse(u)) / 86_400_000) : 0;
    if (u && dias >= DIAS_SIN_PUBLICAR) sumar(quietos, quienes, `${nombre}: hace ${dias} días`);
  }

  const mesTxt = new Date(`${mes}-15T12:00:00Z`).toLocaleDateString("es-AR", { month: "long", timeZone: "UTC" });
  const cuerpo = (l: string[]) => (l.length > 4 ? `${l.slice(0, 4).join(" · ")} · y ${l.length - 4} más` : l.join(" · "));
  await Promise.all([
    ...[...falta].map(([uid, l]) =>
      enviarAviso(
        {
          destinatarios: [uid],
          titulo: `${quedan === 1 ? "Hoy cierra" : `Quedan ${quedan} días para cerrar`} ${mesTxt}: ${l.length === 1 ? "1 cliente con videos sin publicar" : `${l.length} clientes con videos sin publicar`}`,
          cuerpo: cuerpo(l),
          link: "/videos",
          clave: `fin_de_mes:${hoy}`,
          mail: false,
        },
        base
      ).catch((e) => console.warn("[fin de mes]", uid, e))
    ),
    ...[...quietos].map(([uid, l]) =>
      enviarAviso(
        {
          destinatarios: [uid],
          titulo: l.length === 1 ? "Un cliente sin publicar hace días" : `${l.length} clientes sin publicar hace días`,
          cuerpo: cuerpo(l),
          link: "/videos",
          clave: `sin_publicar:${hoy}`,
          mail: false,
        },
        base
      ).catch((e) => console.warn("[sin publicar]", uid, e))
    ),
  ]);
  return { fin_de_mes: falta.size, sin_publicar: quietos.size };
}
