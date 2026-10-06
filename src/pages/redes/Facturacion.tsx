import { Navigate, useLocation } from "react-router-dom";

/** La vieja pantalla de facturación se separó en Cobros y Pagos al equipo. */
export default function Facturacion() {
  const { search } = useLocation();
  const q = new URLSearchParams(search);
  const tab = q.get("tab");
  q.delete("tab");
  const resto = q.toString() ? `?${q}` : "";
  return <Navigate to={`${tab === "equipo" ? "/pagos-equipo" : "/cobros"}${resto}`} replace />;
}
