// Unifica en Prodi los dos sistemas viejos de Firebase ("progreso" = Prodi Redes viejo, "postgo" = PostGo),
// pasando sus datos del MODELO VIEJO (tareas de contenido) al MODELO NUEVO (videos, piezas, clientes, perfiles).
//
// SOLO LEE Firebase (Firestore y Auth): nunca escribe ni borra nada allá.
// SOLO AGREGA en Postgres: insert … on conflict do nothing. Nunca modifica ni borra filas que ya existen.
// Los ids son deterministas, así que correrlo dos veces no duplica nada.
//
// Uso (llave en certs/firebase-<origen>.json, no se sube a git):
//   pnpm unificar:viejo --origen=progreso --inspeccionar        → muestra el esquema viejo (solo Firebase, no toca la base)
//   pnpm unificar:viejo --origen=progreso                       → SIMULACIÓN contra la base de DATABASE_URL (solo lee)
//   pnpm unificar:viejo --origen=progreso --aplicar             → agrega en la base LOCAL
//   pnpm unificar:viejo --origen=progreso --aplicar --produccion → agrega en una base que no es local
// Orden recomendado: primero progreso, después postgo (así los mails y clientes repetidos quedan unidos).
//
// ─── MAPEO (viejo → nuevo) ────────────────────────────────────────────────────────────────────────────────
// Usuarios (Firebase Auth + profiles):
//   · Se buscan por MAIL (minúsculas) en `usuarios` de la base destino. Si existe: se reusa ese uid (no se toca
//     ni el usuario ni su perfil) y todas las referencias viejas (equipo del cliente, responsables, chats,
//     historial…) pasan al uid existente. Si no: se crea con el uid viejo (o "<origen>_<uid>" si ese uid ya
//     lo usa otra persona) y la contraseña de Firebase como "fbscrypt$sal$hash" (progreso) o
//     "fbscrypt$sal$hash$postgo" (postgo, valida con FIREBASE_HASH_POSTGO_*; ver api/_lib/cuentas.ts).
//   · Perfil nuevo: nombre, email, avatarColor, profileImage (si es una imagen chica), theme, created_at,
//     activo (false si estaba deshabilitado en Auth) y role:
//       admin→admin · productor→productor · editor→editor · cliente→cliente
//       pm→productor · cm→pauta · disenador→diseno · otro/sin rol→pending
//     Se descartan: fcm_tokens, whatsapp_*, project_permissions, dashboard_access, filtros y preferencias viejas.
// Clientes (projects):
//   · Si en destino ya hay un cliente con el mismo id, o con el mismo nombre normalizado (minúsculas, sin
//     tildes, espacios simples), se reusa ese (no se modifica) y se le cuelgan los videos/piezas.
//   · Si no, se crea "projects/<origen>_<id>": nombre, color, enabled (sin campo = true), created_at, alta,
//     unidad: "<origen>", team_roles { productor: productor+pm, editor, pauta: cm, cliente } con uids nuevos
//     (un rol vacío se completa con los perfiles de ese rol que tenían el cliente en project_permissions, o
//     si no, con los responsables de sus tareas que tenían ese rol),
//     facturacion.tipo = client_portal.comprobante (si había). plan_redes_id queda vacío (los planes viejos
//     eran por tipo de contenido, no por videos). Lo viejo que no tiene lugar va en `_viejo`.
// Tareas (tasks):
//   · Reel e Historia Audiovisual (o sin tipo con archivo de video) → videos/<origen>_<id>.
//   · Historia, Feed y Feed Carrusel → piezas_ia/<origen>_<id> (precio 0, sin cobro, incluida: false para no
//     gastar el cupo de piezas del plan nuevo; versión enviada/aprobada = último archivo final).
//   · Tareas de "material crudo" (is_raw_material_task) no se crean aparte: su crudo y su responsable
//     (productor) se suman al video de la tarea principal.
//   · etapa del video según estado viejo:
//       Sin Iniciar / En Producción → edicion si tiene crudo, si no planificado
//       Producido sin Aprobar → revision_cliente (si el cliente revisaba) o revision_interna
//       Para Publicar → para_publicar · Programado / Publicado → publicado
//     estado de la pieza: Sin Iniciar→pagada · En Producción→en_proceso · Producido sin Aprobar→para_aprobar ·
//       Para Publicar / Programado / Publicado→entregada
//     Lo que quedó sin terminar de meses anteriores al actual (--cierre=YYYY-MM) se cierra como publicado/entregada,
//     con la nota en el historial y el estado viejo en `_viejo.estado` (el sistema viejo no se usaba para
//     marcar lo publicado; si no, el tablero y el panel del cliente se llenan de pendientes falsos).
//   · mes = fecha de la tarea (o creación) en hora argentina. Adjuntos: misma forma, con su drive_file_id.
//   · idea = descripción (+ notas), feedback_interno = feedback_pm, feedback_cliente, cliente_rating,
//     rondas = pedidos de cambio del cliente, historial = cambios de estado + revisiones del cliente.
//   · content_ratings (rúbricas) y client_reviews quedan en el video/pieza (`_viejo.calificaciones`, historial).
// Otros:
//   · chats: los grupos de cliente y "equipo" los arma la app sola; solo se copian los que tienen mensajes
//     (con sus mensajes y audios), con miembros y autores remapeados.
//   · videos (ya en modelo nuevo, progreso) → videos/<origen>_<id> remapeado.
//   · team_meetings → reuniones/<origen>_<id>.
//   · Se omiten (y se informa): in_app_notifications, notification_queue, whatsapp_verifications, phone_users,
//     user_filters*, app_settings, reminders (WhatsApp), task_structures, execution_guides(_checks),
//     content_plans (planes por tipo de contenido), portal_service_* (catálogo viejo del portal).
// Todo lo creado lleva `_origen` y `_id_viejo`.

