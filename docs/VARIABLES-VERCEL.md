# Variables de Vercel · prodi-redes

Proyecto de Vercel: **prodi-redes** → Settings → Environment Variables → ambiente **Production**.
Después de cargar o cambiar cualquiera: **Deployments → ⋯ → Redeploy** (si no, no la toma).

> Este archivo no tiene ningún valor secreto, solo los nombres. Las claves nunca van en el repo ni en chats.
> Al pegar un valor: solo la clave, **sin comillas, sin espacios y sin salto de línea al final**.

Estado al **8/10/2026** (según los registros de Vercel y la base):
✅ anda · ❌ falla · ➕ falta cargar · ⚪ sin verificar

## 1. Urgentes (hoy no andan)

| Variable | Estado | Para qué | De dónde sale (a nombre de Prodi) |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | ❌ "la clave no es válida" (401) | IA de texto: @prodi, copys, guiones, plan del mes, memoria, minutas escritas | console.anthropic.com → Claves de API → Crear clave (**Vence: Nunca**). Cuenta de Lucas (org Prodi) |
| `RESEND_API_KEY` | ❌ "API key is invalid" (401): **no sale ningún mail** | Todos los mails: boletas, avisos, links de contraseña, recordatorios de cobro | resend.com → API Keys. Antes: Domains → verificar `somosprodi.com` (registros DNS) |
| `GEMINI_API_KEY` | ❌ falta o no es válida | Minutas desde el audio de las reuniones (y las imágenes si en Ajustes se elige Gemini) | aistudio.google.com/apikey → Create API key → **Set up billing** (pago, así Google no usa los datos) |
| `OPENAI_API_KEY` | ➕ no está | Imágenes de las piezas gráficas (si en Ajustes está elegido ChatGPT, que es lo que viene) | platform.openai.com → API keys (cargar saldo en Billing) |

## 2. Base de datos y cuentas

| Variable | Estado | Para qué |
|---|---|---|
| `DATABASE_URL` | ✅ (la app anda) | Base Postgres en Neon (proyecto "progreso"). ⚠️ Está al 92% del tráfico gratis del mes: ver nota abajo |
| `AUTH_SECRET` | ✅ (el login anda) | Firma las sesiones y los links de contraseña. No cambiarla (cierra la sesión de todos y vence los links) |
| `INVITATION_CODE` | ⚪ | Código para registrarse sin invitación (opcional) |
| `DB_POOL_MAX` | ⚪ opcional | Conexiones a la base por función (por defecto está bien) |

## 3. Google Drive y Calendar

| Variable | Estado | Para qué |
|---|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | ⚪ | Conexión con Google (Drive y Calendar) |
| `GOOGLE_OAUTH_CLIENT_SECRET` | ⚪ | Ídem |
| `TOKEN_ENCRYPTION_KEY` | ⚪ | Cifra el permiso de Drive guardado en la base (64 caracteres hex). **No cambiarla**: si cambia, hay que reconectar Drive |
| `OAUTH_STATE_SECRET` | ⚪ | Seguridad del login con Google |

Prueba: Ajustes → "Google Drive y Calendar" tiene que decir conectado.

## 4. Avisos al celular (push)

| Variable | Estado | Para qué |
|---|---|---|
| `VAPID_PUBLIC_KEY` | ⚪ | Clave pública de las notificaciones |
| `VITE_VAPID_PUBLIC_KEY` | ⚪ | La misma clave pública (la usa la app). Tiene que ser **igual** a la de arriba |
| `VAPID_PRIVATE_KEY` | ⚪ | Clave privada (par de la pública) |
| `VAPID_SUBJECT` | ⚪ opcional | `mailto:hola@somosprodi.com` |

Prueba: Mi perfil → Notificaciones → "Mandar notificación de prueba".

## 5. Mails (además de la clave de Resend)

| Variable | Estado | Para qué |
|---|---|---|
| `INFORME_FROM` | ⚪ | Remitente. Sin cargar: `Prodi <informes@somosprodi.com>` (el dominio tiene que estar verificado en Resend) |
| `INFORME_REPLY_TO` | ⚪ opcional | A dónde responden los clientes |

## 6. Cobros, facturas y Meta

| Variable | Estado | Para qué |
|---|---|---|
| `MP_ACCESS_TOKEN` | ⚪ | Mercado Pago (débitos, videos y piezas extra). Credenciales de **producción** de la cuenta de Prodi |
| `MP_WEBHOOK_SECRET` | ⚪ | Valida los avisos de pago de Mercado Pago |
| `ARCA_CUIT`, `ARCA_CERT`, `ARCA_KEY`, `ARCA_PUNTO_VENTA`, `ARCA_CONDICION`, `ARCA_PRODUCCION` | ⚪ | Factura electrónica (ver docs/DESPLIEGUE.md, sección ARCA). Punto de venta de Prodi: 2 |
| `META_ACCESS_TOKEN`, `META_APP_SECRET`, `META_GRAPH_VERSION` | ⚪ | Resultados de Instagram/Facebook y pauta |

## 7. Sistema

| Variable | Estado | Para qué |
|---|---|---|
| `APP_URL` | ✅ | `https://prodi-redes.vercel.app` (links de mails, push y Mercado Pago) |
| `VITE_APP_URL` | ⚪ opcional | La misma dirección (la usa la app) |
| `CRON_SECRET` | ⚪ | Protege las tareas automáticas diarias (recordatorios, facturación del 27) |
| `APROBACION_SECRET` | ⚪ | Links para que el cliente apruebe videos sin entrar |

## 8. Opcionales (no hace falta tocarlas)

| Variable | Para qué |
|---|---|
| `ANTHROPIC_MODEL` | Modelo de Claude. Sin cargar = `claude-opus-5-5` (el mejor). **No cargarla** salvo que se quiera otro |
| `OPENAI_IMAGE_MODEL`, `OPENAI_IMAGE_QUALITY` | Modelo y calidad de imágenes de ChatGPT (por defecto `gpt-image-1`, `high`) |
| `GEMINI_TEXT_MODEL`, `GEMINI_IMAGE_MODEL` | Modelos de Gemini (por defecto los actuales) |
| `VITE_CHAT_URL` | `https://prodi-chat.vercel.app` **solo** después de agregar ese dominio en Settings → Domains. Separa los avisos del chat (van solo a Prodi Chat) |
| `VITE_APK_URL` | Link al instalador de Android, si hay |

## Cómo comprobar que quedaron bien

1. **IA:** entrar como super admin → **Ajustes → "Con qué IA se hace cada cosa"**: cada una tiene que decir **Conectada** en verde. Después escribir `@prodi hola` en un chat: tiene que contestar.
2. **Mails:** Equipo → a alguien → "Link para cambiar contraseña" → que le llegue el mail. En Vercel → Logs no tiene que aparecer `[mail] lote rechazado`.
3. **Si una clave falla:** en Vercel → Logs aparece la causa. Para Claude dice *"Claude rechazó la clave (empieza con …, N caracteres)"*: una buena empieza con `sk-ant-api03` y tiene más de 100 caracteres.

## Nota: base de datos (Neon) al 92% del tráfico gratis

El plan gratis de Neon trae 5 GB de tráfico por mes y el proyecto "progreso" ya usó 4,6 GB. Si llega al 100%, **el sistema se puede caer hasta que se renueve el mes**.
Recomendado: pasar el proyecto de Neon a una cuenta de Prodi (Neon permite transferir el proyecto) y activar el plan pago **Launch** con la tarjeta de Prodi. **No hace falta mudarse a Supabase:** es más trabajo y más riesgo, y hay que cambiar el código.
