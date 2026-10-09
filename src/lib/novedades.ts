// Recorridos animados: la bienvenida de cada rol (la primera vez que entra) y las novedades (cada vez que
// se agrega algo). Cada persona ve cada novedad una sola vez: quedan anotadas en su perfil
// (profiles.novedades_vistas), así no se repiten aunque cambie de celular.
//
// CÓMO SUMAR UNA NOVEDAD: agregarla ARRIBA de NOVEDADES con un id nuevo (nunca reusar uno), para quién es
// (roles; sin roles = todos) y sus diapositivas. Quien entra por primera vez no ve las novedades viejas:
// ve la bienvenida, que ya explica cómo funciona todo.

export type AnimRecorrido =
  | "deslizar"
  | "mencionar"
  | "reaccionar"
  | "tarea"
  | "prodi"
  | "videos"
  | "ya-lo-filme"
  | "entrega"
  | "ganancias"
  | "avisos"
  | "guion"
  | "cobros"
  | "piezas"
  | "pagos"
  | "pedir-video"
  | "aprobar"
  | "subir-material"
  | "boleta"
  | "resultados"
  | "cupo"
  | "meta-copiar"
  | "meta-pegar"
  | "meta-datos"
  | "hablar-cliente";

export interface Diapositiva {
  titulo: string;
  texto: string;
  anim: AnimRecorrido;
}

export interface Novedad {
  id: string;
  /** YYYY-MM-DD */
  fecha: string;
  titulo: string;
  /** Roles que la ven (sin roles: todos). En Prodi Chat se muestran solo las marcadas `chat`. */
  roles?: string[];
  chat?: boolean;
  diapositivas: Diapositiva[];
}

const EQUIPO = ["admin", "productor", "editor", "pauta", "diseno", "administracion"];

const CHAT: Diapositiva[] = [
  { titulo: "Deslizá para responder", texto: "Arrastrá un mensaje hacia la derecha y respondés justo a ese, citado. Como en WhatsApp.", anim: "deslizar" },
  { titulo: "Mencioná con @", texto: "Escribí @ y elegí a alguien: le llega un aviso aunque no esté mirando el chat.", anim: "mencionar" },
  { titulo: "Reaccioná", texto: "Mantené apretado un mensaje y tocá 👍 ✅ ❤️ para contestar rápido sin escribir.", anim: "reaccionar" },
  { titulo: "Convertilo en tarea", texto: "Mantené apretado → «Hacer tarea»: elegís para quién y para cuándo, y le llega el aviso.", anim: "tarea" },
  { titulo: "Pedile a @prodi", texto: "Escribí @prodi y lo que necesitás: agenda reuniones, deja tareas y recuerda cosas del cliente.", anim: "prodi" },
];

/** Pauta: el ID del anuncio de Meta en cada video, y los resultados llegan solos. */
const META: Diapositiva[] = [
  {
    titulo: "1. Copiá el ID del anuncio",
    texto: "En el Administrador de anuncios de Meta, en la columna «ID del anuncio», copiá el número del anuncio de ese video.",
    anim: "meta-copiar",
  },
  {
    titulo: "2. Pegalo en el video",
    texto: "Al marcarlo publicado (o en «Editar pauta») pegalo en «ID del anuncio en Meta» y guardá.",
    anim: "meta-pegar",
  },
  {
    titulo: "3. Los números llegan solos",
    texto: "Alcance, reproducciones, mensajes e inversión se actualizan todos los días a las 8. Si los querés ya, en «Resultados» tocá «Traer de Meta».",
    anim: "meta-datos",
  },
];

/** Edición y diseño: hablar una corrección con el cliente con la tarjeta del video o la pieza. */
const HABLAR_CLIENTE: Diapositiva = {
  titulo: "¿Una duda con la corrección?",
  texto: "Debajo de los cambios que pidió el cliente tocá «Hablarlo con el cliente»: se abre su grupo con la tarjeta del video o la pieza y la corrección entera. Escribís tu pregunta y listo.",
  anim: "hablar-cliente",
};