import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp, GeoPoint, DocumentReference } from "firebase-admin/firestore";
import fsArch from "fs";

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");
const flag = (n) => process.argv.includes(`--${n}`);
const ORIGEN = arg("origen");
if (!["progreso", "postgo"].includes(ORIGEN)) {
  console.error("Indicá el origen: --origen=progreso o --origen=postgo");
  process.exit(1);
}
const APLICAR = flag("aplicar");
const PRODUCCION = flag("produccion");
const INSPECCIONAR = flag("inspeccionar");
/** Lo no terminado con mes anterior a este se cierra (por defecto: el mes actual; --cierre=YYYY-MM para cambiarlo). */
const CIERRE = arg("cierre") ?? mesAR(new Date().toISOString());
if (!/^\d{4}-\d{2}$/.test(CIERRE)) {
  console.error("--cierre tiene que ser YYYY-MM");
  process.exit(1);
}

const LLAVE = arg("llave") ?? `certs/firebase-${ORIGEN}.json`;
if (!fsArch.existsSync(LLAVE)) {
  console.error(`No encontré la llave ${LLAVE}`);
  process.exit(1);
}
initializeApp({ credential: cert(JSON.parse(fsArch.readFileSync(LLAVE, "utf8"))) });
const fs = getFirestore();

// ─── utilidades ─────────────────────────────────────────────────────────────────────────────────────────
function tipo(v) {
  if (v === null || v === undefined) return "null";
  if (v instanceof Timestamp) return "timestamp";
  if (v instanceof Date) return "date";
  if (v instanceof GeoPoint) return "geo";
  if (v instanceof DocumentReference) return "ref";
  if (Array.isArray(v)) return "array";
  return typeof v;
}
const redactar = (s) => String(s).replace(/([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+)/g, "$1***@$2");
const tapar = (mail) => redactar(mail ?? "");
function aJson(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (v instanceof Date) return v.toISOString();
  if (v instanceof GeoPoint) return { lat: v.latitude, lng: v.longitude };
  if (v instanceof DocumentReference) return v.path;
  if (Array.isArray(v)) return v.map(aJson);
  if (typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, aJson(x)]));
  return v;
}
function ejemplo(v) {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (typeof v === "string") return redactar(v.length > 60 ? v.slice(0, 60) + "…" : v);
  if (Array.isArray(v)) return `[${v.length}] ` + (v.length ? redactar(JSON.stringify(aJson(v[0])).slice(0, 220)) : "");
  if (v && typeof v === "object") return redactar(JSON.stringify(aJson(v)).slice(0, 220));
  return String(v);
}
/** Mes (YYYY-MM) en hora argentina (UTC-3). */
function mesAR(iso) {
  const t = Date.parse(iso ?? "");
  if (isNaN(t)) return null;
  return new Date(t - 3 * 3600_000).toISOString().slice(0, 7);
}
const normalizar = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
const contar = (o, k, n = 1) => (o[k] = (o[k] ?? 0) + n);
const leer = async (col) => (await fs.collection(col).get()).docs.map((d) => ({ id: d.id, ...aJson(d.data()) }));

// ─── modo inspección (solo Firebase) ────────────────────────────────────────────────────────────────────
if (INSPECCIONAR) {
  const COLS = (
    arg("colecciones") ??
    "tasks,projects,profiles,chats,content_ratings,client_reviews,content_plans,team_meetings,reminders,task_structures,execution_guides,portal_service_categories,portal_service_requests,videos"
  ).split(",");
  const VALORES = ["estado", "tipo", "role", "status", "type", "review_flow", "completed", "is_raw_material_task", "requires_raw_material", "enabled", "eval_type", "rated_user_role", "decision", "action"];
  for (const c of COLS) {
    const snap = await fs.collection(c).get();
    console.log(`\n=== ${c} (${snap.size})`);
    const campos = {};
    const valores = {};
    for (const d of snap.docs) {
      for (const [k, v] of Object.entries(d.data())) {
        const t = tipo(v);
        campos[k] ??= { tipos: new Set(), n: 0, ej: [] };
        campos[k].tipos.add(t);
        campos[k].n++;
        if (k === "email" || k.startsWith("whatsapp_phone") || k === "phone" || k === "fcm_tokens") {
          if (campos[k].ej.length < 1 && t === "string") campos[k].ej.push(k === "email" ? tapar(v) : "(oculto)");
          continue;
        }
        if (campos[k].ej.length < 2 && t !== "null" && !(t === "array" && !v.length) && v !== "") campos[k].ej.push(ejemplo(v));
        if (VALORES.includes(k) && (typeof v === "string" || typeof v === "boolean")) {
          valores[k] ??= {};
          contar(valores[k], v);
        }
      }
    }
    for (const [k, x] of Object.entries(campos).sort())
      console.log(`  ${k.padEnd(32)} ${[...x.tipos].join("|").padEnd(18)} ${String(x.n).padStart(5)}  ${x.ej.map((e) => e.replace(/\s+/g, " ")).join("  ‖  ")}`);
    for (const [k, m] of Object.entries(valores)) console.log(`  valores de ${k}: ${JSON.stringify(m)}`);
    if (c === "tasks" && snap.size) {
      const cruz = {};
      const porMes = {};
      for (const d of snap.docs) {
        const t = d.data();
        contar(cruz, `${t.tipo ?? "(sin tipo)"} · ${t.estado} · completed=${t.completed}${t.is_raw_material_task ? " · crudo" : ""}`);
        const mes = mesAR(t.fecha || t.created_at) ?? "?";
        porMes[mes] ??= {};
        contar(porMes[mes], t.estado);
      }
      console.log("  tipo · estado · completed:");
      for (const [k, n] of Object.entries(cruz).sort()) console.log(`    ${k.padEnd(70)} ${n}`);
      console.log("  estado por mes:");
      for (const [m, x] of Object.entries(porMes).sort()) console.log(`    ${m}  ${JSON.stringify(x)}`);
    }
    if (c === "chats") {
      for (const d of snap.docs) {
        const subs = await d.ref.listCollections();
        const cant = [];
        for (const s of subs) cant.push(`${s.id}:${(await s.count().get()).data().count}`);
        console.log(`  chat ${d.id.padEnd(40)} tipo=${d.data().tipo} miembros=${(d.data().miembros ?? []).length} ${cant.join(" ")}`);
      }
      const conMsg = snap.docs[0] ? await snap.docs[0].ref.collection("mensajes").limit(1).get() : null;
      if (conMsg?.docs[0]) console.log(`  ej. mensaje: campos ${JSON.stringify(Object.keys(conMsg.docs[0].data()))}`);
    }
  }
  // Usuarios de Auth: solo cantidades.
  const r = await getAuth().listUsers(1000);
  console.log(`\n=== Auth: ${r.users.length} usuarios · ${r.users.filter((u) => u.passwordHash).length} con hash · ${r.users.filter((u) => u.disabled).length} deshabilitados · ${r.users.filter((u) => !u.email).length} sin mail`);
  process.exit(0);
}

