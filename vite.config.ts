import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // En desarrollo, /api va al servidor local (pnpm local) o a donde diga VITE_API_PROXY.
  const apiProxyTarget = env.VITE_API_PROXY?.replace(/\/$/, "") || "http://localhost:3001";

  return {
    server: {
      host: "::",
      port: 8080,
      proxy:
        mode === "development"
          ? {
              "/api": {
                target: apiProxyTarget,
                changeOrigin: true,
              },
            }
          : undefined,
    },
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
