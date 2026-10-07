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
- **Aprobación por link**: cuando producción manda un video al cliente, el aviso lleva un link firmado (`/aprobar/<token>`) para mirarlo y aprobarlo o pedir cambios **sin usuario**. El link vence a los 30 días y solo sirve mientras el video espera aprobación. Producción también lo puede copiar desde el video ("Link para el cliente"). Función `/api/publico/[accion]`.
- **Resultados desde Meta**: en la pauta de cada video se carga el ID del anuncio (o campaña). Un cron diario trae alcance, impresiones, reproducciones, mensajes, clics e inversión, y se puede forzar con "Actualizar ahora". Ver `docs/META.md`.
- **Débito automático del abono** con suscripciones de Mercado Pago: el cliente lo activa desde "Mi plan" (o el admin le manda el link). Cada cobro mensual queda en `cobros` con `tipo: "abono"`. El admin lo cancela o actualiza el monto desde *Clientes → Informe y cobros*.
- **Marca para las piezas IA**: logo y hasta 4 piezas de referencia por cliente (`projects.marca_archivos`, en `Progreso/<cliente>/Marca`). Se mandan a Gemini como imágenes junto con el pedido.
- **Guion y tomas con IA** por video, **hoja de rodaje** con la lista de tomas, y campo "qué tiene que tener listo el cliente" (con sugerencia de IA) que le llega el **día anterior al rodaje** por la app, push y correo.
- **Piezas para cartelería**: además de redes, afiche/flyer (2:3), cartel o menú (3:4) y banner/lona (21:9).

### Agregado en la versión 5

- **Guía para el cliente**: bienvenida en 4 pasos la primera vez que entra (se puede cerrar; queda en `profiles.guia_cliente_at` y se reabre con "¿Cómo funciona?"), cartel fijo de **próximo paso** arriba de todo (`src/lib/redes/proximoPaso.ts`), recorrido de cada video del mes (Idea → Filmación → Edición → Tu OK → En redes), pedido de piezas en 3 pasos y ayudas en Resultados y Piezas.
- **Datos de ejemplo en el sistema real**: *Ajustes → Datos de ejemplo → Cargar*. Carga los mismos clientes, videos, chats, rodajes, piezas y cobros de la demo (marcados con `demo_ejemplo: true`, las personas dicen "· ejemplo", sin mails ni avisos por correo). Se borran con un botón. Las imágenes de ejemplo están en `public/demo/`. Acción `/api/usuarios/ejemplo-cargar` y `/ejemplo-borrar`.
- **El cliente pide videos**: botón "Pedir un video" (qué, para cuándo, confirmar). Si entra en el plan del mes se crea al toque y producción recibe el aviso; si se pasa, se cotiza el video extra y se cobra con Mercado Pago (el video se crea cuando se acredita el pago). Si el mes siguiente tiene lugar, le ofrece dejarlo para ese mes sin costo. Acción `/api/pagos/pedir-video`.
- **Pedir video, detalles**: opción "Otros" con texto libre y calendario para elegir el día que lo necesita publicado (`videos.fecha_deseada`; el mes del plan sale de esa fecha). El equipo ve la fecha en la tarjeta y en el video.
- **Audios en el chat**: botón de micrófono (como en los mensajeros), hasta 3 minutos. El audio se guarda comprimido en `chats/{id}/audios` (fuera del mensaje, así la lista de mensajes sigue liviana) y se baja solo al reproducirlo. Reglas en `firestore.rules`: hay que volver a publicarlas.
- **Kanban o calendario**: en "Mis videos" del equipo, en Videos del admin y en el panel del cliente hay un selector. El calendario muestra cada video el día de la filmación, el día que lo pidió el cliente y el día que se publicó (colores + íconos), con el detalle del día abajo.
- **Marca obligatoria para el cliente**: mientras le falte el logo, el rubro o "qué lo hace distinto", la bienvenida no se puede cerrar. Lo guarda el servidor (`/api/ia/marca-info`, el cliente no escribe `projects` directo). Los datos van a la IA (copys, guiones, piezas).
- **App instalable** (sin Play Store ni App Store): botón "Instalar app" con los pasos de cada equipo, aviso en el celular, pantalla sin conexión y accesos rápidos. Opcional: .apk de Android para descarga directa. Ver `docs/APP.md`.
- El zip trae también `DEMO-abrir-con-doble-clic.html`: la demo completa en un archivo, sin servidor.

