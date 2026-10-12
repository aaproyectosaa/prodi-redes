export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Confirmar",
  danger,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onClick={() => !busy && onCancel()}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="confirm-title">{title}</h3>
        {body ? <p className="meta">{body}</p> : null}
        <div className="actions" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn line" disabled={busy} onClick={onCancel}>
            Cancelar
          </button>
          <button
            type="button"
            className={`btn${danger ? " danger" : ""}`}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "Guardando…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
