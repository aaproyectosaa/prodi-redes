import { NextRequest, NextResponse } from "../next-shim";
import { setIngestVisibility } from "../subscriptions";

function authorized(req: NextRequest) {
  const expected = (process.env.INGEST_SECRET || "").trim();
  if (!expected) return false;
  const header = req.headers.get("authorization") || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const alt = req.headers.get("x-ingest-secret")?.trim() || "";
  return bearer === expected || alt === expected;
}

/**
 * Prodi (u otro origen) oculta o vuelve a mostrar una suscripción
 * para que no entre en el listado ni en liquidación.
 */
export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    hidden?: boolean;
    mp_preapproval_id?: string;
    preapproval_id?: string;
    mp_payment_id?: string;
    payment_id?: string;
    external_reference?: string;
  };

  const result = await setIngestVisibility({
    hidden: Boolean(body.hidden),
    mpPreapprovalId: body.mp_preapproval_id || body.preapproval_id || null,
    mpPaymentId: String(body.mp_payment_id || body.payment_id || "") || null,
    externalReference: body.external_reference || null,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: "Falta mp_preapproval_id, mp_payment_id o external_reference" },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true, hidden: Boolean(body.hidden) });
}
