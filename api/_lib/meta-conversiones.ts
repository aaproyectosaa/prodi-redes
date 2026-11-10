// Conversiones del CRM a Meta (Conversions API para leads): cuando un lead que llegó por un formulario de un anuncio de
// Prodi entra o cambia de etapa, se le avisa a Meta con el id del formulario. Así la pauta aprende qué formularios
// terminan en reunión o en cliente, y le muestra los anuncios a gente parecida.
// Variables: META_DATASET_ID (el conjunto de datos de Prodi en el Administrador de eventos) y META_CAPI_TOKEN (un
// token con acceso a ese conjunto; si no está, usa META_ACCESS_TOKEN). Sin META_DATASET_ID no hace nada.
// Nunca tira: si Meta no lo acepta, queda en el log y el CRM sigue igual.

import { graph } from "./meta-leads";

/** El nombre de cada etapa como lo ve Meta (las mismas del tablero de Leads). */
const ETAPA: Record<string, string> = {
  calificado: "Nuevo",
  reunion_agendada: "Reunion agendada",
  propuesta: "Propuesta",
  ganado: "Ganado",
  perdido: "Perdido",
  no_califica: "No califica",
};

export async function avisarEtapaAMeta(lead: Record<string, unknown> | null | undefined, estado: string): Promise<void> {
  const dataset = process.env.META_DATASET_ID?.trim();
  const meta = (lead?.meta ?? null) as { leadgen_id?: unknown } | null;
  const leadgenId = String(meta?.leadgen_id ?? "");
  // Solo los que vinieron de un formulario de Meta (los demás Meta no los conoce).
  if (!dataset || lead?.origen !== "meta:leadgen" || !/^\d+$/.test(leadgenId) || !ETAPA[estado]) return;
  const evento = {
    event_name: ETAPA[estado],
    event_time: Math.floor(Date.now() / 1000),
    action_source: "system_generated",
    user_data: { lead_id: leadgenId },
    custom_data: { event_source: "crm", lead_event_source: "Gestor Prodi" },
  };
  try {
    const capi = process.env.META_CAPI_TOKEN?.trim();
    if (capi) {
      // El token del Administrador de eventos no es de nuestra app: va sin la firma (appsecret_proof) de Gestor Prodi.
      const r = await fetch(`https://graph.facebook.com/${process.env.META_GRAPH_VERSION || "v23.0"}/${dataset}/events`, {
        method: "POST",
        body: new URLSearchParams({ data: JSON.stringify([evento]), access_token: capi }),
      });
      const j: { error?: { message?: string } } = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error?.message ?? String(r.status));
    } else await graph(`${dataset}/events`, { data: JSON.stringify([evento]) }, process.env.META_ACCESS_TOKEN || "", "POST");
  } catch (err) {
    console.warn(`[meta-conversiones] No se pudo avisar «${ETAPA[estado]}» del lead ${leadgenId}:`, err instanceof Error ? err.message : err);
  }
}
