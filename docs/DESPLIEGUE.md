# Prodi Redes · Guía de despliegue (para Ariel / Agustín)

Este repo es el mismo gestor de antes ("Roquest"), reestructurado al modelo actual de Prodi Redes:
**videos comerciales con pauta en Meta**. Desde la versión 12 la base es **Postgres en Neon** (antes Firebase)
con login propio; la conexión de Google Drive sigue igual. Las tareas viejas (`tasks`) no se borran: quedan como historial.

## 1. Qué cambió

| Antes | Ahora |
|---|---|
| Roles admin, CM, PM, productor, editor, diseñador, cliente | **admin** (super admin), **productor** (producción), **editor**, **pauta**, **cliente** |
| Tareas de feed, carrusel, historias | Un solo circuito: **video** |
| Aprobación del PM | Revisión interna de **producción** y después el cliente |
| — | Rodajes (día, hora, lugar, varios videos por jornada) |
| Planes por tipo de pieza | Planes de **videos por mes** + videos extra |
| Diseñador | **Piezas gráficas con IA** que el cliente pide y **paga con Mercado Pago** |
| — | Resultados de pauta cargados por el equipo + **informe mensual por mail** |
| — | Tablero del super admin (cuellos de botella, carga del equipo, oportunidades de venta) |

Circuito de cada video:

```
planificado → agendado (rodaje) → edición → revisión interna → revisión del cliente → para subir y pautar → publicado
                                     ↑______ cambios ______|________ cambios _________|
```

### Agregado en la versión 2

- **Chat interno**: un grupo "Equipo Prodi", un grupo por cliente (equipo asignado + usuarios del cliente + admins) y mensajes privados. Los grupos los crea y mantiene solo el sistema cuando el super admin abre la app. Colección `chats` con subcolección `mensajes`.
- **Videollamadas gratis** con Jitsi Meet (`meet.jit.si`, sin cuenta ni API key). Se arrancan desde el chat o desde Reuniones. En `meet.jit.si` la primera persona que entra a la sala tiene que iniciar sesión con Google o GitHub para abrirla (los demás no). Si se quiere evitar, se puede cambiar el servidor en `app_settings/redes.jitsi_base`.
- **Minutas con IA**: se graba el audio en el navegador (pestaña de la llamada + micrófono, o solo micrófono para reuniones presenciales), se sube a Drive (`Progreso/<cliente>/Reuniones`) y Gemini arma resumen, temas, acuerdos y tareas. También funciona con notas escritas. Colección `reuniones`. La función `/api/ia/minuta` puede tardar hasta 5 minutos: necesita *Fluid compute* activado en Vercel (viene activado en proyectos nuevos).
- **Gestión de usuarios** desde Equipo: crear (con contraseña temporal), editar rol y clientes, desactivar, eliminar y generar link para cambiar la contraseña. Función `/api/usuarios/[accion]`.
- **Ver como**: el super admin puede mirar el sistema como cualquier persona, en solo lectura.
- **Reportes** por persona: entregas, tiempos, aprobados sin cambios, nota de clientes, inversión gestionada, actividad por semana y movimientos recientes.

### Agregado en la versión 3

- **Kanban por rol**: producción, edición y pauta entran directo a "Mis videos" (`/videos`) con columnas de su trabajo. Se sacaron las pantallas de inicio por rol (`/produccion`, `/edicion`, `/pauta` redirigen a `/videos`, así los avisos viejos siguen andando).
- **Aprobación por link**: cuando producción manda un video al cliente, el aviso de WhatsApp lleva un link firmado (`/aprobar/<token>`) para mirarlo y aprobarlo o pedir cambios **sin usuario**. El link vence a los 30 días y solo sirve mientras el video espera aprobación. Producción también lo puede copiar desde el video ("Link para el cliente"). Función `/api/publico/[accion]`.
- **Resultados desde Meta**: en la pauta de cada video se carga el ID del anuncio (o campaña). Un cron diario trae alcance, impresiones, reproducciones, mensajes, clics e inversión, y se puede forzar con "Actualizar ahora". Ver `docs/META.md`.
- **Débito automático del abono** con suscripciones de Mercado Pago: el cliente lo activa desde "Mi plan" (o el admin le manda el link). Cada cobro mensual queda en `cobros` con `tipo: "abono"`. El admin lo cancela o actualiza el monto desde *Clientes → Informe y cobros*.
- **Marca para las piezas IA**: logo y hasta 4 piezas de referencia por cliente (`projects.marca_archivos`, en `Progreso/<cliente>/Marca`). Se mandan a Gemini como imágenes junto con el pedido.
- **Guion y tomas con IA** por video, **hoja de rodaje** con la lista de tomas, y campo "qué tiene que tener listo el cliente" (con sugerencia de IA) que le llega el **día anterior al rodaje** por WhatsApp/push.
- **Piezas para cartelería**: además de redes, afiche/flyer (2:3), cartel o menú (3:4) y banner/lona (21:9).

