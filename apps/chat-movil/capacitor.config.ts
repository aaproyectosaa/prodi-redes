import type { CapacitorConfig } from "@capacitor/cli";

// Prodi Chat nativa: la app abre la web de Prodi Chat (prodi-chat.vercel.app) y le suma lo nativo
// (avisos, botón atrás, splash, área segura). Cada deploy de Vercel actualiza la app sin pasar por la tienda;
// solo hay que volver a subirla cuando cambia algo de acá (plugins, ícono, permisos).
const config: CapacitorConfig = {
  appId: "com.somosprodi.chat",
  appName: "Prodi Chat",
  // Solo la pantalla "sin conexión" (si no carga la web): todo lo demás viene de Vercel.
  webDir: "www",
  backgroundColor: "#000000",
  server: {
    url: "https://prodi-chat.vercel.app/chat-app",
    androidScheme: "https",
    cleartext: false,
    // Fuera de esta dirección (el sistema, Drive, links de clientes) se abre en el navegador del teléfono.
    allowNavigation: ["prodi-chat.vercel.app"],
    errorPath: "sin-conexion.html",
  },
  android: {
    // Cambiar a true solo para depurar con chrome://inspect.
    webContentsDebuggingEnabled: false,
    // La web ya trae su user agent; se agrega esto para reconocer la app (estadísticas, soporte).
    appendUserAgent: "ProdiChatApp",
  },
  ios: {
    // La web dibuja hasta los bordes y se acomoda con env(safe-area-inset-*) (viewport-fit=cover).
    contentInset: "never",
    appendUserAgent: "ProdiChatApp",
    scrollEnabled: false,
  },
  experimental: {
    // iPhone (Swift Package Manager): evita el choque de nombres del paquete de Firebase.
    ios: { spm: { packageOptions: { "@capacitor-firebase/messaging": { symlink: true } } } },
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: "#000000",
      showSpinner: false,
      androidScaleType: "CENTER_CROP",
      splashFullScreen: false,
      splashImmersive: false,
    },
    SystemBars: {
      // Android: la web va de borde a borde (viewport-fit=cover) y se acomoda con env(safe-area-inset-*).
      // En WebView viejos (Chromium < 140) Capacitor le pone margen solo. Las letras de la barra las cambia la web según el tema.
      insetsHandling: "native",
      initialViewportFitValueHint: "cover",
      style: "DARK",
    },
    Keyboard: {
      // Con el teclado, la web se achica (como Android con resizes-content): la caja de escribir queda a la vista.
      resize: "native",
      resizeOnFullScreen: true,
    },
    FirebaseMessaging: {
      // Con la app abierta, el aviso se muestra adentro (un cartel), no como notificación del sistema.
      presentationOptions: ["badge"],
    },
  },
};

export default config;
