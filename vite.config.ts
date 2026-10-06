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
    plugins: [react(), !apiProxyTarget && apiEnDev(env)],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
