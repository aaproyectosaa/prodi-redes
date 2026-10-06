# Prodi como app (sin Play Store ni App Store)

El sistema es una **app instalable** (PWA). Se instala desde el navegador, queda con su ícono, se abre a
pantalla completa, recibe avisos y **se actualiza sola** con cada deploy (no hay que mandar versiones nuevas).

Mientras no la tengan instalada, **cada vez que entran aparece un popup** para instalarla (una vez por visita,
con "Más tarde"), con los pasos de su equipo. También está el botón **"Instalar app"** en el menú lateral, el menú
del celular y la pantalla de ingreso. Ya instalada, si no activaron los avisos en ese equipo, aparece otro popup
**"Activá los avisos"** (un toque). Para que los avisos funcionen hace falta `VITE_FIREBASE_VAPID_KEY` en Vercel.

| Dispositivo | Cómo se instala |
|---|---|
| Android (Chrome, Samsung Internet) | Botón "Instalar ahora" → queda como una app más en el cajón de apps |
| Computadora (Chrome, Edge) | Botón "Instalar ahora" o el ícono de instalar en la barra de direcciones → ventana propia, en el escritorio y el menú de inicio |
| iPhone / iPad | Safari → Compartir → "Agregar a inicio". Apple no permite otra forma fuera del App Store. Instalada así recibe avisos (iOS 16.4 o más nuevo) |

Archivos: `public/manifest.webmanifest` (nombre, íconos, accesos rápidos, capturas), `public/icons/`,
`public/offline.html` (pantalla sin conexión) y el service worker que arma `vite-plugin-firebase-sw.ts`
(avisos push + pantalla sin conexión). Requisito: el sitio tiene que estar en HTTPS (Vercel ya lo está).

## Opcional: instalador .apk para Android (descarga directa)

Para quien prefiera bajar un archivo e instalarlo (sin Play Store). El .apk abre el mismo sistema, así que
también se actualiza solo.

1. Con el sistema ya publicado, entrar a **https://www.pwabuilder.com**, pegar la URL y elegir **Android →
   Generate package** (tipo *Trusted Web Activity*). Package ID sugerido: `com.somosprodi.redes`.
2. Descarga un .zip con el **.apk firmado**, la **clave de firma** (guardarla: hace falta para futuras versiones)
   y un archivo **`assetlinks.json`**.
3. Copiar `assetlinks.json` a `public/.well-known/assetlinks.json` y hacer deploy (así la app abre sin la barra
   del navegador).
4. Subir el .apk (por ejemplo a `public/descargas/prodi.apk`, o a Drive con link público) y cargar la URL en
   Vercel como `VITE_APK_URL`. En el diálogo de instalar aparece "Descargar instalador para Android (.apk)".
5. Al instalarlo, Android pide permitir "instalar apps de orígenes desconocidos" una sola vez.
