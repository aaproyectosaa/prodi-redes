import { paymentStatusEs, statusTone } from "@/software/lib/labels";

export function StatusPill({
  status,
  label,
}: {
  status?: string | null;
  label?: string;
}) {
  return (
    <span className={`pill ${statusTone(status)}`}>{label || paymentStatusEs(status)}</span>
  );
}
