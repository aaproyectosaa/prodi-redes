import Link from "@/software/compat";
import { money, money2 } from "@/software/lib/money";
import type { BreakdownRow, Partner } from "./types";

function rowMeta(row: BreakdownRow) {
  const countLabel =
    row.source === "maintenance"
      ? "cobros"
      : row.source === "extra"
        ? "cobro extra"
        : row.source === "subscription"
          ? "cobros suscrip."
          : "pagos";
  const suffix =
    row.source === "maintenance" || row.source === "extra"
      ? ""
      : row.custom
        ? " · propio"
        : " · default";
  return `${row.count} ${countLabel}${suffix}`;
}

export function BreakdownTable({
  rows,
  amountLabel,
  title,
  partners,
}: {
  rows: BreakdownRow[];
  amountLabel: string;
  title: string;
  partners: Partner[];
}) {
  if (!rows.length) return null;
  const totalFee = rows.reduce((a, row) => a + Number(row.fee || 0), 0);
  const totalByPartner = partners.map((partner) =>
    rows.reduce(
      (a, row) =>
        a + Number(row.shares.find((s) => s.partner_id === partner.id)?.share || 0),
      0,
    ),
  );

  const actionLink =
    amountLabel === "Fee" || amountLabel === "Suscrip."
      ? (
          <Link className="btn sm line" href="/socios?tab=clientes">
            Cambiar %
          </Link>
        )
      : amountLabel === "Mant."
        ? (
            <Link className="btn sm line" href="/mantenimientos">
              Mantenimientos
            </Link>
          )
        : null;

  return (
    <div style={{ marginTop: "1.15rem" }}>
      <div className="liq-section-head">
        <h3 style={{ margin: 0, fontSize: "0.95rem" }}>{title}</h3>
        {actionLink}
      </div>

      <div className="liq-mobile-only">
        {rows.map((row) => (
          <div
            key={`${row.source}-${row.client_id || row.client_name}`}
            className="liq-row-card"
          >
            <div className="liq-row-card-head">
              <strong>{row.client_name}</strong>
            </div>
            <div className="meta" style={{ marginBottom: "0.45rem" }}>
              {rowMeta(row)}
            </div>
            <div className="liq-breakdown-fee">
              {amountLabel}:{" "}
              {row.source === "subscription" ? money2(row.fee) : money(row.fee)}
            </div>
            <div className="liq-breakdown-shares">
              {row.shares.map((share) => (
                <div key={share.partner_id} className="liq-share-row">
                  <span>
                    {share.partner_name}
                    <span className="meta"> · {share.pct}%</span>
                  </span>
                  <span className="mono">{money(share.share)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="table-wrap liq-desktop-only">
        <table className="data-table table-breakdown">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>{amountLabel}</th>
              {partners.map((partner) => <th key={partner.id}>{partner.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.source}-${row.client_id || row.client_name}`}>
                <td>
                  <strong>{row.client_name}</strong>
                  <div className="meta">{rowMeta(row)}</div>
                </td>
                <td>
                  {row.source === "subscription" ? money2(row.fee) : money(row.fee)}
                </td>
                {row.shares.map((share) => (
                  <td key={share.partner_id}>
                    {money(share.share)}
                    <div className="meta">{share.pct}%</div>
                  </td>
                ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td><strong>Total</strong></td>
            <td><strong>{rows.some((r) => r.source === "subscription") ? money2(totalFee) : money(totalFee)}</strong></td>
            {totalByPartner.map((n, i) => (
              <td key={partners[i]?.id || i}><strong>{money(n)}</strong></td>
            ))}
          </tr>
        </tfoot>
      </table>
      </div>
    </div>
  );
}
