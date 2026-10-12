import { AppForm } from "./AppForm";

export default function NewAppPage() {
  return (
    <div>
      <h1 className="page-title">Nueva app Mercado Pago</h1>
      <p className="page-sub">
        Solo Client ID, Secret y Access Token. Después agregás los clientes adentro.
      </p>
      <AppForm mode="create" />
    </div>
  );
}