// ─── conversión ─────────────────────────────────────────────────────────────────────────────────────────
const { default: pg } = await import("pg");
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Falta DATABASE_URL.");
  process.exit(1);
}
const local = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
if (APLICAR && !local && !PRODUCCION) {
  console.error("La base no es local. Para escribir en producción agregá --produccion (solo agrega, no pisa).");
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: url, ssl: local ? undefined : { rejectUnauthorized: true }, max: 3 });
const q = async (sql, params) => (await pool.query(sql, params)).rows;
const host = (() => {
  try {
    return new URL(url).host;
  } catch {
    return "?";
  }
})();

console.log(`Origen: Firebase "${ORIGEN}" (proyecto ${JSON.parse(fsArch.readFileSync(LLAVE, "utf8")).project_id})`);
console.log(`Destino: ${local ? "base LOCAL" : "base NO local (producción)"} (${host})`);
console.log(APLICAR ? "APLICANDO: se agrega lo nuevo (lo que ya existe no se toca)." : "SIMULACIÓN: no se escribe nada. Para agregar: --aplicar");
console.log(`Cierre: lo no terminado de antes de ${CIERRE} se cierra como publicado/entregado.\n`);

const AVISOS = [];
const avisar = (s) => AVISOS.push(s);
const AHORA = new Date().toISOString();
const MIGRACION = "migracion";
const nid = (id) => `${ORIGEN}_${id}`;

// Lo que hay en el destino.
const destUsuarios = await q("select uid, lower(email) as email from usuarios");
const uidPorMail = new Map(destUsuarios.map((r) => [r.email, r.uid]));
const uidsDest = new Set(destUsuarios.map((r) => r.uid));
const destPerfiles = await q("select id, lower(data->>'email') as email from documentos where coleccion = 'profiles'");
const perfilPorMail = new Map(destPerfiles.filter((r) => r.email).map((r) => [r.email, r.id]));
const perfilesDest = new Set(destPerfiles.map((r) => r.id));
const destClientes = await q("select id, data->>'nombre' as nombre from documentos where coleccion = 'projects'");
const clienteDestPorId = new Map(destClientes.map((r) => [r.id, r]));
const clienteDestPorNombre = new Map();
for (const r of destClientes) if (!clienteDestPorNombre.has(normalizar(r.nombre))) clienteDestPorNombre.set(normalizar(r.nombre), r);

// Lo que hay en el origen.
const [perfilesV, proyectosV, tareasV, reviewsV, ratingsV, reunionesV, videosNV] = await Promise.all(
  ["profiles", "projects", "tasks", "client_reviews", "content_ratings", "team_meetings", "videos"].map(leer)
);
const authV = [];
{
  let token;
  do {
    const r = await getAuth().listUsers(1000, token);
    authV.push(...r.users);
    token = r.pageToken;
  } while (token);
}

// ─── usuarios ───────────────────────────────────────────────────────────────────────────────────────────
const ROL = { admin: "admin", productor: "productor", editor: "editor", cliente: "cliente", pm: "productor", cm: "pauta", disenador: "diseno" };
const mapaU = new Map(); // uid viejo → uid nuevo
const rolViejo = new Map(); // uid viejo → rol viejo
const nuevosUsuarios = []; // { uid, email, clave_hash, nombre, desactivado }
const nuevosPerfiles = [];
const usuariosEmparejados = [];
const usuariosOmitidos = [];
const rolesNuevos = {};
const conClaveFb = { si: 0, no: 0 };
{
  const perfilPorUid = new Map(perfilesV.map((p) => [p.id, p]));
  const authPorUid = new Map(authV.map((u) => [u.uid, u]));
  const uids = [...new Set([...authPorUid.keys(), ...perfilPorUid.keys()])];
  const enEstaCorrida = new Map(); // mail → uid nuevo (dos cuentas viejas con el mismo mail)
  for (const uid of uids) {
    const a = authPorUid.get(uid);
    const p = perfilPorUid.get(uid);
    rolViejo.set(uid, p?.role ?? null);
    const mail = (a?.email ?? p?.email ?? "").trim().toLowerCase();
    if (!mail) {
      usuariosOmitidos.push(`${uid.slice(0, 6)}… sin mail`);
      continue;
    }
    const existente = uidPorMail.get(mail) ?? enEstaCorrida.get(mail);
    if (existente) {
      mapaU.set(uid, existente);
      usuariosEmparejados.push(`${tapar(mail)} → ${existente === uid ? "mismo uid" : existente}`);
      continue;
    }
    if (perfilPorMail.has(mail)) {
      // Hay un perfil con ese mail pero sin usuario para entrar: se reusa, sin crear nada.
      const pid = perfilPorMail.get(mail);
      mapaU.set(uid, pid);
      usuariosEmparejados.push(`${tapar(mail)} → perfil ${pid} (sin usuario en la tabla usuarios)`);
      avisar(`${tapar(mail)}: tiene perfil en destino pero no usuario para entrar; no se creó usuario.`);
      continue;
    }
    const nuevo = uidsDest.has(uid) || perfilesDest.has(uid) ? nid(uid) : uid;
    mapaU.set(uid, nuevo);
    enEstaCorrida.set(mail, nuevo);
    let hash = null;
    if (a?.passwordHash && a?.passwordSalt) hash = `fbscrypt$${a.passwordSalt}$${a.passwordHash}${ORIGEN === "progreso" ? "" : "$" + ORIGEN}`;
    hash ? conClaveFb.si++ : conClaveFb.no++;
    const nombre = p?.nombre ?? a?.displayName ?? mail.split("@")[0];
    const desactivado = !!a?.disabled;
    nuevosUsuarios.push({ uid: nuevo, email: mail, clave_hash: hash, nombre, desactivado });
    const role = ROL[p?.role] ?? "pending";
    contar(rolesNuevos, `${p?.role ?? "(sin perfil)"} → ${role}`);
    const imagen = typeof p?.profileImage === "string" && /^data:image\/(jpeg|png|webp);base64,/.test(p.profileImage) && p.profileImage.length <= 200_000 ? p.profileImage : undefined;
    if (p?.profileImage && !imagen) avisar(`Foto de perfil de ${tapar(mail)} descartada (muy grande o no es imagen).`);
    nuevosPerfiles.push({
      id: nuevo,
      data: {
        nombre,
        email: mail,
        role,
        ...(p?.avatarColor ? { avatarColor: p.avatarColor } : {}),
        ...(imagen ? { profileImage: imagen } : {}),
        ...(p?.theme ? { theme: p.theme } : {}),
        ...(desactivado ? { activo: false } : {}),
        ...(Array.isArray(p?.extra_panel_roles)
          ? { extra_panel_roles: [...new Set(p.extra_panel_roles.map((r) => ROL[r]).filter((r) => r && r !== role))] }
          : {}),
        created_at: p?.created_at ?? a?.metadata?.creationTime ? new Date(p?.created_at ?? a.metadata.creationTime).toISOString() : AHORA,
        _origen: ORIGEN,
        _id_viejo: uid,
        _rol_viejo: p?.role ?? null,
      },
    });
  }
}
/** Rol viejo de un uid nuevo (para saber quién era editor o productor). */
const rolDe = (nuevo) => { for (const [v, n] of mapaU) if (n === nuevo && rolViejo.get(v)) return rolViejo.get(v); return null; };
const U = (uid) => (typeof uid === "string" ? mapaU.get(uid) ?? null : null);
const Us = (arr) => [...new Set((Array.isArray(arr) ? arr : []).map(U).filter(Boolean))];
const porDesconocido = new Set();
const Uby = (uid) => {
  if (typeof uid !== "string" || !uid) return MIGRACION;
  const m = U(uid);
  if (!m) porDesconocido.add(uid);
  return m ?? uid;
};