### Agregado en la versión 5

- **Guía para el cliente**: bienvenida en 4 pasos la primera vez que entra (se puede cerrar; queda en `profiles.guia_cliente_at` y se reabre con "¿Cómo funciona?"), cartel fijo de **próximo paso** arriba de todo (`src/lib/redes/proximoPaso.ts`), recorrido de cada video del mes (Idea → Filmación → Edición → Tu OK → En redes), pedido de piezas en 3 pasos y ayudas en Resultados y Piezas.
- **Datos de ejemplo en el sistema real**: *Ajustes → Datos de ejemplo → Cargar*. Carga los mismos clientes, videos, chats, rodajes, piezas y cobros de la demo (marcados con `demo_ejemplo: true`, las personas dicen "· ejemplo", sin mails ni WhatsApp). Se borran con un botón. Las imágenes de ejemplo están en `public/demo/`. Acción `/api/usuarios/ejemplo-cargar` y `/ejemplo-borrar`.
- **El cliente pide videos**: botón "Pedir un video" (qué, para cuándo, confirmar). Si entra en el plan del mes se crea al toque y producción recibe el aviso; si se pasa, se cotiza el video extra y se cobra con Mercado Pago (el video se crea cuando se acredita el pago). Si el mes siguiente tiene lugar, le ofrece dejarlo para ese mes sin costo. Acción `/api/pagos/pedir-video`.
- **Pedir video, detalles**: opción "Otros" con texto libre y calendario para elegir el día que lo necesita publicado (`videos.fecha_deseada`; el mes del plan sale de esa fecha). El equipo ve la fecha en la tarjeta y en el video.
- **Audios en el chat**: botón de micrófono (como WhatsApp), hasta 3 minutos. El audio se guarda comprimido en `chats/{id}/audios` (fuera del mensaje, así la lista de mensajes sigue liviana) y se baja solo al reproducirlo. Reglas en `firestore.rules`: hay que volver a publicarlas.
- **Kanban o calendario**: en "Mis videos" del equipo, en Videos del admin y en el panel del cliente hay un selector. El calendario muestra cada video el día de la filmación, el día que lo pidió el cliente y el día que se publicó (colores + íconos), con el detalle del día abajo.
- **Marca obligatoria para el cliente**: mientras le falte el logo, el rubro o "qué lo hace distinto", la bienvenida no se puede cerrar. Lo guarda el servidor (`/api/ia/marca-info`, el cliente no escribe `projects` directo). Los datos van a la IA (copys, guiones, piezas).
- **App instalable** (sin Play Store ni App Store): botón "Instalar app" con los pasos de cada equipo, aviso en el celular, pantalla sin conexión y accesos rápidos. Opcional: .apk de Android para descarga directa. Ver `docs/APP.md`.
- El zip trae también `DEMO-abrir-con-doble-clic.html`: la demo completa en un archivo, sin servidor.

### Agregado en la versión 6 (para agilizar a producción)

