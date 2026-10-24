import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";

// El link que un cliente del CRM le manda a su contacto (/v/:token): la foto o el video, con el nombre del negocio.

interface Vista {
  nombre: string;
  tipo: "foto" | "video";
  negocio: string;
}

export default function ArchivoPublico() {
  const { token = "" } = useParams();
  const [vista, setVista] = useState<Vista | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/publico/archivo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ t: token }) })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j?.error ?? "Este link ya no está disponible");
        setVista(j as Vista);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Este link ya no está disponible"));
  }, [token]);
  useEffect(() => {
    if (vista) document.title = vista.negocio ? `${vista.nombre} · ${vista.negocio}` : vista.nombre;
  }, [vista]);

  const src = `/api/publico/archivo-media?t=${encodeURIComponent(token)}`;
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-zinc-950 p-4 text-white">
      {error ? (
        <p className="text-sm text-white/70">{error}</p>
      ) : !vista ? (
        <Loader2 className="h-6 w-6 animate-spin text-white/60" />
      ) : (
        <>
          {vista.negocio && <p className="text-sm font-semibold tracking-wide text-white/80">{vista.negocio}</p>}
          {vista.tipo === "video" ? (
            <video src={src} controls autoPlay playsInline className="max-h-[80dvh] w-full max-w-md rounded-2xl bg-black shadow-2xl" />
          ) : (
            <img src={src} alt={vista.nombre} className="max-h-[80dvh] w-auto max-w-full rounded-2xl shadow-2xl" />
          )}
          <p className="max-w-md text-center text-base font-medium">{vista.nombre}</p>
        </>
      )}
    </div>
  );
}