// ─── clientes ───────────────────────────────────────────────────────────────────────────────────────────
const mapaP = new Map(); // id viejo → id destino
const proyectoV = new Map(proyectosV.map((p) => [p.id, p]));
const nuevosClientes = [];
const clientesEmparejados = [];
{
  const creadosPorNombre = new Map();
  for (const p of proyectosV) {
    const n = normalizar(p.nombre);
    const porId = clienteDestPorId.get(p.id) ?? clienteDestPorId.get(nid(p.id));
    const porNombre = clienteDestPorNombre.get(n);
    if (porId && porId.id === nid(p.id)) {
      mapaP.set(p.id, porId.id); // ya migrado antes con esta herramienta
      clientesEmparejados.push(`${p.nombre} → ya migrado (${porId.id})`);
      continue;
    }
    if (porId || porNombre) {
      const x = porId ?? porNombre;
      mapaP.set(p.id, x.id);
      clientesEmparejados.push(`${p.nombre} → existente "${x.nombre}" (${x.id}) por ${porId ? "id" : "nombre"}`);
      continue;
    }
    if (creadosPorNombre.has(n)) {
      mapaP.set(p.id, creadosPorNombre.get(n));
      avisar(`Cliente repetido en ${ORIGEN}: "${p.nombre}" (${p.id}) se une a ${creadosPorNombre.get(n)}.`);
      continue;
    }
    const id = nid(p.id);
    mapaP.set(p.id, id);
    creadosPorNombre.set(n, id);
    const tr = p.team_roles ?? {};
    const comprobante = p.client_portal?.comprobante;
    nuevosClientes.push({
      id,
      data: {
        nombre: String(p.nombre ?? "Cliente").trim(),
        color: p.color ?? "#6366f1",
        enabled: p.enabled !== false,
        team_roles: Object.fromEntries(
          Object.entries({
            productor: [...(tr.productor ?? []), ...(tr.pm ?? [])],
            editor: tr.editor,
            pauta: tr.cm,
            cliente: tr.cliente,
          }).map(([rol, uids]) => {
            // Rol vacío: se completa con quienes tenían el cliente en project_permissions y ese rol (nuevo).
            let lista = Us(uids);
            if (!lista.length) lista = Us(perfilesV.filter((x) => ROL[x.role] === rol && (x.project_permissions ?? []).includes(p.id)).map((x) => x.id));
            // Si sigue vacío: los responsables de sus tareas que tenían ese rol.
            if (!lista.length && rol !== "cliente")
              lista = Us(tareasV.filter((t) => t.proyecto_id === p.id).flatMap((t) => t.responsible_user_ids ?? []).filter((u) => ROL[rolViejo.get(u)] === rol));
            return [rol, lista];
          })
        ),
        plan_redes_id: null,
        ...(comprobante === "boleta" || comprobante === "factura" ? { facturacion: { tipo: comprobante } } : {}),
        created_at: p.created_at ?? AHORA,
        alta: (p.created_at ?? AHORA).slice(0, 10),
        unidad: ORIGEN,
        _origen: ORIGEN,
        _id_viejo: p.id,
        _viejo: {
          review_flow: p.review_flow ?? null,
          plan_id: p.plan_id ?? null,
          monthly_limits: p.monthly_limits ?? null,
          disenador: Us(tr.disenador),
        },
      },
    });
  }
}