- **Armar el mes con IA**: botón "Armar el mes con IA" en el kanban de producción, en Videos del admin y en cada cliente. La IA propone tantas ideas como videos libres tenga el plan del mes, usando la marca, los videos que más mensajes trajeron, las fechas comerciales del mes y lo aprendido del cliente. Queda como **borrador que el cliente no ve**: producción edita, pide "otra idea" (con una pista opcional), quita o agrega ideas propias, y recién con "Aprobar y mandar" le llega al cliente. El cliente marca cada idea "Va" o "Cambiaría algo" (con comentario); las que van se convierten solas en videos del mes. Las que pidió cambiar las ajusta producción y crea el video (o las descarta). Colección `planes_mes/{cliente}_{mes}`.
- **La IA aprende de cada cliente** (`ia_memoria/{cliente}`, solo producción la ve): guarda qué ideas dejó producción tal cual, cuáles cambió (antes → después), cuáles sacó o rehízo, cuáles agregó, qué aprobó el cliente y qué pidió cambiar. Con eso Gemini reescribe un resumen corto que usa en el próximo plan. Además hay "Indicaciones fijas para la IA" por cliente (ej. "no mostrar precios").
- **Subir el material desde la hoja de rodaje**: en cada video de la hoja hay "Filmar" (cámara del celular) y "Subir". Cuando está el material del último video de la jornada, todos pasan solos a edición, la editora recibe el aviso y el rodaje queda como realizado. También se puede mandar uno solo antes.
- **Correcciones en el segundo exacto**: al pedir cambios (producción o el cliente desde el panel) se pausa el video y se toca "Marcar un cambio en 0:12". La editora ve las marcas sobre la línea de tiempo y tocando cada una el video salta a ese segundo (`videos.feedback_marcas`).
- **Recordatorio automático al cliente**: si un video lleva 48 h esperando su OK, el cron diario le manda WhatsApp/push con el link para aprobar sin entrar (cada 48 h, hasta 3). Al tercero le avisa a producción para que lo llame. Lo mismo con las ideas del mes sin responder (hasta 2). En el video se ve cuántos recordatorios se mandaron.
- Acciones nuevas dentro de `/api/ia/[accion]` (siguen siendo 12 funciones): `plan-mes`, `plan-enviar`, `plan-responder`, `plan-ajustar`, `memoria-notas`. **Hay que volver a publicar `firestore.rules`** (reglas de `planes_mes`, `ia_memoria` y `feedback_marcas`). No hay variables nuevas.

### Agregado en la versión 7 (negocio, gráfica y contexto comercial)

- **Tablero del dueño**: el del super admin ahora es el del negocio, sin producción. Muestra lo facturado y cobrado del mes, lo que se le paga al equipo y lo que queda, el crecimiento de los últimos 12 meses, los clientes (abono, extras, mensajes y estado del cobro), los pedidos que entraron y alertas para vender más o no perder clientes. Videos, rodajes y piezas siguen en el menú, en la sección "Producción".
- **Facturación del 27** (`/facturacion`, solo super admin): el cron diario, el día 27, arma una boleta por cliente en `facturas/{cliente}_{mes}` con el abono y los ítems fijos (ej. combustible) y avisa para revisarla. Boleta (sin IVA) o factura (con IVA) según el cliente; los que tienen débito automático quedan cobrados solos cuando Mercado Pago debita, y los que pagaron por adelantado salen cobrados. Desde ahí: editar ítems, emitir (el cliente la ve en "Mi plan"), marcar cobrada y el medio, ver o imprimir la boleta con la marca PRODI, mandarla por WhatsApp y bajar la planilla para Excel con las mismas columnas de siempre. Acción `/api/pagos/facturar`. Datos de cobro, vencimiento e IVA en Ajustes.
- **Pagos al equipo**: en Facturación → Pagos al equipo se carga cómo se le paga a cada uno (fijo, por trabajo o las dos cosas) y el sistema cuenta solo lo del mes desde el historial: videos filmados (producción), editados (edición), publicados (pauta) y piezas entregadas (diseño). Se suman bonos o descuentos y se marca pagado. Colecciones `equipo_pagos` y `equipo_liquidaciones` (solo super admin).
- **Rol Diseño** (`diseno`, Karen): hace la gráfica de todos los clientes sin estar asignada a cada uno. Su inicio es el kanban de piezas (Para hacer, Diseñando, Esperando al cliente, Entregadas). Arma cada pieza con IA o sube su propio diseño (imagen o PDF), y la manda al cliente para aprobar.
- **Piezas gráficas, flujo nuevo**: el cliente elige qué necesita (redes o para imprimir, con un dibujito de cada formato), si es **para vender** (producto, precio o promo y qué tiene que hacer la gente) o **para comunicar** (saludo, horario, novedad), y confirma. Cada plan incluye piezas por mes (`planes_redes.piezas_mes`); pasado eso se cobra aparte con Mercado Pago, con precio distinto para redes y para imprimir. El cliente aprueba la versión o pide cambios, como con los videos, y recién ahí la descarga. Acción `/api/pagos/pedir-pieza`.
- **Contexto comercial para la IA**: en Ajustes, "Cómo vende Prodi" (el enfoque en resultados y leads, lo lee la IA en todo). En cada cliente, pestaña **Comercial**: enfoque, qué cuenta como resultado, productos y servicios (★ los que hay que empujar) y temporadas o promos con fechas. La IA lo usa en el plan del mes, los textos, los guiones y las piezas, y las temporadas solo cuando están vigentes. Se guarda en `ia_memoria/{cliente}.comercial` (acción `/api/ia/comercial-guardar`).
- Siguen siendo 12 funciones. **Hay que volver a publicar `firestore.rules`** (facturas, pagos al equipo, rol diseño y piezas). No hay variables nuevas. Para Karen: crearle el usuario en Equipo con el rol "Diseño".