### Agregado en la versión 6 (para agilizar a producción)

- **Armar el mes con IA**: botón "Armar el mes con IA" en el kanban de producción, en Videos del admin y en cada cliente. La IA propone tantas ideas como videos libres tenga el plan del mes, usando la marca, los videos que más mensajes trajeron, las fechas comerciales del mes y lo aprendido del cliente. Queda como **borrador que el cliente no ve**: producción edita, pide "otra idea" (con una pista opcional), quita o agrega ideas propias, y recién con "Aprobar y mandar" le llega al cliente. El cliente marca cada idea "Va" o "Cambiaría algo" (con comentario); las que van se convierten solas en videos del mes. Las que pidió cambiar las ajusta producción y crea el video (o las descarta). Colección `planes_mes/{cliente}_{mes}`.
- **La IA aprende de cada cliente** (`ia_memoria/{cliente}`, solo producción la ve): guarda qué ideas dejó producción tal cual, cuáles cambió (antes → después), cuáles sacó o rehízo, cuáles agregó, qué aprobó el cliente y qué pidió cambiar. Con eso Gemini reescribe un resumen corto que usa en el próximo plan. Además hay "Indicaciones fijas para la IA" por cliente (ej. "no mostrar precios").
- **Subir el material desde la hoja de rodaje**: en cada video de la hoja hay "Filmar" (cámara del celular) y "Subir". Cuando está el material del último video de la jornada, todos pasan solos a edición, la editora recibe el aviso y el rodaje queda como realizado. También se puede mandar uno solo antes.
- **Correcciones en el segundo exacto**: al pedir cambios (producción o el cliente desde el panel) se pausa el video y se toca "Marcar un cambio en 0:12". La editora ve las marcas sobre la línea de tiempo y tocando cada una el video salta a ese segundo (`videos.feedback_marcas`).
- **Recordatorio automático al cliente**: si un video lleva 48 h esperando su OK, el cron diario le manda el aviso (app, push y correo) con el link para aprobar sin entrar (cada 48 h, hasta 3). Al tercero le avisa a producción para que lo llame. Lo mismo con las ideas del mes sin responder (hasta 2). En el video se ve cuántos recordatorios se mandaron.
- Acciones nuevas dentro de `/api/ia/[accion]` (siguen siendo 12 funciones): `plan-mes`, `plan-enviar`, `plan-responder`, `plan-ajustar`, `memoria-notas`. **Hay que volver a publicar `firestore.rules`** (reglas de `planes_mes`, `ia_memoria` y `feedback_marcas`). No hay variables nuevas.

### Agregado en la versión 7 (negocio, gráfica y contexto comercial)

