import { AbsoluteFill, OffthreadVideo, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont } from "@remotion/google-fonts/Montserrat";

export const { fontFamily } = loadFont("normal", { weights: ["800", "900"], subsets: ["latin", "latin-ext"] });

/** Tiempos en segundos desde el arranque del clip. */
export type Efecto =
  | { tipo: "zoom"; desde: number; hasta: number; escala?: number }
  | { tipo: "flash"; en: number }
  | { tipo: "titulo"; desde: number; hasta: number; texto: string; sub?: string }
  | { tipo: "etiqueta"; desde: number; hasta: number; texto: string; x?: number; y?: number; giro?: number; tam?: number }
  | { tipo: "promo"; desde: number; hasta: number; grande: string; chico: string; y?: number }
  | { tipo: "broll"; desde: number; hasta: number; src: string; texto?: string; y?: number }
  | { tipo: "cta"; desde: number; hasta: number; texto: string }
  /** La persona recortada (pnpm editar persona) encima de los gráficos: lo que esté en esos tramos queda detrás de ella. */
  | { tipo: "persona"; desde: number; hasta: number; src: string };

export type Colores = { marca: string; fuerte: string; texto: string };

const seg = (s: number, fps: number) => Math.round(s * fps);

export const ORIGEN_ZOOM = "50% 35%";

/** La persona recortada, con el mismo zoom que el video para que calce justo encima. */
export const Persona: React.FC<{ efectos: Efecto[] }> = ({ efectos }) => {
  const { fps } = useVideoConfig();
  const escala = useZoom(efectos);
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {efectos.map((e, i) =>
        e.tipo === "persona" ? (
          <Sequence key={i} from={seg(e.desde, fps)} durationInFrames={Math.max(1, seg(e.hasta, fps) - seg(e.desde, fps))} layout="none">
            <OffthreadVideo src={staticFile(e.src)} transparent muted style={{ position: "absolute", width: "100%", height: "100%", transform: `scale(${escala})`, transformOrigin: ORIGEN_ZOOM }} />
          </Sequence>
        ) : null,
      )}
    </AbsoluteFill>
  );
};

/** Escala del video según los zoom activos (entra y sale suave). */
export const useZoom = (efectos: Efecto[]) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  let escala = 1;
  for (const e of efectos) {
    if (e.tipo !== "zoom") continue;
    const a = seg(e.desde, fps);
    const b = seg(e.hasta, fps);
    if (frame < a || frame > b + 8) continue;
    const entra = spring({ frame: frame - a, fps, config: { damping: 18, stiffness: 180 } });
    const sale = interpolate(frame, [b, b + 8], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    escala = Math.max(escala, 1 + ((e.escala ?? 1.14) - 1) * entra * sale);
  }
  return escala;
};

export const Efectos: React.FC<{ efectos: Efecto[]; colores: Colores }> = ({ efectos, colores }) => {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill>
      {efectos.map((e, i) => {
        if (e.tipo === "zoom" || e.tipo === "persona") return null;
        if (e.tipo === "flash") {
          return (
            <Sequence key={i} from={seg(e.en, fps) - 2} durationInFrames={9} layout="none">
              <Flash />
            </Sequence>
          );
        }
        const desde = seg(e.desde, fps);
        const dur = Math.max(1, seg(e.hasta, fps) - desde);
        return (
          <Sequence key={i} from={desde} durationInFrames={dur} layout="none">
            {e.tipo === "titulo" && <Titulo {...e} c={colores} dur={dur} />}
            {e.tipo === "etiqueta" && <Etiqueta {...e} c={colores} dur={dur} />}
            {e.tipo === "promo" && <Promo {...e} c={colores} dur={dur} />}
            {e.tipo === "broll" && <Broll {...e} c={colores} dur={dur} />}
            {e.tipo === "cta" && <Cta {...e} c={colores} dur={dur} />}
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

/** Entrada con rebote y salida rápida, común a todos los gráficos. */
const usePop = (dur: number) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const entra = spring({ frame, fps, config: { damping: 11, stiffness: 160, mass: 0.7 } });
  const sale = interpolate(frame, [dur - 6, dur], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return { frame, fps, entra, sale, v: Math.min(entra, 1) * sale };
};

const Flash: React.FC = () => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [0, 2, 9], [0, 0.85, 0], { extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ backgroundColor: "white", opacity: o }} />;
};

const caja = (fondo: string, color: string): React.CSSProperties => ({
  fontFamily,
  fontWeight: 900,
  textTransform: "uppercase",
  background: fondo,
  color,
  borderRadius: 22,
  padding: "14px 34px",
  boxShadow: "0 14px 40px rgba(0,0,0,0.28)",
  lineHeight: 1.05,
  textAlign: "center",
});

const Titulo: React.FC<{ texto: string; sub?: string; c: Colores; dur: number }> = ({ texto, sub, c, dur }) => {
  const { frame, entra, sale } = usePop(dur);
  const subEntra = interpolate(frame, [6, 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ alignItems: "center", paddingTop: 280, gap: 18, opacity: sale }}>
      <div style={{ ...caja(c.fuerte, "white"), fontSize: 78, transform: `translateY(${interpolate(entra, [0, 1], [-260, 0])}px) rotate(-2deg)` }}>{texto}</div>
      {sub ? (
        <div style={{ ...caja("white", c.fuerte), fontSize: 44, opacity: subEntra, transform: `scale(${interpolate(subEntra, [0, 1], [0.7, 1])}) rotate(1.5deg)` }}>{sub}</div>
      ) : null}
    </AbsoluteFill>
  );
};

const Etiqueta: React.FC<{ texto: string; x?: number; y?: number; giro?: number; tam?: number; c: Colores; dur: number }> = ({ texto, x = 540, y = 720, giro = -4, tam = 58, c, dur }) => {
  const { entra, sale, frame } = usePop(dur);
  const late = 1 + Math.sin(frame / 6) * 0.015;
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        transform: `translate(-50%, -50%) scale(${entra * late}) rotate(${giro}deg)`,
        opacity: sale,
        ...caja("white", c.texto),
        fontSize: tam,
        border: `${Math.round(tam / 10)}px solid ${c.fuerte}`,
        whiteSpace: "nowrap",
      }}
    >
      {texto}
    </div>
  );
};