/** Novedades, de la más nueva a la más vieja. */
export const NOVEDADES: Novedad[] = [
  {
    id: "2026-10-nueva-pieza",
    fecha: "2026-10-10",
    titulo: "Cargá piezas gráficas para diseño",
    roles: ["productor"],
    diapositivas: [
      {
        titulo: "Botón «Pieza gráfica»",
        texto: "Está en Mis videos y en la ficha de cada cliente. Elegís el cliente, subís las fotos (producto, local, persona), qué pieza es y qué hay que hacer. A diseño le llega al toque.",
        anim: "piezas",
      },
      {
        titulo: "Las fotos se usan tal cual",
        texto: "La diseñadora las ve en la pieza y la IA las pone de protagonistas al generarla. Si al cliente no le quedan piezas del plan, elegís sin cargo o que la pague él.",
        anim: "subir-material",
      },
    ],
  },
  {
    id: "2026-10-meta-id",
    fecha: "2026-10-09",
    titulo: "Los resultados de Meta, solos",
    roles: ["pauta"],
    diapositivas: META,
  },
  {
    id: "2026-10-hablar-cliente",
    fecha: "2026-10-09",
    titulo: "Correcciones: hablalo con el cliente",
    roles: ["editor", "diseno"],
    diapositivas: [HABLAR_CLIENTE],
  },
  {
    id: "2026-10-cliente",
    fecha: "2026-10-08",
    titulo: "Novedades en tu panel",
    roles: ["cliente"],
    diapositivas: [
      { titulo: "¿Filmaste vos? Mandanos el material", texto: "Al pedir un video elegí «Yo mando el material»: lo subís desde acá y lo editamos nosotros.", anim: "subir-material" },
      { titulo: "Siempre sabés cuántos videos te quedan", texto: "Te avisamos cuando te queda 1 video del mes y cuando se terminan. Si necesitás más, pedís uno extra.", anim: "cupo" },
    ],
  },
  {
    id: "2026-10-chat",
    fecha: "2026-10-08",
    titulo: "El chat ahora es más rápido",
    chat: true,
    diapositivas: CHAT.slice(0, 4),
  },
  {
    id: "2026-10-produccion",
    fecha: "2026-10-08",
    titulo: "Novedades en Videos",
    roles: ["admin", "productor"],
    diapositivas: [
      { titulo: "«Ya lo filmé»", texto: "¿Grabaste algo que no estaba planificado? Tocá «Ya lo filmé», subí el material y mandalo a edición. Sin rodaje.", anim: "ya-lo-filme" },
      { titulo: "Fecha de entrega", texto: "Al mandar un video a edición elegís para cuándo lo necesitás. La editora lo ve en la tarjeta y le avisamos el día antes.", anim: "entrega" },
      { titulo: "Guion a mano", texto: "En cada video podés escribir el guion y las tomas vos («Escribirlo yo») o pedírselo a la IA.", anim: "guion" },
    ],
  },
  {
    id: "2026-10-editora",
    fecha: "2026-10-08",
    titulo: "Fecha de entrega en cada video",
    roles: ["editor"],
    diapositivas: [
      { titulo: "Sabés qué va primero", texto: "Cada video en edición dice para cuándo hay que entregarlo: naranja si es hoy o mañana, rojo si se atrasó. Lo más urgente queda arriba.", anim: "entrega" },
    ],
  },
  {
    id: "2026-10-ganancias",
    fecha: "2026-10-08",
    titulo: "Mis ganancias",
    roles: ["productor", "editor", "pauta", "diseno"],
    diapositivas: [
      { titulo: "Mirá lo que vas ganando", texto: "En el menú, «Mis ganancias»: lo que llevás en el mes, qué trabajos cuentan, lo que tenés en camino y si ya se te pagó.", anim: "ganancias" },
    ],
  },
];