// ─── tareas → videos / piezas ───────────────────────────────────────────────────────────────────────────
const VIDEO_TIPOS = ["Reel", "Historia Audiovisual"];
const PIEZA_TIPOS = { Historia: "vertical", Feed: "posteo_vertical", "Feed Carrusel": "posteo_vertical" };
const TERMINADO = ["Publicado", "Programado", "Para Publicar"];
const ESTADOS = ["Sin Iniciar", "En Producción", "Producido sin Aprobar", "Para Publicar", "Programado", "Publicado"];
const reviewsPorTarea = new Map();
for (const r of reviewsV) (reviewsPorTarea.get(r.task_id) ?? reviewsPorTarea.set(r.task_id, []).get(r.task_id)).push(r);
const ratingsPorTarea = new Map();
for (const r of ratingsV) (ratingsPorTarea.get(r.task_id) ?? ratingsPorTarea.set(r.task_id, []).get(r.task_id)).push(r);
const tareaV = new Map(tareasV.map((t) => [t.id, t]));
const crudoDe = new Map(); // id tarea principal → tarea de material crudo
for (const t of tareasV) if (t.is_raw_material_task && t.parent_task_id) crudoDe.set(t.parent_task_id, t);

const sinDrive = { n: 0 };
function adjunto(a, fallbackAt) {
  if (!a || typeof a !== "object") return null;
  const id = a.drive_file_id ?? String(a.web_view_link ?? "").match(/\/d\/([\w-]+)/)?.[1] ?? null;
  if (!id) {
    sinDrive.n++;
    return null;
  }
  return {
    drive_file_id: id,
    name: a.name ?? "archivo",
    mime_type: a.mime_type ?? "application/octet-stream",
    size: Number(a.size) || 0,
    ...(a.thumbnail_link ? { thumbnail_link: a.thumbnail_link } : {}),
    web_view_link: a.web_view_link ?? `https://drive.google.com/file/d/${id}/view`,
    ...(a.web_content_link ? { web_content_link: a.web_content_link } : {}),
    uploaded_at: a.uploaded_at ?? fallbackAt ?? AHORA,
    uploaded_by: Uby(a.uploaded_by),
    folder_path: a.folder_path ?? "",
  };
}
const adjuntos = (arr, at) => {
  const vistos = new Set();
  return (Array.isArray(arr) ? arr : [])
    .map((a) => adjunto(a, at))
    .filter((a) => a && !vistos.has(a.drive_file_id) && vistos.add(a.drive_file_id));
};
const esUrl = (s) => typeof s === "string" && /^https?:\/\//.test(s.trim());

function historialDe(t, accionFinal) {
  const h = [{ at: t.created_at ?? AHORA, by: MIGRACION, accion: "Creado en el sistema anterior", nota: null }];
  for (const e of t.edit_history ?? []) if (e?.field === "estado" && e.edited_at) h.push({ at: e.edited_at, by: Uby(e.edited_by), accion: "Cambió de estado (sistema anterior)", nota: null });
  for (const r of reviewsPorTarea.get(t.id) ?? [])
    h.push({
      at: r.reviewed_at ?? AHORA,
      by: Uby(r.reviewed_by),
      accion: r.decision === "approved" ? "El cliente lo aprobó" : "El cliente pidió cambios",
      nota: [r.rating ? `★ ${r.rating}` : null, r.comment || null].filter(Boolean).join(" · ") || null,
    });
  h.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  h.push({ at: AHORA, by: MIGRACION, accion: accionFinal, nota: null });
  return h;
}
function etapaDesde(t) {
  const est = (t.edit_history ?? []).filter((e) => e?.field === "estado" && e.edited_at).map((e) => e.edited_at).sort();
  return est.at(-1) ?? t.last_edited_at ?? t.created_at ?? AHORA;
}
function calificaciones(t) {
  return (ratingsPorTarea.get(t.id) ?? []).map((r) => ({
    calificado: Uby(r.rated_user_id),
    rol: r.rated_user_role ?? null,
    tipo: r.eval_type ?? null,
    puntajes: r.scores ?? {},
    promedio: r.average_score ?? null,
    por: Uby(r.rated_by),
    at: r.reviewed_at ?? null,
  }));
}

const nuevosVideos = [];
const nuevasPiezas = [];
const omitidasTareas = {};
const estadosRaros = {};
const etapas = {};
const estadosPieza = {};
const cerradas = { videos: 0, piezas: 0 };
const crudosUnidos = { n: 0 };
const sinCliente = {};

