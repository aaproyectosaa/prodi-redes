import { Composition } from "remotion";
import { Reel, type ReelProps } from "./Reel";

const FPS = 30;

const ejemplo: ReelProps = {
  video: null,
  duracionClip: 5,
  captions: [],
  logo: null,
  fondoCierre: "#111111",
  colorResaltado: "#ffd400",
  segundosCierre: 2.5,
};

export const Root: React.FC = () => (
  <Composition
    id="Reel"
    component={Reel}
    width={1080}
    height={1920}
    fps={FPS}
    durationInFrames={Math.round((ejemplo.duracionClip + ejemplo.segundosCierre) * FPS)}
    defaultProps={ejemplo}
    calculateMetadata={({ props }) => ({
      durationInFrames: Math.round((props.duracionClip + props.segundosCierre) * FPS),
    })}
  />
);
