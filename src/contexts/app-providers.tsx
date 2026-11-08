import type { ReactNode } from "react";
import { UserProfileProvider } from "@/contexts/user-profile-context";
import { AppDataProvider } from "@/contexts/app-data-context";
import { DriveUploadProvider } from "@/contexts/drive-upload-context";
import { ProfileThemeSync } from "@/components/ProfileThemeSync";
import { EmpresaProvider } from "@/lib/empresa";
import { ForegroundPushListener } from "@/components/ForegroundPushListener";
import { enIngles } from "@/lib/idioma";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <UserProfileProvider>
      <ProfileThemeSync />
      {/* En inglés (video de la revisión de Meta) no salen los avisos del equipo, que están en castellano. */}
      {!enIngles && <ForegroundPushListener />}
      <DriveUploadProvider>
        <AppDataProvider>
          <EmpresaProvider>{children}</EmpresaProvider>
        </AppDataProvider>
      </DriveUploadProvider>
    </UserProfileProvider>
  );
}
