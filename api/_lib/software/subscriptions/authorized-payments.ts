import {
  fetchAuthorizedPayment,
  fetchPayment,
  fetchPreapproval,
  searchAuthorizedPayments,
  type MpAuthorizedPayment,
  type MpPayment,
} from "../mp";
import { num, text } from "./contracts";
import {
  upsertSubscriptionCharge,
  upsertSubscriptionChargeFromMp,
} from "./charges";
import { upsertSubscriptionFromMp } from "./plans";
import { ensureSubscriptionTables } from "./schema";
import { getSql } from "../sql";

export async function upsertFromAuthorizedPayment(
  appId: string,
  auth: MpAuthorizedPayment,
  opts?: {
    preferredClientName?: string | null;
    accessToken?: string | null;
    payment?: MpPayment | null;
  },
) {
  const preId = text(auth.preapproval_id);
  if (preId && opts?.accessToken) {
    const pre = await fetchPreapproval(opts.accessToken, preId);
    if (pre.ok && pre.data?.id) {
      await upsertSubscriptionFromMp(appId, pre.data, {
        preferredClientName: opts.preferredClientName,
        accessToken: opts.accessToken,
      });
    }
  }

  const payId = auth.payment?.id != null ? String(auth.payment.id) : null;
  let payment = opts?.payment || null;
  if (!payment && payId && opts?.accessToken) {
    const detail = await fetchPayment(opts.accessToken, payId);
    if (detail.ok && detail.data?.id) payment = detail.data;
  }

  if (payment) {
    return upsertSubscriptionChargeFromMp(appId, payment, {
      preferredClientName: opts?.preferredClientName,
      accessToken: opts?.accessToken,
      kind: "recurring",
      mpPreapprovalId: preId,
      mpAuthorizedPaymentId: text(auth.id),
    });
  }

  const authStatus = text(auth.payment?.status) || text(auth.status) || "unknown";
  return upsertSubscriptionCharge(
    appId,
    {
      mpPaymentId: payId,
      mpAuthorizedPaymentId: text(auth.id),
      mpPreapprovalId: preId,
      status: authStatus === "processed" ? "approved" : authStatus,
      amount: num(auth.transaction_amount),
      currency: text(auth.currency_id) || "ARS",
      kind: "recurring",
      description: text(auth.reason),
      externalReference: auth.external_reference != null ? String(auth.external_reference) : null,
      paidAt: text(auth.debit_date) || text(auth.last_modified) || text(auth.date_created),
      raw: auth,
    },
    { preferredClientName: opts?.preferredClientName, accessToken: opts?.accessToken },
  );
}

export async function importAuthorizedPaymentId(
  appId: string,
  authorizedId: string,
  token: string,
  opts?: { preferredClientName?: string | null },
) {
  const { ok, data } = await fetchAuthorizedPayment(token, authorizedId);
  if (!ok || data?.id == null) {
    return { saved: false as const, reason: "authorized_payment no legible" };
  }
  return upsertFromAuthorizedPayment(appId, data, {
    accessToken: token,
    preferredClientName: opts?.preferredClientName,
  });
}

export async function importPreapprovalId(
  appId: string,
  preapprovalId: string,
  token: string,
  opts?: { preferredClientName?: string | null },
) {
  const { ok, data } = await fetchPreapproval(token, preapprovalId);
  if (!ok || !data?.id) {
    return { saved: false as const, reason: "preapproval no legible" };
  }
  const sub = await upsertSubscriptionFromMp(appId, data, {
    accessToken: token,
    preferredClientName: opts?.preferredClientName,
  });
  return { saved: true as const, subscription: sub };
}

export async function syncAuthorizedPaymentsForApp(
  appId: string,
  token: string,
  opts?: { preferredClientName?: string | null; onlyAccepted?: boolean },
) {
  await ensureSubscriptionTables();
  const sql = getSql();
  const onlyAccepted = opts?.onlyAccepted !== false;
  const pres = onlyAccepted
    ? await sql`
        SELECT mp_preapproval_id FROM hub_subscriptions
        WHERE app_id = ${appId}::uuid AND hub_status = 'accepted'
      `
    : await sql`
        SELECT mp_preapproval_id FROM hub_subscriptions
        WHERE app_id = ${appId}::uuid
      `;
  let imported = 0;
  for (const row of pres) {
    imported += await syncAuthorizedPaymentsForPreapproval(
      appId,
      token,
      String(row.mp_preapproval_id || ""),
      { preferredClientName: opts?.preferredClientName },
    );
  }
  return { imported };
}

export async function syncAuthorizedPaymentsForPreapproval(
  appId: string,
  token: string,
  preapprovalId: string,
  opts?: { preferredClientName?: string | null },
) {
  const preId = String(preapprovalId || "").trim();
  if (!preId) return 0;
  const { ok, data } = await searchAuthorizedPayments(token, { preapprovalId: preId, limit: 50 });
  if (!ok) return 0;
  let imported = 0;
  for (const auth of data.results || []) {
    const res = await upsertFromAuthorizedPayment(appId, auth, {
      accessToken: token,
      preferredClientName: opts?.preferredClientName,
    });
    if (res.saved) imported++;
  }
  return imported;
}
