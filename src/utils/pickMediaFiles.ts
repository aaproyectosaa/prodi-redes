import { toast } from "sonner";

const MEDIA_ACCEPT =
  "image/*,video/*,.heic,.heif,.mov,.MOV,.mp4,.m4v,.MP4,.M4V";

type PreparingListener = (preparing: boolean) => void;

let inputEl: HTMLInputElement | null = null;
let pendingCallback: ((files: File[]) => void) | null = null;
const preparingListeners = new Set<PreparingListener>();
let preparingActive = false;

export function subscribePickerPreparing(listener: PreparingListener): () => void {
  preparingListeners.add(listener);
  listener(preparingActive);
  return () => preparingListeners.delete(listener);
}

function setPreparing(preparing: boolean) {
  preparingActive = preparing;
  preparingListeners.forEach((listener) => listener(preparing));
}

function isIosDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

function ensureInput(): HTMLInputElement {
  if (inputEl) return inputEl;

  inputEl = document.createElement("input");
  inputEl.type = "file";
  inputEl.multiple = true;
  inputEl.accept = MEDIA_ACCEPT;
  inputEl.style.display = "none";
  inputEl.setAttribute("aria-hidden", "true");
  document.body.appendChild(inputEl);

  const finishPreparing = () => setPreparing(false);

  inputEl.addEventListener("change", () => {
    const callback = pendingCallback;
    pendingCallback = null;

    const snapshot = inputEl?.files ? Array.from(inputEl.files) : [];
    inputEl!.value = "";

    const deliver = () => {
      finishPreparing();
      if (snapshot.length === 0) {
        toast.error(
          "No se recibieron archivos. Probá de nuevo o subí de a uno si son muy pesados."
        );
        return;
      }
      callback?.(snapshot);
    };

    // iOS: a veces el change dispara antes de que los File estén listos.
    if (isIosDevice()) {
      window.setTimeout(deliver, 150);
    } else {
      deliver();
    }
  });

  inputEl.addEventListener("cancel", () => {
    pendingCallback = null;
    finishPreparing();
  });

  return inputEl;
}

/** Abre cámara o grabación en el móvil; en desktop permite elegir video/foto. */
export function pickCaptureMedia(onFiles: (files: File[]) => void): void {
  let input = document.getElementById("progreso-capture-input") as HTMLInputElement | null;
  if (!input) {
    input = document.createElement("input");
    input.id = "progreso-capture-input";
    input.type = "file";
    input.accept = "video/*,image/*";
    input.setAttribute("capture", "environment");
    input.style.display = "none";
    input.setAttribute("aria-hidden", "true");
    document.body.appendChild(input);
    input.addEventListener("change", () => {
      const snapshot = input?.files ? Array.from(input.files) : [];
      input!.value = "";
      if (snapshot.length > 0) onFiles(snapshot);
    });
  }
  input.value = "";
  input.click();
}

/** Abre el selector nativo (Fotos en iPhone). Mantiene el input en el DOM para iOS. */
export function pickMediaFiles(onFiles: (files: File[]) => void): void {
  pendingCallback = onFiles;
  setPreparing(true);

  const input = ensureInput();
  input.value = "";

  window.setTimeout(() => {
    input.click();
  }, 0);
}

/** En iOS el tamaño del File puede tardar en poblarse tras cerrar la galería. */
export async function waitForFilesReady(
  files: File[],
  maxWaitMs = 12_000
): Promise<File[]> {
  if (files.length === 0) return files;
  if (!isIosDevice()) return files;

  const deadline = Date.now() + maxWaitMs;
  let ready = files;

  while (Date.now() < deadline) {
    ready = files.filter((file) => file.size > 0);
    if (ready.length === files.length) return ready;
    await new Promise((resolve) => window.setTimeout(resolve, 200));
  }

  return files.filter((file) => file.size > 0);
}
