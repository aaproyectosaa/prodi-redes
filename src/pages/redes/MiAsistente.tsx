import { Fragment, useEffect, useRef, useState } from "react";
import { ArrowUp, Loader2, Lock, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PageShell } from "@/components/redes/PageShell";
import { callApi } from "@/lib/redes/api";
import { cn } from "@/lib/utils";

type Msg = { role: "user" | "assistant"; content: string };
const CLAVE = "prodi-mi-asistente";

const EJEMPLOS = [
  "¿Qué clientes me dejan más plata y cuáles menos?",
  "¿Cómo viene la facturación de este año contra 2025?",
  "¿Quién del equipo está más cargado de trabajo?",
  "¿Qué tengo que pagar este mes entre créditos, impuestos y equipo?",
  "¿A qué clientes les convendría subir el abono?",
];

/** **negrita**, listas con "-" y párrafos: lo justo para leer bien las respuestas. */
function Texto({ texto }: { texto: string }) {
  const linea = (l: string) =>
    l.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <b key={i}>{p.slice(2, -2)}</b> : <Fragment key={i}>{p}</Fragment>));
  return (
    <div className="space-y-1.5">
      {texto.split("\n").map((l, i) => {
        const t = l.trim();
        if (!t) return <div key={i} className="h-1" />;
        const item = t.match(/^([-*•]|\d+[.)])\s+(.*)$/);
        if (item) return <p key={i} className="pl-4 -indent-3">• {linea(item[2])}</p>;
        if (/^#{1,4}\s/.test(t)) return <p key={i} className="pt-1 font-semibold">{linea(t.replace(/^#+\s*/, ""))}</p>;
        return <p key={i}>{linea(t)}</p>;
      })}
    </div>
  );
}

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
      title="Mi asistente"
      subtitle={
        <span className="inline-flex items-center gap-1.5">
          <Lock className="h-3.5 w-3.5" /> Solo vos. Ve todo el sistema: clientes, equipo, videos y plata.
        </span>
      }
      actions={
        mensajes.length > 0 && (
          <Button variant="outline" onClick={() => setMensajes([])} disabled={pensando}>
            <Trash2 className="mr-2 h-4 w-4" /> Nueva conversación
          </Button>
        )
      }
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-4 pb-40">
        {mensajes.length === 0 && (
          <div className="space-y-4 rounded-2xl border bg-card p-6 text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-[#6F40FC] to-[#E040A0] text-white">
              <Sparkles className="h-6 w-6" />
            </span>
            <div>
              <p className="font-semibold">Preguntame lo que quieras del negocio</p>
              <p className="text-sm text-muted-foreground">Tengo la facturación (también la de las planillas 2024-2025), gastos, deudas, pagos al equipo, clientes y videos.</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {EJEMPLOS.map((e) => (
                <button key={e} type="button" onClick={() => void preguntar(e)} className="rounded-full border px-3 py-1.5 text-left text-xs hover:border-primary/50 hover:bg-primary/5">
                  {e}
                </button>
              ))}
            </div>
          </div>
        )}
        {mensajes.map((m, i) => (
          <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[90%] rounded-2xl px-4 py-3 text-sm leading-relaxed", m.role === "user" ? "bg-primary text-primary-foreground" : "border bg-card")}>
              {m.role === "user" ? <p className="whitespace-pre-wrap">{m.content}</p> : <Texto texto={m.content} />}
            </div>
          </div>
        ))}
        {pensando && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Mirando los números…
          </div>
        )}
        <div ref={fin} />
      </div>
      <div className="fixed inset-x-0 bottom-16 z-20 px-4 md:bottom-4 md:left-[var(--sidebar-width,16rem)] md:right-28">
        <form
          className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border bg-background p-2 shadow-lg"
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
            className="max-h-40 min-h-10 resize-none border-0 shadow-none focus-visible:ring-0"
          />
          <Button type="submit" size="icon" disabled={!texto.trim() || pensando} aria-label="Preguntar">
            <ArrowUp className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </PageShell>
  );
}
