import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { BrowserRouter, HashRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { ThemeProvider } from "@/hooks/use-theme";
import { AppLayout } from "./components/AppLayout";
import RoleRedirect from "./pages/RoleRedirect";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";
import PendingRoleGate from "./components/PendingRoleGate";
import { RequireRole } from "./components/RequireRole";
import { AppProviders } from "./contexts/app-providers";
import { useUserProfileContext } from "./contexts/user-profile-context";
import { ChatAppLayout, ModoChat } from "./components/ChatAppLayout";

const Profile = lazy(() => import("./pages/Profile"));
const Notificaciones = lazy(() => import("./pages/Notificaciones"));
const Tablero = lazy(() => import("./pages/redes/Tablero"));
const Facturacion = lazy(() => import("./pages/redes/Facturacion"));
const Gastos = lazy(() => import("./pages/redes/Gastos"));
const Cobros = lazy(() => import("./pages/redes/Cobros"));
const PagosEquipo = lazy(() => import("./pages/redes/PagosEquipo"));
const MisGanancias = lazy(() => import("./pages/redes/MisGanancias"));
const Deudas = lazy(() => import("./pages/redes/Deudas"));
const Administracion = lazy(() => import("./pages/redes/Administracion"));
const Circuito = lazy(() => import("./pages/redes/Circuito"));
const Rodajes = lazy(() => import("./pages/redes/Rodajes"));
const ClientePortal = lazy(() => import("./pages/redes/ClientePortal"));
const Clientes = lazy(() => import("./pages/redes/Clientes"));
const ClienteDetalle = lazy(() => import("./pages/redes/ClienteDetalle"));
const Equipo = lazy(() => import("./pages/redes/Equipo"));
const Ajustes = lazy(() => import("./pages/redes/Ajustes"));
const Piezas = lazy(() => import("./pages/redes/Piezas"));
const Chat = lazy(() => import("./pages/redes/Chat"));
const Reuniones = lazy(() => import("./pages/redes/Reuniones"));
const Aprobar = lazy(() => import("./pages/Aprobar"));
const Reportes = lazy(() => import("./pages/redes/Reportes"));
const Escalabilidad = lazy(() => import("./pages/redes/Escalabilidad"));
const MiAsistente = lazy(() => import("./pages/redes/MiAsistente"));
const ReporteDetalle = lazy(() => import("./pages/redes/Reportes").then((m) => ({ default: m.ReporteDetalle })));

const queryClient = new QueryClient();

// La demo navegable (sin servidor) usa rutas con # para funcionar como página estática.
const Router = import.meta.env.VITE_DEMO ? HashRouter : BrowserRouter;

const Cargando = () => <div className="p-8 text-sm text-muted-foreground">Cargando…</div>;

/** Rutas del sistema anterior: redirigen al inicio del rol. */
const LEGACY_PATHS = ["/dashboard", "/pm", "/cm", "/tareas", "/mis-tareas", "/projects", "/productor", "/editor", "/disenador", "/m/:code/:taskId"];

/** Las pantallas de inicio por rol ahora son el tablero de videos (mantiene ?video=). */
const AVideos = () => {
  const { search } = useLocation();
  return <Navigate to={`/videos${search}`} replace />;
};

/** En Prodi Chat, el chat para cualquier rol asignado (los pendientes ven el aviso de PendingRoleGate). */
const ChatSoloConRol = () => {
  const { role, loading } = useUserProfileContext();
  if (loading || !role) return <Cargando />;
  if (role === "pending") return null;
  return <Chat />;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider defaultTheme="dark" storageKey="ui-theme">
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <Router>
          <AppProviders>
            <PendingRoleGate />
            <Suspense fallback={<Cargando />}>
            <ModoChat>
            <Routes>
              <Route path="/auth" element={<Auth />} />
              {/* Público: el cliente aprueba desde el link del aviso sin entrar al sistema */}
              <Route path="/aprobar/:token" element={<Aprobar />} />

              <Route element={<AppLayout />}>
                <Route path="/" element={<RoleRedirect />} />

                {/* Super admin */}
                <Route path="/tablero" element={<RequireRole roles={["admin", "administracion"]}><Tablero /></RequireRole>} />
                <Route path="/facturacion" element={<RequireRole roles={["admin", "administracion"]}><Facturacion /></RequireRole>} />
                <Route path="/gastos" element={<RequireRole roles={["admin", "administracion"]}><Gastos /></RequireRole>} />
                <Route path="/administracion" element={<RequireRole roles={["admin", "administracion"]}><Administracion /></RequireRole>} />
                <Route path="/cobros" element={<RequireRole roles={["admin", "administracion"]}><Cobros /></RequireRole>} />
                <Route path="/pagos-equipo" element={<RequireRole roles={["admin", "administracion"]}><PagosEquipo /></RequireRole>} />
                <Route path="/mis-ganancias" element={<RequireRole roles={["productor", "editor", "pauta", "diseno"]}><MisGanancias /></RequireRole>} />
                <Route path="/deudas" element={<RequireRole roles={["admin", "administracion"]}><Deudas /></RequireRole>} />
                <Route path="/equipo" element={<RequireRole roles={["admin"]}><Equipo /></RequireRole>} />
                <Route path="/ajustes" element={<RequireRole roles={["admin"]}><Ajustes /></RequireRole>} />
                <Route path="/reportes" element={<RequireRole roles={["admin"]}><Reportes /></RequireRole>} />
                <Route path="/escalabilidad" element={<RequireRole roles={["admin"]}><Escalabilidad /></RequireRole>} />
                <Route path="/mi-asistente" element={<RequireRole roles={["admin"]}><MiAsistente /></RequireRole>} />
                <Route path="/reportes/:uid" element={<RequireRole roles={["admin"]}><ReporteDetalle /></RequireRole>} />

                {/* Todos */}
                <Route path="/chat" element={<RequireRole roles={["admin", "productor", "editor", "pauta", "diseno", "administracion", "cliente"]}><Chat /></RequireRole>} />
                <Route path="/reuniones" element={<RequireRole roles={["admin", "productor", "editor", "pauta", "diseno", "administracion", "cliente"]}><Reuniones /></RequireRole>} />

                {/* Equipo */}
                <Route path="/videos" element={<RequireRole roles={["admin", "productor", "editor", "pauta"]}><Circuito /></RequireRole>} />
                <Route path="/rodajes" element={<RequireRole roles={["admin", "productor"]}><Rodajes /></RequireRole>} />
                <Route path="/piezas" element={<RequireRole roles={["admin", "productor", "diseno"]}><Piezas /></RequireRole>} />
                <Route path="/clientes" element={<RequireRole roles={["admin", "productor"]}><Clientes /></RequireRole>} />
                <Route path="/clientes/:id" element={<RequireRole roles={["admin", "productor"]}><ClienteDetalle /></RequireRole>} />

                {/* Cliente */}
                <Route path="/cliente" element={<RequireRole roles={["cliente"]}><ClientePortal /></RequireRole>} />

                <Route path="/profile" element={<Profile />} />
                <Route path="/notificaciones" element={<Notificaciones />} />
                {["/produccion", "/edicion", "/pauta"].map((p) => (
                  <Route key={p} path={p} element={<AVideos />} />
                ))}
                {LEGACY_PATHS.map((p) => (
                  <Route key={p} path={p} element={<Navigate to="/" replace />} />
                ))}
              </Route>

              {/* Prodi Chat: la app aparte con solo los chats (chat-app.html, manifest-chat.webmanifest) */}
              <Route path="/chat-app/ingresar" element={<Auth />} />
              <Route element={<ChatAppLayout />}>
                <Route path="/chat-app" element={<ChatSoloConRol />} />
                <Route path="/chat-app/perfil" element={<Profile />} />
                <Route path="/chat-app/avisos" element={<Notificaciones />} />
                <Route path="/chat-app/*" element={<Navigate to="/chat-app" replace />} />
              </Route>

              <Route path="*" element={<NotFound />} />
            </Routes>
            </ModoChat>
            </Suspense>
          </AppProviders>
        </Router>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
