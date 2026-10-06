import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { escucharInstalacion } from "./lib/instalar";

escucharInstalacion();

createRoot(document.getElementById("root")!).render(<App />);
