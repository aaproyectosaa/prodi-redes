import { useEffect, useRef, useState } from "react";
import { ArrowUp, Loader2, Lock, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PageShell } from "@/components/redes/PageShell";
import { callApi } from "@/lib/redes/api";
import { TextoIA } from "@/components/redes/TextoIA";

type Msg = { role: "user" | "assistant"; content: string };
const CLAVE = "prodi-mi-asistente";

const EJEMPLOS = [
  "¿Qué clientes me dejan más plata y cuáles menos?",
  "¿Cómo viene la facturación de este año contra 2025?",
  "¿Quién del equipo está más cargado de trabajo?",
  "¿Qué tengo que pagar este mes entre créditos, impuestos y equipo?",
  "¿A qué clientes les convendría subir el abono?",
];

/** El asistente del dueño: solo el super admin, ve todo el sistema (también la plata). La conversación queda en este dispositivo. */
export default function MiAsistente() {
  const [mensajes, setMensajes] = useState<Msg[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(CLAVE) ?? "[]") as Msg[];
    } catch {
      return [];
    }
  });
  const [texto, setTexto] = useState("");
  const [pensando, setPensando] = useState(false);
  const fin = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(CLAVE, JSON.stringify(mensajes.slice(-40)));
    } catch {
      /* sin almacenamiento: queda solo en pantalla */
    }
    fin.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [mensajes, pensando]);

  const preguntar = async (q: string) => {
    const pregunta = q.trim();
    if (!pregunta || pensando) return;
    const lista: Msg[] = [...mensajes, { role: "user", content: pregunta }];
    setMensajes(lista);
    setTexto("");
    setPensando(true);
    try {
      const r = await callApi<{ texto: string }>("/api/ia/dueno", { mensajes: lista.slice(-20) });
      setMensajes((m) => [...m, { role: "assistant", content: r.texto }]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No pudo responder");
      setMensajes((m) => m.slice(0, -1));
      setTexto(pregunta);
    } finally {
      setPensando(false);
    }
  };

  return (
    <PageShell
      title={<span className="text-[26px] font-bold tracking-tight">Mi asistente</span>}
      subtitle={
        <span className="inline-flex items-center gap-1.5">
          <Lock className="h-3.5 w-3.5" /> Solo vos. Ve todo el sistema: clientes, equipo, videos y plata.
        </span>
      }
      actions={
        mensajes.length > 0 && (
          <Button variant="outline" onClick={() => setMensajes([])} disabled={pensando} className="h-11 rounded-2xl font-semibold">
            <Trash2 className="mr-2 h-4 w-4" /> Nueva conversación
          </Button>
        )
      }
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-5 pb-44">
        {mensajes.length === 0 && (
          <div className="relative overflow-hidden rounded-2xl border bg-card px-5 py-8 text-center sm:px-8 sm:py-10">
            <div className="pointer-events-none absolute -top-24 left-1/2 h-56 w-56 -translate-x-1/2 rounded-full bg-gradient-to-br from-primary/20 to-fuchsia-500/15 blur-3xl" />
            <div className="relative space-y-5">
              <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-fuchsia-500 text-white shadow-lg shadow-primary/30">
                <Sparkles className="h-7 w-7" />
              </span>
              <div className="space-y-1.5">
                <p className="text-[22px] font-bold leading-tight tracking-tight">Preguntame lo que quieras del negocio</p>
                <p className="mx-auto max-w-md text-sm text-muted-foreground">
                  Tengo la facturación (también la de las planillas 2024-2025), gastos, deudas, pagos al equipo, clientes y videos.
                </p>
              </div>
              <div className="grid gap-2 text-left sm:grid-cols-2">
                {EJEMPLOS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => void preguntar(e)}
                    className="group flex items-start gap-2.5 rounded-2xl bg-muted/60 px-3.5 py-3 text-sm font-medium leading-snug transition-all hover:bg-primary/10 hover:text-primary active:scale-[0.98]"
                  >
                    <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary/70 transition-colors group-hover:text-primary" />
                    <span>{e}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        {mensajes.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end animate-in fade-in slide-in-from-bottom-1 duration-300 motion-reduce:animate-none">
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-[15px] leading-relaxed text-primary-foreground shadow-md shadow-primary/20">
                <p className="whitespace-pre-wrap">{m.content}</p>
              </div>
            </div>
          ) : (
            <div key={i} className="flex items-start gap-3 animate-in fade-in slide-in-from-bottom-1 duration-300 motion-reduce:animate-none">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Sparkles className="h-4 w-4" />
              </span>
              <div className="min-w-0 max-w-[calc(100%-2.75rem)] flex-1 rounded-2xl rounded-tl-md bg-muted/60 px-4 py-3 text-[15px] leading-relaxed">
                <TextoIA texto={m.content} />
              </div>
            </div>
          )
        )}
        {pensando && (
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Loader2 className="h-4 w-4 animate-spin" />
            </span>
            <span className="rounded-2xl rounded-tl-md bg-muted/60 px-4 py-2.5 text-sm text-muted-foreground">Mirando los números…</span>
          </div>
        )}
        <div ref={fin} />
      </div>
      <div className="fixed inset-x-0 bottom-16 z-20 px-4 md:bottom-4 md:left-[var(--sidebar-width,16rem)] md:right-28">
        <form
          className="mx-auto flex max-w-3xl items-end gap-2 rounded-[1.75rem] border bg-background/95 p-2 pl-3 shadow-xl shadow-black/10 backdrop-blur transition-colors focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/15 dark:shadow-black/40"
          onSubmit={(e) => {
            e.preventDefault();
            void preguntar(texto);
          }}
        >
          <Textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void preguntar(texto);
              }
            }}
            placeholder="Preguntá algo del negocio…"
            rows={1}
            className="max-h-40 min-h-11 resize-none border-0 bg-transparent px-1 py-2.5 text-[15px] shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          <Button
            type="submit"
            size="icon"
            disabled={!texto.trim() || pensando}
            aria-label="Preguntar"
            className="h-11 w-11 shrink-0 rounded-full shadow-lg shadow-primary/25 transition-transform active:scale-95"
          >
            {pensando ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowUp className="h-5 w-5" />}
          </Button>
        </form>
      </div>
    </PageShell>
  );
}