for (const t of tareasV) {
  if (t.is_raw_material_task) {
    if (t.parent_task_id && tareaV.has(t.parent_task_id)) crudosUnidos.n++;
    else contar(omitidasTareas, "tarea de crudo sin tarea principal");
    continue;
  }
  const pid = mapaP.get(t.proyecto_id);
  if (!pid) {
    contar(sinCliente, t.proyecto_id ?? "(vacío)");
    contar(omitidasTareas, "sin cliente (proyecto inexistente)");
    continue;
  }
  if (!ESTADOS.includes(t.estado)) contar(estadosRaros, String(t.estado));
  const crudo = crudoDe.get(t.id);
  const at = t.created_at ?? AHORA;
  const finalizado = adjuntos(t.attachments_finalizado, at);
  const crudos = adjuntos([...(t.attachments_crudo ?? []), ...(crudo?.attachments_crudo ?? []), ...(crudo?.attachments_finalizado ?? [])], at);
  const esVideo = VIDEO_TIPOS.includes(t.tipo) || (!t.tipo && finalizado.some((a) => a.mime_type.startsWith("video/")));
  const mes = mesAR(t.fecha || t.created_at) ?? mesAR(AHORA);
  const viejo = proyectoV.get(t.proyecto_id) ?? {};
  const cerrar = !["Publicado", "Programado"].includes(t.estado) && mes < CIERRE;
  const responsables = Us(t.responsible_user_ids);
  const reviews = reviewsPorTarea.get(t.id) ?? [];
  const rondas = reviews.filter((r) => r.decision === "changes_requested").length;
  const links = [
    esUrl(t.material_crudo) ? `Material crudo: ${t.material_crudo.trim()}` : null,
    esUrl(t.material_finalizado) ? `Material final: ${t.material_finalizado.trim()}` : null,
  ].filter(Boolean);
  const _viejo = {
    tipo: t.tipo ?? null,
    estado: t.estado ?? null,
    completed: t.completed ?? null,
    responsables,
    material_crudo: t.material_crudo ?? null,
    material_finalizado: t.material_finalizado ?? null,
    ...(crudo ? { tarea_crudo: crudo.id } : {}),
    ...(t.feedback_cliente_attachments?.length ? { feedback_cliente_adjuntos: adjuntos(t.feedback_cliente_attachments, at) } : {}),
    ...(ratingsPorTarea.has(t.id) ? { calificaciones: calificaciones(t) } : {}),
  };
  const idea = [t.descripcion, t.notas ? `Notas: ${t.notas}` : null].filter((x) => x && String(x).trim()).join("\n\n") || null;
  const accion = cerrar ? `Migrado del sistema anterior (${ORIGEN}); estaba en «${t.estado}», se cierra por antigüedad` : `Migrado del sistema anterior (${ORIGEN}; estado «${t.estado}»)`;

  if (esVideo) {
    let etapa;
    if (cerrar || t.estado === "Publicado" || t.estado === "Programado") etapa = "publicado";
    else if (t.estado === "Para Publicar") etapa = "para_publicar";
    else if (t.estado === "Producido sin Aprobar") etapa = viejo.review_flow === "cliente" ? "revision_cliente" : "revision_interna";
    else etapa = crudos.length ? "edicion" : "planificado";
    if (cerrar) cerradas.videos++;
    contar(etapas, `${t.estado} → ${etapa}${cerrar ? " (cierre)" : ""}`);
    const team = viejo.team_roles ?? {};
    const editor = responsables.find((u) => rolDe(u) === "editor") ?? Us(team.editor)[0] ?? null;
    const productor = Us(crudo?.responsible_user_ids)[0] ?? responsables.find((u) => ["productor", "pm"].includes(rolDe(u))) ?? Us([...(team.productor ?? []), ...(team.pm ?? [])])[0] ?? null;
    const publicadoAt = etapa === "publicado" ? (t.fecha && t.fecha < AHORA ? t.fecha : etapaDesde(t)) : null;
    nuevosVideos.push({
      id: nid(t.id),
      data: {
        proyecto_id: pid,
        titulo: String(t.titulo ?? "Video").trim() || "Video",
        idea,
        objetivo: null,
        referencias: links.length ? links.join("\n") : null,
        mes,
        extra: false,
        etapa,
        etapa_desde: etapaDesde(t),
        rodaje_id: null,
        productor_id: productor,
        editor_id: editor,
        pauta_id: Us(team.cm)[0] ?? null,
        attachments_crudo: crudos,
        attachments_finalizado: finalizado,
        copy: null,
        feedback_interno: t.feedback_pm ?? null,
        feedback_cliente: t.feedback_cliente ?? t.client_rating_comment ?? null,
        rondas,
        cliente_rating: t.client_rating ?? null,
        publicacion: publicadoAt ? { publicado_at: publicadoAt, link_instagram: null, link_facebook: null, link_tiktok: null } : null,
        pauta: null,
        resultados: null,
        meta: null,
        historial: historialDe(t, accion),
        created_at: at,
        created_by: MIGRACION,
        updated_at: t.last_edited_at ?? at,
        _origen: ORIGEN,
        _id_viejo: t.id,
        _viejo,
      },
    });
  } else {
    let estado;
    if (cerrar || TERMINADO.includes(t.estado)) estado = "entregada";
    else if (t.estado === "Producido sin Aprobar") estado = "para_aprobar";
    else if (t.estado === "En Producción") estado = "en_proceso";
    else estado = "pagada";
    if (cerrar) cerradas.piezas++;
    contar(estadosPieza, `${t.tipo ?? "(sin tipo)"} · ${t.estado} → ${estado}${cerrar ? " (cierre)" : ""}`);
    nuevasPiezas.push({
      id: nid(t.id),
      data: {
        proyecto_id: pid,
        solicitado_por: MIGRACION,
        pedido: [String(t.titulo ?? "").trim(), t.descripcion].filter((x) => x && String(x).trim()).join("\n\n") || "Pieza",
        texto_en_pieza: null,
        formato: PIEZA_TIPOS[t.tipo] ?? "posteo_vertical",
        mes,
        incluida: false,
        precio: 0,
        estado,
        cobro_id: null,
        versiones: [],
        attachments_finalizado: finalizado,
        version_enviada_id: estado === "para_aprobar" ? finalizado.at(-1)?.drive_file_id ?? null : null,
        version_aprobada_id: estado === "entregada" ? finalizado.at(-1)?.drive_file_id ?? null : null,
        feedback_cliente: t.feedback_cliente ?? null,
        rondas,
        historial: historialDe(t, accion),
        nota_equipo: [t.notas, t.feedback_pm ? `Feedback interno: ${t.feedback_pm}` : null, ...links].filter(Boolean).join("\n\n") || null,
        created_at: at,
        updated_at: t.last_edited_at ?? at,
        _origen: ORIGEN,
        _id_viejo: t.id,
        _viejo: { ...(crudos.length ? { attachments_crudo: crudos } : {}), ..._viejo },
      },
    });
  }
}

// Videos que ya estaban en el modelo nuevo (progreso).
for (const v of videosNV) {
  const pid = mapaP.get(v.proyecto_id);
  if (!pid) {
    contar(omitidasTareas, "video (modelo nuevo) sin cliente");
    continue;
  }
  const { id, ...resto } = v;
  nuevosVideos.push({
    id: nid(id),
    data: {
      ...resto,
      proyecto_id: pid,
      productor_id: U(v.productor_id),
      editor_id: U(v.editor_id),
      pauta_id: U(v.pauta_id),
      created_by: Uby(v.created_by),
      historial: (v.historial ?? []).map((h) => ({ ...h, by: Uby(h.by) })),
      attachments_crudo: adjuntos(v.attachments_crudo, v.created_at),
      attachments_finalizado: adjuntos(v.attachments_finalizado, v.created_at),
      _origen: ORIGEN,
      _id_viejo: id,
    },
  });
  contar(etapas, `(modelo nuevo) ${v.etapa}`);
}

