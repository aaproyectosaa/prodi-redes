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

## Seguidores e Instagram de los clientes (ya funciona)

Todos los días (cron diario) el sistema lee las páginas de Facebook que el usuario del sistema tiene asignadas y el
Instagram vinculado a cada una, y guarda una foto por cliente en `metricas_redes` (seguidores de IG y FB, alcance y
visitas al perfil del día anterior). Con eso arma la curva de crecimiento (ficha del cliente → Resultados, y el panel
del cliente). Ajustes → "Instagram y Facebook de los clientes" → *Revisar conexión* dice cliente por cliente si se lee
o qué le falta, y completa solo `meta.page_id` / `meta.ig_user_id` cuando encuentra la página (por el ID cargado, el
usuario de Instagram de la ficha o el nombre).

Configuración (una sola vez):

1. En el Business Manager de Prodi, asignarle al usuario del sistema las **páginas** de los clientes (y que cada
   página tenga su Instagram profesional vinculado).
2. Generar de nuevo el token agregando `instagram_basic`, `instagram_manage_insights` y `pages_read_engagement`
   (además de `ads_read`) y reemplazar `META_ACCESS_TOKEN` en Vercel.

## Pauta de toda la cuenta e Instagram día por día (ya funciona)

`api/_lib/meta-cuenta.ts`. Para cada cliente con `meta.ad_account_id` y/o `meta.ig_user_id`:

- `meta_pauta_diaria/{cliente}_{fecha}_{campaña}`: gasto, impresiones, alcance, clics, CTR, CPM, CPC, mensajes,
  compras (y su valor), leads, reproducciones y thruplays, más el array `actions` completo (`acciones_raw`).
- `metricas_redes/{cliente}_{fecha}`: se le suman alcance, visualizaciones e interacciones de Instagram de ese día.
- `projects.meta_sync`: cuándo se trajo por última vez y si falló (con el error en criollo).

Cuándo corre (todo automático, sin botones): la primera vez que un cliente tiene IDs (o si se los cambian) se trae
el historial de 90 días, en tramos de 30; después, los últimos 3 días (Meta corrige los números recientes). Lo dispara
el cron diario (hasta 2 historiales por corrida) y también abrir los resultados del cliente (equipo o el cliente mismo):
si lo último tiene más de 3 horas, el servidor lo vuelve a buscar. Errores de límite de uso de Meta (4, 17, 613, 80004)
se reintentan solos; si un cliente falla, se anota y se sigue con el próximo.

Dónde se ve: ficha del cliente → Resultados (rangos, campañas, inversión por día, ROAS), el panel del cliente (en
criollo: "Invertiste", "Te escribieron X veces", comparado con el mismo tramo del mes pasado) y Reportes → *Pauta de los
clientes* (todos juntos, con aviso si la última actualización falló).

Permisos del token: `ads_read` + los de Instagram de arriba. Cada cuenta publicitaria tiene que estar asignada al
usuario del sistema.

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
