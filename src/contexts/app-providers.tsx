import type { ReactNode } from "react";
import { UserProfileProvider } from "@/contexts/user-profile-context";
import { AppDataProvider } from "@/contexts/app-data-context";
import { DriveUploadProvider } from "@/contexts/drive-upload-context";
import { ProfileThemeSync } from "@/components/ProfileThemeSync";
import { ForegroundPushListener } from "@/components/ForegroundPushListener";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <UserProfileProvider>
      <ProfileThemeSync />
      <ForegroundPushListener />
      <DriveUploadProvider>
        <AppDataProvider>{children}</AppDataProvider>
      </DriveUploadProvider>
    </UserProfileProvider>
  );
}
