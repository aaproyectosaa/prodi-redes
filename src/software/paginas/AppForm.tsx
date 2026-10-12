import Link from "@/software/compat";
import { useRouter } from "@/software/compat";
import { FormEvent, useState, type ReactNode } from "react";
import { ArrowLeft, Check, CheckCircle2, Copy, ExternalLink, KeyRound, Trash2, Webhook, XCircle } from "lucide-react";
import { useToast } from "@/software/compat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/software/ui/ConfirmDialog";
import { StatusPill } from "@/software/ui/StatusPill";
import type { MpAppPublic } from "@/software/lib/types";
import { swFetch } from "@/software/compat";
import { cn } from "@/lib/utils";

type Props = {
  mode: "create" | "edit";
  initial?: MpAppPublic | null;
  onSaved?: () => void;
  /** URL que hay que cargar en Mercado Pago Developers → Webhooks (la da el servidor al abrir la app). */
  webhookUrl?: string;
};

const MP_DEVELOPERS = "https://www.mercadopago.com.ar/developers/panel/app";

export function AppForm({ mode, initial, onSaved, webhookUrl }: Props) {
  const router = useRouter();
  const showToast = useToast();
  const [name, setName] = useState(initial?.name || "");
  const [clientId, setClientId] = useState(initial?.client_id || "");
  const [clientSecret, setClientSecret] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [hookUrl, setHookUrl] = useState(webhookUrl || "");
  const [hookStatus, setHookStatus] = useState(initial?.webhook_status || "pending");
  const [connMsg, setConnMsg] = useState<{ ok: boolean; text: string } | null>(
    initial?.connection_status === "ok"
      ? {
          ok: true,
          text: initial.mp_nickname
            ? `Conectado como @${initial.mp_nickname}`
            : initial.mp_user_id
              ? `Conectado · ID ${initial.mp_user_id}`
              : "Conectado",
        }
      : initial?.connection_status === "error"
        ? { ok: false, text: initial.connection_error || "Error de conexión" }
        : null
  );

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setConnMsg(null);
    try {
      const body: Record<string, string> = {
        name,
        client_id: clientId,
      };
      if (clientSecret) body.client_secret = clientSecret;
      if (accessToken) body.access_token = accessToken;

      const res = await swFetch(mode === "create" ? "/api/apps" : `/api/apps/${initial!.id}`, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setConnMsg({ ok: false, text: data.error || "No se pudo conectar" });
        throw new Error(data.error || "No se pudo guardar");
      }
      if (data.webhook_url) setHookUrl(String(data.webhook_url));

      if (data.connection?.ok || data.app?.connection_status === "ok") {
        const text =
          data.connection?.message || (data.app?.mp_nickname ? `Conectado como @${data.app.mp_nickname}` : "Conectado con Mercado Pago ✓");
        setConnMsg({ ok: true, text });
        showToast(text);
      } else if (data.app?.connection_status === "error") {
        setConnMsg({
          ok: false,
          text: data.app.connection_error || "Token inválido",
        });
        showToast("No se pudo conectar: revisá el Access Token");
      } else {
        showToast("App guardada ✓");
      }

      if (mode === "create" && data.app?.id) {
        window.setTimeout(() => router.push(`/apps/${data.app.id}`), 900);
      } else {
        onSaved?.();
        router.refresh();
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Error");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!initial?.id) return;
    setDeleting(true);
    try {
      await swFetch(`/api/apps/${initial.id}`, { method: "DELETE" });
      showToast("App eliminada");
      setConfirmDelete(false);
      router.push("/apps");
    } finally {
      setDeleting(false);
    }
  };

  const probarWebhook = async () => {
    if (!initial?.id) return;
    setTesting(true);
    try {
      const res = await swFetch(`/api/apps/${initial.id}/test-webhook`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (data.webhook_url) setHookUrl(String(data.webhook_url));
      setHookStatus(res.ok ? "ok" : "error");
      showToast(res.ok ? "El webhook respondió bien ✓" : data.error || "El webhook no respondió");
    } catch {
      showToast("No se pudo probar el webhook");
    } finally {
      setTesting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <section className="space-y-5 rounded-2xl border bg-card p-4 shadow-sm sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <KeyRound className="h-4 w-4 text-primary" />
              Credenciales
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Las sacás de{" "}
              <a href={MP_DEVELOPERS} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline">
                Mercado Pago Developers → Tus integraciones
                <ExternalLink className="h-3 w-3" />
              </a>{" "}
              → elegí la aplicación → Credenciales de producción.
            </p>
          </div>
          {mode === "edit" && initial ? (
            <StatusPill
              status={initial.connection_status}
              label={initial.connection_status === "ok" ? "Conectada" : initial.connection_status === "error" ? "Error de conexión" : "Sin conectar"}
            />
          ) : null}
        </div>

        <Campo id="app-name" label="Nombre de la app" ayuda="Un nombre para reconocerla acá adentro. No se ve en Mercado Pago.">
          <Input id="app-name" value={name} onChange={(e) => setName(e.target.value)} required placeholder="Ej: App principal" className="h-10" />
        </Campo>

        <Campo id="app-client-id" label="Client ID" ayuda="En Credenciales de producción, el número que dice “Client ID”.">
          <Input
            id="app-client-id"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="h-10 font-mono"
            required={mode === "create"}
            autoComplete="off"
            spellCheck={false}
            placeholder="Ej: 1234567890123456"
          />
        </Campo>

        <Campo
          id="app-client-secret"
          label="Client Secret"
          guardado={initial?.has_client_secret ? initial.client_secret_masked : undefined}
          ayuda="Al lado del Client ID. Tocá el ojito en Mercado Pago para verlo y copialo entero."
        >
          <Input
            id="app-client-secret"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            className="h-10 font-mono"
            required={mode === "create"}
            autoComplete="off"
            spellCheck={false}
            placeholder={mode === "edit" ? "Dejá vacío para no cambiarlo" : "Pegá el Client Secret"}
          />
        </Campo>

        <Campo
          id="app-access-token"
          label="Access Token de producción"
          guardado={initial?.has_access_token ? initial.access_token_masked : undefined}
          ayuda="Empieza con APP_USR-. Con él se leen los pagos y las comisiones de la cuenta."
        >
          <Input
            id="app-access-token"
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            className="h-10 font-mono"
            required={mode === "create"}
            autoComplete="off"
            spellCheck={false}
            placeholder={mode === "edit" ? "Dejá vacío para no cambiarlo" : "APP_USR-…"}
          />
        </Campo>

        {connMsg ? (
          <div
            className={cn(
              "flex items-start gap-3 rounded-xl border p-3",
              connMsg.ok ? "border-success/30 bg-success/[0.06]" : "border-destructive/30 bg-destructive/[0.06]"
            )}
          >
            {connMsg.ok ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
            ) : (
              <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            )}
            <div className="min-w-0">
              <p className={cn("text-sm font-semibold", connMsg.ok ? "text-success" : "text-destructive")}>
                {connMsg.ok ? "Conexión OK" : "No se pudo conectar"}
              </p>
              <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{connMsg.text}</p>
            </div>
          </div>
        ) : null}
      </section>

      {mode === "edit" && initial ? (
        <section className="space-y-4 rounded-2xl border bg-card p-4 shadow-sm sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <Webhook className="h-4 w-4 text-primary" />
                Webhook (aviso de cada venta)
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                En Mercado Pago Developers → tu aplicación → Webhooks → Configurar notificaciones: pegá esta URL en “Modo productivo”, marcá el evento
                “Pagos” y guardá. Así cada venta entra al instante.
              </p>
            </div>
            <StatusPill
              status={hookStatus}
              label={hookStatus === "ok" ? "Webhook OK" : hookStatus === "error" ? "Webhook con error" : "Webhook pendiente"}
            />
          </div>
          {hookUrl ? (
            <UrlCopiable url={hookUrl} />
          ) : (
            <p className="text-xs text-muted-foreground">Tocá “Probar webhook” para ver la URL.</p>
          )}
          <Button type="button" variant="outline" onClick={probarWebhook} disabled={testing}>
            <Webhook className="mr-1.5 h-4 w-4" />
            {testing ? "Probando…" : "Probar webhook"}
          </Button>
        </section>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
        <Button variant="ghost" asChild>
          <Link href="/apps">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Volver
          </Link>
        </Button>
        {mode === "edit" ? (
          <Button type="button" variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="mr-1.5 h-4 w-4" />
            Eliminar app
          </Button>
        ) : null}
        <Button type="submit" disabled={saving} className="sm:ml-auto sm:min-w-40">
          {saving ? "Guardando…" : mode === "create" ? "Crear y conectar" : "Guardar cambios"}
        </Button>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="¿Eliminar esta app?"
        body="Se borra la app y todos sus pagos de Prodi Software. En Mercado Pago no se toca nada."
        confirmLabel="Eliminar"
        danger
        busy={deleting}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={remove}
      />
    </form>
  );
}

function Campo({ id, label, ayuda, guardado, children }: { id: string; label: string; ayuda: string; guardado?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <Label htmlFor={id}>{label}</Label>
        {guardado ? <span className="font-mono text-[11px] text-muted-foreground">guardado: {guardado}</span> : null}
      </div>
      {children}
      <p className="text-xs text-muted-foreground">{ayuda}</p>
    </div>
  );
}

function UrlCopiable({ url }: { url: string }) {
  const [ok, setOk] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-xl border bg-muted/30 p-2">
      <code className="min-w-0 flex-1 truncate px-1 font-mono text-xs">{url}</code>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="shrink-0"
        onClick={() => {
          navigator.clipboard?.writeText(url).then(
            () => {
              setOk(true);
              window.setTimeout(() => setOk(false), 1500);
            },
            () => undefined
          );
        }}
      >
        {ok ? <Check className="mr-1 h-3.5 w-3.5" /> : <Copy className="mr-1 h-3.5 w-3.5" />}
        {ok ? "Copiada" : "Copiar"}
      </Button>
    </div>
  );
}