- **Tablero del dueño**: el del super admin ahora es el del negocio, sin producción. Muestra lo facturado y cobrado del mes, lo que se le paga al equipo y lo que queda, el crecimiento de los últimos 12 meses, los clientes (abono, extras, mensajes y estado del cobro), los pedidos que entraron y alertas para vender más o no perder clientes. Videos, rodajes y piezas siguen en el menú, en la sección "Producción".
- **Facturación del 27** (`/facturacion`, solo super admin): el cron diario, el día 27, arma una boleta por cliente en `facturas/{cliente}_{mes}` con el abono y los ítems fijos (ej. combustible) y avisa para revisarla. Boleta (sin IVA) o factura (con IVA) según el cliente; los que tienen débito automático quedan cobrados solos cuando Mercado Pago debita, y los que pagaron por adelantado salen cobrados. Desde ahí: editar ítems, emitir (el cliente la ve en "Mi plan"), marcar cobrada y el medio, ver o imprimir la boleta con la marca PRODI, copiar el texto del recordatorio y bajar la planilla para Excel con las mismas columnas de siempre. Acción `/api/pagos/facturar`. Datos de cobro, vencimiento, IVA y comisión de Mercado Pago del débito en Ajustes.
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
- **Recordatorio automático de cobro** (cron diario): a los clientes con boleta pendiente, 2 días antes del vencimiento y a los 1, 7 y 15 días de vencida, por la app (y push si lo tienen activado) y por mail. No va a los que pagan con débito. Se apaga por cliente en *Datos de facturación* (`facturacion.sin_recordatorios`).
- **Alta de cliente en un paso**: marca, plan, equipo y el usuario del cliente juntos, con el mensaje de bienvenida armado para copiar o mandar por mail.
- No hay reglas de Firestore nuevas en esta versión (si no se publicaron las de la v9, publicarlas).

### Versión 12: Postgres (Neon) en lugar de Firebase

- **Los datos están en Postgres (Neon).** Cada colección de antes (clientes, videos, facturas, chats…) es un conjunto de documentos JSON en la tabla `documentos` (ver `db/esquema.sql`), con vistas en castellano para consultarla a mano (`clientes`, `videos`, `facturas`, `gastos`…). La app ya no habla con la base directo: todo pasa por `/api/db`, que aplica las **reglas de acceso** (`api/_lib/reglas.ts`, las mismas que tenía `firestore.rules`).
- **"En vivo" sin Firebase:** la app pregunta cada 4 segundos qué cambió (cada 20 con la pestaña en segundo plano) y vuelve a pedir solo eso. Un mensaje de chat tarda 2–5 segundos en aparecerle al otro.
- **Login propio:** usuarios en la tabla `usuarios`, contraseñas con scrypt, sesión firmada con `AUTH_SECRET` (30 días; cambiar la contraseña o desactivar a alguien corta sus sesiones). El registro con código de invitación ahora se valida en el servidor (`INVITATION_CODE`). Link para crear o cambiar la contraseña: `/auth?clave=…` (lo genera el admin en *Equipo*, sirve una sola vez, vence en 3 días).
- **Avisos push estándar (Web Push con claves VAPID)**, sin Firebase Cloud Messaging. Cada persona tiene que volver a activar los avisos una vez en su perfil.
- Las 5 funciones de Drive quedaron en una (`api/drive/[accion].ts`, mismas URLs). Funciones: **10 de 12**.
- Se borraron `firestore.rules` y la dependencia `firebase`. `firebase-admin` queda solo para la migración.
- Pruebas hechas contra un Postgres 16 real (mismo motor que Neon): 37 pruebas de seguridad por rol (`scripts/probar-seguridad.py`), login, cambio de clave, links de clave, registro, chat en vivo entre dos usuarios, emisión de boletas que le llegan al cliente, pagos al equipo, deudas, colores y contexto comercial del cliente, cron diario.

### Versión 12.1 (correcciones antes de subir)

- **Arreglado:** la función `/api/usuarios` (crear, editar y desactivar usuarios, links de contraseña, datos de ejemplo) se caía en Vercel porque usaba los datos de ejemplo desde la carpeta `demo/`. Ahora están en `api/_lib/ejemplo-datos.ts`.
- Conexión a Neon: usa el link tal cual lo da Neon (`sslmode=require&channel_binding=require`), con verificación del certificado y channel binding.
- Se toma `vercel.json` y el arreglo de `api/_lib/google.ts` de la versión de Ariel.
- Probado con lo mismo que arma Vercel (`vercel build`): las 10 funciones compiladas cargan y responden, contra un Postgres con SSL y usuario/contraseña como Neon. 37 pruebas de seguridad, todas las pantallas de todos los roles (compu y celular) sin errores, y los recorridos de cobros, chat en vivo, links de contraseña, registro, pagos, deudas y panel del cliente.

