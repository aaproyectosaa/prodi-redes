# Prodi Redes

Gestor interno de Prodi para la producción de **videos comerciales con pauta en Meta**.

- **Super admin**: tablero, clientes, planes, equipo, cobros e informes.
- **Producción**: planifica con el cliente, agenda rodajes, sube el crudo y revisa antes del cliente.
- **Edición**: edita y entrega.
- **Pauta**: sube a las redes, pauta y carga resultados.
- **Cliente**: aprueba videos, ve resultados, pide piezas gráficas con IA (pago con Mercado Pago) y compra videos extra.

Stack: React + Vite + Tailwind/shadcn · Firebase (Auth, Firestore, FCM) · Google Drive · funciones de Vercel ·
Gemini · Mercado Pago · Resend.

```bash
pnpm install
pnpm dev        # app y /api en http://localhost:8080 (lee .env y .env.local; usá una base de prueba)
pnpm build
pnpm exec vite build --config vite.demo.config.ts   # demo con datos de ejemplo → dist-demo/
```

Despliegue y migración: [`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md).