// ─── reuniones ──────────────────────────────────────────────────────────────────────────────────────────
const nuevasReuniones = reunionesV.map((m) => {
  const ini = m.starts_at ?? m.created_at ?? AHORA;
  const dur = Number(m.duration_minutes) || 60;
  return {
    id: nid(m.id),
    data: {
      titulo: m.title ?? "Reunión",
      proyecto_id: null,
      chat_id: null,
      fecha: ini,
      fin: new Date(Date.parse(ini) + dur * 60_000).toISOString(),
      duracion_min: dur,
      link: `https://meet.jit.si/prodi-${nid(m.id)}`,
      participantes: Us([...(m.assignee_ids ?? []), m.created_by]),
      creada_por: Uby(m.created_by),
      estado: ini < AHORA ? "realizada" : "programada",
      notas: m.notes ?? null,
      minuta: null,
      created_at: m.created_at ?? AHORA,
      _origen: ORIGEN,
      _id_viejo: m.id,
      _viejo: { modality: m.modality ?? null },
    },
  };
});

// ─── chats (solo los que tienen mensajes) ───────────────────────────────────────────────────────────────
const nuevosChats = [];
const nuevosMensajes = []; // { coleccion, id, data }
const chatsOmitidos = {};
for (const d of (await fs.collection("chats").get()).docs) {
  const c = aJson(d.data());
  const subs = Object.fromEntries(await Promise.all((await d.ref.listCollections()).map(async (s) => [s.id, (await s.get()).docs])));
  const mensajes = subs.mensajes ?? [];
  if (!mensajes.length) {
    contar(chatsOmitidos, "sin mensajes (los grupos los arma la app sola)");
    continue;
  }
  let id;
  if (d.id === "equipo") id = "equipo";
  else if (c.tipo === "cliente" && c.proyecto_id) {
    const pid = mapaP.get(c.proyecto_id);
    if (!pid) {
      contar(chatsOmitidos, "de un cliente que no se migró");
      continue;
    }
    id = `cliente_${pid}`;
  } else if (c.tipo === "directo") {
    const m = Us(c.miembros).sort();
    if (m.length !== 2) {
      contar(chatsOmitidos, "privado con un usuario que no está");
      continue;
    }
    id = `dm_${m.join("_")}`;
  } else id = nid(d.id);
  const miembros = Us(c.miembros);
  const remap = (o) => Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [U(k), v]).filter(([k]) => k));
  nuevosChats.push({
    id,
    data: {
      ...c,
      ...(c.proyecto_id ? { proyecto_id: mapaP.get(c.proyecto_id) } : {}),
      miembros,
      nombres: remap(c.nombres),
      leido: remap(c.leido),
      ...(c.ultimo ? { ultimo: { ...c.ultimo, by: Uby(c.ultimo.by) } } : {}),
      ...(c.admins ? { admins: Us(c.admins) } : {}),
      ...(c.creado_por ? { creado_por: Uby(c.creado_por) } : {}),
      _origen: ORIGEN,
      _id_viejo: d.id,
    },
  });
  for (const [sub, docs] of Object.entries(subs)) {
    if (!["mensajes", "audios"].includes(sub)) {
      contar(chatsOmitidos, `subcolección ${sub}`);
      continue;
    }
    for (const m of docs) {
      const x = aJson(m.data());
      nuevosMensajes.push({ coleccion: `chats/${id}/${sub}`, id: m.id, data: { ...x, ...(x.by ? { by: Uby(x.by) } : {}), _origen: ORIGEN } });
    }
  }
}

// ─── omitidos ───────────────────────────────────────────────────────────────────────────────────────────
const OMITIR = {
  in_app_notifications: "avisos viejos",
  notification_queue: "cola de avisos vieja",
  whatsapp_verifications: "WhatsApp (ya no se usa)",
  phone_users: "WhatsApp (ya no se usa)",
  user_filters: "filtros de pantallas viejas",
  user_filters_my_tasks: "filtros de pantallas viejas",
  app_settings: "configuración del sistema viejo",
  reminders: "recordatorios por WhatsApp",
  task_structures: "plantillas de tareas viejas",
  execution_guides: "guías viejas (sin equivalente)",
  execution_guide_checks: "guías viejas (sin equivalente)",
  content_plans: "planes por tipo de contenido (los nuevos son por videos: planes_redes)",
  portal_service_categories: "catálogo del portal viejo (sin equivalente)",
  portal_service_requests: "pedidos del portal viejo (sin equivalente)",
  content_ratings: "no se crean aparte: quedan en _viejo.calificaciones del video/pieza",
  client_reviews: "no se crean aparte: quedan en el historial del video/pieza",
};
const omitidas = [];
const usadas = new Set(["profiles", "projects", "tasks", "team_meetings", "videos", "chats"]);
for (const col of await fs.listCollections()) {
  if (usadas.has(col.id)) continue;
  const n = (await col.count().get()).data().count;
  omitidas.push(`${col.id} (${n}): ${OMITIR[col.id] ?? "sin destino claro"}`);
}

// ─── escritura (o simulación) ───────────────────────────────────────────────────────────────────────────
async function existentes(coleccion, ids) {
  const s = new Set();
  for (let i = 0; i < ids.length; i += 1000) {
    const r = await q("select id from documentos where coleccion = $1 and id = any($2::text[])", [coleccion, ids.slice(i, i + 1000)]);
    r.forEach((x) => s.add(x.id));
  }
  return s;
}
/** Agrega documentos (los que ya existen no se tocan). Devuelve { nuevos, yaEstaban }. */
async function agregar(coleccion, docs) {
  const ya = await existentes(coleccion, docs.map((d) => d.id));
  const nuevos = docs.filter((d) => !ya.has(d.id));
  let escritos = 0;
  if (APLICAR) {
    for (let i = 0; i < nuevos.length; i += 200) {
      const lote = nuevos.slice(i, i + 200);
      const vals = lote.map((_, j) => `($1, $${j * 2 + 2}, $${j * 2 + 3}::jsonb)`);
      const params = [coleccion, ...lote.flatMap((d) => [d.id, JSON.stringify(d.data)])];
      const r = await pool.query(`insert into documentos (coleccion, id, data) values ${vals.join(",")} on conflict (coleccion, id) do nothing`, params);
      escritos += r.rowCount;
    }
  }
  return { total: docs.length, nuevos: nuevos.length, yaEstaban: ya.size, escritos };
}

