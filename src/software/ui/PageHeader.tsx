import type { ReactNode } from "react";

/** Título de cada pantalla de Software (mismo estilo que el resto de Prodi). */
export function PageHeader({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight md:text-[28px]">{title}</h1>
        {sub ? <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{sub}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