### Agregado en la versión 8 (administración)

- **Facturar por cliente o en masa**: en Facturación cada cliente tiene su casilla. Si el mes todavía no está preparado, se elige a quién facturarle (los que no tienen plan también, y los ítems se cargan después). Con la lista armada: "Emitir" por cliente, o se tildan varios y aparece una barra para emitir, marcar cobradas (con el medio), imprimir todas las boletas juntas en un PDF, bajar la planilla solo de esas o "No facturar" este mes. Filtros: para revisar, falta cobrar, vencidas, cobradas. "Facturar a otro cliente" suma uno que quedó afuera. Desde cada fila, "Datos de facturación del cliente": boleta o factura, razón social, CUIT, ítems fijos, adelantado y **"No facturarle solo el 27"** (canje o pausa: el cron lo saltea).
- **Rol Administración** (`administracion`): entra directo a Facturación y ve Gastos, Números (el tablero del negocio) y Chat. Maneja cobros, boletas, datos de facturación de los clientes, pagos al equipo y gastos. No ve ni toca la producción.
- **Gastos** (`/gastos`, colección `gastos`): se carga cada gasto con categoría, medio y proveedor; los que se repiten se traen del mes anterior con un toque. Muestra en qué se va la plata y el **libro del mes** (todo lo que entró y salió) para pasarle al contador en Excel. En el tablero, "Te queda" ya descuenta los gastos.
- **Hay que volver a publicar `firestore.rules`**. Para el usuario de administración: crearlo en Equipo con el rol "Administración".

### Agregado en la versión 9

- **Emitir una boleta le llega al cliente**: al emitir (acción `POST /api/pagos/emitir`) la boleta pasa a "falta cobrar", el cliente recibe el aviso en su panel ("Mi plan" la abre directo) y un **duplicado por mail** a los correos del cliente (`contacto_emails` + el mail de sus usuarios) con el detalle y el botón "Ver y descargar", que lleva al sistema (no se adjunta PDF). Usa Resend (`RESEND_API_KEY`, `INFORME_FROM`); sin eso se emite igual y solo no sale el mail. Solo se mandan las boletas/facturas de administración, no las piezas.
- **Administración simplificada**: el menú de administración ahora es *Resumen* (qué hacer hoy, con un toque a cada cosa), *Cobros* (dos pasos: emitir —se elige a quién, nadie viene tildado— y cobrar), *Pagos al equipo*, *Gastos* y *Deudas e impuestos*. La ruta vieja `/facturacion` redirige sola.
- **Deudas e impuestos** (colección `obligaciones`, solo super admin y administración): créditos del banco, convenio de pagos con ARCA e impuestos mensuales, con sus cuotas. El cron diario avisa el mismo día y 3 días antes de cada vencimiento a super admin y administración. Lo pagado entra solo al libro del mes como egreso.
- **Estadísticas del año** en el tablero del super admin: ingresos y gastos por mes, resultado, clientes activos, mensajes que generaron las campañas, cómo baja la deuda y en qué se fue la plata.
- Hay que **volver a publicar `firestore.rules`** (regla nueva de `obligaciones`).

### Agregado en la versión 11

