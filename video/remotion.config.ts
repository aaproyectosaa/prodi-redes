import { Config } from "@remotion/cli/config";

// La PC tiene poca RAM libre: 2 pestañas de Chrome renderizando a la vez alcanzan.
Config.setConcurrency(2);
Config.setVideoImageFormat("jpeg");
Config.setCodec("h264");
Config.setCrf(18);
Config.setOverwriteOutput(true);
