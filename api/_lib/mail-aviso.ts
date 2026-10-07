// Mail genérico de un aviso (mismo estilo que los mails de boletas e informes).

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function mailAvisoHtml(a: { titulo: string; cuerpo: string; link: string; baseUrl: string; nombre?: string }): string {
  const saludo = a.nombre ? `Hola ${esc(a.nombre.split(" ")[0])},` : "Hola,";
  const cuerpo = esc(a.cuerpo).replace(/\n/g, "<br>");
  return `<!doctype html><html lang="es"><body style="margin:0;background:#F4F2FA;font-family:Inter,Segoe UI,Roboto,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F2FA;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:18px;overflow:hidden;">
<tr><td style="background:#0B0A10;padding:22px 28px;"><img src="${a.baseUrl}/brand/logo-horizontal-blanco.png" height="28" alt="PRODI" style="display:block;height:28px;"></td></tr>
<tr><td style="height:4px;background:#6F40FC;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:28px;">
  <div style="font-size:14px;color:#6B6880;">${saludo}</div>
  <div style="font-size:21px;font-weight:700;color:#111018;margin:6px 0 10px;line-height:1.3;">${esc(a.titulo)}</div>
  ${cuerpo ? `<div style="font-size:15px;color:#3A3848;line-height:1.55;">${cuerpo}</div>` : ""}
  <div style="text-align:center;margin:26px 0 6px;">
    <a href="${esc(a.link)}" style="display:inline-block;background:#6F40FC;color:#FFFFFF;text-decoration:none;font-weight:600;font-size:15px;padding:14px 26px;border-radius:12px;">Abrir en Prodi</a>
  </div>
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #EEECF5;font-size:12px;color:#8A879A;line-height:1.5;">Te llega porque tenés activados los avisos por correo. Podés apagarlos en <a href="${a.baseUrl}/profile" style="color:#6F40FC;">Mi perfil → Notificaciones</a>. Prodi · Reconquista, Santa Fe</td></tr>
</table></td></tr></table></body></html>`;
}
