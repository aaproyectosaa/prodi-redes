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
}

export const LOCALIDADES: LocalidadViatico[] = [
  { n: "Reconquista", p: "Santa Fe", d: "General Obligado", km: 0 },
  { n: "Avellaneda", p: "Santa Fe", d: "General Obligado", km: 3 },
  { n: "Puerto Reconquista", p: "Santa Fe", d: "General Obligado", km: 12 },
  { n: "Berna", p: "Santa Fe", d: "General Obligado", km: 24 },
  { n: "Guadalupe Norte", p: "Santa Fe", d: "General Obligado", km: 24 },
  { n: "Los Laureles", p: "Santa Fe", d: "General Obligado", km: 26 },
  { n: "La Sarita", p: "Santa Fe", d: "General Obligado", km: 28 },
  { n: "El Araza", p: "Santa Fe", d: "General Obligado", km: 30 },
  { n: "Lanteri", p: "Santa Fe", d: "General Obligado", km: 34 },
  { n: "Las Garzas", p: "Santa Fe", d: "General Obligado", km: 36 },
  { n: "Goya", p: "Corrientes", d: "Goya", km: 37 },
  { n: "Paraje San Manuel", p: "Santa Fe", d: "General Obligado", km: 37 },
  { n: "Malabrigo", p: "Santa Fe", d: "General Obligado", km: 39 },
  { n: "Romang", p: "Santa Fe", d: "San Javier", km: 41 },
  { n: "Ingeniero Chanourdie", p: "Santa Fe", d: "General Obligado", km: 43 },
  { n: "Carolina", p: "Corrientes", d: "Goya", km: 45 },
  { n: "Lavalle", p: "Corrientes", d: "Lavalle", km: 47 },
  { n: "Arroyo Ceibal", p: "Santa Fe", d: "General Obligado", km: 50 },
  { n: "Garabato", p: "Santa Fe", d: "Vera", km: 52 },
  { n: "Toba", p: "Santa Fe", d: "Vera", km: 53 },
  { n: "Colonia Durán", p: "Santa Fe", d: "San Javier", km: 54 },
  { n: "Santa Lucía", p: "Corrientes", d: "Lavalle", km: 55 },
  { n: "Tartagal", p: "Santa Fe", d: "Vera", km: 56 },
  { n: "Paraje 29", p: "Santa Fe", d: "Vera", km: 58 },
  { n: "Villa Córdoba", p: "Corrientes", d: "Lavalle", km: 58 },
  { n: "Colmena", p: "Santa Fe", d: "Vera", km: 61 },
  { n: "Pozo de los Indios", p: "Santa Fe", d: "Vera", km: 63 },
  { n: "Vera", p: "Santa Fe", d: "Vera", km: 66 },
  { n: "Intiyaco", p: "Santa Fe", d: "Vera", km: 67 },
  { n: "Kilómetro 115", p: "Santa Fe", d: "Vera", km: 67 },
  { n: "Cruz de los Milagros", p: "Corrientes", d: "Lavalle", km: 71 },
  { n: "Yatayti Calle", p: "Corrientes", d: "Lavalle", km: 72 },
  { n: "Gobernador Juan E. Martínez", p: "Corrientes", d: "Lavalle", km: 73 },
  { n: "Villa Ana", p: "Santa Fe", d: "General Obligado", km: 73 },
  { n: "Fortín Olmos", p: "Santa Fe", d: "Vera", km: 75 },
  { n: "Golondrina", p: "Santa Fe", d: "Vera", km: 75 },
  { n: "Pueblo Santa Lucía", p: "Santa Fe", d: "Vera", km: 75 },
  { n: "Villa Ocampo", p: "Santa Fe", d: "General Obligado", km: 78 },
  { n: "La Isleta", p: "Santa Fe", d: "General Obligado", km: 80 },
  { n: "Margarita", p: "Santa Fe", d: "Vera", km: 84 },
  { n: "9 de Julio", p: "Corrientes", d: "San Roque", km: 86 },
  { n: "La Gallareta", p: "Santa Fe", d: "Vera", km: 86 },
  { n: "Alejandra", p: "Santa Fe", d: "San Javier", km: 87 },
  { n: "Tacuarendí", p: "Santa Fe", d: "General Obligado", km: 89 },
  { n: "Bella Vista", p: "Corrientes", d: "Bella Vista", km: 92 },
  { n: "San Antonio de Obligado", p: "Santa Fe", d: "General Obligado", km: 92 },
  { n: "Las Toscas", p: "Santa Fe", d: "General Obligado", km: 95 },
  { n: "Esquina", p: "Corrientes", d: "Esquina", km: 97 },
  { n: "Cañada Ombú", p: "Santa Fe", d: "Vera", km: 99 },
];