- **Cobros en dos pasos** (emitir y cobrar): nadie viene tildado, se elige a quién emitir y al emitir se arma y se manda en un solo paso (`POST /api/pagos/emitir` acepta `{ mes, proyecto_ids }`).
- **Pago al equipo por cliente**: en *Pagos al equipo* cada persona puede cobrar un monto por cada cliente que lleva (editable cliente por cliente, con fijo opcional). Se guarda en `equipo_pagos/{uid}.por_cliente`.
- **Menú lateral plegable**: Administración, Producción y Gestión arrancan plegados; se abre solo el grupo donde estás.
- **Calendario de piezas** para diseño (además del kanban): lo pendiente cae en la fecha que pidió el cliente (`piezas_ia.fecha_deseada`, nuevo campo opcional al pedir) y lo entregado en el día que se aprobó.
- **Panel del cliente**: "Mi plan" rehecho (si está al día o cuánto debe, qué incluye y cuánto usó, cómo paga, boletas); nueva pestaña "Mi negocio" con logo, **colores de la marca** (`projects.marca.paleta`, acción `POST /api/ia/marca-colores`) y **lo que vende** (el cliente carga el contexto comercial: `POST /api/ia/comercial-ver` y `comercial-guardar` ahora aceptan al cliente). Se sacó la carga de piezas de referencia. Pedir una pieza la primera vez es guiado paso a paso.
- **Recordatorio automático de cobro** (cron diario): a los clientes con boleta pendiente, 2 días antes del vencimiento y a los 1, 7 y 15 días de vencida, por la app (y WhatsApp si lo tienen activado) y por mail. No va a los que pagan con débito. Se apaga por cliente en *Datos de facturación* (`facturacion.sin_recordatorios`).
- **Alta de cliente en un paso**: marca, plan, equipo y el usuario del cliente juntos, con el mensaje de bienvenida armado para copiar o mandar por WhatsApp.
- No hay reglas de Firestore nuevas en esta versión (si no se publicaron las de la v9, publicarlas).

### Versión 12: Postgres (Neon) en lugar de Firebase

- **Los datos están en Postgres (Neon).** Cada colección de antes (clientes, videos, facturas, chats…) es un conjunto de documentos JSON en la tabla `documentos` (ver `db/esquema.sql`), con vistas en castellano para consultarla a mano (`clientes`, `videos`, `facturas`, `gastos`…). La app ya no habla con la base directo: todo pasa por `/api/db`, que aplica las **reglas de acceso** (`api/_lib/reglas.ts`, las mismas que tenía `firestore.rules`).
- **"En vivo" sin Firebase:** la app pregunta cada 4 segundos qué cambió (cada 20 con la pestaña en segundo plano) y vuelve a pedir solo eso. Un mensaje de chat tarda 2–5 segundos en aparecerle al otro.
- **Login propio:** usuarios en la tabla `usuarios`, contraseñas con scrypt, sesión firmada con `AUTH_SECRET` (30 días; cambiar la contraseña o desactivar a alguien corta sus sesiones). El registro con código de invitación ahora se valida en el servidor (`INVITATION_CODE`). Link para crear o cambiar la contraseña: `/auth?clave=…` (lo genera el admin en *Equipo*, sirve una sola vez, vence en 3 días).
- **Avisos push estándar (Web Push con claves VAPID)**, sin Firebase Cloud Messaging. Cada persona tiene que volver a activar los avisos una vez en su perfil.
- Las 5 funciones de Drive quedaron en una (`api/drive/[accion].ts`, mismas URLs). Funciones: **10 de 12**.
- Se borraron `firestore.rules` y la dependencia `firebase`. `firebase-admin` queda solo para la migración.
- Pruebas hechas contra un Postgres 16 real (mismo motor que Neon): 37 pruebas de seguridad por rol (`scripts/probar-seguridad.py`), login, cambio de clave, links de clave, registro, chat en vivo entre dos usuarios, emisión de boletas que le llegan al cliente, pagos al equipo, deudas, colores y contexto comercial del cliente, cron diario.

## 2. Pasos para desplegar (versión 12, Neon)

1. **Neon**: en el proyecto, copiar la *connection string* "pooled" (termina en `-pooler…/neondb?sslmode=require`).
   Va como `DATABASE_URL` en Vercel. ⚠️ Si la contraseña de la base anduvo por chats o mails, rotarla en Neon (*Roles → Reset password*) y usar la nueva.
2. **Crear las tablas** (desde la compu, una vez; se puede repetir):
   ```bash
   npm install
   DATABASE_URL="postgresql://…" npm run db:setup
   ```
