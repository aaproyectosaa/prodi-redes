import { createRoot } from "react-dom/client";
import App from "@/App";
import "@/index.css";
import { DemoBar } from "./DemoBar";
import { escucharInstalacion } from "@/lib/instalar";

escucharInstalacion();

// La app ocupa h-screen: en la demo le restamos la barra de arriba.
const style = document.createElement("style");
style.textContent = `#demo-app .h-screen{height:calc(100vh - 2.5rem)!important}`;
document.head.appendChild(style);

createRoot(document.getElementById("root")!).render(
  <div className="flex h-screen flex-col">
    <DemoBar />
    <div id="demo-app" className="min-h-0 flex-1">
      <App />
    </div>
  </div>
);
