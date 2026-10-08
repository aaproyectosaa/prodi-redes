import { useEffect } from "react";
import { asset } from "@/lib/asset";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { AppSidebar } from "@/components/AppSidebar";
import { DriveUploadStatusBar } from "@/components/DriveUploadStatusBar";
import { MobileAppHeader, MobileTabBar, useTecladoAbierto } from "@/components/MobileNav";
import { AvisoActivarAvisos, AvisoInstalar } from "@/components/InstalarApp";
import { RecorridoAuto } from "@/components/recorrido/Recorrido";
import { AvisoDescargarChat, InstalarChatHost } from "@/components/InstalarChat";
import { VideoSheet } from "@/components/redes/VideoSheet";
import { ChatDock } from "@/components/redes/chat/ChatDock";
import { VerComoBanner } from "@/components/redes/VerComo";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { RedesDataProvider } from "@/contexts/redes-data-context";
import { BadgeApp } from "@/components/BadgeApp";
import { SidebarExtrasProvider, useSidebarExtras } from "@/hooks/use-sidebar-extras";
import { useAltoVisible } from "@/hooks/use-alto-visible";
import { useChatDock } from "@/lib/redes/chatDock";

const LayoutInner = () => {
  const navigate = useNavigate();
  const { user, authChecked, profile, role, viewingAs } = useUserProfileContext();
  const { extras } = useSidebarExtras();
  const { pathname } = useLocation();
  const teclado = useTecladoAbierto();
  const dockAbierto = useChatDock().abierto;
  useAltoVisible();
  // El aviso de Prodi Chat no va adentro del chat, con el chat flotante abierto ni con el teclado afuera.
  const sinAvisoChat = teclado || dockAbierto || pathname.replace(/\/$/, "") === "/chat";

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
      <BadgeApp />
      <div className="alto-app seguro-costados flex overflow-hidden bg-background">
        <AppSidebar profile={profile} role={role}>
          {extras}
        </AppSidebar>
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* En el celular el encabezado va primero: es el que deja libre la barra de estado del iPhone. */}
          <MobileAppHeader profile={profile} role={role} />
          <VerComoBanner />
          <AvisoDescargarChat oculto={sinAvisoChat} />
          <main className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
            <Outlet />
          </main>
        </div>
        <MobileTabBar role={role} />
        <AvisoInstalar />
        <InstalarChatHost />
        <AvisoActivarAvisos uid={viewingAs ? undefined : user?.uid} />
        <RecorridoAuto />
        <DriveUploadStatusBar />
        <VideoSheet />
        <ChatDock />
      </div>
    </RedesDataProvider>
  );
};

export const AppLayout = () => (
  <SidebarExtrasProvider>
    <LayoutInner />
  </SidebarExtrasProvider>
);
