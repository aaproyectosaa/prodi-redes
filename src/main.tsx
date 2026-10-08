import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { escucharInstalacion } from "./lib/instalar";
import { marcarArranqueChat } from "./lib/chatApp";
import { prepararSonido } from "./lib/sonido";
import { ErrorBoundary, recargarPorVersion } from "./components/ErrorBoundary";

escucharInstalacion();
marcarArranqueChat();
// El audio de los avisos se desbloquea con los toques (en iPhone, también al volver a la app).
prepararSonido();

// Si salió una versión nueva mientras la app estaba abierta, una pantalla puede no encontrar sus archivos: se recarga.
window.addEventListener("vite:preloadError", (e) => {
  if (recargarPorVersion()) e.preventDefault();
});

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
