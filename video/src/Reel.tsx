import { useMemo } from "react";
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { createTikTokStyleCaptions, type Caption, type TikTokPage } from "@remotion/captions";

export type ReelProps = {
  /** Ruta dentro de public/ (staticFile) del clip ya recortado. */
  video: string | null;
  duracionClip: number;
  captions: Caption[];
  /** Ruta dentro de public/ del logo del cierre. */
  logo: string | null;
  fondoCierre: string;
  colorResaltado: string;
  segundosCierre: number;
};

export const Reel: React.FC<ReelProps> = (p) => {
  const { fps } = useVideoConfig();
  const framesClip = Math.round(p.duracionClip * fps);

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <Sequence durationInFrames={framesClip}>
        {p.video ? <OffthreadVideo src={staticFile(p.video)} style={{ width: "100%", height: "100%" }} /> : null}
        <Subtitulos captions={p.captions} color={p.colorResaltado} />
      </Sequence>
      <Sequence from={framesClip}>
        <Cierre logo={p.logo} fondo={p.fondoCierre} />
      </Sequence>
    </AbsoluteFill>
  );
};

const Subtitulos: React.FC<{ captions: Caption[]; color: string }> = ({ captions, color }) => {
  const { fps } = useVideoConfig();
  const { pages } = useMemo(
    () => createTikTokStyleCaptions({ captions, combineTokensWithinMilliseconds: 900 }),
    [captions],
  );

  return (
    <AbsoluteFill>
      {pages.map((page, i) => {
        const desde = Math.round((page.startMs / 1000) * fps);
        const siguiente = pages[i + 1]?.startMs ?? page.startMs + page.durationMs;
        const hasta = Math.round((Math.min(siguiente, page.startMs + page.durationMs + 600) / 1000) * fps);
        if (hasta <= desde) return null;
        return (
          <Sequence key={i} from={desde} durationInFrames={hasta - desde} layout="none">
            <Pagina page={page} color={color} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

const Pagina: React.FC<{ page: TikTokPage; color: string }> = ({ page, color }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ms = page.startMs + (frame / fps) * 1000;
  const entrada = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 6 });

  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 430 }}>
      <div
        style={{
          maxWidth: 900,
          textAlign: "center",
          fontFamily: "'Montserrat', 'Arial Black', Arial, sans-serif",
          fontWeight: 900,
          fontSize: 76,
          lineHeight: 1.15,
          textTransform: "uppercase",
          color: "white",
          WebkitTextStroke: "14px black",
          paintOrder: "stroke",
          transform: `scale(${interpolate(entrada, [0, 1], [0.85, 1])})`,
          whiteSpace: "pre-wrap",
        }}
      >
        {page.tokens.map((t, i) => {
          const activa = ms >= t.fromMs && ms < t.toMs;
          return (
            <span key={i} style={{ color: activa ? color : "white" }}>
              {t.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const Cierre: React.FC<{ logo: string | null; fondo: string }> = ({ logo, fondo }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 14, mass: 0.8 } });
  const fundido = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: fondo, justifyContent: "center", alignItems: "center", opacity: fundido }}>
      {logo ? (
        <Img
          src={staticFile(logo)}
          style={{
            width: 640,
            maxHeight: 640,
            objectFit: "contain",
            transform: `scale(${interpolate(s, [0, 1], [0.6, 1])})`,
            opacity: s,
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
};
