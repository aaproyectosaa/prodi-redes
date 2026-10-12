import { useState } from "react";
import { ChevronDown, Settings2 } from "lucide-react";
import Link from "@/software/compat";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { money, money2 } from "@/software/lib/money";
import type { BreakdownRow, Partner } from "./types";

function rowMeta(row: BreakdownRow) {
  const countLabel =
    row.source === "maintenance"
      ? row.count === 1
        ? "cobro"
        : "cobros"
      : row.source === "extra"
        ? "trabajo extra"
        : row.source === "subscription"
          ? row.count === 1
            ? "cobro del plan"
            : "cobros del plan"
          : row.count === 1
            ? "venta"
            : "ventas";
  const suffix =
    row.source === "maintenance" || row.source === "extra"
      ? ""
      : row.custom
        ? " · % propio del cliente"
        : " · % general";
  return `${row.count} ${countLabel}${suffix}`;
}

/** Detalle por cliente de una bolsa: de dónde sale lo que le toca a cada uno. Arranca cerrado. */
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
  const [open, setOpen] = useState(false);
  if (!rows.length) return null;
  const isSub = rows.some((r) => r.source === "subscription");
  const fmt = (n: number, sub = false) => (sub ? money2(n) : money(n));
  const totalFee = rows.reduce((a, row) => a + Number(row.fee || 0), 0);
  const totalByPartner = partners.map((partner) =>
    rows.reduce(
      (a, row) => a + Number(row.shares.find((s) => s.partner_id === partner.id)?.share || 0),
      0,
    ),
  );

  const actionLink =
    amountLabel === "Comisión" || amountLabel === "Plan mensual" ? (
      <Button asChild variant="outline" size="sm">
        <Link href="/socios?tab=clientes">
          <Settings2 /> Cambiar % por cliente
        </Link>
      </Button>
    ) : amountLabel === "Abono" ? (
      <Button asChild variant="outline" size="sm">
        <Link href="/mantenimientos">
          <Settings2 /> Ver abonos
        </Link>
      </Button>
    ) : null;

  return (
    <div className="rounded-2xl border bg-card shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 p-4 text-left"
      >
        <div className="min-w-0">
          <h3 className="text-base font-semibold">{title}</h3>
          <p className="text-xs text-muted-foreground">
            {rows.length} {rows.length === 1 ? "fila" : "filas"} · total {fmt(totalFee, isSub)} · tocá para{" "}
            {open ? "cerrar" : "ver el detalle"}
          </p>
        </div>
        <ChevronDown
          className={cn("h-5 w-5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </button>

      {open ? (
        <div className="space-y-3 border-t p-4">
          {actionLink ? <div className="flex justify-end">{actionLink}</div> : null}

          {/* Celular: una tarjeta por cliente */}
          <div className="space-y-2 md:hidden">
            {rows.map((row) => (
              <div
                key={`${row.source}-${row.client_id || row.client_name}`}
                className="rounded-xl border bg-background p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{row.client_name}</p>
                    <p className="text-xs text-muted-foreground">{rowMeta(row)}</p>
                  </div>
                  <span className="shrink-0 font-semibold tabular-nums">
                    {fmt(row.fee, row.source === "subscription")}
                  </span>
                </div>
                <div className="mt-2 space-y-1 border-t pt-2">
                  {row.shares.map((share) => (
                    <div key={share.partner_id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate">
                        {share.partner_name}
                        <span className="text-xs text-muted-foreground"> · {share.pct}%</span>
                      </span>
                      <span className="tabular-nums">{money(share.share)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between rounded-xl bg-muted/50 px-3 py-2 text-sm font-semibold">
              <span>Total</span>
              <span className="tabular-nums">{fmt(totalFee, isSub)}</span>
            </div>
          </div>

          {/* Compu: tabla */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Cliente</th>
                  <th className="py-2 pr-3 text-right font-medium">{amountLabel}</th>
                  {partners.map((partner) => (
                    <th key={partner.id} className="py-2 pr-3 text-right font-medium">
                      {partner.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.source}-${row.client_id || row.client_name}`} className="border-b last:border-0">
                    <td className="py-2 pr-3">
                      <p className="font-medium">{row.client_name}</p>
                      <p className="text-xs text-muted-foreground">{rowMeta(row)}</p>
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums">
                      {fmt(row.fee, row.source === "subscription")}
                    </td>
                    {partners.map((partner) => {
                      const share = row.shares.find((s) => s.partner_id === partner.id);
                      return (
                        <td key={partner.id} className="whitespace-nowrap py-2 pr-3 text-right tabular-nums">
                          {money(share?.share || 0)}
                          <p className="text-xs text-muted-foreground">{share?.pct ?? 0}%</p>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t font-semibold">
                  <td className="py-2 pr-3">Total</td>
                  <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums">{fmt(totalFee, isSub)}</td>
                  {totalByPartner.map((n, i) => (
                    <td key={partners[i]?.id || i} className="whitespace-nowrap py-2 pr-3 text-right tabular-nums">
                      {money(n)}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
