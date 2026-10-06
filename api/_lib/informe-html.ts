/* eslint-disable @typescript-eslint/no-explicit-any */
// Render puro del informe mensual (sin dependencias de Node): lo usan el
// servidor y la demo navegable.

const ars = (n: number) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n || 0);
const num = (n: number) => new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(n || 0);
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export interface DatosInforme {
  nombre: string;
  label: string;
  baseUrl: string;
  resumen: { publicados: number; cupo: number; alcance: number; reproducciones: number; mensajes: number; gasto: number };
  publicados: any[];
}

export function renderInformeHtml({ nombre, label, baseUrl, resumen, publicados }: DatosInforme): string {
  const p = { nombre };
  const costoMensaje = resumen.mensajes > 0 && resumen.gasto > 0 ? resumen.gasto / resumen.mensajes : null;
  const logo = `${baseUrl}/brand/logo-horizontal-blanco.png`;

  const kpi = (titulo: string, valor: string, destacado = false) => `
    <td width="33%" style="padding:6px;">
      <div style="background:${destacado ? "#6F40FC" : "#F4F2FF"};border-radius:14px;padding:16px 14px;">
        <div style="font-size:12px;color:${destacado ? "#E9E3FF" : "#6B6880"};">${titulo}</div>
        <div style="font-size:24px;font-weight:700;color:${destacado ? "#FFFFFF" : "#111018"};margin-top:4px;">${valor}</div>
      </div>
    </td>`;

  const filas = publicados
    .map((v) => {
      const fin = v.attachments_finalizado?.[0];
      const thumb = fin?.drive_file_id ? `https://drive.google.com/thumbnail?id=${fin.drive_file_id}&sz=w200` : "";
      const link = v.publicacion?.link_instagram || v.publicacion?.link_facebook || "";
      return `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #EEECF5;" width="64">
          ${thumb ? `<img src="${thumb}" width="56" height="56" style="border-radius:10px;object-fit:cover;display:block;background:#EEE;" alt="">` : ""}
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid #EEECF5;font-size:14px;color:#111018;">
          <div style="font-weight:600;">${esc(v.titulo)}</div>
          ${link ? `<a href="${esc(link)}" style="font-size:12px;color:#6F40FC;text-decoration:none;">Ver publicación →</a>` : ""}
        </td>
        <td align="right" style="padding:10px 0;border-bottom:1px solid #EEECF5;font-size:13px;color:#4A4760;white-space:nowrap;">
          ${num(v.resultados?.alcance ?? 0)} alcance<br>${num(v.resultados?.mensajes ?? 0)} mensajes
        </td>
      </tr>`;
    })
    .join("");

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
      Este mes publicamos <b>${resumen.publicados}</b> video${resumen.publicados === 1 ? "" : "s"}${resumen.cupo ? ` de los <b>${resumen.cupo}</b> de tu plan` : ""}. Estos son los resultados de la pauta:
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>${kpi("Personas alcanzadas", num(resumen.alcance), true)}${kpi("Reproducciones", num(resumen.reproducciones))}${kpi("Mensajes", num(resumen.mensajes))}</tr>
      <tr>${kpi("Inversión en pauta", ars(resumen.gasto))}${kpi("Costo por mensaje", costoMensaje ? ars(costoMensaje) : "—")}${kpi("Videos publicados", `${resumen.publicados}${resumen.cupo ? `/${resumen.cupo}` : ""}`)}</tr>
    </table>
  </td></tr>
  ${publicados.length ? `<tr><td style="padding:12px 28px 4px;">
    <div style="font-size:13px;font-weight:700;color:#111018;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Videos del mes</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${filas}</table>
  </td></tr>` : ""}
  <tr><td align="center" style="padding:24px 28px 30px;">
    <a href="${baseUrl}/cliente?tab=resultados" style="display:inline-block;background:#6F40FC;color:#FFFFFF;text-decoration:none;font-weight:600;font-size:14px;padding:13px 26px;border-radius:999px;">Ver el detalle en tu panel</a>
    <p style="font-size:12px;color:#8A879C;margin:18px 0 0;line-height:1.5;">Las cifras salen del Administrador de anuncios de Meta y las carga el equipo de Prodi.<br>¿Querés sumar videos para una promo? Lo podés hacer desde tu panel.</p>
  </td></tr>
</table>
<p style="font-size:11px;color:#9C99AD;margin:16px 0 0;">Prodi · Reconquista, Santa Fe</p>
</td></tr></table>
</body></html>`;

  return html;
}
