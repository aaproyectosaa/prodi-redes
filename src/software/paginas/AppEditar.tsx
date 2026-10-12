import { useParams } from "@/software/compat";
import { useEffect, useState } from "react";
import { AppForm } from "./AppForm";
import type { MpAppPublic } from "@/software/lib/types";
import { swFetch } from "@/software/compat";

export default function EditAppPage() {
  const params = useParams();
  const id = String(params.id);
  const [app, setApp] = useState<MpAppPublic | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    swFetch(`/api/apps/${id}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error");
        setApp(data.app);
      })
      .catch((e) => setError(e.message));
  }, [id, tick]);

  if (error) return <p style={{ color: "var(--danger)" }}>{error}</p>;
  if (!app) return <p className="meta">Cargando…</p>;

  return (
    <div>
      <h1 className="page-title">{app.name}</h1>
      <p className="page-sub">
        Credenciales de la app. Los clientes salen solos en la sección Clientes al sincronizar.
      </p>
      <AppForm mode="edit" initial={app} onSaved={() => setTick((t) => t + 1)} />
    </div>
  );
}
