// Localidades a 100 km o menos de Reconquista (en línea recta), para los viáticos de filmación.
// Fuente: Georef, API oficial del Gobierno argentino (apis.datos.gob.ar/georef), centroides de cada localidad.
// Generado el 2026-10-14. Las de Corrientes quedan del otro lado del río: se cotizan aparte.

export interface LocalidadViatico {
  /** Nombre de la localidad. */
  n: string;
  /** Provincia. */
  p: string;
  /** Departamento. */
  d: string;
  /** Distancia a Reconquista en línea recta (km). */
  km: number;
  /** Latitud y longitud del centro de la localidad (para el mapa). */
  la: number;
  lo: number;
}

/** Centro de Reconquista (el punto de partida). */
export const RECONQUISTA = { la: -29.1445, lo: -59.6435 };

export const LOCALIDADES: LocalidadViatico[] = [
  { n: "Reconquista", p: "Santa Fe", d: "General Obligado", km: 0, la: -29.1445, lo: -59.6435 },
  { n: "Avellaneda", p: "Santa Fe", d: "General Obligado", km: 3, la: -29.1175, lo: -59.6585 },
  { n: "Puerto Reconquista", p: "Santa Fe", d: "General Obligado", km: 12, la: -29.2338, lo: -59.581 },
  { n: "Berna", p: "Santa Fe", d: "General Obligado", km: 24, la: -29.2727, lo: -59.8453 },
  { n: "Guadalupe Norte", p: "Santa Fe", d: "General Obligado", km: 24, la: -28.9451, lo: -59.5636 },
  { n: "Los Laureles", p: "Santa Fe", d: "General Obligado", km: 26, la: -29.3686, lo: -59.7362 },
  { n: "La Sarita", p: "Santa Fe", d: "General Obligado", km: 28, la: -28.9728, lo: -59.8488 },
  { n: "El Araza", p: "Santa Fe", d: "General Obligado", km: 30, la: -29.133, lo: -59.9476 },
  { n: "Lanteri", p: "Santa Fe", d: "General Obligado", km: 34, la: -28.84, lo: -59.6352 },
  { n: "Las Garzas", p: "Santa Fe", d: "General Obligado", km: 36, la: -28.8471, lo: -59.4997 },
  { n: "Goya", p: "Corrientes", d: "Goya", km: 37, la: -29.1401, lo: -59.2599 },
  { n: "Paraje San Manuel", p: "Santa Fe", d: "General Obligado", km: 37, la: -28.8736, lo: -59.866 },
  { n: "Malabrigo", p: "Santa Fe", d: "General Obligado", km: 39, la: -29.3488, lo: -59.9699 },
  { n: "Romang", p: "Santa Fe", d: "San Javier", km: 41, la: -29.4996, lo: -59.7477 },
  { n: "Ingeniero Chanourdie", p: "Santa Fe", d: "General Obligado", km: 43, la: -28.7598, lo: -59.5772 },
  { n: "Carolina", p: "Corrientes", d: "Goya", km: 45, la: -29.1503, lo: -59.1818 },
  { n: "Lavalle", p: "Corrientes", d: "Lavalle", km: 47, la: -29.0233, lo: -59.1792 },
  { n: "Arroyo Ceibal", p: "Santa Fe", d: "General Obligado", km: 50, la: -28.7231, lo: -59.4777 },
  { n: "Garabato", p: "Santa Fe", d: "Vera", km: 52, la: -28.9545, lo: -60.1351 },
  { n: "Toba", p: "Santa Fe", d: "Vera", km: 53, la: -29.2682, lo: -60.1715 },
  { n: "Colonia Durán", p: "Santa Fe", d: "San Javier", km: 54, la: -29.5581, lo: -59.9266 },
  { n: "Santa Lucía", p: "Corrientes", d: "Lavalle", km: 55, la: -28.9899, lo: -59.1008 },
  { n: "Tartagal", p: "Santa Fe", d: "Vera", km: 56, la: -28.6711, lo: -59.8481 },
  { n: "Paraje 29", p: "Santa Fe", d: "Vera", km: 58, la: -29.1082, lo: -60.2393 },
  { n: "Villa Córdoba", p: "Corrientes", d: "Lavalle", km: 58, la: -28.9917, lo: -59.0752 },
  { n: "Colmena", p: "Santa Fe", d: "Vera", km: 61, la: -28.7625, lo: -60.0911 },
  { n: "Pozo de los Indios", p: "Santa Fe", d: "Vera", km: 63, la: -28.9451, lo: -60.252 },
  { n: "Vera", p: "Santa Fe", d: "Vera", km: 66, la: -29.4592, lo: -60.2148 },
  { n: "Intiyaco", p: "Santa Fe", d: "Vera", km: 67, la: -28.6749, lo: -60.0707 },
  { n: "Kilómetro 115", p: "Santa Fe", d: "Vera", km: 67, la: -28.8248, lo: -60.2234 },
  { n: "Cruz de los Milagros", p: "Corrientes", d: "Lavalle", km: 71, la: -28.8361, lo: -59.006 },
  { n: "Yatayti Calle", p: "Corrientes", d: "Lavalle", km: 72, la: -29.0283, lo: -58.9122 },
  { n: "Gobernador Juan E. Martínez", p: "Corrientes", d: "Lavalle", km: 73, la: -28.9123, lo: -58.9361 },
  { n: "Villa Ana", p: "Santa Fe", d: "General Obligado", km: 73, la: -28.4927, lo: -59.6133 },
  { n: "Fortín Olmos", p: "Santa Fe", d: "Vera", km: 75, la: -29.057, lo: -60.4129 },
  { n: "Golondrina", p: "Santa Fe", d: "Vera", km: 75, la: -28.5564, lo: -60.0248 },
  { n: "Pueblo Santa Lucía", p: "Santa Fe", d: "Vera", km: 75, la: -29.2819, lo: -60.4027 },
  { n: "Villa Ocampo", p: "Santa Fe", d: "General Obligado", km: 78, la: -28.4868, lo: -59.3547 },
  { n: "La Isleta", p: "Santa Fe", d: "General Obligado", km: 80, la: -28.4922, lo: -59.2942 },
  { n: "Margarita", p: "Santa Fe", d: "Vera", km: 84, la: -29.6876, lo: -60.2532 },
  { n: "9 de Julio", p: "Corrientes", d: "San Roque", km: 86, la: -28.8408, lo: -58.8301 },
  { n: "La Gallareta", p: "Santa Fe", d: "Vera", km: 86, la: -29.5863, lo: -60.3782 },
  { n: "Alejandra", p: "Santa Fe", d: "San Javier", km: 87, la: -29.9092, lo: -59.8269 },
  { n: "Tacuarendí", p: "Santa Fe", d: "General Obligado", km: 89, la: -28.4178, lo: -59.2572 },
  { n: "Bella Vista", p: "Corrientes", d: "Bella Vista", km: 92, la: -28.5077, lo: -59.0452 },
  { n: "San Antonio de Obligado", p: "Santa Fe", d: "General Obligado", km: 92, la: -28.3843, lo: -59.2644 },
  { n: "Las Toscas", p: "Santa Fe", d: "General Obligado", km: 95, la: -28.3549, lo: -59.2593 },
  { n: "Esquina", p: "Corrientes", d: "Esquina", km: 97, la: -30.0146, lo: -59.5295 },
  { n: "Cañada Ombú", p: "Santa Fe", d: "Vera", km: 99, la: -28.3091, lo: -59.9836 },
];