### Versión 12.2 (scroll en el celular)

- La app usa el alto real de la pantalla del celular (`dvh`): en iPhone la parte de abajo ya no queda escondida detrás de la barra del navegador. Lo mismo para todas las ventanas.
- Las ventanas (nuevo cliente, gasto, pieza, reunión…) ya no se salen de la pantalla en el celular: el alto propio de cada una ahora solo aplica en compu.
- Kanban de videos y piezas: en el celular las columnas ya no tienen scroll propio (se deslizaba la columna en vez de la página); se baja con la página y se pasa de columna deslizando de costado. En compu queda igual.
- Tablero y Gastos se salían de costado en el celular (una tabla ancha estiraba toda la pantalla); arreglado para todas las grillas. Notificaciones también, en celulares chicos.
- Los cuadros de texto crecen con lo que se escribe (no queda un scroll adentro de otro).
- En iPhone, tocar un campo ya no hace zoom y deja la pantalla corrida (letra de 16 px en los campos del celular).

- Con el teclado abierto se esconde la barra de abajo (el chat queda pegado al teclado).
- Perfil: el botón *Guardar cambios* quedaba tapado por la barra de abajo. La barra de *Subidas* a Drive tapaba la barra de abajo. Las listas de personas dentro de las ventanas ya no scrollean aparte en el celular.
- Probado en 390 px y 360 px de ancho, con gestos táctiles, en todas las pantallas de todos los roles: sin desbordes, sin zonas trabadas, nada tapado por la barra.

### Reglas de cobro (boletas, vencimiento, interés y débito)

- **Mes vencido: el 27 de cada mes se factura ese mes, y se cobra del 1 al 5 del mes siguiente.** Ej.: la boleta armada el 27/10 es la "boleta de octubre" (servicio de octubre) y se paga del 1 al 5 de noviembre. En la base la boleta guarda `mes` = el mes del 27, que es también el período facturado (`periodoDe(mes)` en `api/_lib/facturacion.ts` devuelve el mismo mes); el id es `{cliente}_{mes}`.
- **Vence el 5** del mes siguiente al facturado (Ajustes → Facturación → "Vence el día", por defecto 5). A un cliente puntual se le pueden cambiar los días ("Cuándo paga" en su ficha → Facturación: `facturacion.pago_desde` / `pago_hasta`, del 1 al 28). Hasta el último día no hay interés.
- **"Tiene pagado hasta"** (`facturacion.adelantado_hasta`, YYYY-MM) es el último **mes de servicio** pagado por adelantado: si pagó hasta diciembre, las boletas de octubre, noviembre y diciembre salen como cobradas.
- **Interés por mora: 0,5% por día, simple, sobre el saldo**, contando cada día (hora de Argentina) desde el siguiente al vencimiento (el 6) hasta el día que se paga. No se guarda en la boleta: se calcula al vuelo (`interesMora`). Al marcarla cobrada se guarda lo cobrado en `facturas.interes_cobrado`. Se ve en Cobros, en "Mi plan" del cliente, en la boleta, en el WhatsApp de recordatorio y en los mails/avisos automáticos.
- **El débito automático de Mercado Pago cobra el total de la boleta más la comisión de Mercado Pago.** Total = abono + extras fijos + IVA si es factura (`totalMensual`, la misma función que la boleta). Comisión = Ajustes → Facturación → "Comisión de Mercado Pago" (`app_settings/redes.comision_mp_pct`, % de lo cobrado con IVA; 0 = sin recargo). El débito es `total / (1 − %/100)` redondeado a pesos (`montoDebito`, se calcula solo en `precioAbono`), así después de la comisión a PRODI le queda el total. La boleta, la factura y ARCA siguen con el total de la boleta; la comisión es solo un recargo del débito.
- Cada débito paga la **última boleta emitida y pendiente** del cliente (un débito de principios de noviembre paga la de octubre; si no hay, el último borrador; si no hay nada, queda en `cobros` con `sin_factura: true` y lo toma la próxima boleta del 27). En el cobro y en la boleta queda `comision_mp` (lo que se quedó MP); para saber si cubre se descuenta: si lo debitado menos la comisión no llega al total, la boleta queda pendiente con el saldo (`facturas.debitado`). Un débito no cobra interés aunque Mercado Pago lo pase después del 5. En el libro del mes la comisión sale como egreso y el "Cobrado" del tablero la descuenta.
- **Suscripciones ya activas**: siguen cobrando su monto de antes (sin comisión) hasta que se toca *Clientes → Informe y cobros → "Cobrar $X desde ahora"*, que actualiza el monto en Mercado Pago y guarda la comisión usada (`suscripcion.comision_pct`). Mientras tanto PRODI absorbe la comisión y no se registra. Lo mismo cuando cambia el precio del plan, el IVA, los extras fijos o la comisión: el sistema no actualiza solo los débitos.

