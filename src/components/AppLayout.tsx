import { useEffect } from "react";
import { asset } from "@/lib/asset";
import { Outlet, useNavigate } from "react-router-dom";
import { AppSidebar } from "@/components/AppSidebar";
import { DriveUploadStatusBar } from "@/components/DriveUploadStatusBar";
import { MobileAppHeader, MobileTabBar } from "@/components/MobileNav";
import { AvisoActivarAvisos, AvisoInstalar } from "@/components/InstalarApp";
import { VideoSheet } from "@/components/redes/VideoSheet";
import { VerComoBanner } from "@/components/redes/VerComo";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { RedesDataProvider } from "@/contexts/redes-data-context";
import { SidebarExtrasProvider, useSidebarExtras } from "@/hooks/use-sidebar-extras";
import { useSyncAppBaseUrl } from "@/hooks/use-sync-app-base-url";

const LayoutInner = () => {
  const navigate = useNavigate();
  const { user, authChecked, profile, role, viewingAs } = useUserProfileContext();
  const { extras } = useSidebarExtras();
  useSyncAppBaseUrl(role === "admin");

  useEffect(() => {
    if (authChecked && !user) navigate("/auth", { replace: true });
  }, [authChecked, user, navigate]);

  if (!authChecked) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background">
        <img src={asset("/brand/isotipo.png")} alt="" className="h-10 w-auto animate-pulse" />
      </div>
    );
  }
  if (!user) return null;

  return (
    <RedesDataProvider>
      <div className="flex h-dvh overflow-hidden bg-background">
        <AppSidebar profile={profile} role={role}>
          {extras}
        </AppSidebar>
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <VerComoBanner />
          <MobileAppHeader profile={profile} role={role} />
          <main className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
            <Outlet />
          </main>
        </div>
        <MobileTabBar role={role} />
        <AvisoInstalar />
        <AvisoActivarAvisos uid={viewingAs ? undefined : user?.uid} />
        <DriveUploadStatusBar />
        <VideoSheet />
      </div>
    </RedesDataProvider>
  );
};

export const AppLayout = () => (
  <SidebarExtrasProvider>
    <LayoutInner />
  </SidebarExtrasProvider>
);
