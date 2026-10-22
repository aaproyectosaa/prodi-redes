// Antes de que el servidor abra un link que mandó alguien (vista previa en el chat, leer la web de un cliente): que el
// dominio no apunte a una dirección interna. Un dominio "normal" puede resolver a 127.0.0.1, a la red privada o a la
// dirección de metadatos de la nube (169.254.169.254); con esto se rechaza.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/** ¿Es una dirección interna (no de internet)? */
export function ipInterna(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) || // link-local / metadatos de la nube
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224 // multicast y reservadas
    );
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    if (x === "::" || x === "::1") return true;
    const mapeada = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapeada) return ipInterna(mapeada[1]);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(x); // privadas, link-local y multicast
  }
  return true;
}

/** ¿El dominio resuelve solo a direcciones de internet? (si no resuelve, tampoco se abre) */
export async function hostPublicoDNS(hostname: string): Promise<boolean> {
  const h = hostname.replace(/^\[|\]$/g, "");
  if (isIP(h)) return !ipInterna(h);
  try {
    const ips = await lookup(h, { all: true, verbatim: true });
    return ips.length > 0 && ips.every((r) => !ipInterna(r.address));
  } catch {
    return false;
  }
}
