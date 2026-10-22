/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { callApi } from "@/lib/redes/api";
import { hace } from "@/lib/redes/format";

// Conectar el WhatsApp de Prodi a Leads con el "registro integrado" de Meta en modo coexistencia: el número sigue
// andando en la app WhatsApp Business del celular y cada chat nuevo entra como lead (api/_lib/meta-whatsapp.ts).

interface Estado {
  conectado: boolean;
  numero: string | null;
  nombre: string | null;
  config_id: string;
  app_id: string;
  ultimo_mensaje_at: string | null;
}

let sdk: Promise<any> | null = null;
/** El SDK de Facebook (una sola vez). */
function cargarSdk(appId: string): Promise<any> {
  if ((window as any).FB) return Promise.resolve((window as any).FB);
  sdk ??= new Promise((resolve, reject) => {
    (window as any).fbAsyncInit = () => {
      (window as any).FB.init({ appId, autoLogAppEvents: true, xfbml: false, version: "v23.0" });
      resolve((window as any).FB);
    };
    const s = document.createElement("script");
    s.src = "https://connect.facebook.net/es_LA/sdk.js";
    s.async = true;
    s.crossOrigin = "anonymous";
    s.onerror = () => {
      sdk = null;
      reject(new Error("No se pudo cargar Facebook"));
    };
    document.body.appendChild(s);
  });
  return sdk;
}

export function ConectarWhatsApp() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [configId, setConfigId] = useState("");
  const [busy, setBusy] = useState(false);
  // Lo que manda la ventana de Meta al terminar (cuenta y número elegidos).
  const sesion = useRef<{ waba_id?: string; phone_number_id?: string }>({});

  const cargar = () =>
    callApi<Estado>("/api/web/wa-estado", {})
      .then((e) => {
        setEstado(e);
        setConfigId(e.config_id);
      })
      .catch(() => undefined);

  useEffect(() => {
    void cargar();
    const alMensaje = (ev: MessageEvent) => {
      if (!/facebook\.com$/.test(new URL(ev.origin).hostname)) return;
      try {
        const d = typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data;
        if (d?.type === "WA_EMBEDDED_SIGNUP" && d.data) sesion.current = { waba_id: d.data.waba_id, phone_number_id: d.data.phone_number_id };
      } catch {
        /* otros mensajes de Facebook */
      }
    };
    window.addEventListener("message", alMensaje);
    return () => window.removeEventListener("message", alMensaje);
  }, []);

  const conectar = async () => {
    if (!estado) return;
    setBusy(true);
    try {
      if (configId.trim() !== estado.config_id) await callApi("/api/web/wa-config", { config_id: configId.trim() });
      const FB = await cargarSdk(estado.app_id);
      sesion.current = {};
      const code: string | null = await new Promise((resolve) =>
        FB.login((r: any) => resolve(r?.authResponse?.code ?? null), {
          config_id: configId.trim(),
          response_type: "code",
          override_default_response_type: true,
          extras: { setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" },
        })
      );
      if (!code) throw new Error("Se cerró la ventana de Meta sin terminar");
      // La ventana avisa la cuenta y el número un instante después.
      for (let i = 0; i < 20 && !sesion.current.phone_number_id; i++) await new Promise((r) => setTimeout(r, 250));
      const r = await callApi<{ numero: string | null }>("/api/web/wa-conectar", { code, ...sesion.current });
      toast.success(`WhatsApp conectado${r.numero ? `: ${r.numero}` : ""}`);
      await cargar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo conectar WhatsApp");
    } finally {
      setBusy(false);
    }
  };

  if (!estado) return null;
  return (
    <div className="space-y-2 rounded-xl border bg-muted/40 p-3">
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <MessageCircle className="h-4 w-4 text-emerald-500" /> WhatsApp de Prodi
      </p>
      {estado.conectado ? (
        <p className="flex items-start gap-1.5 rounded-lg bg-emerald-500/10 px-2.5 py-1.5 text-xs text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Conectado{estado.numero ? `: ${estado.numero}` : ""}
            {estado.nombre ? ` (${estado.nombre})` : ""}. Cada chat nuevo entra como lead.
            {estado.ultimo_mensaje_at ? ` Último mensaje ${hace(estado.ultimo_mensaje_at)}.` : ""}
          </span>
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Cada persona que escribe por primera vez al WhatsApp de Prodi entra acá como lead, con aviso. El número sigue funcionando en la app del celular.
        </p>
      )}
      <div className="flex gap-1.5">
        <Input value={configId} onChange={(e) => setConfigId(e.target.value.replace(/\D/g, ""))} placeholder="ID de configuración de Meta" className="h-9 text-xs" inputMode="numeric" />
        <Button size="sm" className="h-9 shrink-0 bg-emerald-500 text-white hover:bg-emerald-600" onClick={() => void conectar()} disabled={busy || configId.length < 6}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : estado.conectado ? "Reconectar" : "Conectar"}
        </Button>
      </div>
    </div>
  );
}