### Factura electrónica (ARCA)

Las de tipo **factura** (con IVA) se autorizan en ARCA desde *Cobros → ver la boleta → "Autorizar en ARCA"*: pide el CAE, lo guarda en `facturas.arca` (tipo, punto de venta, número, CAE y vencimiento) y desde ahí se ve también en "Mi plan" del cliente. Las **boletas** (sin IVA) no van a ARCA. **Por defecto todo cliente se factura con factura**; boleta solo si se elige en su ficha. Va directo a los web services de ARCA con `@arcasdk/core` (`api/_lib/arca.ts`): el certificado y la clave no pasan por ningún intermediario.

- **Letra**: si PRODI es responsable inscripto, A para clientes responsables inscriptos o monotributistas y B para consumidores finales o exentos; si es monotributo, siempre C. Por eso cada cliente con factura necesita la **condición frente al IVA** (ficha del cliente → Facturación).
- **Qué se factura**: el total de la boleta (sin el interés por mora), concepto *servicios*, período = el mes facturado, vencimiento del pago = el de la boleta.
- **No se duplica**: la boleta se marca antes de pedir el CAE. Si un intento queda a medias (se cortó la conexión), hay que revisar en ARCA si salió antes de tocar "Reintentar igual". Una factura con CAE no se puede borrar: se anula con nota de crédito (todavía no está en el sistema).
- **Ticket de acceso**: dura 12 h y ARCA no da otro mientras siga vigente, así que se guarda en la base (`arca_tickets`, solo la lee el servidor).

**Homologación (prueba), una sola vez:**
1. Clave y pedido de certificado (en Git Bash, con el CUIT del emisor sin guiones):
   ```bash
   mkdir -p certs && openssl genrsa -out certs/arca-homo.key 2048
   openssl req -new -key certs/arca-homo.key -subj "/C=AR/O=PRODI/CN=prodi-homo/serialNumber=CUIT 20XXXXXXXXX" -out certs/arca-homo.csr
   ```
   (`certs/` está en `.gitignore`: la clave nunca se sube.)
2. En ARCA con clave fiscal: *Administrador de Relaciones de Clave Fiscal → Adherir servicio → ARCA → WSASS - Autogestión Certificados Homologación*.
3. En **WSASS**: *Nuevo Certificado* → nombre `prodi-homo`, pegar el contenido de `certs/arca-homo.csr` → guardar lo que devuelve como `certs/arca-homo.crt`.
4. En **WSASS**: *Crear autorización a servicio* → el certificado `prodi-homo` y el servicio **wsfe**.
5. En `.env.local`: `ARCA_CUIT`, `ARCA_PUNTO_VENTA=1`, `ARCA_CONDICION` y el certificado y la clave en base64 (`base64 -w0 certs/arca-homo.crt` y `base64 -w0 certs/arca-homo.key`) en `ARCA_CERT` y `ARCA_KEY`. Sin `ARCA_PRODUCCION`.
6. `pnpm arca:probar` → tiene que mostrar los servidores de ARCA en "OK" y el último número de factura.

