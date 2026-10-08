import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { escucharInstalacion } from "./lib/instalar";
import { marcarArranqueChat } from "./lib/chatApp";
import { prepararSonido } from "./lib/sonido";

escucharInstalacion();
marcarArranqueChat();
// El audio de los avisos se desbloquea con los toques (en iPhone, también al volver a la app).
prepararSonido();

createRoot(document.getElementById("root")!).render(<App />);
