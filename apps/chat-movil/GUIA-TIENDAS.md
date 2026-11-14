# Prodi Chat en App Store y Google Play

La app abre `https://prodi-chat.vercel.app/chat-app` y le suma lo nativo: avisos, botón atrás, splash y área segura.
Lo que se cambia en la web llega solo a la app con cada deploy de Vercel. A la tienda se vuelve a subir solo cuando
cambia algo de esta carpeta (ícono, permisos, plugins).

- **Identificador de la app (en las dos tiendas):** `com.somosprodi.chat`. No se puede cambiar después.
- **Política de privacidad:** `https://prodi-chat.vercel.app/privacidad-chat.html`
- **Borrar la cuenta:** en la app, Menú → Mi perfil → «Borrar mi cuenta». Le llega el pedido a los admins y se borra a mano desde Equipo.

---

## 1. Firebase (avisos): una sola vez

1. En [console.firebase.google.com](https://console.firebase.google.com), crear el proyecto «Prodi Chat» (Analytics: no).
2. **Android:** «Agregar app» → Android → paquete `com.somosprodi.chat` → bajar `google-services.json` → guardarlo en
   `apps/chat-movil/android/app/google-services.json`.
3. **iPhone:** «Agregar app» → Apple → bundle `com.somosprodi.chat` → bajar `GoogleService-Info.plist` → guardarlo en
   `apps/chat-movil/ios/App/App/GoogleService-Info.plist`.
   Esos dos archivos no son secretos: se pueden subir al repo.
4. **Clave de Apple para avisos:** en developer.apple.com → Certificates, IDs & Profiles → Keys → «+» → marcar
   *Apple Push Notifications service (APNs)* → bajar el `.p8`. En Firebase: ⚙ Configuración → Cloud Messaging →
   App de Apple → subir el `.p8` con el Key ID y el Team ID.
5. **Para el servidor (lo cargan Agustín o Ariel en Vercel):** Firebase → ⚙ Configuración → Cuentas de servicio →
   «Generar nueva clave privada». Se baja un JSON. En Vercel → prodi-redes → Settings → Environment Variables:
   - `FIREBASE_SERVICE_ACCOUNT` = el contenido entero del JSON (o el JSON en base64). Production y Preview.
   - Después, redeploy.

Sin `FIREBASE_SERVICE_ACCOUNT` la app anda igual, pero no le llegan avisos. Para probar: Mi perfil → Avisos → «Probar».

---

## 2. Google Play (Android)

**Cuenta:** [play.google.com/console](https://play.google.com/console), USD 25 un solo pago.
- **Como persona:** antes de publicar hay que hacer una *prueba cerrada* con **12 testers durante 14 días**
  (mails de Gmail del equipo y clientes de confianza).
- **Como organización:** no hace falta esa prueba, pero piden un número D-U-N-S (gratis, tarda unos días).

**Compilar el .aab** (en esta PC ya están Java 21 y el SDK de Android):

```bash
cd apps/chat-movil && pnpm run android:aab
```

Sale en `apps/chat-movil/android/app/build/outputs/bundle/release/app-release.aab`.
Para cada versión nueva, subir `versionCode` (1, 2, 3…) y `versionName` en `android/app/build.gradle`.

**Firma:** `android/firma/` (no está en git) tiene la clave de subida y su contraseña. **Hacé una copia en un lugar
seguro (Drive privado).** Google Play guarda la clave final (Play App Signing); si esta se pierde, se pide una nueva a
Google, pero tarda.

**Subirla:**
1. Crear la app: nombre «Prodi Chat», idioma Español (Latinoamérica), App, Gratis.
2. Panel → completar «Configura tu app»:
   - Política de privacidad: la URL de arriba.
   - Acceso a la app: «Algunas funciones están restringidas» → cargar un usuario y contraseña de prueba (un cliente demo).
   - Anuncios: No. Clasificación de contenido: cuestionario (comunicación entre usuarios: sí).
   - Público objetivo: 18+. Noticias: no. Apps gubernamentales/financieras/salud: no.
   - **Seguridad de los datos:** recopila nombre, email, fotos y videos, audio, mensajes, ID del dispositivo (para avisos).
     Cifrados en tránsito: sí. Se puede pedir borrarlos: sí (URL de privacidad). No se comparten con terceros.
   - URL para borrar la cuenta: la de privacidad (sección «Borrar tu cuenta»).
3. Pruebas → Prueba cerrada → crear versión → subir el `.aab` → agregar los testers.
4. Después de los 14 días: Producción → nueva versión con el mismo `.aab` (o uno nuevo).

---

## 3. App Store (iPhone), sin Mac

**Cuenta:** [developer.apple.com/programs](https://developer.apple.com/programs), USD 99 por año.
Como organización también piden D-U-N-S.

**Una vez:**
1. developer.apple.com → Identifiers → «+» → App IDs → `com.somosprodi.chat` → marcar **Push Notifications**.
2. [appstoreconnect.apple.com](https://appstoreconnect.apple.com) → Apps → «+» → Nueva app → iOS, «Prodi Chat»,
   bundle `com.somosprodi.chat`, SKU `prodi-chat`.
3. App Store Connect → Usuarios y acceso → Integraciones → **Claves de API** → generar una con rol *App Manager* →
   bajar el `.p8` (se baja una sola vez) y anotar Issuer ID y Key ID.
4. En [codemagic.io](https://codemagic.io) (alcanzan los 500 minutos gratis por mes):
   - Conectar el repo de GitHub.
   - Team settings → Integrations → Developer Portal → cargar la clave de API con el nombre **Prodi App Store**.
   - En la app de Codemagic → Environment variables → grupo `firebase` → `GOOGLE_SERVICE_INFO_PLIST` = el plist en
     base64 (solo si no lo subiste al repo).
   - En `codemagic.yaml` (raíz del repo), cambiar `APP_STORE_APP_ID` por el Apple ID numérico de la app
     (App Store Connect → la app → Información de la app).
   - Code signing identities → generar el certificado de distribución de iOS (Codemagic lo crea y lo guarda).

**Cada versión:** Codemagic → Start new build → workflow «Prodi Chat · iPhone». Compila, firma y la sube a
**TestFlight** sola (unos 15 a 20 minutos). En el iPhone, con la app TestFlight, se prueba antes de mandarla a revisión.
Para una versión nueva subir `MARKETING_VERSION` (1.0 → 1.1) en `ios/App/App.xcodeproj/project.pbxproj`. El número
de compilación lo sube Codemagic.

**Mandarla a revisión** (App Store Connect → la app):
- Privacidad de la app: URL de privacidad. Datos: contacto (nombre, email), contenido del usuario (fotos, videos,
  audio, mensajes), identificadores (ID del dispositivo). Vinculados al usuario: sí. Rastreo: **no**.
- Información de revisión: usuario y contraseña de prueba, y una nota:
  «Prodi Chat es la app de mensajería de la agencia con sus clientes. Las cuentas las crea la agencia; se puede pedir
  la baja desde Mi perfil → Borrar mi cuenta».
- Clasificación por edad: 12+ (comunicación sin moderar entre usuarios). Categoría: Negocios.
- Encriptación: ya está declarada en la app (solo HTTPS).

Ojo: Apple a veces rechaza las apps que «son solo una web» (regla 4.2). A favor tenemos avisos nativos, cámara y
micrófono para llamadas, y borrar la cuenta. Si la rechazan por eso, se responde explicando que es la herramienta de
comunicación de la agencia con sus clientes y se puede sumar algo nativo más (por ejemplo, compartir fotos desde la galería
a un chat).

---

## 4. Textos para las fichas

**Nombre:** Prodi Chat
**Subtítulo (iPhone, 30 letras):** Tu equipo de Prodi, al toque
**Descripción corta (Android, 80 letras):** Hablá con el equipo de Prodi: videos para aprobar, mensajes y llamadas.

**Descripción:**

> Prodi Chat es la forma más rápida de hablar con tu equipo de Prodi.
>
> • Chateá con tu productor, editor y diseñadora en un solo lugar.
> • Aprobá tus videos y piezas desde el chat, o pedí cambios con un toque.
> • Mandá fotos, videos, audios y archivos.
> • Hacé videollamadas y reuniones sin instalar nada más.
> • Recibí avisos al instante: mensajes nuevos, menciones y videos listos para ver.
> • Tema claro, oscuro o violeta.
>
> Para usar Prodi Chat necesitás un usuario de Prodi. Si sos cliente, te lo da tu equipo.

**Palabras clave (iPhone, 100 letras):** chat,agencia,redes,videos,aprobar,equipo,marketing,contenido,mensajes,prodi
**Categoría:** Negocios (secundaria: Productividad).
**Soporte / contacto:** progresodigital.arg@gmail.com · URL de soporte: `https://prodi-chat.vercel.app/privacidad-chat.html`

---

## 5. Capturas

Con un usuario demo (sin datos reales de clientes), sacar 4 o 5 pantallas:
1. Lista de chats. 2. Una conversación con un video para aprobar. 3. Una videollamada. 4. Avisos. 5. El tema violeta.

| Tienda | Tamaño | Cuántas |
|---|---|---|
| App Store | iPhone 6,9" → 1320 × 2868 (o 1290 × 2796) | 3 a 10 |
| Google Play | Teléfono, 1080 × 1920 o más (9:16) | 2 a 8 |
| Google Play | Gráfico destacado 1024 × 500 | 1 |
| Google Play | Ícono 512 × 512 | `public/icons/icon-chat-512.png` |

La app es solo para iPhone (sin iPad), así que no hacen falta capturas de iPad.
Se pueden sacar desde el celular o desde Chrome en la compu (F12 → modo teléfono, 430 × 932, captura de 3x).

---

## Para tener en cuenta

- **Franja negra abajo en iPhone:** en la app nativa no pasa (era de la app instalada desde Safari). La web se dibuja
  de borde a borde y se acomoda con el área segura.
- **Links del sistema** (abrir Prodi, Drive, links de clientes): se abren en el navegador del teléfono.
- **Sin conexión:** muestra «Sin conexión» con «Reintentar» y vuelve sola cuando hay internet.
- **iPhone:** el `Package.swift` lo regenera Codemagic (`cap sync ios` en la Mac). En Windows no se puede porque usa symlinks.