3. **Pasar los datos de Firebase** (una sola vez, con la service account):
   ```bash
   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json DATABASE_URL="postgresql://…" npm run migrar:firebase              # simula y cuenta
   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json DATABASE_URL="postgresql://…" npm run migrar:firebase -- --aplicar  # copia
   ```
   Copia todas las colecciones (con los mensajes de los chats) y los usuarios. Para que **sigan entrando con la misma contraseña**,
   cargar en Vercel los parámetros de Firebase (*Authentication → Users → ⋮ → Password hash parameters*):
   `FIREBASE_HASH_SIGNER_KEY`, `FIREBASE_HASH_SALT_SEPARATOR`, `FIREBASE_HASH_ROUNDS`, `FIREBASE_HASH_MEM_COST`.
   Al entrar por primera vez, la clave se pasa sola al formato nuevo. Si no se cargan, el admin les manda el link desde *Equipo → Link para cambiar contraseña*.
   - Para **probar antes con datos de ejemplo** en una base vacía (no en la de producción): `DATABASE_URL="…" npm run db:ejemplo` (todos entran con la clave `prodi2026`, ej. lucas@somosprodi.com).
4. **Variables en Vercel** (ver `.env.example`):
   - Nuevas: `DATABASE_URL`, `AUTH_SECRET` (texto al azar de 32+ caracteres), `INVITATION_CODE`,
     `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` + `VITE_VAPID_PUBLIC_KEY` (la misma pública) — se generan con `npx web-push generate-vapid-keys`.
   - Se borran: todas las `VITE_FIREBASE_*` y `VITE_INVITATION_CODE`. `FIREBASE_SERVICE_ACCOUNT_BASE64` se puede borrar después de migrar.
   - Siguen igual: Drive (`GOOGLE_OAUTH_*`, `TOKEN_ENCRYPTION_KEY`, `OAUTH_STATE_SECRET`), `GEMINI_API_KEY`, Mercado Pago, `RESEND_API_KEY`, `CRON_SECRET`, `APROBACION_SECRET`, `APP_URL`, Meta.
5. **Deploy** normal en Vercel. Ya no hay reglas que publicar en Firebase.
6. **Probar en la compu antes de subir** (opcional): `npm run build`, después
   `DATABASE_URL="…" AUTH_SECRET="…" npm run local` → http://localhost:3001 (la app y las funciones, como en Vercel).
   Con datos de ejemplo cargados: `python3 scripts/probar-seguridad.py` corre las pruebas de acceso por rol.
7. **Mercado Pago**: el webhook sigue en `https://TU-DOMINIO/api/pagos/webhook` (no cambia).
8. **Resend**: verificar el dominio `somosprodi.com` para que salgan los mails (informes, boletas, recordatorios).
9. **Bot de WhatsApp**: lee la cola `notification_queue`, que ahora está en Postgres
   (`select * from documentos where coleccion = 'notification_queue' and data->>'status' = 'pending'`). Hay que apuntarlo a la base nueva.

10. **En la app, como super admin**: *Ajustes* (precios, Drive conectado), *Equipo* (rol de cada persona),
    *Clientes → Configuración* (plan, equipo, usuarios del cliente, correos y marca).
11. **Meta** (resultados automáticos): ver `docs/META.md`. Sin `META_ACCESS_TOKEN` los resultados se cargan a mano.

## 3. Funciones de servidor (`/api`)

Son **10** (el plan Hobby de Vercel permite 12). Cualquier función nueva conviene meterla como acción dentro de una
de las existentes (`[accion].ts`).

