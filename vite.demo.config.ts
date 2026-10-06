// Build de la demo navegable: misma app, con la base, el login, Drive y /api simulados en el navegador.
// npx vite build --config vite.demo.config.ts  →  dist-demo/
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import fs from "fs";

const r = (p: string) => path.resolve(__dirname, p);

export default defineConfig({
  root: r("demo"),
  base: "./",
  publicDir: r("public"),
  define: { "import.meta.env.VITE_DEMO": JSON.stringify("1") },
  plugins: [
    react(),
    {
      name: "demo-assets",
      closeBundle() {
        if (!process.env.SINGLE) fs.cpSync(r("demo/public/demo"), r("dist-demo/demo"), { recursive: true });
      },
      configureServer(server) {
        server.middlewares.use("/demo", (req, res, next) => {
          const f = r(`demo/public/demo${req.url}`);
          if (fs.existsSync(f)) {
            res.setHeader("Content-Type", "image/jpeg");
            fs.createReadStream(f).pipe(res);
          } else next();
        });
      },
    },
  ],
  resolve: {
    alias: [
      { find: /^@\/lib\/db$/, replacement: r("demo/firestore-mock.ts") },
      { find: /^@\/lib\/auth$/, replacement: r("demo/auth-mock.ts") },
      { find: /^@\/lib\/redes\/api$/, replacement: r("demo/api-mock.ts") },
      { find: /^@\/hooks\/use-drive-connection$/, replacement: r("demo/drive-mocks.tsx") },
      { find: /^@\/hooks\/use-drive-upload$/, replacement: r("demo/drive-mocks.tsx") },
      { find: /^@\/components\/media\/(TaskMediaGallery|ClientMediaCarousel)$/, replacement: r("demo/drive-mocks.tsx") },
      { find: /^@\//, replacement: `${r("src")}/` },
    ],
  },
  build: process.env.SINGLE
    ? {
        // Un solo archivo: sin chunks separados (se arma con scripts/demo-single.py).
        outDir: r("dist-demo-single"),
        emptyOutDir: true,
        cssCodeSplit: false,
        assetsInlineLimit: 100_000_000,
        chunkSizeWarningLimit: 5000,
        rollupOptions: { output: { inlineDynamicImports: true } },
      }
    : { outDir: r("dist-demo"), emptyOutDir: true, chunkSizeWarningLimit: 2000 },
});
