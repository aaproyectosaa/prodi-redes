import Link, { useParams } from "@/software/compat";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/software/ui/PageHeader";
import { AppForm } from "./AppForm";
import type { MpAppPublic } from "@/software/lib/types";
import { swFetch } from "@/software/compat";

export default function EditAppPage() {
  const params = useParams();
  const id = String(params.id);
  const [app, setApp] = useState<MpAppPublic | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    swFetch(`/api/apps/${id}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error");
        setApp(data.app);
        setWebhookUrl(data.webhook_url || "");
      })
      .catch((e) => setError(e.message));
  }, [id, tick]);

  if (error)
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="rounded-2xl border border-destructive/30 bg-destructive/[0.06] p-4 text-sm text-destructive">{error}</div>
        <Button variant="outline" asChild>
          <Link href="/apps">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Volver a las apps
          </Link>
        </Button>
      </div>
    );
  if (!app)
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Skeleton className="h-10 w-64 rounded-xl" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    );

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title={app.name}
        sub="Credenciales y webhook de esta app de Mercado Pago. Los clientes aparecen solos en Clientes al actualizar desde Mercado Pago."
      />
      <AppForm key={`${app.id}-${app.updated_at}`} mode="edit" initial={app} webhookUrl={webhookUrl} onSaved={() => setTick((t) => t + 1)} />
    </div>
  );
}
