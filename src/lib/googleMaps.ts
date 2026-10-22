/* eslint-disable @typescript-eslint/no-explicit-any */
// Google Maps en el navegador (mapa que se mueve y buscador de lugares). Solo si hay clave en VITE_GOOGLE_MAPS_KEY
// (Maps JavaScript API + Places API (New), restringida al dominio del sistema). Sin clave se usa OpenStreetMap.

export const CLAVE_MAPS = ((import.meta.env.VITE_GOOGLE_MAPS_KEY as string | undefined) ?? "").trim();
export const hayGoogleMaps = () => !!CLAVE_MAPS;

let carga: Promise<any> | null = null;

/** Carga el script de Google una sola vez y devuelve `google.maps`. */
export function googleMaps(): Promise<any> {
  if (!CLAVE_MAPS) return Promise.reject(new Error("Falta la clave de Google Maps"));
  if ((window as any).google?.maps?.importLibrary) return Promise.resolve((window as any).google.maps);
  carga ??= new Promise((resolve, reject) => {
    const cb = `__prodiMaps${Date.now()}`;
    (window as any)[cb] = () => resolve((window as any).google.maps);
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(CLAVE_MAPS)}&v=weekly&loading=async&language=es&region=AR&callback=${cb}`;
    s.async = true;
    s.onerror = () => {
      carga = null;
      reject(new Error("No se pudo cargar Google Maps"));
    };
    document.head.appendChild(s);
  });
  return carga;
}

export interface LugarGoogle {
  id: string;
  titulo: string;
  detalle: string;
  /** Para elegirlo: trae nombre, dirección y coordenadas. */
  elegir: () => Promise<{ valor: string; coords: [number, number] | null }>;
}

let sesion: any = null;

/** Sugerencias de lugares y direcciones de Argentina mientras se escribe (Places API New). */
export async function sugerirLugares(texto: string): Promise<LugarGoogle[]> {
  const maps = await googleMaps();
  const { AutocompleteSuggestion, AutocompleteSessionToken } = await maps.importLibrary("places");
  sesion ??= new AutocompleteSessionToken();
  const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({ input: texto, includedRegionCodes: ["ar"], language: "es", sessionToken: sesion });
  return (suggestions ?? [])
    .map((s: any) => s.placePrediction)
    .filter(Boolean)
    .slice(0, 5)
    .map((p: any) => ({
      id: p.placeId,
      titulo: p.mainText?.text ?? p.text?.text ?? "",
      detalle: p.secondaryText?.text ?? "",
      elegir: async () => {
        const lugar = p.toPlace();
        await lugar.fetchFields({ fields: ["displayName", "formattedAddress", "location"] });
        sesion = null;
        const nombre = lugar.displayName ?? "";
        const dir = String(lugar.formattedAddress ?? "").replace(/, Argentina$/, "");
        return {
          valor: nombre && !dir.startsWith(nombre) ? `${nombre}, ${dir}` : dir || nombre,
          coords: lugar.location ? [lugar.location.lat(), lugar.location.lng()] : null,
        };
      },
    }));
}

/** Dónde queda un texto (dirección o nombre de un lugar), con Google. */
export async function buscarCoordsGoogle(texto: string): Promise<[number, number] | null> {
  const maps = await googleMaps();
  const { Place } = await maps.importLibrary("places");
  const { places } = await Place.searchByText({ textQuery: texto, fields: ["location"], region: "ar", language: "es", maxResultCount: 1 });
  const l = places?.[0]?.location;
  return l ? [l.lat(), l.lng()] : null;
}