const R = {};
// Usuarios (tabla usuarios): add-only; si el mail o el uid ya existen, no se toca.
{
  let escritos = 0;
  if (APLICAR)
    for (const u of nuevosUsuarios) {
      const r = await pool.query(
        "insert into usuarios (uid, email, clave_hash, nombre, desactivado) values ($1, $2, $3, $4, $5) on conflict do nothing",
        [u.uid, u.email, u.clave_hash, u.nombre, u.desactivado]
      );
      escritos += r.rowCount;
    }
  R.usuarios = { total: mapaU.size + usuariosOmitidos.length, nuevos: nuevosUsuarios.length, yaEstaban: usuariosEmparejados.length, escritos };
}
R.perfiles = await agregar("profiles", nuevosPerfiles);
R.clientes = await agregar("projects", nuevosClientes);
// "ya estaban" de perfiles y clientes incluye los emparejados por mail / id / nombre.
R.perfiles.yaEstaban += usuariosEmparejados.length;
R.clientes.yaEstaban += clientesEmparejados.length;
R.videos = await agregar("videos", nuevosVideos);
R.piezas = await agregar("piezas_ia", nuevasPiezas);
R.reuniones = await agregar("reuniones", nuevasReuniones);
R.chats = await agregar("chats", nuevosChats);
{
  const porCol = new Map();
  for (const m of nuevosMensajes) (porCol.get(m.coleccion) ?? porCol.set(m.coleccion, []).get(m.coleccion)).push(m);
  const tot = { total: 0, nuevos: 0, yaEstaban: 0, escritos: 0 };
  for (const [col, docs] of porCol) {
    const r = await agregar(col, docs);
    for (const k in tot) tot[k] += r[k];
  }
  R["mensajes/audios"] = tot;
}

// ─── informe ────────────────────────────────────────────────────────────────────────────────────────────
console.log(`${"entidad".padEnd(18)} ${"a crear".padStart(8)} ${"ya estaban".padStart(10)} ${APLICAR ? "escritos".padStart(9) : ""}`);
for (const [k, r] of Object.entries(R)) console.log(`${k.padEnd(18)} ${String(r.nuevos).padStart(8)} ${String(r.yaEstaban).padStart(10)} ${APLICAR ? String(r.escritos).padStart(9) : ""}`);

console.log(`\nUsuarios en ${ORIGEN}: ${authV.length} en Auth, ${perfilesV.length} perfiles.`);
console.log(`  Nuevos: ${nuevosUsuarios.length} (${conClaveFb.si} con contraseña de Firebase, ${conClaveFb.no} sin contraseña: entran con link de "olvidé mi clave").`);
for (const [k, n] of Object.entries(rolesNuevos)) console.log(`    rol ${k}: ${n}`);
console.log(`  Ya existían (por mail): ${usuariosEmparejados.length}`);
for (const x of usuariosEmparejados) console.log(`    = ${x}`);
for (const x of usuariosOmitidos) console.log(`  omitido: ${x}`);

console.log(`\nClientes en ${ORIGEN}: ${proyectosV.length} · a crear ${nuevosClientes.length} · emparejados ${clientesEmparejados.length}`);
for (const x of clientesEmparejados) console.log(`    = ${x}`);
for (const c of nuevosClientes) console.log(`    + ${c.data.nombre}${c.data.enabled ? "" : " (deshabilitado)"} · equipo ${Object.entries(c.data.team_roles).map(([k, v]) => `${k}:${v.length}`).join(" ")}`);

console.log(`\nTareas en ${ORIGEN}: ${tareasV.length} → videos ${nuevosVideos.length - videosNV.length} · piezas ${nuevasPiezas.length} · crudo unido al video ${crudosUnidos.n}`);
console.log("  Videos (estado viejo → etapa):");
for (const [k, n] of Object.entries(etapas).sort()) console.log(`    ${k.padEnd(52)} ${n}`);
console.log("  Piezas (tipo · estado viejo → estado):");
for (const [k, n] of Object.entries(estadosPieza).sort()) console.log(`    ${k.padEnd(60)} ${n}`);
console.log(`  Cerradas por antigüedad (antes de ${CIERRE}): ${cerradas.videos} videos, ${cerradas.piezas} piezas`);
for (const [k, n] of Object.entries(omitidasTareas)) console.log(`  omitidas: ${k}: ${n}`);
console.log(`Reuniones: ${nuevasReuniones.length} · Chats con mensajes: ${nuevosChats.length} (${nuevosMensajes.length} mensajes/audios)`);
for (const [k, n] of Object.entries(chatsOmitidos)) console.log(`  chats omitidos: ${k}: ${n}`);

console.log("\nNo se migran:");
for (const x of omitidas) console.log(`  - ${x}`);

if (Object.keys(estadosRaros).length) avisar(`Estados sin mapeo (se trataron como "Sin Iniciar"): ${JSON.stringify(estadosRaros)}`);
if (Object.keys(sinCliente).length) avisar(`Tareas con cliente inexistente: ${JSON.stringify(sinCliente)}`);
if (sinDrive.n) avisar(`${sinDrive.n} adjuntos sin id de Drive (se descartaron).`);
if (porDesconocido.size) avisar(`${porDesconocido.size} uids viejos sin usuario (quedan como texto en historial/adjuntos; en equipos y asignados se sacan).`);
if (ORIGEN === "postgo" && conClaveFb.si)
  avisar("Las contraseñas de PostGo necesitan FIREBASE_HASH_POSTGO_SIGNER_KEY y FIREBASE_HASH_POSTGO_SALT_SEPARATOR (y ROUNDS/MEM_COST) del proyecto postgo-c9a4a; sin eso entran con link.");
if (AVISOS.length) {
  console.log("\nAvisos:");
  for (const a of AVISOS) console.log(`  ! ${a}`);
}
await pool.end();
console.log(APLICAR ? "\nListo: se agregó lo nuevo, no se modificó nada que ya existía." : "\nFin de la simulación: no se escribió nada.");
