import { Component, type ReactNode } from "react";

const CLAVE = "prodi:recarga-por-version";

/**
 * Error al cargar una parte de la app: casi siempre es porque salió una versión nueva mientras estaba abierta
 * (los archivos viejos ya no existen). Se arregla recargando.
 */
export const esErrorDeVersion = (err: unknown) =>
  /dynamically imported module|Importing a module script failed|error loading dynamically|ChunkLoadError|Loading chunk|Unable to preload CSS/i.test(
    String((err as Error)?.message ?? err)
  );

/** Recarga una sola vez por minuto (si el error sigue, se muestra la pantalla de error en vez de recargar en bucle). */
export function recargarPorVersion(): boolean {
  try {
    const ultima = Number(sessionStorage.getItem(CLAVE) ?? 0);
    if (Date.now() - ultima < 60_000) return false;
    sessionStorage.setItem(CLAVE, String(Date.now()));
  } catch {
    /* sin sessionStorage: se recarga igual */
  }
  window.location.reload();
  return true;
}

/** Si algo de la pantalla falla, en vez de quedar en negro se recarga (versión nueva) o se ofrece recargar. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("[app]", error);
    if (esErrorDeVersion(error)) recargarPorVersion();
  }

  render() {
    if (!this.state.error) return this.props.children;
    const version = esErrorDeVersion(this.state.error);
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background p-6 text-center text-foreground">
        <img src="/favicon.png" alt="" className="h-10 w-10 opacity-80" onError={(e) => (e.currentTarget.style.display = "none")} />
        <div className="space-y-1">
          <p className="text-lg font-semibold">{version ? "Hay una versión nueva de Prodi" : "Algo falló en esta pantalla"}</p>
          <p className="text-sm text-muted-foreground">{version ? "Recargá para seguir con la última versión." : "Recargá la página para seguir. Si vuelve a pasar, avisanos."}</p>
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Recargar
        </button>
        {!version && <p className="max-w-md break-words text-[11px] text-muted-foreground/70">{this.state.error.message}</p>}
      </div>
    );
  }
}
