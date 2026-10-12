import { PageHeader } from "@/software/ui/PageHeader";
import { AppForm } from "./AppForm";

export default function NewAppPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Nueva app de Mercado Pago"
        sub="Cargá las credenciales de la app y la conectamos. Los clientes aparecen solos después, al actualizar desde Mercado Pago."
      />
      <AppForm mode="create" />
    </div>
  );
}
