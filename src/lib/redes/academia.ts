import { useEffect, useState } from "react";
import { doc, onSnapshot, setDoc } from "@/lib/db";
import { db } from "@/integrations/firebase/client";

// Academia Prodi: un curso por rol para la gente nueva del equipo. Cada lección tiene (si ya está hecho) un video
// corto, los puntos clave, los pasos y una pregunta: si la responde bien, la lección queda completa.
// El progreso de cada persona va en academia/{uid}. Mientras alguien está "en capacitación" (profiles.en_capacitacion,
// lo prende el admin), sus videos los revisa un supervisor antes de que le lleguen al cliente.

export interface Leccion {
  id: string;
  titulo: string;
  resumen: string;
  /** Video animado de la lección (en public/academia) y su miniatura. Sin video: se lee el texto. */
  video?: string;
  poster?: string;
  /** Lo que dura (para mostrar en la tarjeta). */
  duracion?: string;
  puntos: string[];
  pasos?: string[];
  pregunta: { texto: string; opciones: string[]; correcta: number; porque: string };
}
export type RolCurso = "productor" | "editor" | "pauta" | "diseno";
export interface Curso {
  rol: RolCurso;
  titulo: string;
  descripcion: string;
  lecciones: Leccion[];
}

const COMO_TRABAJA: Leccion = {
  id: "como-trabaja-prodi",
  titulo: "Cómo trabaja Prodi",
  resumen: "Qué vendemos, cómo es el mes de un cliente y el camino de cada video, de la idea a la publicación.",
  video: "/academia/como-trabaja-prodi.mp4",
  poster: "/academia/como-trabaja-prodi.jpg",
  duracion: "0:20",
  puntos: [
    "Prodi hace videos verticales (Reels) para comercios y los pauta en Meta para que les escriban por WhatsApp y les compren.",
    "Cada cliente tiene un plan: una cantidad de videos por mes. A principio de mes se arma el plan con ideas y el cliente lo aprueba.",
    "Cada video pasa por etapas: idea → rodaje → edición → revisión interna → aprobación del cliente → publicación.",
    "Todo pasa por el sistema: si no está cargado, no existe. Los avisos te dicen qué te toca.",
  ],
  pasos: ["Entrá a «Mis videos» y mirá en qué etapa está cada uno.", "Activá las notificaciones del sistema en el celular.", "Leé el chat del cliente antes de cada trabajo."],
  pregunta: {
    texto: "¿Para qué hace videos Prodi?",
    opciones: ["Para que la marca tenga muchos likes", "Para que al comercio le escriban y le compren", "Para llenar el feed del cliente"],
    correcta: 1,
    porque: "Los likes no pagan cuentas: los videos están pensados para traer mensajes y ventas, y la pauta los lleva a la gente correcta.",
  },
};

