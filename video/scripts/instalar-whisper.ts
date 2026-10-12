// Baja whisper.cpp y el modelo de transcripción a video/whisper.cpp (una sola vez).
import fs from "node:fs";
import path from "node:path";
import { installWhisperCpp, downloadWhisperModel } from "@remotion/install-whisper-cpp";

const dir = path.join(import.meta.dirname, "..", "whisper.cpp");
const release = path.join(dir, "Release");
const bin = path.join(dir, "build", "bin");

// En Windows el zip se descomprime en Release/ pero Remotion (>= 1.7.4) busca build/bin/whisper-cli.exe
if (fs.existsSync(release) && !fs.existsSync(bin)) {
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  fs.renameSync(release, bin);
}
if (!fs.existsSync(path.join(bin, "whisper-cli.exe")) && fs.existsSync(dir) && process.platform === "win32") {
  fs.rmSync(dir, { recursive: true });
}
await installWhisperCpp({ to: dir, version: "1.7.6", printOutput: false });
if (fs.existsSync(release) && !fs.existsSync(bin)) {
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  fs.renameSync(release, bin);
}
await downloadWhisperModel({ model: "medium", folder: dir });
console.log("whisper.cpp listo en", dir);
