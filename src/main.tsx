import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { escucharInstalacion } from "./lib/instalar";
import { marcarArranqueChat } from "./lib/chatApp";

escucharInstalacion();
marcarArranqueChat();

createRoot(document.getElementById("root")!).render(<App />);