/** La bienvenida de cada rol: lo principal de su día a día y lo básico del chat. */
export function bienvenidaDe(role: string | undefined, enChat: boolean): Diapositiva[] {
  if (enChat || role === "contacto") return [...CHAT, { titulo: "Avisos al instante", texto: "Activá las notificaciones y te enterás de cada mensaje y cada mención en el momento.", anim: "avisos" }];
  const avisos: Diapositiva = { titulo: "Te avisamos de todo", texto: "Activá las notificaciones: te llega cada video, mensaje y mención al instante.", anim: "avisos" };
  const chat = CHAT.slice(0, 3);
  switch (role) {
    case "cliente":
      return [
        { titulo: "Pedí un video en 4 pasos", texto: "Tocá «Pedir un video»: contanos qué querés, con qué material y para cuándo. Si entra en tu plan, no se paga aparte.", anim: "pedir-video" },
        { titulo: "¿Filmaste vos? Subilo", texto: "Elegí «Yo mando el material» y subí los videos desde el celular. Nosotros lo editamos.", anim: "subir-material" },
        { titulo: "Aprobá con un toque", texto: "Cuando un video está listo te avisamos. Lo mirás y lo aprobás o pedís cambios.", anim: "aprobar" },
        { titulo: "Tus videos del mes", texto: "En «Mi plan» ves cuántos usaste y cuántos te quedan. Te avisamos cuando se terminan.", anim: "cupo" },
        { titulo: "Resultados", texto: "Mirá cuánta gente vio tus videos y cuántos mensajes te llegaron.", anim: "resultados" },
        { titulo: "Tus boletas", texto: "Te llegan el 27 por la app y por mail. Las ves, las descargás y pagás por transferencia o débito.", anim: "boleta" },
        ...chat,
        avisos,
      ];
    case "productor":
      return [
        { titulo: "Todos tus videos en un lugar", texto: "En «Mis videos» ves cada video por etapa: idea, rodaje, edición y aprobación del cliente.", anim: "videos" },
        { titulo: "«Ya lo filmé»", texto: "Si grabaste algo sin planificar, tocá «Ya lo filmé», subí el material y va directo a edición.", anim: "ya-lo-filme" },
        { titulo: "Fecha de entrega", texto: "Al mandar a edición elegís para cuándo lo necesitás. La editora lo ve y le avisamos el día antes.", anim: "entrega" },
        ...chat,
        { titulo: "Mis ganancias", texto: "En el menú ves lo que llevás ganado en el mes y lo que tenés en camino.", anim: "ganancias" },
        avisos,
      ];
    case "editor":
      return [
        { titulo: "Lo que te toca editar", texto: "En «Mis videos» están los que tienen el crudo listo. Bajás el material, editás y subís el final.", anim: "videos" },
        { titulo: "Primero lo urgente", texto: "Cada video dice para cuándo hay que entregarlo. Lo más urgente queda arriba.", anim: "entrega" },
        HABLAR_CLIENTE,
        ...chat,
        { titulo: "Mis ganancias", texto: "En el menú ves lo que llevás ganado en el mes y lo que tenés en camino.", anim: "ganancias" },
        avisos,
      ];
    case "pauta":
      return [
        { titulo: "Lo que hay que publicar", texto: "En «Mis videos» están los aprobados por el cliente, listos para publicar y pautar.", anim: "videos" },
        ...META,
        ...chat,
        { titulo: "Mis ganancias", texto: "En el menú ves lo que llevás ganado en el mes.", anim: "ganancias" },
        avisos,
      ];
    case "diseno":
      return [
        { titulo: "Piezas gráficas", texto: "En «Piezas gráficas» están los pedidos de cada cliente. Diseñás, subís la versión y el cliente la aprueba.", anim: "piezas" },
        HABLAR_CLIENTE,
        ...chat,
        { titulo: "Mis ganancias", texto: "En el menú ves lo que llevás ganado en el mes.", anim: "ganancias" },
        avisos,
      ];
    case "administracion":
      return [
        { titulo: "Cobros del mes", texto: "El 27 se preparan solas las boletas. En «Cobros» las revisás, las emitís y marcás lo cobrado.", anim: "cobros" },
        { titulo: "Pagos al equipo", texto: "El sistema cuenta lo que hizo cada uno y calcula lo que le corresponde.", anim: "pagos" },
        ...chat,
        avisos,
      ];
    default:
      return [
        { titulo: "Todo el negocio a la vista", texto: "Clientes, videos, cobros y equipo, en un solo lugar.", anim: "videos" },
        ...chat,
        { titulo: "Pedile a @prodi", texto: "Escribí @prodi en cualquier chat: agenda reuniones, deja tareas y recuerda cosas del cliente.", anim: "prodi" },
        avisos,
      ];
  }
}

/** Las novedades que le tocan a este rol (en Prodi Chat, solo las del chat). */
export const novedadesPara = (role: string | undefined, enChat: boolean) =>
  NOVEDADES.filter((n) => {
    if (enChat) return !!n.chat;
    // Sin roles: las del chat son para todos (también clientes y contactos); el resto, solo para el equipo.
    const para = n.roles ?? (n.chat ? [...EQUIPO, "cliente", "contacto"] : EQUIPO);
    return para.includes(role ?? "");
  });

/** Para volver a abrir la bienvenida desde el menú ("¿Cómo se usa?"). */
export const EVENTO_RECORRIDO = "prodi-recorrido";