**Producción**: lo mismo pero el certificado se pide en *Administración de Certificados Digitales* (no WSASS), se autoriza el servicio *Facturación electrónica* en el Administrador de Relaciones, se da de alta un punto de venta **RECE para aplicativo y web services** (*Administración de puntos de venta y domicilios*; PRODI usa el **2**), se cargan las variables en Vercel y `ARCA_PRODUCCION=true`.

### Chat: archivos, @prodi y aprendizaje

- **Archivos** (clip, pegar o arrastrar; en el celular abre el selector): fotos y videos se ven en el chat, el resto es una tarjeta para descargar. Máximo **200 MB** por archivo; no se aceptan ejecutables ni HTML/SVG. El servidor abre la subida a Drive (`Progreso/Chat/<chat>`) con la cuenta de la app y le da a la página solo la URL de ese archivo (`/api/drive/chat-subida`): así también suben los clientes sin tener acceso a Drive. Al terminar, `/api/drive/chat-archivo` comprueba que el archivo sea de ese chat y de esa persona y recién ahí escribe el mensaje. Los archivos **no** se comparten por link: se ven con `/api/drive/media-token`, que ahora también deja verlos a los miembros del chat donde se mandaron (y solo a ellos). Los mensajes con archivo solo los escribe el servidor (`reglas.ts`).
- **@prodi** (se autocompleta al escribir `@`): el mensaje se guarda y `/api/ia/chat-asistente` lo procesa con Gemini, que devuelve un JSON (reunión, tarea, recordar, responder o preguntar). El servidor valida todo: que seas miembro del chat, las personas (por nombre o apodo, sin tildes; si hay dudas, pregunta), que sean usuarios activos que podés sumar (los del chat y, si sos del equipo, todo el equipo), fechas y horas en hora de Argentina. Límite: 4 pedidos por minuto por persona (`prodi_pedidos`). Ejemplos: “@prodi reunión a las 5 pm con Ariel y Pato”, “@prodi recordale a Lucía que mande el guion el viernes”, “@prodi acordate que en noviembre abren la sucursal nueva”. Las reuniones van a `reuniones` (con `fecha` y `fin` en ISO y `participantes`) y las tareas a la colección nueva **`tareas`** (`titulo`, `asignados`, `vence`, `vence_inicio`/`vence_fin`, `hecha`, `creada_por`, `chat_id`, `proyecto_id`): las ven los asignados, quien la pidió y el admin, y se marcan hechas en *Chat → Tareas*. Los avisos salen por `enviarAviso`. El cron diario avisa las tareas que vencen ese día.
- **Aprendizaje**: el cron diario (`/api/informes/diario`) lee los mensajes nuevos de los **grupos de cada cliente** (`chats/cliente_<id>`, con cursor por chat en `ia_memoria.chat_cursor`) y guarda datos cortos para el marketing en `ia_memoria.chat_notas` (`fuente: "chat"`, fecha; sin repetir, máximo 40; sin teléfonos, mails, documentos ni cosas personales). Los chats privados y el grupo del equipo **no** se leen. “@prodi acordate que …” guarda al instante. El plan del mes, el copy y el guion los usan; se ven (y se pueden quitar) en *Plan del mes → Lo que la IA aprendió*.

### Notificaciones: app + push + correo + Google Calendar (WhatsApp eliminado)

