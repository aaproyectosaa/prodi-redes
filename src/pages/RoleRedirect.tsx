import { useEffect } from "react";
import { asset } from "@/lib/asset";
import { useNavigate } from "react-router-dom";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { defaultRouteForRole } from "@/lib/roles";
import { useEmpresa } from "@/lib/empresa";

const RoleRedirect = () => {
  const navigate = useNavigate();
  const { user, role, loading } = useUserProfileContext();
  // En Prodi Software, su inicio; en Redes, el de su rol.
  const { empresa } = useEmpresa();

  useEffect(() => {
    if (!user) {
      navigate("/auth", { replace: true });
      return;
    }
    if (loading || !role || role === "pending") return;
    navigate(empresa === "software" ? "/software" : defaultRouteForRole(role), { replace: true });
  }, [user, role, loading, navigate, empresa]);

  return (
    <div className="flex min-h-[60dvh] items-center justify-center">
      <img src={asset("/brand/isotipo.png")} alt="" className="h-10 w-auto animate-pulse" />
    </div>
  );
};

export default RoleRedirect;
