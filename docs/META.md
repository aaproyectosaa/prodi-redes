# Conexión con Meta

## Resultados automáticos (ya funciona)

El equipo de pauta carga en cada video el **ID del anuncio** (o del conjunto o la campaña) del Administrador de
anuncios. Todos los días a las 8:00 (`/api/informes/diario`) el sistema lee los insights y completa `resultados`:
alcance, impresiones, reproducciones (`video_view`), interacciones, mensajes
(`onsite_conversion.messaging_conversation_started_7d`), clics e inversión. También se puede forzar desde el video
("Actualizar ahora"). Se sincronizan los videos con pauta activa o que terminaron hace menos de 45 días.

Configuración (una sola vez):

1. En el Business Manager de Prodi: *Configuración del negocio → Usuarios del sistema* → crear un usuario del
   sistema (admin) y asignarle las cuentas publicitarias de los clientes con permiso de **ver rendimiento**.
2. Crear una app de tipo *Business* en developers.facebook.com y generar con ese usuario del sistema un token
   **sin vencimiento** con el permiso `ads_read`.
3. En Vercel: `META_ACCESS_TOKEN` (el token), opcional `META_APP_SECRET` (firma las llamadas) y opcional
   `META_GRAPH_VERSION` (por defecto `v23.0`).
4. La inversión se toma en la moneda de la cuenta publicitaria (tiene que estar en ARS).

Para que un cliente nuevo entre en la sincronización, alcanza con que comparta su cuenta publicitaria con el
Business Manager de Prodi y asignarla al usuario del sistema.

## Publicar y pautar desde el sistema (a futuro)

Objetivo: que el equipo de pauta publique el video en Instagram/Facebook del cliente y cree la campaña sin
salir del gestor. El circuito ya está preparado:

- Cada cliente guarda `meta.page_id`, `meta.ig_user_id` y `meta.ad_account_id` (Clientes → Configuración).
- Cada video tiene `meta.post_id`, `meta.campaign_id`, `meta.ad_id` y `resultados` (ya se traen solos con `ad_id`).
- La acción "Marcar publicado" (`publicarVideo` en `src/lib/redes/videos.ts`) es el punto donde se
  enchufa la publicación automática.

Pasos para implementarlo:

1. App de Meta (developers.facebook.com) con los permisos `instagram_content_publish`,
   `pages_manage_posts`, `ads_management`, `ads_read` y revisión de app aprobada.
2. Cada cliente agrega a Prodi como socio en su Business Manager (acceso a página, cuenta de IG y
   cuenta publicitaria). Guardar un token de sistema por negocio, cifrado como el de Drive (`api/_lib/crypto.ts`).
3. `POST /api/meta/publicar`: sube el video final (desde Drive) a IG como Reel
   (`/{ig-user-id}/media` con `media_type=REELS`, luego `/media_publish`) y guarda `meta.post_id`.
4. `POST /api/meta/pautar`: crea campaña → conjunto → anuncio usando el post publicado, con el
   presupuesto y fechas del formulario de pauta.
5. ~~Cron de resultados~~: ya está hecho (ver arriba).

Ojo: ya se usan las 12 funciones del plan Hobby de Vercel. Publicar y pautar tienen que ir como acciones
nuevas dentro de `api/informes/[accion].ts` (o renombrarlo a `api/meta/[accion].ts` moviendo lo de informes), o pasar a Pro.
