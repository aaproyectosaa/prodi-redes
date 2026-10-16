/* eslint-disable @typescript-eslint/no-explicit-any */
// Render puro del informe mensual (sin dependencias de Node): lo usan el
// servidor y la demo navegable.

const ars = (n: number) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n || 0);
const num = (n: number) => new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(n || 0);
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Id de archivo de Drive válido (si no, no se muestra la miniatura). */
const idDriveOk = (id: unknown): id is string => typeof id === "string" && /^[A-Za-z0-9_-]+$/.test(id);
/** Solo links https (nada de javascript: ni data:); si no, no se muestra. */
const linkOk = (u: unknown): string => (typeof u === "string" && /^https:\/\/[^\s"<>]+$/i.test(u.trim()) ? u.trim() : "");

/** Campos de resultados que cuentan como "cargados" (un video sin ninguno no muestra números). */
const CAMPOS_RESULTADO = ["alcance", "impresiones", "reproducciones", "interacciones", "mensajes", "clics", "gasto"] as const;

/** Un número de resultados del video, o null si no está cargado. */
const val = (v: any, k: string): number | null => {
  const n = v?.resultados?.[k];
  if (n == null || n === "") return null;
  const x = Number(n);
  return isFinite(x) ? x : null;
};

/** El video tiene al menos un número de resultados cargado (mayor a cero). */
export function tieneResultados(v: any): boolean {
  return CAMPOS_RESULTADO.some((k) => (val(v, k) ?? 0) > 0);
}

/** Costo por mensaje de un video (solo si tiene gasto y mensajes). */
export function costoPorMensaje(v: any): number | null {
  const g = val(v, "gasto") ?? 0;
  const m = val(v, "mensajes") ?? 0;
  return g > 0 && m > 0 ? g / m : null;
}

export interface MejorVideo {
  id: string;
  titulo: string;
  criterio: "mensajes" | "alcance";
  mensajes: number;
  alcance: number;
  costo_mensaje: number | null;
  /** Otro video que consiguió el mensaje más barato (si no es el mismo). */
  mas_barato?: { id: string; titulo: string; costo_mensaje: number } | null;
}

/**
 * El video que mejor funcionó en el mes: el que más mensajes trajo (a igualdad, el más barato).
 * Si nadie trajo mensajes, el que más personas alcanzó. Solo si hay al menos 2 videos con resultados para comparar.
 */
export function mejorVideo(publicados: any[]): MejorVideo | null {
  const con = publicados.filter(tieneResultados);
  if (con.length < 2) return null;
  const base = (v: any, criterio: MejorVideo["criterio"]): MejorVideo => ({
    id: String(v.id ?? ""),
    titulo: String(v.titulo ?? ""),
    criterio,
    mensajes: val(v, "mensajes") ?? 0,
    alcance: val(v, "alcance") ?? 0,
    costo_mensaje: costoPorMensaje(v),
    mas_barato: null,
  });
  const conMensajes = con.filter((v) => (val(v, "mensajes") ?? 0) > 0);
  if (conMensajes.length) {
    const orden = [...conMensajes].sort(
      (a, b) => (val(b, "mensajes") ?? 0) - (val(a, "mensajes") ?? 0) || (costoPorMensaje(a) ?? Infinity) - (costoPorMensaje(b) ?? Infinity)
    );
    const mejor = base(orden[0], "mensajes");
    const baratos = conMensajes.filter((v) => costoPorMensaje(v) != null).sort((a, b) => costoPorMensaje(a)! - costoPorMensaje(b)!);
    const barato = baratos[0];
    if (barato && baratos.length >= 2 && String(barato.id ?? "") !== mejor.id && costoPorMensaje(barato)! < (mejor.costo_mensaje ?? Infinity)) {
      mejor.mas_barato = { id: String(barato.id ?? ""), titulo: String(barato.titulo ?? ""), costo_mensaje: costoPorMensaje(barato)! };
    }
    return mejor;
  }
  const porAlcance = con.filter((v) => (val(v, "alcance") ?? 0) > 0).sort((a, b) => (val(b, "alcance") ?? 0) - (val(a, "alcance") ?? 0));
  return porAlcance.length >= 2 ? base(porAlcance[0], "alcance") : null;
}

/** Totales del mes anterior para comparar (solo se usa si tuvo resultados cargados). */
export interface ResumenAnterior {
  mes: string;
  label: string;
  publicados: number;
  con_resultados: number;
  alcance: number;
  reproducciones: number;
  mensajes: number;
  gasto: number;
}

export interface DatosInforme {
  nombre: string;
  label: string;
  baseUrl: string;
  resumen: { publicados: number; cupo: number; alcance: number; reproducciones: number; mensajes: number; gasto: number };
  publicados: any[];
  /** Mes anterior, para las flechas ↑/↓. Opcional (la demo no lo manda). */
  anterior?: ResumenAnterior | null;
}

/** "5 de octubre" (hora de Argentina). */
const fechaCorta = (iso: unknown): string => {
  if (typeof iso !== "string" || !iso) return "";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00-03:00`) : new Date(iso);
  if (isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "long", timeZone: "America/Argentina/Buenos_Aires" }).format(d);
};

export function renderInformeHtml({ nombre, label, baseUrl, resumen, publicados, anterior }: DatosInforme): string {
  const p = { nombre };
  const costoMensaje = resumen.mensajes > 0 && resumen.gasto > 0 ? resumen.gasto / resumen.mensajes : null;
  const base = esc(baseUrl);
  const logo = `${base}/brand/logo-horizontal-blanco.png`;
  const hayResultados =
    publicados.some(tieneResultados) || resumen.alcance > 0 || resumen.mensajes > 0 || resumen.gasto > 0 || resumen.reproducciones > 0;
  const ant = anterior && anterior.con_resultados > 0 ? anterior : null;
  const mesAnt = ant ? esc(ant.label.split(" ")[0].toLowerCase()) : "";
  const costoAnt = ant && ant.mensajes > 0 && ant.gasto > 0 ? ant.gasto / ant.mensajes : null;

  /** "↑ 12% vs. septiembre". `menosEsMejor` para el costo; `neutro` para la inversión (ni bueno ni malo). */
  const delta = (act: number | null, prev: number | null, destacado: boolean, opts: { menosEsMejor?: boolean; neutro?: boolean } = {}) => {
    if (!ant || act == null || prev == null || prev <= 0 || act <= 0) return "";
    const pct = Math.round(((act - prev) / prev) * 100);
    if (pct === 0) return `<div style="font-size:11px;color:${destacado ? "#E9E3FF" : "#6B6880"};margin-top:4px;">= igual que ${mesAnt}</div>`;
    const sube = pct > 0;
    const bueno = opts.menosEsMejor ? !sube : sube;
    const color = destacado ? "#FFFFFF" : opts.neutro ? "#6B6880" : bueno ? "#1E8E54" : "#C73A3A";
    return `<div style="font-size:11px;font-weight:600;color:${color};margin-top:4px;">${sube ? "↑" : "↓"} ${Math.abs(pct)}% vs. ${mesAnt}</div>`;
  };

  const kpi = (titulo: string, valor: string, destacado = false, extra = "") => `
    <td width="33%" valign="top" style="padding:6px;">
      <div style="background:${destacado ? "#6F40FC" : "#F4F2FF"};border-radius:14px;padding:16px 14px;">
        <div style="font-size:12px;color:${destacado ? "#E9E3FF" : "#6B6880"};">${esc(titulo)}</div>
        <div style="font-size:24px;font-weight:700;color:${destacado ? "#FFFFFF" : "#111018"};margin-top:4px;">${esc(valor)}</div>${extra}
      </div>
    </td>`;
  const sinDato = "—";

  /** Un numerito del video (solo los que están cargados). */
  const metrica = (titulo: string, valor: string) => `
            <td width="33%" valign="top" style="padding:4px;">
              <div style="background:#F7F6FB;border-radius:10px;padding:8px 10px;">
                <div style="font-size:11px;color:#6B6880;">${esc(titulo)}</div>
                <div style="font-size:15px;font-weight:700;color:#111018;margin-top:2px;">${esc(valor)}</div>
              </div>
            </td>`;

  const mejor = mejorVideo(publicados);
  const ordenados = [...publicados].sort((a, b) =>
    String(a.publicacion?.publicado_at ?? "").localeCompare(String(b.publicacion?.publicado_at ?? ""))
  );

  const filas = ordenados
    .map((v) => {
      const fin = v.attachments_finalizado?.[0];
      const thumb = idDriveOk(fin?.drive_file_id) ? `https://drive.google.com/thumbnail?id=${fin.drive_file_id}&sz=w200` : "";
      const link = linkOk(v.publicacion?.link_instagram) || linkOk(v.publicacion?.link_facebook) || linkOk(v.publicacion?.link_tiktok);
      const fecha = fechaCorta(v.publicacion?.publicado_at);
      const esMejor = !!mejor && String(v.id ?? "") === mejor.id;

      const celdas: string[] = [];
      if (tieneResultados(v)) {
        const g = val(v, "gasto");
        const m = val(v, "mensajes");
        const c = costoPorMensaje(v);
        const a = val(v, "alcance");
        const imp = val(v, "impresiones");
        const rep = val(v, "reproducciones");
        const cl = val(v, "clics");
        if (g != null && g > 0) celdas.push(metrica("Inversión", ars(g)));
        if (m != null) celdas.push(metrica("Mensajes", num(m)));
        if (c != null) celdas.push(metrica("Costo por mensaje", ars(c)));
        if (a != null) celdas.push(metrica("Alcance", num(a)));
        if (imp != null && imp > 0) celdas.push(metrica("Impresiones", num(imp)));
        if (rep != null && rep > 0) celdas.push(metrica("Reproducciones", num(rep)));
        if (cl != null && cl > 0) celdas.push(metrica("Clics", num(cl)));
      }
      const grilla: string[] = [];
      for (let i = 0; i < celdas.length; i += 3) {
        const fila = celdas.slice(i, i + 3);
        while (fila.length < 3) fila.push(`<td width="33%" style="padding:4px;"></td>`);
        grilla.push(`<tr>${fila.join("")}</tr>`);
      }
      const numeros = grilla.length
        ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;">${grilla.join("")}</table>`
        : `<div style="font-size:12px;color:#8A879C;margin-top:8px;">Todavía sin resultados cargados.</div>`;

      return `
      <tr><td style="padding:12px 0;border-bottom:1px solid #EEECF5;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          ${thumb ? `<td width="64" valign="top"><img src="${esc(thumb)}" width="56" height="56" style="border-radius:10px;object-fit:cover;display:block;background:#EEE;" alt=""></td>` : ""}
          <td valign="top" style="font-size:14px;color:#111018;">
            ${esMejor ? `<div style="display:inline-block;background:#6F40FC;color:#FFFFFF;font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;padding:3px 8px;border-radius:999px;margin-bottom:4px;">★ El mejor del mes</div>` : ""}
            <div style="font-weight:600;">${esc(v.titulo)}</div>
            ${fecha ? `<div style="font-size:12px;color:#6B6880;margin-top:2px;">Publicado el ${esc(fecha)}</div>` : ""}
            ${link ? `<a href="${esc(link)}" style="font-size:12px;color:#6F40FC;text-decoration:none;">Ver publicación →</a>` : ""}
          </td>
        </tr></table>
        ${numeros}
      </td></tr>`;
    })
    .join("");

  const fraseMejor = !mejor
    ? ""
    : mejor.criterio === "mensajes"
      ? `<b>«${esc(mejor.titulo)}»</b> fue el video que más mensajes trajo: <b>${num(mejor.mensajes)}</b>${
          mejor.costo_mensaje != null ? `, a <b>${ars(mejor.costo_mensaje)}</b> cada uno` : ""
        }.${
          mejor.mas_barato
            ? ` Y <b>«${esc(mejor.mas_barato.titulo)}»</b> consiguió los mensajes más baratos: <b>${ars(mejor.mas_barato.costo_mensaje)}</b> cada uno.`
            : ""
        }`
      : `<b>«${esc(mejor.titulo)}»</b> fue el video que más personas alcanzó: <b>${num(mejor.alcance)}</b>.`;

  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Informe ${esc(label)} · ${esc(p.nombre)}</title></head>
<body style="margin:0;padding:0;background:#F6F5FA;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F5FA;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFFFF;border-radius:20px;overflow:hidden;">
  <tr><td style="background:#000000;padding:28px 28px 24px;">
    <img src="${logo}" height="28" alt="Prodi" style="display:block;height:28px;">
    <div style="color:#A99BFF;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;margin-top:22px;">Informe mensual</div>
    <div style="color:#FFFFFF;font-size:26px;font-weight:700;margin-top:4px;">${esc(p.nombre)} · ${esc(label)}</div>
  </td></tr>
  <tr><td style="padding:24px 22px 8px;">
    <p style="margin:0 6px 14px;font-size:15px;color:#3A3850;line-height:1.5;">
      Este mes publicamos <b>${num(resumen.publicados)}</b> video${resumen.publicados === 1 ? "" : "s"}${resumen.cupo ? ` de los <b>${num(resumen.cupo)}</b> de tu plan` : ""}.${
        hayResultados ? " Estos son los resultados de la pauta:" : " Todavía no hay resultados de pauta cargados para este mes."
      }
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>${kpi("Personas alcanzadas", hayResultados ? num(resumen.alcance) : sinDato, true, delta(resumen.alcance, ant?.alcance ?? null, true))}${kpi(
        "Reproducciones",
        hayResultados ? num(resumen.reproducciones) : sinDato,
        false,
        delta(resumen.reproducciones, ant?.reproducciones ?? null, false)
      )}${kpi("Mensajes", hayResultados ? num(resumen.mensajes) : sinDato, false, delta(resumen.mensajes, ant?.mensajes ?? null, false))}</tr>
      <tr>${kpi("Inversión en pauta", hayResultados ? ars(resumen.gasto) : sinDato, false, delta(resumen.gasto, ant?.gasto ?? null, false, { neutro: true }))}${kpi(
        "Costo promedio por mensaje",
        costoMensaje ? ars(costoMensaje) : sinDato,
        false,
        delta(costoMensaje, costoAnt, false, { menosEsMejor: true })
      )}${kpi("Videos publicados", `${resumen.publicados}${resumen.cupo ? `/${resumen.cupo}` : ""}`)}</tr>
    </table>
    ${ant && hayResultados ? `<p style="margin:6px 6px 0;font-size:11px;color:#8A879C;">Las flechas comparan con ${mesAnt}.</p>` : ""}
  </td></tr>
  ${fraseMejor ? `<tr><td style="padding:12px 28px 0;">
    <div style="background:#F4F2FF;border-left:4px solid #6F40FC;border-radius:12px;padding:14px 16px;font-size:14px;color:#3A3850;line-height:1.5;">
      <div style="font-size:12px;font-weight:700;color:#6F40FC;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">★ El mejor del mes</div>
      ${fraseMejor}
    </div>
  </td></tr>` : ""}
  ${publicados.length ? `<tr><td style="padding:16px 28px 4px;">
    <div style="font-size:13px;font-weight:700;color:#111018;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Resultados por video</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${filas}</table>
  </td></tr>` : ""}
  <tr><td align="center" style="padding:24px 28px 30px;">
    <a href="${base}/cliente?tab=resultados" style="display:inline-block;background:#6F40FC;color:#FFFFFF;text-decoration:none;font-weight:600;font-size:14px;padding:13px 26px;border-radius:999px;">Ver el detalle en tu panel</a>
    <p style="font-size:12px;color:#8A879C;margin:18px 0 0;line-height:1.5;">Las cifras salen del Administrador de anuncios de Meta y las carga el equipo de Prodi.<br>¿Querés sumar videos para una promo? Lo podés hacer desde tu panel.</p>
  </td></tr>
</table>
<p style="font-size:11px;color:#9C99AD;margin:16px 0 0;">Prodi · Reconquista, Santa Fe</p>
</td></tr></table>
</body></html>`;

  return html;
}