- **WhatsApp se sacó por completo**: no hay más vinculación de número, códigos, configuración del bot ni cola `notification_queue` (el servidor ya no escribe ahí; el bot externo se puede apagar). Los campos `whatsapp_*` de los perfiles quedan en la base pero no se usan y la app no los puede escribir; `app_settings/whatsapp_bot` ya no se expone. Se borraron `/api/usuarios/whatsapp-*`. La boleta ya no muestra el WhatsApp: en *Ajustes → Datos de cobro* hay un **mail para comprobantes** opcional. "Recordar" en Cobros ahora **copia** el texto del recordatorio.
- **Cada aviso sale por tres lados** (`enviarAviso` en `api/_lib/notify.ts`, que usan `/api/avisos` y todos los procesos del servidor): **in-app**, **push** (si lo activó) y **correo** al mail del perfil con la marca PRODI (título, texto y botón "Abrir en Prodi"). Por persona: *Mi perfil → Notificaciones → Recibir avisos por correo* (`profiles.email_avisos`, por defecto sí). Para no llenar la casilla: si la persona ya tiene un aviso **sin leer** con la misma clave (ej. varios mensajes del mismo chat) no se repite el mail; las boletas (`factura:`) y los recordatorios de cobro (`cobro:`) no mandan el mail genérico porque ya tienen el suyo; reuniones y tareas que ya están en Calendar tampoco (la invitación de Google es el mail). Se mandan todos juntos en un pedido a Resend (`/emails/batch`) después de guardar; si falla, solo queda en el log. Usa `RESEND_API_KEY`, `INFORME_FROM` (y `INFORME_REPLY_TO` opcional) y `APP_URL` para los links.
- **Google Calendar**: las **reuniones** y las **tareas con fecha** se agendan en el calendario principal de la cuenta de Google conectada en *Ajustes* (la misma de Drive), con los participantes / asignados como invitados (`sendUpdates=all`: a cada uno le llega la invitación y le aparece en su Google Calendar). Hora de Argentina; las tareas son de día completo. Si se mueve la reunión o cambian los invitados se actualiza, y si se borra (o la tarea pierde la fecha) se cancela. Idempotente: el id del evento sale del documento y queda guardado en `google_event_id` (+ `google_event_hash`, solo los escribe el servidor). Se sincroniza en `/api/db/escribir` (lo que se guarda desde la app), en `crearTarea` y en las reuniones de @prodi (`api/_lib/calendario.ts`: `sincronizarCalendario`, `agendarEnCalendario`, `cancelarEnCalendario`). Sin Calendar conectado no hace nada.
- **Hay que reconectar Google una vez**: la conexión ahora pide también el permiso `calendar.events`. En *Ajustes → Google Drive y Calendar* aparece el aviso "Falta permitir Google Calendar" con el botón **Reconectar con Calendar** (solo el super admin). En Google Cloud, agregar ese permiso a la pantalla de consentimiento de OAuth y habilitar la **Google Calendar API** en el mismo proyecto.
- **Sonido de Prodi**: cuando llega un aviso con la app abierta y a la vista suena un acorde corto y suave (sintetizado en el navegador, sin archivos). Se apaga en *Mi perfil → Notificaciones → Sonido de notificaciones* (se guarda en ese dispositivo). Con la app cerrada, la notificación push usa el sonido del sistema.

## 2. Pasos para desplegar (versión 12, Neon)

1. **Neon**: en el proyecto, copiar la *connection string* "pooled" (termina en `-pooler…/neondb?sslmode=require`).
   Va como `DATABASE_URL` en Vercel. ⚠️ Si la contraseña de la base anduvo por chats o mails, rotarla en Neon (*Roles → Reset password*) y usar la nueva.
2. **Crear las tablas** (desde la compu, una vez; se puede repetir):
   ```bash
   pnpm install
   DATABASE_URL="postgresql://…" pnpm db:setup
   ```
