import { getSql } from "../sql";
import { text } from "./contracts";

export async function resolveClient(
  appId: string,
  opts: {
    collectorId?: string | null;
    preferredName?: string | null;
    description?: string | null;
    accessToken?: string | null;
  },
) {
  const {
    clientRefFromMpPayment,
    ensureClient,
    matchClientByDescription,
    sellerNameFromDescription,
    slugClientKey,
    isPosLikeLabel,
  } = await import("../clients");

  const preferredRaw = String(opts.preferredName || "").trim() || null;
  const preferred =
    preferredRaw && !isPosLikeLabel(preferredRaw) ? preferredRaw : null;

  if (preferred) {
    const sql = getSql();
    const exact = await sql`
      SELECT collector_id, name FROM hub_clients
      WHERE app_id = ${appId}::uuid
        AND lower(trim(name)) = lower(trim(${preferred}))
      LIMIT 1
    `;
    if (exact[0]) {
      return {
        collectorId: String(exact[0].collector_id),
        collectorName: String(exact[0].name),
      };
    }
    const slug = slugClientKey(preferred);
    if (slug) {
      const name = await ensureClient(appId, slug, preferred);
      return { collectorId: slug, collectorName: name };
    }
  }

  const fakePayment = {
    collector_id: opts.collectorId || undefined,
    description: opts.description || undefined,
  };
  const ref = clientRefFromMpPayment(
    fakePayment as Parameters<typeof clientRefFromMpPayment>[0],
    preferred,
  );

  if (ref) {
    let suggested = ref.suggestedName;
    if (opts.accessToken && /^cliente\s+\d+$/i.test(suggested)) {
      const { fetchCollectorDisplayName } = await import("../mp");
      const nick = await fetchCollectorDisplayName(opts.accessToken, ref.key);
      if (nick) suggested = nick;
    }
    if (preferred) suggested = preferred;
    const name = await ensureClient(appId, ref.key, suggested);
    return { collectorId: ref.key, collectorName: name };
  }

  const byName = await matchClientByDescription(
    appId,
    preferred ? `Producto de ${preferred}` : opts.description,
  );
  if (byName) {
    const name = preferred || byName.name;
    if (preferred) await ensureClient(appId, byName.key, preferred);
    return { collectorId: byName.key, collectorName: name };
  }

  const collectorRaw = text(opts.collectorId);
  if (collectorRaw && !collectorRaw.startsWith("slug:")) {
    let suggested =
      preferred ||
      sellerNameFromDescription(opts.description) ||
      `Cliente ${collectorRaw}`;
    if (opts.accessToken && /^cliente\s+\d+$/i.test(suggested)) {
      const { fetchCollectorDisplayName } = await import("../mp");
      const nick = await fetchCollectorDisplayName(opts.accessToken, collectorRaw);
      if (nick) suggested = nick;
    }
    const name = await ensureClient(appId, collectorRaw, suggested);
    return { collectorId: collectorRaw, collectorName: name };
  }

  const pageName = preferred || sellerNameFromDescription(opts.description);
  if (pageName) {
    const slug = slugClientKey(pageName);
    if (slug) {
      const name = await ensureClient(appId, slug, pageName);
      return { collectorId: slug, collectorName: name };
    }
  }

  return { collectorId: null as string | null, collectorName: preferred };
}