| Ruta | Qué hace |
|---|---|
| `POST /api/avisos` | Aviso in-app + push + WhatsApp cuando un video cambia de etapa |
| `POST /api/ia/copy` | 3 opciones de texto para el posteo (Gemini) |
| `POST /api/ia/minuta` | Minuta de una reunión a partir de la grabación o las notas |
| `POST /api/usuarios/*` | Crear, editar, desactivar, eliminar usuarios y links de contraseña (solo super admin) |
| `POST /api/ia/pieza` | Genera una versión de la pieza gráfica y la guarda en Drive (`Progreso/<cliente>/Piezas IA`) |
| `POST /api/pagos/crear` | Crea el cobro y la preferencia de Checkout Pro |
| `POST /api/pagos/webhook` | Recibe a Mercado Pago, confirma el pago y aplica el efecto |
| `POST /api/pagos/verificar` | Al volver del checkout, confirma el pago por si el webhook demora |
| `POST /api/pagos/reembolsar` | El equipo rechaza una pieza: devuelve el pago |
| `POST /api/informes/enviar` | Vista previa / envío manual del informe |
| `GET  /api/informes/cron` | Envío automático del día 1 |
| `GET  /api/informes/diario` | Cron diario: resultados de Meta, aviso el día antes del rodaje, recordatorios de 48 h, facturación del 27, vencimientos de cuotas e impuestos y recordatorios de cobro a clientes |
| `POST /api/informes/meta` | Trae ya los resultados de Meta de un video |
| `POST /api/publico/video`, `/responder`, `GET /media` | Página pública de aprobación (sin usuario, con link firmado) |
| `POST /api/publico/link` | Producción genera el link de aprobación para mandar |
| `POST /api/pagos/suscribir`, `/suscripcion` | Débito automático del abono: alta, baja y cambio de monto |
| `POST /api/ia/guion`, `/preparar` | Guion + tomas del video; qué tiene que tener listo el cliente para el rodaje |
| `POST /api/ia/marca-subir`, `/marca-quitar` | Logo y piezas de referencia de la marca |
| `POST /api/ia/plan-mes`, `/plan-enviar`, `/plan-responder`, `/plan-ajustar`, `/memoria-notas` | Plan del mes con IA, revisión de producción, respuesta del cliente y lo que aprende la IA |
| `POST /api/ia/comercial-guardar` | Contexto comercial del cliente (productos, temporadas) para la IA |
| `POST /api/pagos/pedir-pieza` | El cliente pide una pieza: entra en el plan o se cobra |
| `POST /api/pagos/facturar` | Prepara la facturación de un mes (también la corre el cron el 27) |
| `POST /api/pagos/emitir` | Emite boletas (o arma y emite a los clientes elegidos): aviso al cliente en su panel + duplicado por mail |
| `POST /api/ia/marca-colores`, `/comercial-ver` | Colores de la marca y contexto comercial desde el panel del cliente |
| `/api/drive/*`, `/api/in-app-notifications/delete` | Igual que antes (Drive ahora es una sola función con las mismas URLs) |
| `POST /api/db/consultar`, `/escribir`, `/cambios` | Los datos de la app (con las reglas de acceso) y el aviso de cambios para que todo se vea en vivo |
| `POST /api/auth/login`, `/registrar`, `/yo`, `/cambiar-clave`, `/usar-link`, `/nombre`, `/push` | Login, cuenta del usuario y suscripción a los avisos push |

Los precios se calculan siempre en el servidor (el cliente no puede mandar un monto).

## 4. Colecciones (ahora en Postgres, tabla `documentos`)

`videos`, `rodajes`, `piezas_ia`, `cobros`, `planes_redes`, `informes`, `chats` (+ `mensajes`), `reuniones`, `app_settings/redes`,
`planes_mes` (plan del mes con IA), `ia_memoria` (lo que la IA aprendió de cada cliente y su contexto comercial; solo producción y diseño),
`facturas`, `equipo_pagos`, `equipo_liquidaciones`, `gastos` y `obligaciones` (super admin y administración). En `projects`: `facturacion` (boleta o factura, razón social, CUIT, ítems fijos, adelantado).
En `projects` se agregaron: `plan_redes_id`, `plan_redes_override`, `creditos_extra`, `contacto_emails`,
`marca`, `redes`, `meta`, `team_roles.pauta`, `marca_archivos` y `suscripcion` (estos dos los escribe solo el servidor).
En `videos`: `guion`, `tomas`, `meta.ad_id`, `feedback_marcas`, `recordatorios_cliente`, `recordatorio_cliente_at`, `plan_idea_id`. En `rodajes`: `preparar`, `recordatorio_at`. Los tipos están en `src/lib/redes/types.ts`.

## 5. Demo navegable

`npx vite build --config vite.demo.config.ts` genera `dist-demo/`: la misma app con datos de ejemplo,
sin base ni servidor (todo simulado en el navegador; sirve para mostrar pantallas). No se despliega en producción.
Para probar de verdad, usar `npm run local` contra una base Postgres (ver paso 6).

## 6. A futuro: publicar y pautar desde el sistema

Ver `docs/META.md`.
