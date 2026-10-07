import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { manejarApi } from "./scripts/api-local";

/** En `pnpm dev`, /api corre acá mismo (8080): las funciones de api/ como en Vercel, recargadas al editarlas. */
function apiEnDev(env: Record<string, string>): Plugin {
  return {
    name: "prodi-api-local",
    apply: "serve",
    configureServer(server) {
      // Las funciones leen process.env: .env y encima .env.local (lo que ya venga de afuera gana).
      for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = v;
      server.middlewares.use((req, res, next) => {
        manejarApi(__dirname, req, res, (archivo) => server.ssrLoadModule(archivo))
          .then((atendida) => !atendida && next())
          .catch(next);
      });
    },
  };
}

/** La app "Prodi Chat" (/chat-app…) usa chat-app.html: su manifest y sus íconos de iPhone. Como el rewrite de vercel.json. */
const esChatApp = (url = "") => /^\/chat-app(\/|\?|$)/.test(url);
function chatAppHtml(): Plugin {
  const reescribir = (req: { url?: string }, _res: unknown, next: () => void) => {
    if (esChatApp(req.url)) req.url = "/chat-app.html" + (req.url!.includes("?") ? req.url!.slice(req.url!.indexOf("?")) : "");
    next();
  };
  return {
    name: "prodi-chat-app-html",
    configureServer(server) {
      server.middlewares.use(reescribir);
    },
    configurePreviewServer(server) {
      server.middlewares.use(reescribir);
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // Con VITE_API_PROXY, /api va a otro servidor (p. ej. la app publicada) en vez de correr acá.
  const apiProxyTarget = env.VITE_API_PROXY?.replace(/\/$/, "");

  return {
    server: {
      host: "::",
      port: 8080,
      proxy: apiProxyTarget ? { "/api": { target: apiProxyTarget, changeOrigin: true } } : undefined,
    },
    plugins: [react(), chatAppHtml(), !apiProxyTarget && apiEnDev(env)],
    build: {
      rollupOptions: {
        // Dos páginas con el mismo código: el sistema (index.html) y la app de chats (chat-app.html).
        input: {
          main: path.resolve(__dirname, "index.html"),
          chat: path.resolve(__dirname, "chat-app.html"),
        },
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