export const CURSOS: Curso[] = [
  {
    rol: "productor",
    titulo: "Productora",
    descripcion: "Planificar, filmar y llevar cada video hasta que el cliente lo aprueba.",
    lecciones: [
      COMO_TRABAJA,
      {
        id: "reel-que-vende",
        titulo: "Qué tiene un Reel que vende",
        resumen: "Las tres partes que no pueden faltar: gancho, producto y llamado.",
        video: "/academia/productora-l2.mp4",
        poster: "/academia/productora-l2.jpg",
        duracion: "0:22",
        puntos: [
          "El gancho: en los primeros 3 segundos tiene que pasar algo que haga frenar el dedo (una pregunta, un movimiento, algo inesperado).",
          "El producto: bien de cerca, que se vea y que se entienda qué gana el cliente (no solo qué es).",
          "El llamado: claro y uno solo. «Escribinos por WhatsApp», «Vení hoy al local».",
          "Si falta uno de los tres, el video no vende.",
        ],
        pasos: ["Antes de filmar, escribí en una línea el gancho de cada video.", "Filmá el producto en primer plano, con luz.", "Cerrá siempre con el llamado, dicho y escrito."],
        pregunta: {
          texto: "¿Qué tiene que pasar en los primeros 3 segundos?",
          opciones: ["El logo del negocio", "Algo que haga frenar el dedo", "La dirección del local"],
          correcta: 1,
          porque: "Si los primeros 3 segundos no enganchan, la persona sigue de largo y nunca llega al producto ni al llamado.",
        },
      },
      {
        id: "antes-del-rodaje",
        titulo: "Antes del rodaje",
        resumen: "Qué pedirle al cliente y qué llevar para que el día de rodaje rinda.",
        video: "/academia/antes-del-rodaje.mp4",
        poster: "/academia/antes-del-rodaje.jpg",
        duracion: "0:20",
        puntos: [
          "Confirmá el día y la hora con el cliente por el chat del sistema, y que el rodaje esté cargado en «Rodajes».",
          "Pedile que tenga listos los productos, el local ordenado y a la persona que va a hablar (si habla alguien).",
          "Llevá la lista de tomas de cada video: si no está escrita, en el lugar se olvida.",
          "Cargá la batería del celular y del estabilizador, y llevá un micrófono y espacio libre en el teléfono.",
        ],
        pasos: ["Un día antes: confirmá por el chat.", "Revisá el guion y la lista de tomas de cada video.", "Armá el bolso: celular, estabilizador, micrófono, luz, cargadores."],
        pregunta: {
          texto: "¿Dónde se confirma el rodaje con el cliente?",
          opciones: ["Por WhatsApp personal", "Por el chat del sistema y cargado en «Rodajes»", "No hace falta confirmarlo"],
          correcta: 1,
          porque: "Así queda registrado, el equipo lo ve y el sistema le manda el recordatorio al cliente.",
        },
      },
      {
        id: "filmar-con-celular",
        titulo: "Filmar con el celular",
        resumen: "Luz, sonido y encuadre: lo básico que hace que un video se vea profesional.",
        video: "/academia/filmar-con-celular.mp4",
        poster: "/academia/filmar-con-celular.jpg",
        duracion: "0:18",
        puntos: [
          "Luz: de frente o de costado, nunca la ventana atrás de la persona. Si es de noche, usá la luz de apoyo.",
          "Sonido: micrófono siempre que alguien hable. Un video con mal sonido se abandona más rápido que uno con mala imagen.",
          "Encuadre: vertical, con aire arriba de la cabeza y el producto en el centro de la atención.",
          "Grabá cada toma 2 o 3 veces y unos segundos de más al principio y al final: la editora te lo agradece.",
        ],
        pregunta: {
          texto: "¿Qué hacés si la persona está parada delante de una ventana?",
          opciones: ["Nada, se arregla en edición", "La movés para que la luz le dé de frente o de costado", "Subís el brillo del celular"],
          correcta: 1,
          porque: "Con la ventana atrás la cara queda oscura y eso en edición casi no se arregla.",
        },
      },
      {
        id: "despues-del-rodaje",
        titulo: "Después del rodaje",
        resumen: "Subir el material, «Ya lo filmé» y mandar a edición con fecha.",
        video: "/academia/despues-del-rodaje.mp4",
        poster: "/academia/despues-del-rodaje.jpg",
        duracion: "0:13",
        puntos: [
          "Subí el material el mismo día, en el video que corresponde. Si filmaste algo que no estaba planificado, usá «Ya lo filmé».",
          "Al mandar a edición elegí para cuándo lo necesitás: la editora lo ve y el sistema le avisa el día antes.",
          "Dejá una nota para la editora: qué toma es la buena, qué música o ritmo imaginás.",
          "Cuando la editora entrega, revisalo vos antes de mandarlo al cliente.",
        ],
        pasos: ["Subí todo el material del rodaje.", "Mandá a edición con fecha de entrega y una nota.", "Revisá la entrega y aprobala o pedí cambios."],
        pregunta: {
          texto: "¿Quién revisa el video antes de que le llegue al cliente?",
          opciones: ["Nadie, va directo", "La productora (y, si está en capacitación, un supervisor)", "El cliente lo revisa primero"],
          correcta: 1,
          porque: "El cliente tiene que recibir un video que ya pasó nuestro control de calidad.",
        },
      },
      {
        id: "hablar-con-el-cliente",
        titulo: "Cómo hablarle al cliente",
        resumen: "El tono de Prodi y lo que no se hace.",
        video: "/academia/hablar-con-el-cliente.mp4",
        poster: "/academia/hablar-con-el-cliente.jpg",
        duracion: "0:17",
        puntos: [
          "Cordial, claro y corto. Respondé el mismo día, aunque sea para decir «lo veo y te aviso».",
          "Siempre por el chat del sistema: así todo el equipo sabe qué se habló.",
          "Nunca prometas fechas, precios ni videos extra que no estén confirmados por Prodi.",
          "Si el cliente está enojado, escuchá, no discutas por escrito y avisale al admin.",
        ],
        pregunta: {
          texto: "El cliente te pide un video extra sin cargo. ¿Qué hacés?",
          opciones: ["Le decís que sí para quedar bien", "Le decís que lo consultás y avisás al admin", "No le contestás"],
          correcta: 1,
          porque: "Lo que no está en el plan lo define Prodi: prometerlo te compromete a vos y al equipo.",
        },
      },
    ],
  },
  {
    rol: "editor",
    titulo: "Editora",
    descripcion: "Convertir el material en Reels que enganchan y venden, a tiempo.",
    lecciones: [
      COMO_TRABAJA,
      {
        id: "edicion-que-vende",
        titulo: "Una edición que vende",
        resumen: "Ritmo, gancho y subtítulos.",
        video: "/academia/edicion-que-vende.mp4",
        poster: "/academia/edicion-que-vende.jpg",
        duracion: "0:17",
        puntos: [
          "Los primeros 3 segundos son lo más importante: arrancá con la toma más fuerte, no con el logo.",
          "Ritmo: cortes cada 1 a 3 segundos, sin silencios largos.",
          "Subtítulos siempre: la mayoría mira sin sonido.",
          "Cierre con el llamado a la acción, escrito y dicho.",
        ],
        pregunta: {
          texto: "¿Con qué arranca el video?",
          opciones: ["Con el logo del cliente", "Con la toma más fuerte", "Con una pantalla negra"],
          correcta: 1,
          porque: "Si el comienzo no engancha, nadie llega a ver el resto.",
        },
      },
      {
        id: "entregas",
        titulo: "Entregas y cambios",
        resumen: "Fecha de entrega, versión final y cómo tomar los cambios.",
        video: "/academia/entregas.mp4",
        poster: "/academia/entregas.jpg",
        duracion: "0:16",
        puntos: [
          "Respetá la fecha de entrega que puso la productora: el sistema te avisa el día antes.",
          "Subí el video final en «Final» y tocá «Entregar para revisión».",
          "Los cambios llegan con marcas en el video: resolvelos todos antes de volver a entregar.",
        ],
        pregunta: {
          texto: "¿Dónde subís el video terminado?",
          opciones: ["Por WhatsApp a la productora", "En «Final» del video y «Entregar para revisión»", "En Drive suelto"],
          correcta: 1,
          porque: "Así la productora y el cliente lo ven en el lugar correcto y queda el historial.",
        },
      },
    ],
  },
  {
    rol: "pauta",
    titulo: "Pauta",
    descripcion: "Que la publicidad en Meta traiga mensajes y ventas, sin pasarse del presupuesto.",
    lecciones: [
      COMO_TRABAJA,
      {
        id: "pauta-que-trae-mensajes",
        titulo: "Pauta que trae mensajes",
        resumen: "Objetivo, público y presupuesto.",
        video: "/academia/pauta-que-trae-mensajes.mp4",
        poster: "/academia/pauta-que-trae-mensajes.jpg",
        duracion: "0:16",
        puntos: [
          "El objetivo casi siempre es mensajes por WhatsApp, no alcance ni likes.",
          "Público según la zona del comercio: no gastes en gente que no puede comprar.",
          "Respetá el presupuesto del mes de cada cliente: el sistema te avisa si te pasás.",
          "Mirá el costo por mensaje y por venta, no solo cuánta gente lo vio.",
        ],
        pregunta: {
          texto: "¿Cuál es el objetivo habitual de una campaña de un comercio?",
          opciones: ["Más seguidores", "Mensajes por WhatsApp", "Más alcance"],
          correcta: 1,
          porque: "Los mensajes son los que terminan en ventas.",
        },
      },
      {
        id: "usar-el-sistema-pauta",
        titulo: "El módulo de Pauta",
        resumen: "Alertas, consejos de la IA y qué video vende.",
        video: "/academia/usar-el-sistema-pauta.mp4",
        poster: "/academia/usar-el-sistema-pauta.jpg",
        duracion: "0:15",
        puntos: [
          "En «Pauta» ves cada cliente con su gasto del mes, alertas y consejos de la IA.",
          "Marcá como hechos los consejos que aplicás: el admin ve qué se aplicó.",
          "Usá el especialista de Meta del sistema cuando tengas dudas de una campaña.",
        ],
        pregunta: {
          texto: "¿Qué hacés con un consejo de la IA que aplicaste?",
          opciones: ["Nada", "Lo marcás como hecho", "Lo borrás"],
          correcta: 1,
          porque: "Así queda registrado y se mide qué cambió después.",
        },
      },
    ],
  },
  {
    rol: "diseno",
    titulo: "Diseño",
    descripcion: "Piezas gráficas con la identidad de cada cliente, en tiempo y forma.",
    lecciones: [
      COMO_TRABAJA,
      {
        id: "pieza-que-vende",
        titulo: "Una pieza que vende",
        resumen: "Una idea por pieza, producto grande y llamado claro.",
        video: "/academia/pieza-que-vende.mp4",
        poster: "/academia/pieza-que-vende.jpg",
        duracion: "0:15",
        puntos: [
          "Una sola idea por pieza: si querés decir todo, no se entiende nada.",
          "Producto o precio grande; el texto, poco y legible en el celular.",
          "Siempre con la marca del cliente: logo, colores y tipografía de su ficha.",
          "Llamado a la acción claro.",
        ],
        pregunta: {
          texto: "¿De dónde sacás el logo y los colores del cliente?",
          opciones: ["De Google", "De la marca cargada en su ficha", "Los elegís vos"],
          correcta: 1,
          porque: "La ficha tiene la versión correcta del logo y la paleta aprobada por el cliente.",
        },
      },
      {
        id: "circuito-piezas",
        titulo: "El circuito de las piezas",
        resumen: "Igual que los videos: diseño → revisión de la productora → cliente.",
        video: "/academia/circuito-piezas.mp4",
        poster: "/academia/circuito-piezas.jpg",
        duracion: "0:14",
        puntos: [
          "Cuando terminás, la pieza la revisa la productora: la aprueba (y le llega al cliente) o pide cambios.",
          "Los cambios del cliente vuelven a vos con su nota.",
          "Respetá las fechas que pide el cliente en el pedido.",
        ],
        pregunta: {
          texto: "¿Quién ve la pieza antes que el cliente?",
          opciones: ["Nadie", "La productora", "El community manager"],
          correcta: 1,
          porque: "Igual que los videos, pasa por la revisión interna antes de llegar al cliente.",
        },
      },
    ],
  },
];

export interface ProgresoAcademia {
  completadas?: Record<string, string>;
  actualizado_at?: string;
}

export function useProgresoAcademia(uid: string | undefined) {
  const [p, setP] = useState<ProgresoAcademia | null>(null);
  useEffect(() => {
    if (!uid) return;
    return onSnapshot(
      doc(db, "academia", uid),
      (s) => setP((s.data() as ProgresoAcademia | undefined) ?? {}),
      () => setP({})
    );
  }, [uid]);
  return p;
}

export async function completarLeccion(uid: string, leccionId: string) {
  const at = new Date().toISOString();
  await setDoc(doc(db, "academia", uid), { completadas: { [leccionId]: at }, actualizado_at: at }, { merge: true });
}

/** Cuántas lecciones del curso completó. */
export function avanceDe(curso: Curso, p: ProgresoAcademia | null | undefined) {
  const hechas = curso.lecciones.filter((l) => p?.completadas?.[l.id]).length;
  return { hechas, total: curso.lecciones.length, completo: hechas === curso.lecciones.length };
}

/** Los cursos de una persona según sus roles. */
export function cursosDe(roles: string[]): Curso[] {
  return CURSOS.filter((c) => roles.includes(c.rol));
}
