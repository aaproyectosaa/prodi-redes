import type { ReactNode } from "react";

export function EmptyState({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children ? <div className="meta" style={{ marginTop: 6 }}>{children}</div> : null}
    </div>
  );
}
