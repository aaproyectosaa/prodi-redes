import Link from "@/software/compat";
import { useRouter } from "@/software/compat";
import { FormEvent, useState } from "react";
import { useToast } from "@/software/compat";
import type { MpAppPublic } from "@/software/lib/types";
import { swFetch } from "@/software/compat";

type Props = {
  mode: "create" | "edit";
  initial?: MpAppPublic | null;
  onSaved?: () => void;
};

export function AppForm({ mode, initial, onSaved }: Props) {
  const router = useRouter();
  const showToast = useToast();
  const [name, setName] = useState(initial?.name || "");
  const [clientId, setClientId] = useState(initial?.client_id || "");
  const [clientSecret, setClientSecret] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [saving, setSaving] = useState(false);
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
        : null,
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

      if (data.connection?.ok || data.app?.connection_status === "ok") {
        const text =
          data.connection?.message ||
          (data.app?.mp_nickname
            ? `Conectado como @${data.app.mp_nickname}`
            : "Conectado con Mercado Pago ✓");
        setConnMsg({ ok: true, text });
        showToast(text);
      } else if (data.app?.connection_status === "error") {
        setConnMsg({
          ok: false,
          text: data.app.connection_error || "Token inválido",
        });
        showToast("No se pudo conectar — revisá el Access Token");
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
    if (!confirm("¿Eliminar esta app y sus pagos?")) return;
    await swFetch(`/api/apps/${initial.id}`, { method: "DELETE" });
    showToast("App eliminada");
    router.push("/apps");
  };

  return (
    <form onSubmit={onSubmit} className="card">
      <div className="field">
        <label>Nombre de la app</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder="Ej: App principal socios"
        />
      </div>
      <div className="field">
        <label>Client ID</label>
        <input
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          className="mono"
          required={mode === "create"}
          placeholder="De Developers → Tu aplicación"
        />
      </div>
      <div className="field">
        <label>
          Client Secret
          {initial?.has_client_secret ? ` (guardado: ${initial.client_secret_masked})` : ""}
        </label>
        <input
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
          className="mono"
          required={mode === "create"}
          placeholder={mode === "edit" ? "Dejá vacío para no cambiar" : ""}
        />
      </div>
      <div className="field">
        <label>
          Access Token (producción)
          {initial?.has_access_token ? ` (guardado: ${initial.access_token_masked})` : ""}
        </label>
        <input
          value={accessToken}
          onChange={(e) => setAccessToken(e.target.value)}
          className="mono"
          placeholder={mode === "edit" ? "Dejá vacío para no cambiar" : "Para leer pagos y fees"}
          required={mode === "create"}
        />
      </div>

      {connMsg ? (
        <div
          className="card"
          style={{
            marginBottom: "0.85rem",
            background: connMsg.ok
              ? "color-mix(in srgb, var(--ok) 14%, transparent)"
              : "color-mix(in srgb, var(--danger) 14%, transparent)",
            borderColor: connMsg.ok
              ? "color-mix(in srgb, var(--ok) 35%, var(--line))"
              : "color-mix(in srgb, var(--danger) 35%, var(--line))",
            boxShadow: "none",
          }}
        >
          <strong style={{ color: connMsg.ok ? "var(--ok)" : "var(--danger)" }}>
            {connMsg.ok ? "Conexión OK" : "No conectó"}
          </strong>
          <div className="meta" style={{ marginTop: 4 }}>
            {connMsg.text}
          </div>
        </div>
      ) : null}

      {mode === "edit" && initial ? (
        <div style={{ marginBottom: "0.85rem" }}>
          <span className={`pill ${initial.connection_status}`}>
            Conexión {initial.connection_status}
          </span>
        </div>
      ) : null}

      <div className="actions form-actions">
        <button className="btn" type="submit" disabled={saving}>
          {saving ? "Guardando…" : mode === "create" ? "Crear app" : "Guardar"}
        </button>
        <Link className="btn line" href="/apps">
          Volver
        </Link>
        {mode === "edit" ? (
          <button type="button" className="btn danger sm" onClick={remove}>
            Eliminar
          </button>
        ) : null}
      </div>
    </form>
  );
}
