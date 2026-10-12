import { NextRequest, NextResponse } from "../next-shim";
import { requireSession, unauthorized } from "../next-shim";
import { listActivity } from "../activity";

export async function GET(req: NextRequest) {
  if (!(await requireSession())) return unauthorized();
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") || 150), 300);
  const type = req.nextUrl.searchParams.get("type") || "";
  const q = (req.nextUrl.searchParams.get("q") || "").trim().toLowerCase();
  const from = req.nextUrl.searchParams.get("from") || "";
  const to = req.nextUrl.searchParams.get("to") || "";
  let rows = await listActivity(limit);
  if (type) rows = rows.filter((r) => String(r.type) === type);
  if (q) {
    rows = rows.filter((r) => String(r.message || "").toLowerCase().includes(q));
  }
  if (from || to) {
    rows = rows.filter((r) => {
      const day = new Date(String(r.created_at)).toLocaleDateString("en-CA", {
        timeZone: "America/Argentina/Buenos_Aires",
      });
      if (from && day < from) return false;
      if (to && day > to) return false;
      return true;
    });
  }
  return NextResponse.json({ activity: rows });
}
