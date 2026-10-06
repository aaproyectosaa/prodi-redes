/* eslint-disable @typescript-eslint/no-explicit-any */
/* Datos de ejemplo de la demo navegable (clientes ficticios). */
import { AUDIO_DEMO } from "./ejemplo-audio";
import { armarFactura } from "./facturacion";

const DAY = 86_400_000;
const iso = (offsetDays: number, hour = 10) => {
  const d = new Date(Date.now() + offsetDays * DAY);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};
const ymd = (offsetDays: number) => {
  const d = new Date(Date.now() + offsetDays * DAY);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const mesDe = (offsetMonths: number) => {
  const d = new Date();
  const x = new Date(d.getFullYear(), d.getMonth() + offsetMonths, 1);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`;
};

const nombreMes = (m: string) => {
  const [y, mm] = m.split("-").map(Number);
  return `${["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"][mm - 1]} ${y}`;
};

const att = (file: string, mime = "video/mp4") => ({
  drive_file_id: `demo/${file}`,
  name: file.replace(".jpg", ".mp4"),
  mime_type: mime,
  size: 18_000_000,
  thumbnail_link: `demo/${file}`,
  web_view_link: "#",
  uploaded_at: iso(-2),
  uploaded_by: "u_lucia",
  folder_path: "Progreso/Demo",
});

export function seed() {
  const mes = mesDe(0);
  const mesAnt = mesDe(-1);
  const profiles: Record<string, any> = {
    u_lucas: { nombre: "Lucas Paulón", email: "lucas@somosprodi.com", role: "admin", avatarColor: "#6F40FC" },
    u_lucia: { nombre: "Lucía Pasetto", email: "lucia@somosprodi.com", role: "productor", avatarColor: "#ec4899" },
    u_nati: { nombre: "Natalia Merino", email: "natalia@somosprodi.com", role: "editor", avatarColor: "#f59e0b" },
    u_eze: { nombre: "Ezequiel", email: "ezequiel@somosprodi.com", role: "pauta", avatarColor: "#10b981" },
    u_ivan: { nombre: "Iván Anic", email: "ivan@somosprodi.com", role: "pauta", avatarColor: "#06b6d4" },
    u_karen: { nombre: "Karen", email: "karen@somosprodi.com", role: "diseno", avatarColor: "#a855f7" },
    u_admin: { nombre: "Lucii", email: "administracion@somosprodi.com", role: "administracion", avatarColor: "#14b8a6" },
    u_cli1: { nombre: "Martín Gómez", email: "martin@dontano.com.ar", role: "cliente", avatarColor: "#f97316" },
    u_cli2: { nombre: "Carla Ruiz", email: "carla@opticasvision.com", role: "cliente", avatarColor: "#3b82f6" },
    u_old: { nombre: "Ex community manager", email: "cm@ejemplo.com", role: "cm", avatarColor: "#64748b" },
    u_new: { nombre: "Usuario nuevo", email: "nuevo@ejemplo.com", role: "pending", avatarColor: "#64748b" },
  };
  const accesos: Record<string, number> = { u_admin: -0.3, u_karen: -0.1, u_lucas: 0, u_lucia: -0.05, u_nati: -0.2, u_eze: -0.4, u_ivan: -2.3, u_cli1: -0.6, u_cli2: -3.2 };
  for (const [id, d] of Object.entries(accesos)) profiles[id].ultimo_acceso = new Date(Date.now() + d * DAY).toISOString();


  const planes = {
    pl_ini: { nombre: "Inicial", descripcion: "", videos_mes: 4, piezas_mes: 2, precio_mensual: 380000, precio_video_extra: 95000, activo: true, orden: 0 },
    pl_cre: { nombre: "Crecimiento", descripcion: "", videos_mes: 8, piezas_mes: 4, precio_mensual: 680000, precio_video_extra: 85000, activo: true, orden: 1 },
    pl_full: { nombre: "Full", descripcion: "", videos_mes: 12, piezas_mes: 6, precio_mensual: 920000, precio_video_extra: 75000, activo: true, orden: 2 },
  };

  const team = (pauta: string, cliente: string[] = []) => ({
    productor: ["u_lucia"],
    editor: ["u_nati"],
    pauta: [pauta],
    cliente,
  });
  const projects: Record<string, any> = {
    p1: {
      nombre: "Pizzería Don Tano", color: "#F97316", enabled: true, plan_redes_id: "pl_cre", team_roles: team("u_eze", ["u_cli1"]),
      contacto_emails: ["martin@dontano.com.ar"],
      marca: { rubro: "Pizzería y delivery", descripcion: "Masa madre de 48 horas, horno a leña y delivery hasta las 2 AM", publico: "Familias y jóvenes de la ciudad", tono: "Cercano, con humor, voseo", colores: "#f97316, #111111, #fff7ed", paleta: ["#f97316", "#111111", "#fff7ed"] },
      redes: { instagram: "@dontano.pizzas" }, creditos_extra: {},
      marca_archivos: {
        logo: { ...att("logo-dontano.png", "image/png"), name: "logo.png" },
        referencias: [{ ...att("pieza-4.jpg", "image/jpeg"), name: "referencia-1.jpg" }],
      },
      suscripcion: { mp_preapproval_id: "pre_demo_1", estado: "activa", monto: 680000, payer_email: "martin@dontano.com.ar", init_point: null, creada_at: iso(-40), actualizada_at: iso(-40), ultimo_pago_at: iso(-3) },
    },
    p2: {
      nombre: "Ópticas Visión", color: "#06B6D4", enabled: true, plan_redes_id: "pl_ini", team_roles: team("u_ivan", ["u_cli2"]),
      contacto_emails: ["carla@opticasvision.com"], marca: { rubro: "Óptica", tono: "Profesional y cálido", colores: "Celeste y blanco" },
      redes: { instagram: "@opticas.vision" }, creditos_extra: {},
    },
    p3: {
      nombre: "Gimnasio Fuerza", color: "#EF4444", enabled: true, plan_redes_id: "pl_full", team_roles: team("u_eze"),
      contacto_emails: ["admin@fuerzagym.com"], marca: { rubro: "Gimnasio", tono: "Motivador" }, creditos_extra: {},
      facturacion: { tipo: "boleta", extras_fijos: [{ concepto: "Combustible", neto: 15000 }] },
    },
    p4: {
      nombre: "Concesionaria Norte", color: "#3B82F6", enabled: true, plan_redes_id: "pl_cre", team_roles: team("u_ivan"),
      contacto_emails: ["ventas@norteautos.com"], marca: { rubro: "Concesionaria de autos", tono: "Confiable" },
      facturacion: { tipo: "factura", razon_social: "Norte Automotores S.A.", cuit: "30-71234567-8", extras_fijos: [] },
      creditos_extra: { [mes]: 2 },
      suscripcion: { mp_preapproval_id: "pre_demo_2", estado: "activa", monto: 680000, payer_email: "ventas@norteautos.com", init_point: null, creada_at: iso(-70), actualizada_at: iso(-70), ultimo_pago_at: iso(-2) },
    },
    p5: {
      nombre: "Heladería Polar", color: "#EC4899", enabled: true, plan_redes_id: "pl_ini", team_roles: team("u_eze"),
      contacto_emails: [], marca: { rubro: "Heladería artesanal" }, creditos_extra: {},
      facturacion: { tipo: "boleta", adelantado_hasta: mesDe(2) },
    },
  };

  const videos: Record<string, any> = {};
  let n = 0;
  const thumbs: Record<string, string> = { p1: "video-1.jpg", p2: "video-3.jpg", p3: "video-4.jpg", p4: "video-5.jpg", p5: "video-6.jpg" };
  const titulos: Record<string, string[]> = {
    p1: ["Promo 2x1 de los jueves", "Cómo hacemos la masa madre", "Delivery hasta las 2 AM", "Pizza del mes: cuatro quesos", "Detrás del horno", "Combo familiar", "Testimonio de clientes", "Noche de fútbol"],
    p2: ["Lentes de sol 2027", "Control visual gratis", "Lentes para chicos", "Cuotas sin interés"],
    p3: ["Clase de funcional", "Plan verano", "Antes y después de Pablo", "Conocé a los profes", "Nueva sala de cardio", "Spinning nocturno", "Promo pareja", "Musculación para principiantes", "Desafío 30 días", "Horarios nuevos", "Clase de boxeo", "Nutrición deportiva"],
    p4: ["Usados certificados", "Test drive sin turno", "Financiación 0%", "Llegó el nuevo SUV", "Service oficial", "Entrega de la semana", "Permutas", "Equipo de ventas", "Accesorios", "Plan de ahorro", "Garantía extendida"],
    p5: ["Nuevo sabor pistacho"],
  };

  const add = (pid: string, idx: number, etapa: string, dias: number, extra: Record<string, any> = {}, m = mes) => {
    n += 1;
    const id = `v${n}`;
    const p = projects[pid];
    const pasoEdicion = ["edicion", "revision_interna", "revision_cliente", "para_publicar", "publicado"].includes(etapa);
    const tieneFinal = ["revision_interna", "revision_cliente", "para_publicar", "publicado"].includes(etapa);
    const thumb = idx % 2 === 1 && pid === "p1" ? "video-2.jpg" : idx === 2 && pid === "p1" ? "video-7.jpg" : idx === 1 && pid === "p4" ? "video-8.jpg" : thumbs[pid];
    videos[id] = {
      proyecto_id: pid,
      titulo: titulos[pid][idx % titulos[pid].length],
      idea: "Abrimos con un plano del producto, 3 tomas cortas mostrando el proceso y cerramos con la promo en pantalla y llamado a escribir por WhatsApp.",
      objetivo: "Conseguir mensajes",
      referencias: null,
      mes: m,
      extra: false,
      etapa,
      etapa_desde: iso(-dias, 9),
      rodaje_id: null,
      productor_id: "u_lucia",
      editor_id: "u_nati",
      pauta_id: p.team_roles.pauta[0],
      attachments_crudo: pasoEdicion ? [att("crudo-1.jpg", "image/jpeg"), att("crudo-2.jpg", "image/jpeg")] : [],
      attachments_finalizado: tieneFinal ? [att(thumb, "image/jpeg")] : [],
      copy: tieneFinal ? "🍕 Los jueves son 2x1 en Don Tano.\nTraé a quien quieras y compartí la mejor pizza de la ciudad.\n👉 Escribinos por WhatsApp y reservá tu mesa.\n#pizza #2x1 #jueves" : null,
      feedback_interno: null,
      feedback_cliente: null,
      rondas: 0,
      cliente_rating: null,
      publicacion: etapa === "publicado" ? { publicado_at: iso(-dias), link_instagram: "https://www.instagram.com/", link_facebook: null, link_tiktok: null } : null,
      pauta: etapa === "publicado" ? { activa: true, objetivo: "Mensajes", presupuesto: 60000, inicio: ymd(-dias), fin: ymd(-dias + 14), notas: null } : null,
      resultados:
        etapa === "publicado" && extra.sinResultados !== true
          ? {
              alcance: 8000 + ((n * 3779) % 14000),
              impresiones: 15000 + ((n * 5113) % 20000),
              reproducciones: 6000 + ((n * 2333) % 9000),
              interacciones: 300 + ((n * 97) % 600),
              mensajes: 20 + ((n * 17) % 70),
              clics: 120 + ((n * 41) % 300),
              gasto: 35000 + ((n * 4111) % 30000),
              actualizado_at: iso(-1),
              actualizado_por: p.team_roles.pauta[0],
            }
          : null,
      meta: null,
      historial: (() => {
        const h: any[] = [{ at: iso(-dias - 8, 9), by: "u_lucia", accion: "Planificado", nota: null }];
        const idx = ["planificado", "agendado", "edicion", "revision_interna", "revision_cliente", "para_publicar", "publicado"].indexOf(etapa);
        const cli = (p.team_roles.cliente ?? [])[0];
        if (idx >= 2) h.push({ at: iso(-dias - 5, 11 + (n % 5)), by: "u_lucia", accion: "Crudo cargado, pasa a edición", nota: null });
        if (idx >= 3) h.push({ at: iso(-dias - 3, 10 + (n % 7)), by: "u_nati", accion: "Edición entregada", nota: null });
        if (idx >= 4) h.push({ at: iso(-dias - 2, 15 + (n % 4)), by: "u_lucia", accion: "Aprobado por producción, enviado al cliente", nota: null });
        if (idx >= 5)
          h.push(
            cli
              ? { at: iso(-dias - 1, 9 + (n % 9)), by: cli, accion: "Aprobado por el cliente", nota: null }
              : { at: iso(-dias - 1, 12), by: "u_lucia", accion: "Aprobado por el cliente", nota: "Aprobado por el cliente fuera del sistema" }
          );
        if (idx >= 6) h.push({ at: iso(-dias, 10 + (n % 6)), by: p.team_roles.pauta[0], accion: "Publicado y pautado", nota: null });
        return h;
      })(),
      created_at: iso(-dias - 8),
      created_by: "u_lucia",
      updated_at: iso(-dias),
      ...extra,
    };
    delete videos[id].sinResultados;
    return id;
  };

  // Mes anterior: todo publicado (para resultados e informe)
  [["p1", 8], ["p2", 4], ["p3", 10], ["p4", 8], ["p5", 3]].forEach(([pid, cant]) => {
    for (let i = 0; i < (cant as number); i++) add(pid as string, i, "publicado", 25 - i, {}, mesAnt);
  });

  // Meses anteriores (para ver la evolución de resultados): menos videos al principio.
  [[-5, 4], [-4, 5], [-3, 6], [-2, 7]].forEach(([m, cant]) => {
    for (let i = 0; i < cant; i++) add("p1", i, "publicado", -m * 30 - i, {}, mesDe(m));
  });
  [[-3, 3], [-2, 4]].forEach(([m, cant]) => {
    for (let i = 0; i < cant; i++) add("p2", i, "publicado", -m * 30 - i, {}, mesDe(m));
  });

  // Mes actual
  const rodajes: Record<string, any> = {};
  // Don Tano
  const pm = add("p1", 0, "publicado", 3);
  videos[pm].meta = { ad_id: "120210000123456789" };
  videos[pm].resultados = { ...videos[pm].resultados, actualizado_at: iso(0, 8), actualizado_por: "meta" };
  add("p1", 1, "publicado", 2, { sinResultados: true });
  add("p1", 2, "para_publicar", 0);
  add("p1", 3, "revision_cliente", 2, { recordatorios_cliente: 1, recordatorio_cliente_at: iso(0, 8) });
  add("p1", 4, "revision_interna", 0);
  add("p1", 5, "edicion", 1, {
    feedback_cliente: "En el segundo 8 sacá el precio viejo y poné $18.900. La música más tranqui.",
    feedback_marcas: [
      { t: 8, texto: "Sacá el precio viejo y poné $18.900", de: "cliente" },
      { t: 19, texto: "La música más tranqui desde acá", de: "cliente" },
    ],
    rondas: 1,
  });
  const a1 = add("p1", 6, "agendado", 1);
  const a2 = add("p1", 7, "planificado", 2, { pedido_cliente: true, fecha_deseada: ymd(12) });
  videos[a1].guion = "Escena 1 (0-3 s) · Gancho: “¿Qué dicen los que ya probaron Don Tano?” sobre un plano de la pizza saliendo del horno.\nEscena 2 (3-20 s) · Tres clientes, una frase cada uno, mirando a cámara.\nEscena 3 (20-28 s) · Plano del salón lleno y de la caja de delivery.\nEscena 4 (28-32 s) · Logo + “Pedí por WhatsApp”.";
  videos[a1].tomas = [
    "Pizza saliendo del horno (cámara lenta)",
    "Cliente 1: frase corta a cámara, fondo del salón",
    "Cliente 2: frase corta a cámara, en la vereda",
    "Cliente 3: frase corta a cámara, con la caja de delivery",
    "Plano general del salón con gente",
    "Detalle del logo en la caja",
  ];
  rodajes.r1 = { proyecto_id: "p1", fecha: ymd(3), hora: "10:00", lugar: "Local Av. San Martín 1240", preparar: "Tené 2 pizzas recién salidas y el horno encendido, y avisale a 3 clientes habituales que vengan a las 10:15.", notas: "Llevar luz chica y micrófono corbatero.", estado: "agendado", video_ids: [a1], productor_id: "u_lucia", created_at: iso(-1), created_by: "u_lucia" };
  videos[a1].rodaje_id = "r1";
  void a2;
  // Ópticas
  add("p2", 0, "publicado", 4);
  add("p2", 1, "revision_cliente", 4);
  add("p2", 2, "edicion", 1);
  add("p2", 3, "planificado", 1, { pedido_cliente: true, fecha_deseada: ymd(9) });
  // Gimnasio
  add("p3", 0, "publicado", 5);
  add("p3", 1, "publicado", 4);
  add("p3", 2, "publicado", 1);
  add("p3", 3, "edicion", 5);
  add("p3", 4, "edicion", 0);
  const g1 = add("p3", 5, "agendado", 1);
  const g2 = add("p3", 6, "agendado", 1);
  add("p3", 7, "planificado", 1);
  add("p3", 8, "planificado", 1);
  rodajes.r2 = { proyecto_id: "p3", fecha: ymd(1), hora: "18:00", lugar: "Gimnasio · sala de musculación", notas: "Coordinar con los profes de la tarde.", preparar: "Que estén los profes de la tarde con la remera del gimnasio y la sala ordenada.", estado: "agendado", video_ids: [g1, g2], productor_id: "u_lucia", created_at: iso(-2), created_by: "u_lucia" };
  videos[g1].rodaje_id = "r2";
  videos[g2].rodaje_id = "r2";
  // Concesionaria (se pasa del plan + extras)
  for (let i = 0; i < 4; i++) add("p4", i, "publicado", 4 - i);
  add("p4", 4, "para_publicar", 1);
  add("p4", 5, "para_publicar", 0);
  add("p4", 6, "revision_interna", 1);
  add("p4", 7, "edicion", 2);
  add("p4", 8, "edicion", 0);
  const c1 = add("p4", 9, "agendado", 0);
  const c2 = add("p4", 10, "agendado", 0);
  rodajes.r3 = { proyecto_id: "p4", fecha: ymd(6), hora: "11:30", lugar: "Salón de ventas", notas: null, estado: "agendado", video_ids: [c1, c2], productor_id: "u_lucia", created_at: iso(0), created_by: "u_lucia" };
  videos[c1].rodaje_id = "r3";
  videos[c2].rodaje_id = "r3";
  // Heladería
  add("p5", 0, "planificado", 2);

  const mesDeIso = (i: string) => i.slice(0, 7);
  const ver = (id: string, img: string, at: string, by = "u_karen") => ({ id, drive_file_id: `demo/${img}`, name: `${id}.jpg`, mime_type: "image/jpeg", web_view_link: "#", prompt: "", created_at: at, created_by: by });
  const pz = (data: Record<string, any>) => ({
    texto_en_pieza: null, producto: null, oferta: null, cta: null, versiones: [], attachments_finalizado: [], version_aprobada_id: null,
    version_enviada_id: null, feedback_cliente: null, rondas: 0, nota_equipo: null, cobro_id: null, incluida: false, precio: 0,
    mes: mesDeIso(data.created_at), historial: [{ at: data.created_at, by: data.solicitado_por, accion: data.incluida ? "Pedida (entra en el plan)" : "Pedida (pagada)", nota: null }],
    ...data,
  });
  const piezas: Record<string, any> = {
    pz1: pz({ proyecto_id: "p1", solicitado_por: "u_cli1", enfoque: "institucional", pedido: "Avisar que el sábado abrimos hasta las 2 AM", texto_en_pieza: "SÁBADO HASTA LAS 2 AM", formato: "cuadrado", incluida: true, estado: "entregada", versiones: [ver("v1", "pieza-4.jpg", iso(-6))], version_enviada_id: "v1", version_aprobada_id: "v1", created_at: iso(-7), updated_at: iso(-6),
      historial: [{ at: iso(-7), by: "u_cli1", accion: "Pedida (entra en el plan)", nota: null }, { at: iso(-6, 9), by: "u_karen", accion: "Enviada al cliente para aprobar", nota: null }, { at: iso(-6, 12), by: "u_cli1", accion: "Aprobada por el cliente", nota: null }] }),
    pz2: pz({ proyecto_id: "p2", solicitado_por: "u_cli2", enfoque: "comercial", producto: "Nueva colección de anteojos de sol", oferta: "3 cuotas sin interés", cta: "Vení al local", pedido: "Que se vea fresco, de verano", texto_en_pieza: "NUEVA COLECCIÓN", formato: "vertical", precio: 18000, estado: "pagada", cobro_id: "cb2", created_at: iso(-1), updated_at: iso(-1) }),
    pz3: pz({ proyecto_id: "p5", solicitado_por: "u_lucas", enfoque: "comercial", producto: "Conos de helado", oferta: "2x1 los martes", cta: "Vení al local", pedido: "", texto_en_pieza: "2X1 EN CONOS", formato: "cuadrado", precio: 18000, estado: "en_proceso", cobro_id: "cb3", versiones: [ver("v1", "pieza-3.jpg", iso(0, 9))], created_at: iso(-1), updated_at: iso(0) }),
    pz4: pz({ proyecto_id: "p1", solicitado_por: "u_cli1", enfoque: "comercial", producto: "Menú del mediodía: muzza, napolitana o fugazzeta con gaseosa", oferta: "$9.900", cta: "Vení al local", pedido: "Para la vidriera, que se lea desde la vereda", texto_en_pieza: "MENÚ DEL MEDIODÍA $9.900", formato: "vidriera", precio: 18000, estado: "pagada", cobro_id: "cb5", created_at: iso(0, 8), updated_at: iso(0, 8) }),
    pz5: pz({ proyecto_id: "p1", solicitado_por: "u_cli1", enfoque: "comercial", producto: "Combo familiar: 2 pizzas grandes + gaseosa", oferta: "$18.900", cta: "Escribinos por WhatsApp", pedido: "Para el fin de semana", formato: "posteo_vertical", incluida: true, estado: "para_aprobar", versiones: [ver("v1", "pieza-2.jpg", iso(0, 10))], version_enviada_id: "v1", created_at: iso(-2), updated_at: iso(0, 10),
      historial: [{ at: iso(-2), by: "u_cli1", accion: "Pedida (entra en el plan)", nota: null }, { at: iso(0, 10), by: "u_karen", accion: "Enviada al cliente para aprobar", nota: null }] }),
    pz6: pz({ proyecto_id: "p4", solicitado_por: "u_lucas", enfoque: "comercial", producto: "Financiación 0% en usados", cta: "Escribinos por WhatsApp", pedido: "Banner para el frente del salón", formato: "banner", incluida: true, estado: "en_proceso", rondas: 1, feedback_cliente: "El logo más grande y sacá el auto rojo, poné una camioneta.", versiones: [ver("v1", "pieza-1.jpg", iso(-1, 11))], version_enviada_id: "v1", created_at: iso(-3), updated_at: iso(0, 9),
      historial: [{ at: iso(-3), by: "u_lucas", accion: "Pedida (entra en el plan)", nota: null }, { at: iso(-1, 11), by: "u_karen", accion: "Enviada al cliente para aprobar", nota: null }, { at: iso(0, 9), by: "u_lucas", accion: "El cliente pidió cambios", nota: "El logo más grande y sacá el auto rojo, poné una camioneta." }] }),
    pz7: pz({ proyecto_id: "p3", solicitado_por: "u_lucas", enfoque: "institucional", pedido: "Avisar los horarios del feriado del lunes: de 9 a 13", texto_en_pieza: "FERIADO: ABRIMOS DE 9 A 13", formato: "vertical", incluida: true, estado: "pagada", created_at: iso(0, 7), updated_at: iso(0, 7) }),
  };
  // Para cuándo las necesita cada cliente (calendario de diseño).
  piezas.pz2.fecha_deseada = ymd(3);
  piezas.pz3.fecha_deseada = ymd(6);
  piezas.pz4.fecha_deseada = ymd(2);
  piezas.pz7.fecha_deseada = ymd(1);
  const cobros: Record<string, any> = {
    cb1: { proyecto_id: "p1", tipo: "pieza_ia", concepto: "Pieza gráfica con IA", ref_id: "pz1", cantidad: 1, monto: 18000, moneda: "ARS", estado: "aprobado", mp_payment_id: "1234567890", created_by: "u_cli1", created_at: iso(-7), pagado_at: iso(-7) },
    cb2: { proyecto_id: "p2", tipo: "pieza_ia", concepto: "Pieza gráfica con IA", ref_id: "pz2", cantidad: 1, monto: 18000, moneda: "ARS", estado: "aprobado", mp_payment_id: "1234567891", created_by: "u_cli2", created_at: iso(-1), pagado_at: iso(-1) },
    cb3: { proyecto_id: "p5", tipo: "pieza_ia", concepto: "Pieza gráfica con IA", ref_id: "pz3", cantidad: 1, monto: 18000, moneda: "ARS", estado: "aprobado", mp_payment_id: "1234567892", created_by: "u_lucas", created_at: iso(-1), pagado_at: iso(-1) },
    cb6: { proyecto_id: "p1", tipo: "abono", concepto: `Abono ${nombreMes(mesAnt)} · débito automático`, ref_id: mesAnt, cantidad: 1, monto: 680000, moneda: "ARS", estado: "aprobado", mp_payment_id: "1234567895", created_by: "mercadopago", created_at: iso(-33), pagado_at: iso(-33) },
    cb7: { proyecto_id: "p1", tipo: "abono", concepto: `Abono ${nombreMes(mes)} · débito automático`, ref_id: mes, cantidad: 1, monto: 680000, moneda: "ARS", estado: "aprobado", mp_payment_id: "1234567896", created_by: "mercadopago", created_at: iso(-3), pagado_at: iso(-3) },
    cb8: { proyecto_id: "p4", tipo: "abono", concepto: `Abono ${nombreMes(mes)} · débito automático`, ref_id: mes, cantidad: 1, monto: 680000, moneda: "ARS", estado: "aprobado", mp_payment_id: "1234567897", created_by: "mercadopago", created_at: iso(-2), pagado_at: iso(-2) },
    cb4: { proyecto_id: "p4", tipo: "video_extra", concepto: "2 videos extra", ref_id: mes, cantidad: 2, monto: 170000, moneda: "ARS", estado: "aprobado", mp_payment_id: "1234567893", created_by: "u_lucas", created_at: iso(-2), pagado_at: iso(-2) },
    cb5: { proyecto_id: "p1", tipo: "pieza_ia", concepto: "Pieza gráfica con IA", ref_id: "pz4", cantidad: 1, monto: 18000, moneda: "ARS", estado: "aprobado", mp_payment_id: "1234567894", created_by: "u_cli1", created_at: iso(0, 8), pagado_at: iso(0, 8) },
  };

  const notif = (uid: string, title: string, body: string, link: string, h: number) => ({
    type: "prodi", recipient_user_id: uid, title, body, link, task_id: null, project_id: null, read: false,
    created_at: iso(0, 0).replace(/T.*/, `T${String(8 + h).padStart(2, "0")}:00:00.000Z`), available_at: iso(-1), dedupe_key: `${uid}${title}`,
  });
  const in_app_notifications: Record<string, any> = {
    n1: notif("u_lucia", "Video listo para revisar", "Pizzería Don Tano · Detrás del horno", "/videos", 2),
    n2: notif("u_nati", "El cliente pidió cambios", "Pizzería Don Tano · Combo familiar", "/videos", 1),
    n3: notif("u_eze", "Video aprobado: listo para subir y pautar", "Pizzería Don Tano · Delivery hasta las 2 AM", "/videos", 3),
    n4: notif("u_cli1", "Tenés un video para aprobar", "Pizza del mes: cuatro quesos", "/cliente", 2),
    n5: notif("u_lucas", "Nueva pieza IA pagada", "Ópticas Visión · Pieza gráfica con IA", "/piezas", 1),
  };

  // ---- Chats ----
  const ts = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
  const chats: Record<string, any> = {};
  const mensajes: Record<string, Record<string, any>> = {};
  const chat = (id: string, data: any, msgs: [string, string, number, any?][]) => {
    const ms: Record<string, any> = {};
    msgs.forEach(([by, texto, min, extra], i) => (ms[`m${i}`] = { texto, by, by_nombre: profiles[by]?.nombre ?? "", at: ts(min), tipo: "texto", link: null, reunion_id: null, ...(extra ?? {}) }));
    const last = msgs[msgs.length - 1];
    chats[id] = {
      ...data,
      nombres: Object.fromEntries(data.miembros.map((m: string) => [m, profiles[m]?.nombre ?? ""])),
      ultimo: last ? { texto: last[1].slice(0, 140), by: last[0], at: ts(last[2]) } : null,
      leido: Object.fromEntries(data.miembros.map((m: string) => [m, ts(last ? last[2] + (m === last[0] ? 0 : 30) : 0)])),
      created_at: ts(60 * 24 * 20),
    };
    mensajes[`chats/${id}/mensajes`] = ms;
  };
  chat("equipo", { tipo: "equipo", proyecto_id: null, nombre: "Equipo Prodi", miembros: ["u_lucas", "u_lucia", "u_nati", "u_eze", "u_ivan", "u_karen", "u_admin"] }, [
    ["u_lucas", "Buen día equipo. Esta semana prioridad: cerrar los videos de Concesionaria que se pasaron del plan.", 60 * 26],
    ["u_lucia", "Dale. Mañana filmo Gimnasio a las 18 y el martes Don Tano.", 60 * 25],
    ["u_nati", "Tengo 5 en edición, el de Gimnasio «Conocé a los profes» lo saco hoy.", 60 * 3],
    ["u_eze", "Subí los dos de Don Tano, falta cargar resultados de la masa madre.", 45],
  ]);
  chat("cliente_p1", { tipo: "cliente", proyecto_id: "p1", nombre: "Pizzería Don Tano", miembros: ["u_lucia", "u_nati", "u_eze", "u_cli1", "u_lucas"] }, [
    ["u_lucia", "Hola Martín! Ya quedó agendado el rodaje en el local, a las 10 🍕", 60 * 20],
    ["u_cli1", "Perfecto. ¿Llevo algo especial?", 60 * 19],
    ["u_lucia", "Dos pizzas recién salidas y el horno prendido. Con eso estamos.", 60 * 19 - 5],
    ["u_lucia", "🎤 Mensaje de voz (0:04)", 60 * 19 - 8, { tipo: "audio", audio: { id: "au1", mime: "audio/wav", duracion: 4 } }],
    ["u_lucia", "Videollamada: Revisión de videos del mes", 60 * 26 * 2, { tipo: "llamada", link: "https://meet.jit.si/Prodi-RevisionDonTano-a1b2c3", reunion_id: "rn1" }],
    ["u_cli1", "Ya aprobé el de la promo. El de cuatro quesos lo miro a la noche.", 25],
  ]);
  mensajes["chats/cliente_p1/audios"] = { au1: { data: AUDIO_DEMO, mime: "audio/wav", by: "u_lucia", at: ts(60 * 19 - 8) } };
  chat("cliente_p2", { tipo: "cliente", proyecto_id: "p2", nombre: "Ópticas Visión", miembros: ["u_lucia", "u_nati", "u_ivan", "u_cli2", "u_lucas"] }, [
    ["u_lucia", "Carla, te dejamos «Control visual gratis» para aprobar en el panel 🙌", 60 * 24 * 4],
    ["u_lucia", "¿Pudiste verlo? Si nos das el ok hoy, Iván lo pauta mañana.", 60 * 5],
  ]);
  chat("dm_u_lucia_u_nati", { tipo: "directo", proyecto_id: null, nombre: null, miembros: ["u_lucia", "u_nati"] }, [
    ["u_nati", "Lu, ¿el crudo de Accesorios es todo lo que hay? Me faltan planos de detalle.", 90],
    ["u_lucia", "Sí, el lunes vuelvo y grabo los detalles.", 80],
  ]);

  // ---- Reuniones ----
  const reuniones: Record<string, any> = {
    rn1: {
      titulo: "Revisión de videos del mes", proyecto_id: "p1", chat_id: "cliente_p1", fecha: iso(-2, 17),
      link: "https://meet.jit.si/Prodi-RevisionDonTano-a1b2c3", participantes: ["u_lucia", "u_cli1", "u_lucas"], creada_por: "u_lucia",
      estado: "realizada", notas: null, created_at: iso(-3),
      attachments_crudo: [{ ...att("crudo-1.jpg", "audio/webm"), name: "reunion-revision.webm", size: 5_300_000 }],
      minuta: {
        resumen: "Martín aprobó la promo 2x1 y pidió bajar el precio del combo familiar a $18.900. Se acordó sumar un video de noche de fútbol y probar pauta con objetivo mensajes.",
        temas: ["Videos de octubre", "Precio del combo familiar", "Pauta de los jueves"],
        acuerdos: ["La promo 2x1 queda aprobada", "Pautar con objetivo mensajes, $60.000 por video", "Sumar un video de noche de fútbol"],
        tareas: [
          { tarea: "Corregir precio en el combo familiar", responsable: "Natalia", fecha: "jueves" },
          { tarea: "Planificar el video de noche de fútbol", responsable: "Lucía", fecha: "esta semana" },
          { tarea: "Mandar logo en alta calidad", responsable: "Martín", fecha: null },
        ],
        generado_at: iso(-2, 18), fuente: "audio",
      },
    },
    rn2: {
      titulo: "Planificación de noviembre", proyecto_id: null, chat_id: "equipo", fecha: iso(1, 9),
      link: "https://meet.jit.si/Prodi-Planificacion-x9y8z7", participantes: ["u_lucas", "u_lucia", "u_nati", "u_eze", "u_ivan"], creada_por: "u_lucas",
      estado: "programada", notas: null, minuta: null, attachments_crudo: [], created_at: iso(-1),
    },
    rn3: {
      titulo: "Lanzamiento colección de sol", proyecto_id: "p2", chat_id: "cliente_p2", fecha: iso(0, 23),
      link: "https://meet.jit.si/Prodi-OpticasSol-q4w5e6", participantes: ["u_lucia", "u_cli2", "u_ivan"], creada_por: "u_lucia",
      estado: "programada", notas: "Carla quiere 3 videos para el lanzamiento + placas. Presupuesto de pauta a definir.", minuta: null, attachments_crudo: [], created_at: iso(-1),
    },
  };

  // ---- Plan del mes con IA ----
  const mesSig = mesDe(1);
  const idea = (id: string, titulo: string, texto: string, objetivo: string, porque: string, extra: Record<string, any> = {}) => ({
    id, titulo, idea: texto, objetivo, porque, origen: "ia", respuesta: null, video_id: null, ...extra,
  });
  const ideasDonTano = [
    idea("pi1", "Especial Día de la Madre", "Una mamá y sus hijos comparten una pizza en el salón. Gancho: “¿Ya sabés dónde la llevás?”. Cierre con “Reservá por WhatsApp”.", "Conseguir reservas", "Es la fecha más fuerte del mes y el año pasado trajo muchas reservas."),
    idea("pi2", "La fugazzeta que se estira", "Plano en cámara lenta del queso estirándose, con el sonido del horno. Texto: “48 horas de masa madre”.", "Antojar y conseguir pedidos", "Los planos de producto con queso son los que más mensajes trajeron."),
    idea("pi3", "Noche de fútbol en Don Tano", "El salón lleno mirando el partido, gritos de gol y pizzas saliendo. Cierre: “Vení a ver el partido con nosotros”.", "Llenar el salón los días de partido", "Martín lo pidió en la última reunión."),
    idea("pi4", "Delivery hasta las 2 AM", "Seguimos a un repartidor de noche desde el horno hasta la puerta de un cliente. Cierre con el horario en pantalla.", "Pedidos de noche", "El delivery tarde es lo que los diferencia.", { origen: "equipo" }),
  ];
  const planes_mes: Record<string, any> = {
    [`p1_${mesSig}`]: {
      proyecto_id: "p1", mes: mesSig, estado: "enviado", ideas: ideasDonTano, ideas_ia: ideasDonTano.slice(0, 3), descartadas: ["Tres cosas que no sabías"], cupo: 8,
      nota_equipo: "¡Hola Martín! Para noviembre pensamos en el Día de la Madre y en aprovechar los partidos. Contanos qué te parece.",
      generado_at: iso(-1, 9), generado_por: "u_lucia", enviado_at: iso(-1, 11), enviado_por: "u_lucia", recordatorios: 0, updated_at: iso(-1, 11),
    },
    [`p3_${mesSig}`]: (() => {
      const ideas = [
        idea("gi1", "Desafío de 30 días", "Arranca con un socio el día 1 y vamos mostrando 3 momentos hasta el día 30. Cierre: “Sumate al próximo desafío”.", "Conseguir socios nuevos", "Los antes y después fueron lo que más mensajes trajo en el gimnasio."),
        idea("gi2", "Un profe, un consejo", "Cada profe da un consejo de 5 segundos sobre un error común en la sala. Ritmo rápido, texto en pantalla.", "Posicionarse como expertos", "Los consejos útiles se guardan y se comparten."),
        idea("gi3", "Llegó el verano: plan intensivo", "Promo a definir con el cliente. Tomas de la sala llena y la clase de funcional, con cuenta regresiva al verano.", "Vender el plan de verano", "Noviembre es cuando más gente arranca para llegar al verano."),
      ];
      return { proyecto_id: "p3", mes: mesSig, estado: "borrador", ideas, ideas_ia: ideas, descartadas: [], cupo: 12, nota_equipo: null, generado_at: iso(0, 7), generado_por: "u_lucia", updated_at: iso(0, 7) };
    })(),
  };
  const ia_memoria: Record<string, any> = {
    p1: {
      proyecto_id: "p1",
      resumen: [
        "- Al cliente le gustan los planos de producto con queso y horno: son los que más mensajes traen.",
        "- Prefiere humor y voseo; no quiere videos “de catálogo” con precios en pantalla.",
        "- Producción cambia las promos genéricas por algo concreto del local (delivery tarde, partidos).",
        "- Evitar: “Tres cosas que no sabías”, “Conocé al equipo” (Martín no quiere salir en cámara).",
      ].join("\n"),
      notas_equipo: "No mostrar precios salvo que Martín lo pida. Siempre cerrar con “Pedí por WhatsApp”.",
      comercial: {
        enfoque: "Familias y grupos de amigos de la ciudad. Lo que más consultan es el delivery de noche y los combos para compartir. Ganan por la masa madre de 48 horas y el horno a leña: hay que mostrarlo siempre.",
        objetivo: "Pedidos de delivery por WhatsApp y reservas para el fin de semana",
        productos: [
          { id: "pr1", nombre: "Combo familiar (2 pizzas grandes + gaseosa)", precio: "$18.900", detalle: "El que más se vende los viernes y sábados", destacado: true },
          { id: "pr2", nombre: "Fugazzeta rellena", precio: "$12.500", detalle: "La especialidad de la casa", destacado: true },
          { id: "pr3", nombre: "Delivery hasta las 2 AM", detalle: "Sin cargo en el centro" },
          { id: "pr4", nombre: "Menú del mediodía", precio: "$9.900", detalle: "Porción + gaseosa, de lunes a viernes" },
        ],
        temporadas: [
          { id: "tp1", titulo: "Promo Día de la Madre", detalle: "Postre de regalo para mamá en reservas de 4 o más", desde: ymd(-4), hasta: ymd(14) },
          { id: "tp2", titulo: "Noches de fútbol", detalle: "Pantalla gigante y 2x1 en cerveza en los partidos de la Selección", desde: null, hasta: null },
          { id: "tp3", titulo: "Pizzas a la parrilla de verano", detalle: "Carta de verano con pizzas a la parrilla", desde: ymd(60), hasta: ymd(150) },
        ],
        actualizado_at: iso(-10),
      },
      ejemplos: [
        { mes: mesAnt, at: iso(-35), tipo: "equipo", aprobadas: ["Promo 2x1 de los jueves"], editadas: [{ antes: "La promo de la semana", despues: "Delivery hasta las 2 AM" }], descartadas: ["Tres cosas que no sabías"], agregadas: [] },
        { mes: mesAnt, at: iso(-33), tipo: "cliente", cliente_ok: ["Promo 2x1 de los jueves", "Cómo hacemos la masa madre"], cliente_cambios: [{ titulo: "Conocé al equipo", comentario: "No quiero salir en cámara, mejor mostrar a los pizzeros" }], nota_cliente: null },
      ],
      actualizado_at: iso(-33),
    },
  };

  // ---- Facturación: últimos 11 meses (los clientes fueron entrando de a uno) ----
  const facturas: Record<string, any> = {};
  const alta: Record<string, number> = { p1: -11, p2: -8, p3: -6, p4: -4, p5: -2 };
  for (const [pid, desdeM] of Object.entries(alta)) {
    const pr = projects[pid];
    const plan = (planes as Record<string, any>)[pr.plan_redes_id];
    for (let k = desdeM; k <= -1; k++) {
      const m = mesDe(k);
      // Los abonos subieron un 15% hace 5 meses.
      const abono = Math.round((k < -5 ? plan.precio_mensual * 0.87 : plan.precio_mensual) / 1000) * 1000;
      const f: any = armarFactura(
        { id: pid, nombre: pr.nombre, abono, facturacion: pr.facturacion ?? null, debitoActivo: pr.suscripcion?.estado === "activa" },
        m,
        { ivaPct: 21, diaVencimiento: 10, por: "u_lucas", hoy: `${m}-27` }
      );
      // Todo cobrado menos la última de la heladería, que quedó vencida.
      const vencida = pid === "p5" && k === -1;
      f.estado = vencida ? "pendiente" : "cobrada";
      f.vencimiento = vencida ? ymd(-2) : f.vencimiento;
      f.medio = vencida ? null : pr.suscripcion ? "mercadopago" : k % 2 ? "transferencia" : "efectivo";
      f.cobrado_at = vencida ? null : `${f.vencimiento}T15:00:00.000Z`;
      f.emitida_at = `${m}-27T12:00:00.000Z`;
      f.creada_at = `${m}-27T11:00:00.000Z`;
      facturas[`${pid}_${m}`] = f;
    }
  }
  // Cómo se le paga a cada uno (ejemplo).
  const equipo_pagos: Record<string, any> = {
    u_lucia: { modo: "fijo", fijo: 450000, por_unidad: 0, activo: true },
    u_nati: { modo: "mixto", fijo: 250000, por_unidad: 10000, activo: true },
    u_eze: { modo: "por_cliente", fijo: 0, por_unidad: 0, por_cliente: { p1: 70000, p3: 90000, p5: 45000 }, activo: true },
    u_ivan: { modo: "por_cliente", fijo: 0, por_unidad: 0, por_cliente: { p2: 45000, p4: 60000 }, activo: true },
    u_karen: { modo: "mixto", fijo: 150000, por_unidad: 6000, activo: true },
  };

  // ---- Gastos (ejemplo): fijos que se repiten y algunos sueltos ----
  const gastos: Record<string, any> = {};
  const fijosG: [string, string, number, string, number][] = [
    ["Alquiler oficina", "Alquiler y servicios", 260000, "Inmobiliaria Centro", 5],
    ["Canva Pro + Adobe", "Software y suscripciones", 52000, "Adobe / Canva", 3],
    ["Contador", "Contador y bancos", 80000, "Estudio Gómez", 10],
    ["Internet y celulares", "Alquiler y servicios", 42000, "Personal", 12],
  ];
  for (let k = -11; k <= 0; k++) {
    const m = mesDe(k);
    // Con la inflación, los fijos de hace un año eran más baratos.
    const ajuste = Math.pow(0.975, -k);
    fijosG.forEach(([concepto, categoria, monto, proveedor, dia], i) => {
      if (k === 0 && dia > new Date().getDate()) return; // los del mes en curso que todavía no vencieron
      gastos[`g${k + 1}_${i}`] = { fecha: `${m}-${String(dia).padStart(2, "0")}`, mes: m, concepto, categoria, monto: Math.round((monto * ajuste) / 1000) * 1000, medio: "transferencia", proveedor, fijo: true, created_at: iso(-30), created_by: "u_admin" };
    });
  }
  // Algunos gastos sueltos de meses anteriores.
  ([
    [-10, "Luces LED para rodaje", "Equipos", 310000],
    [-8, "Publicidad propia en Instagram", "Publicidad propia", 120000],
    [-6, "Cámara Sony ZV-E10", "Equipos", 1150000],
    [-4, "Nafta rodajes", "Viáticos y combustible", 64000],
    [-3, "Publicidad propia en Instagram", "Publicidad propia", 150000],
    [-2, "Disco externo 2 TB", "Equipos", 140000],
  ] as [number, string, string, number][]).forEach(([k, concepto, categoria, monto], i) => {
    const m = mesDe(k);
    gastos[`gs${i}`] = { fecha: `${m}-14`, mes: m, concepto, categoria, monto, medio: "transferencia", proveedor: null, fijo: false, created_at: iso(k * 30), created_by: "u_admin" };
  });

  // ---- Pagos al equipo ya hechos (meses anteriores) ----
  const equipo_liquidaciones: Record<string, any> = {};
  const ingreso: [string, number, number][] = [
    ["u_lucia", -11, 450000],
    ["u_nati", -11, 430000],
    ["u_eze", -9, 130000],
    ["u_karen", -6, 230000],
    ["u_ivan", -4, 90000],
  ];
  for (const [uid, desdeM, base] of ingreso) {
    for (let k = desdeM; k <= -1; k++) {
      // El mes pasado todavía falta pagarles a algunos.
      if (k === -1 && !["u_lucia", "u_karen"].includes(uid)) continue;
      const m = mesDe(k);
      // Con menos clientes se trabajaba menos: el pago crecía junto con la cartera.
      const activos = Object.values(alta).filter((d) => d <= k).length;
      const total = Math.round((base * (0.45 + (0.55 * activos) / 5) * (0.94 + (Math.abs(k * 7 + uid.length) % 5) * 0.03)) / 1000) * 1000;
      equipo_liquidaciones[`${uid}_${m}`] = { uid, mes: m, ajustes: [], estado: "pagado", pagado_at: `${m}-28T18:00:00.000Z`, total_pagado: total, detalle: null };
    }
  }

  // ---- Deudas e impuestos ----
  const hoyStr = ymd(0);
  const cuotasDe = (desdeMes: number, dia: number, cantidad: number, monto: (i: number) => number, sinPagar: number[] = []) =>
    Array.from({ length: cantidad }, (_, i) => {
      const m = mesDe(desdeMes + i);
      const vence = `${m}-${String(dia).padStart(2, "0")}`;
      const pagada = vence < hoyStr && !sinPagar.includes(i + 1);
      return { n: i + 1, vence, monto: monto(i), pagada, pagada_at: pagada ? `${vence}T13:00:00.000Z` : null, medio: pagada ? "debito" : null };
    });
  // Que algo venza en los próximos días para ver el aviso.
  const diaPronto = Math.min(28, new Date(Date.now() + 2 * DAY).getDate());
  const obligaciones: Record<string, any> = {
    ob1: {
      tipo: "credito", nombre: "Crédito Banco Galicia", entidad: "Banco Galicia", detalle: "Para la cámara y las luces",
      cuotas: cuotasDe(-5, diaPronto, 12, () => 220000), activa: true, created_at: iso(-160), created_by: "u_admin",
    },
    ob2: {
      tipo: "arca", nombre: "Plan de pagos ARCA", entidad: "ARCA", detalle: "Plan de facilidades 2025",
      cuotas: cuotasDe(-8, 16, 24, () => 90000, [8]), activa: true, created_at: iso(-250), created_by: "u_admin",
    },
    ob3: {
      tipo: "impuesto", nombre: "Monotributo", entidad: "ARCA", detalle: null,
      cuotas: cuotasDe(-11, 20, 23, (i) => (i < 6 ? 52000 : 62000)), activa: true, created_at: iso(-330), created_by: "u_admin",
    },
    ob4: {
      tipo: "impuesto", nombre: "Ingresos Brutos", entidad: "API Santa Fe", detalle: null,
      cuotas: cuotasDe(-11, 13, 23, (i) => Math.round((22000 + i * 3500) / 1000) * 1000), activa: true, created_at: iso(-330), created_by: "u_admin",
    },
  };
  Object.values(obligaciones).forEach((o: any) => o.cuotas.forEach((c: any) => c.pagada && (c.medio = o.tipo === "credito" ? "debito" : "transferencia")));
  // El de Ingresos Brutos de este mes venció y falta pagarlo.
  const iibbMes = obligaciones.ob4.cuotas.find((c: any) => c.vence.startsWith(mesDe(0)));
  if (iibbMes && iibbMes.vence < hoyStr) Object.assign(iibbMes, { pagada: false, pagada_at: null, medio: null });

  gastos.gx1 = { fecha: `${mesDe(-1)}-18`, mes: mesDe(-1), concepto: "Micrófonos corbateros", categoria: "Equipos", monto: 85000, medio: "mercadopago", proveedor: "MercadoLibre", fijo: false, created_at: iso(-20), created_by: "u_admin" };
  gastos.gx2 = { fecha: ymd(-2), mes: ymd(-2).slice(0, 7), concepto: "Nafta rodajes", categoria: "Viáticos y combustible", monto: 38000, medio: "efectivo", proveedor: null, fijo: false, created_at: iso(-2), created_by: "u_admin" };

  return {
    gastos,
    equipo_liquidaciones,
    obligaciones,
    facturas,
    equipo_pagos,
    planes_mes,
    ia_memoria,
    chats,
    reuniones,
    ...mensajes,
    profiles,
    planes_redes: planes,
    projects,
    videos,
    rodajes,
    piezas_ia: piezas,
    cobros,
    in_app_notifications,
    app_settings: {
      redes: { precio_pieza_ia: 18000, precio_pieza_impresion: 28000, dias_alerta: 3, informe_automatico: true, dia_vencimiento: 5, iva_pct: 21 },
      drive_connection: { status: "connected", email: "prodi.redes@gmail.com" },
      whatsapp_bot: { bot_enabled: true },
    },
  };
}