const Promo: React.FC<{ grande: string; chico: string; y?: number; c: Colores; dur: number }> = ({ grande, chico, y = 760, c, dur }) => {
  const { entra, sale, frame } = usePop(dur);
  const brillo = interpolate((frame % 40) / 40, [0, 1], [-120, 220]);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: y, display: "flex", flexDirection: "column", alignItems: "center", opacity: sale }}>
      <div
        style={{
          ...caja(c.fuerte, "white"),
          fontSize: 150,
          padding: "10px 50px",
          borderRadius: 36,
          transform: `scale(${entra}) rotate(-3deg)`,
          backgroundImage: `linear-gradient(110deg, transparent ${brillo - 30}%, rgba(255,255,255,0.45) ${brillo}%, transparent ${brillo + 30}%)`,
        }}
      >
        {grande}
      </div>
      <div style={{ ...caja("white", c.texto), fontSize: 50, marginTop: -10, transform: `translateY(${interpolate(entra, [0, 1], [80, 0])}px) rotate(2deg)` }}>{chico}</div>
    </div>
  );
};

const Broll: React.FC<{ src: string; texto?: string; y?: number; c: Colores; dur: number }> = ({ src, texto, y = 330, c, dur }) => {
  const frame = useCurrentFrame();
  const entra = interpolate(frame, [0, 7], [100, 0], { extrapolateRight: "clamp" });
  const sale = interpolate(frame, [dur - 7, dur], [0, -100], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const zoom = interpolate(frame, [0, dur], [1.05, 1.15]);
  return (
    <AbsoluteFill style={{ transform: `translateX(${entra + sale}%)`, overflow: "hidden" }}>
      <OffthreadVideo src={staticFile(src)} muted style={{ width: "100%", height: "100%", transform: `scale(${zoom})` }} />
      {texto ? <Etiqueta texto={texto} y={y} giro={-3} c={c} dur={dur} /> : null}
    </AbsoluteFill>
  );
};

const Cta: React.FC<{ texto: string; c: Colores; dur: number }> = ({ texto, c, dur }) => {
  const { entra, sale, frame } = usePop(dur);
  const flecha = Math.sin(frame / 4) * 14;
  return (
    <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "center", paddingTop: 230, opacity: sale }}>
      <div style={{ ...caja("white", c.texto), fontSize: 40, padding: "10px 26px", transform: `scale(${entra})` }}>Entrá a</div>
      <div
        style={{
          ...caja(c.fuerte, "white"),
          fontSize: 66,
          marginTop: 14,
          textTransform: "none",
          transform: `scale(${entra})`,
        }}
      >
        {texto}
      </div>
      <div style={{ fontSize: 90, color: "white", marginTop: 6, transform: `translateY(${flecha}px)`, textShadow: "0 6px 20px rgba(0,0,0,0.4)", fontFamily }}>▼</div>
    </AbsoluteFill>
  );
};

export const Progreso: React.FC<{ color: string; frames: number }> = ({ color, frames }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ position: "absolute", top: 0, left: 0, height: 12, width: `${(frame / frames) * 100}%`, background: color, boxShadow: "0 0 12px rgba(0,0,0,0.25)" }} />
  );
};