3. **Pasar los datos de Firebase** (una sola vez, con la service account):
   ```bash
   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json DATABASE_URL="postgresql://…" pnpm migrar:firebase              # simula y cuenta
   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json DATABASE_URL="postgresql://…" pnpm migrar:firebase --aplicar  # copia
   ```
   Copia todas las colecciones (con los mensajes de los chats) y los usuarios. Para que **sigan entrando con la misma contraseña**,
   cargar en Vercel los parámetros de Firebase (*Authentication → Users → ⋮ → Password hash parameters*):
   `FIREBASE_HASH_SIGNER_KEY`, `FIREBASE_HASH_SALT_SEPARATOR`, `FIREBASE_HASH_ROUNDS`, `FIREBASE_HASH_MEM_COST`.
   Al entrar por primera vez, la clave se pasa sola al formato nuevo. Si no se cargan, el admin les manda el link desde *Equipo → Link para cambiar contraseña*.
   - Para **probar antes con datos de ejemplo** en una base vacía (no en la de producción): `DATABASE_URL="…" pnpm db:ejemplo` (todos entran con la clave `prodi2026`, ej. lucas@somosprodi.com).
4. **Variables en Vercel** (ver `.env.example`):
   - Nuevas: `DATABASE_URL`, `AUTH_SECRET` (texto al azar de 32+ caracteres), `INVITATION_CODE`,
     `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` + `VITE_VAPID_PUBLIC_KEY` (la misma pública) — se generan con `pnpm exec web-push generate-vapid-keys`.
   - Se borran: todas las `VITE_FIREBASE_*` y `VITE_INVITATION_CODE`. `FIREBASE_SERVICE_ACCOUNT_BASE64` se puede borrar después de migrar.
   - Siguen igual: Drive (`GOOGLE_OAUTH_*`, `TOKEN_ENCRYPTION_KEY`, `OAUTH_STATE_SECRET`), `GEMINI_API_KEY`, Mercado Pago, `RESEND_API_KEY`, `CRON_SECRET`, `APROBACION_SECRET`, `APP_URL`, Meta.
5. **Deploy** normal en Vercel. Ya no hay reglas que publicar en Firebase.
6. **Probar en la compu antes de subir** (opcional): poné en `.env.local` la `DATABASE_URL` de una branch de Neon
   (nunca la de producción) y corré `pnpm dev` → http://localhost:8080 (la app y las funciones de /api, como en Vercel).
   Para probar la versión compilada: `pnpm build && pnpm local` → http://localhost:3001.
   Con datos de ejemplo cargados: `python3 scripts/probar-seguridad.py` corre las pruebas de acceso por rol.
7. **Mercado Pago**: el webhook sigue en `https://TU-DOMINIO/api/pagos/webhook` (no cambia).
8. **Resend**: verificar el dominio `somosprodi.com` para que salgan los mails (informes, boletas, recordatorios).
9. **Google Calendar**: habilitar la *Google Calendar API* en el proyecto de Google Cloud del OAuth de Drive, sumar el permiso `https://www.googleapis.com/auth/calendar.events` a la pantalla de consentimiento y, ya desplegado, en *Ajustes* tocar **Reconectar con Calendar** (una vez). El bot de WhatsApp ya no se usa.

10. **En la app, como super admin**: *Ajustes* (precios, Drive conectado), *Equipo* (rol de cada persona),
    *Clientes → Configuración* (plan, equipo, usuarios del cliente, correos y marca).
11. **Meta** (resultados automáticos): ver `docs/META.md`. Sin `META_ACCESS_TOKEN` los resultados se cargan a mano.

## 3. Funciones de servidor (`/api`)

Son **10** (el plan Hobby de Vercel permite 12). Cualquier función nueva conviene meterla como acción dentro de una
de las existentes (`[accion].ts`).

| Ruta | Qué hace |
|---|---|
| `POST /api/avisos` | Aviso in-app + push + correo cuando un video cambia de etapa |
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

`pnpm exec vite build --config vite.demo.config.ts` genera `dist-demo/`: la misma app con datos de ejemplo,
sin base ni servidor (todo simulado en el navegador; sirve para mostrar pantallas). No se despliega en producción.
Para probar de verdad, usar `pnpm local` contra una base Postgres (ver paso 6).

## 6. A futuro: publicar y pautar desde el sistema

Ver `docs/META.md`.
