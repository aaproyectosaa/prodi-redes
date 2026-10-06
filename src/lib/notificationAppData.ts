import type { Profile, Project } from "@/integrations/firebase/types";

let profilesCache: Profile[] = [];
let projectsCache: Project[] = [];

/** Registra profiles/projects desde AppDataProvider para encolar avisos sin lecturas extra. */
export function setNotificationAppData(profiles: Profile[], projects: Project[]): void {
  profilesCache = profiles;
  projectsCache = projects;
}

export function getNotificationAppData(): {
  profiles: Profile[];
  projects: Project[];
} {
  return { profiles: profilesCache, projects: projectsCache };
}
