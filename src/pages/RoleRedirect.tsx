import { useEffect } from "react";
import { asset } from "@/lib/asset";
import { useNavigate } from "react-router-dom";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { defaultRouteForRole } from "@/lib/roles";

const RoleRedirect = () => {
  const navigate = useNavigate();
  const { user, role, loading } = useUserProfileContext();

  useEffect(() => {
    if (!user) {
      navigate("/auth", { replace: true });
      return;
    }
    if (loading || !role || role === "pending") return;
    navigate(defaultRouteForRole(role), { replace: true });
  }, [user, role, loading, navigate]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <img src={asset("/brand/isotipo.png")} alt="" className="h-10 w-auto animate-pulse" />
    </div>
  );
};

export default RoleRedirect;
