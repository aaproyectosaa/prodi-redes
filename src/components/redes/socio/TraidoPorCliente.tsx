import { useEffect, useState } from "react";
import { Handshake } from "lucide-react";
import { toast } from "sonner";
import { Section } from "@/components/redes/PageShell";
import { Input } from "@/components/ui/input";
import type { Project } from "@/integrations/firebase/types";
import { callApi } from "@/lib/redes/api";

// Ficha del cliente (admin): qué socio comercial lo trajo y desde cuándo. De eso sale su comisión (los abonos
// cobrados, los meses que tenga configurados desde esta fecha). Se cambia a mano si hace falta.

type SocioLista = { uid: string; nombre: string; activo: boolean; codigo: string | null };

export function TraidoPorCliente({ cliente }: { cliente: Project }) {
  const [socios, setSocios] = useState<SocioLista[] | null>(null);
  const [guardando, setGuardando] = useState(false);
  useEffect(() => {
    callApi<{ socios: SocioLista[] }>("/api/web/socio-lista", {})
      .then((r) => setSocios(r.socios))
      .catch(() => setSocios([]));
  }, []);
  if (!socios || (!socios.length && !cliente.socio_id)) return null;

  const guardar = async (cambios: { socio_id?: string | null; socio_alta?: string | null }) => {
    setGuardando(true);
    try {
      await callApi("/api/web/socio-cliente", {
        proyecto_id: cliente.id,
        socio_id: cambios.socio_id !== undefined ? cambios.socio_id : cliente.socio_id ?? null,
        socio_alta: cambios.socio_alta ?? cliente.socio_alta ?? null,
      });
      toast.success("Guardado");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  };
  const actual = socios.find((s) => s.uid === cliente.socio_id);

  return (
    <Section title="Traído por" description="El socio comercial que trajo este cliente: cobra comisión de sus abonos desde el alta. Solo clientes nuevos (no los que ya eran de Prodi).">
      <div className="space-y-3 rounded-xl border bg-card p-4">
        <div className="flex items-center gap-2">
          <Handshake className="h-4 w-4 shrink-0 text-[#6F40FC]" />
          <select
            value={cliente.socio_id ?? ""}
            onChange={(e) => void guardar({ socio_id: e.target.value || null })}
            disabled={guardando}
            className="h-10 min-w-0 flex-1 rounded-xl border bg-background px-3 text-sm"
            aria-label="Socio comercial"
          >
            <option value="">Nadie (lo trajo Prodi)</option>
            {cliente.socio_id && !actual && <option value={cliente.socio_id}>Socio (ya no está)</option>}
            {socios.map((s) => (
              <option key={s.uid} value={s.uid}>
                {s.nombre}
                {!s.activo ? " (desactivado)" : ""}
              </option>
            ))}
          </select>
        </div>
        {cliente.socio_id && (
          <label className="flex items-center gap-2 text-sm">
            <span className="shrink-0 text-muted-foreground">Desde</span>
            <Input
              type="date"
              defaultValue={cliente.socio_alta ?? ""}
              onBlur={(e) => e.target.value && e.target.value !== cliente.socio_alta && void guardar({ socio_alta: e.target.value })}
              className="h-10 w-44 rounded-xl"
            />
          </label>
        )}
      </div>
    </Section>
  );
}
