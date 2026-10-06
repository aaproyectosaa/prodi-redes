import type { Profile } from "@/integrations/firebase/types";
import type { Reunion, Rodaje, Video } from "./types";
import { etapaInfo } from "./etapas";

export interface Evento {
  videoId: string;
  proyectoId: string;
  titulo: string;
  at: string;
  by: string;
  accion: string;
  nota?: string | null;
}

/** Todas las acciones registradas en el historial de los videos. */
export function eventos(videos: Video[]): Evento[] {
  const out: Evento[] = [];
  for (const v of videos) {
    for (const h of v.historial ?? []) {
      out.push({ videoId: v.id, proyectoId: v.proyecto_id, titulo: v.titulo, at: h.at, by: h.by, accion: h.accion, nota: h.nota });
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

const horas = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 3_600_000;
const prom = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

/** Tiempo entre el evento anterior que cumple `desde` y cada evento de `uid` que cumple `hasta`. */
function demoras(videos: Video[], uid: string, mes: string, desde: (a: string) => boolean, hasta: (a: string) => boolean) {
  const out: number[] = [];
  for (const v of videos) {
    const h = [...(v.historial ?? [])].sort((a, b) => a.at.localeCompare(b.at));
    h.forEach((e, i) => {
      if (e.by !== uid || !hasta(e.accion) || !e.at.startsWith(mes)) return;
      for (let j = i - 1; j >= 0; j--) {
        if (desde(h[j].accion)) {
          out.push(horas(h[j].at, e.at));
          break;
        }
      }
    });
  }
  return out;
}

const es = (...ps: string[]) => (a: string) => ps.some((p) => a.startsWith(p));
const ENTREGA = es("Edición entregada", "Corrección entregada");
const A_EDICION = es("Crudo cargado", "Producción pidió cambios", "El cliente pidió cambios");
const REVISION = es("Aprobado por producción", "Producción pidió cambios");
const PUBLICA = es("Publicado");
const APRUEBA_CLIENTE = es("Aprobado por el cliente");
const CLIENTE_RESPONDE = es("Aprobado por el cliente", "El cliente pidió cambios");
const ENVIADO_CLIENTE = es("Aprobado por producción");

export interface Kpi {
  label: string;
  valor: string;
  ayuda?: string;
  tono?: "bien" | "alerta" | "neutro";
}

export interface ReporteUsuario {
  perfil: Profile;
  acciones: number;
  ultimaActividad: string | null;
  kpis: Kpi[];
  /** Acciones por semana (últimas 6 semanas, de más vieja a más nueva). */
  semanas: { label: string; n: number }[];
  /** Videos que hoy le tocan a esta persona. */
  enSuCancha: Video[];
  recientes: Evento[];
}

const fh = (h: number | null) => (h === null ? "—" : h < 24 ? `${Math.round(h)} h` : `${(h / 24).toFixed(1)} días`);
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

export function reporteUsuario(
  perfil: Profile,
  videos: Video[],
  rodajes: Rodaje[],
  reuniones: Reunion[],
  mes: string,
  todos: Evento[] = eventos(videos)
): ReporteUsuario {
  const uid = perfil.id;
  const mios = todos.filter((e) => e.by === uid);
  const delMes = mios.filter((e) => e.at.startsWith(mes));
  const cuenta = (f: (a: string) => boolean) => delMes.filter((e) => f(e.accion)).length;
  const kpis: Kpi[] = [];

  switch (perfil.role) {
    case "productor": {
      const planif = cuenta(es("Planificado"));
      const rods = rodajes.filter((r) => r.created_by === uid && r.fecha.startsWith(mes) && r.estado !== "cancelado").length;
      const revs = delMes.filter((e) => REVISION(e.accion));
      const aprob = revs.filter((e) => e.accion.startsWith("Aprobado")).length;
      const demRev = prom(demoras(videos, uid, mes, ENTREGA, REVISION));
      kpis.push(
        { label: "Videos planificados", valor: String(planif) },
        { label: "Rodajes", valor: String(rods) },
        { label: "Revisiones", valor: String(revs.length), ayuda: `${pct(aprob, revs.length)} aprobadas al cliente` },
        { label: "Tarda en revisar", valor: fh(demRev), tono: demRev !== null && demRev > 24 ? "alerta" : "bien" }
      );
      break;
    }
    case "editor": {
      const entregas = cuenta(ENTREGA);
      const correcciones = cuenta(es("Corrección entregada"));
      const demEd = prom(demoras(videos, uid, mes, A_EDICION, ENTREGA));
      const suyos = videos.filter((v) => v.editor_id === uid && v.mes === mes && ["revision_cliente", "para_publicar", "publicado"].includes(v.etapa));
      const primera = suyos.filter((v) => (v.rondas ?? 0) === 0).length;
      const ratings = videos.filter((v) => v.editor_id === uid && v.mes === mes && v.cliente_rating).map((v) => v.cliente_rating as number);
      const r = prom(ratings);
      kpis.push(
        { label: "Entregas", valor: String(entregas), ayuda: `${correcciones} fueron correcciones` },
        { label: "Tarda en editar", valor: fh(demEd), tono: demEd !== null && demEd > 48 ? "alerta" : "bien" },
        { label: "Aprobados sin cambios", valor: pct(primera, suyos.length), tono: suyos.length && primera / suyos.length < 0.6 ? "alerta" : "bien" },
        { label: "Nota de clientes", valor: r === null ? "—" : `${r.toFixed(1)} ★`, ayuda: `${ratings.length} calificaciones` }
      );
      break;
    }
    case "pauta": {
      const pubs = cuenta(PUBLICA);
      const dem = prom(demoras(videos, uid, mes, APRUEBA_CLIENTE, PUBLICA));
      const suyos = videos.filter((v) => v.pauta_id === uid && v.mes === mes && v.etapa === "publicado");
      const gasto = suyos.reduce((a, v) => a + (v.resultados?.gasto ?? 0), 0);
      const mensajes = suyos.reduce((a, v) => a + (v.resultados?.mensajes ?? 0), 0);
      const sinRes = suyos.filter((v) => !v.resultados).length;
      kpis.push(
        { label: "Publicados", valor: String(pubs) },
        { label: "Tarda en publicar", valor: fh(dem), tono: dem !== null && dem > 24 ? "alerta" : "bien" },
        {
          label: "Inversión gestionada",
          valor: new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(gasto),
          ayuda: `${mensajes} mensajes generados`,
        },
        { label: "Sin resultados cargados", valor: String(sinRes), tono: sinRes ? "alerta" : "bien" }
      );
      break;
    }
    case "cliente": {
      const aprob = cuenta(APRUEBA_CLIENTE);
      const cambios = cuenta(es("El cliente pidió cambios"));
      const dem = prom(demoras(videos, uid, mes, ENVIADO_CLIENTE, CLIENTE_RESPONDE));
      kpis.push(
        { label: "Videos aprobados", valor: String(aprob) },
        { label: "Pidió cambios", valor: String(cambios) },
        { label: "Tarda en responder", valor: fh(dem), tono: dem !== null && dem > 48 ? "alerta" : "bien" },
        { label: "Reuniones", valor: String(reuniones.filter((r) => r.participantes.includes(uid) && r.fecha.startsWith(mes)).length) }
      );
      break;
    }
    default:
      kpis.push({ label: "Acciones del mes", valor: String(delMes.length) });
  }

  // Actividad por semana (últimas 6).
  const semanas: { label: string; n: number }[] = [];
  const hoy = new Date();
  for (let i = 5; i >= 0; i--) {
    const fin = new Date(hoy.getTime() - i * 7 * 86_400_000);
    const ini = new Date(fin.getTime() - 7 * 86_400_000);
    const n = mios.filter((e) => {
      const t = new Date(e.at).getTime();
      return t > ini.getTime() && t <= fin.getTime();
    }).length;
    semanas.push({ label: i === 0 ? "Esta" : `-${i}`, n });
  }

  const enSuCancha = videos.filter((v) => {
    if (v.etapa === "publicado") return false;
    const resp = etapaInfo(v.etapa).responsable;
    if (resp !== perfil.role) return false;
    if (perfil.role === "productor") return v.productor_id === uid;
    if (perfil.role === "editor") return v.editor_id === uid;
    if (perfil.role === "pauta") return v.pauta_id === uid;
    return false;
  });

  return {
    perfil,
    acciones: delMes.length,
    ultimaActividad: perfil.ultimo_acceso && (!mios[0] || perfil.ultimo_acceso > mios[0].at) ? perfil.ultimo_acceso : mios[0]?.at ?? null,
    kpis,
    semanas,
    enSuCancha,
    recientes: mios.slice(0, 25),
  };
}
