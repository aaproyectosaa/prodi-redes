import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, query, setDoc, where } from "@/lib/db";
import { db } from "@/integrations/firebase/client";
import type { DriveAttachmentRef } from "@/integrations/firebase/types";
import type { MarcaCorreccion } from "@/lib/redes/types";
import type { ProgresoAcademia } from "@/lib/redes/academia";

// Recorridos de la Academia: formación por semanas para gente nueva (ej. "Productora Prodi · Nivel 1").
// El contenido vive en academia_recorridos/{id} y lo edita el admin desde la Academia; mientras no se guardó,
// se usa el de acá (RECORRIDOS_BASE). Cada módulo (semana) tiene lecciones con checklist, un ejercicio que se sube
// y revisa el admin (con marcas en el segundo exacto) y un cuestionario. El módulo siguiente se abre cuando el
// anterior tiene el ejercicio aprobado y el cuestionario aprobado. Las entregas van en academia_entregas.

export interface LeccionRecorrido {
  id: string;
  titulo: string;
  objetivo: string;
  /** Explicación corta: un párrafo por línea. */
  explicacion: string;
  bien: string[];
  mal: string[];
  /** Práctica de la lección (se puede subir para que la mire el admin). */
  ejercicio: string;
  checklist: string[];
  /** Video propio (link de YouTube, de Drive o un .mp4). */
  video?: string;
}
export interface PreguntaRecorrido {
  texto: string;
  opciones: string[];
  correcta: number;
  porque?: string;
}
export interface EjercicioRecorrido {
  titulo: string;
  consigna: string;
  pasos: string[];
}
export interface ModuloRecorrido {
  id: string;
  titulo: string;
  subtitulo: string;
  lecciones: LeccionRecorrido[];
  ejercicio: EjercicioRecorrido;
  cuestionario: PreguntaRecorrido[];
}
export interface Recorrido {
  id: string;
  titulo: string;
  descripcion: string;
  /** Quiénes lo hacen (el admin los ve todos). */
  roles: string[];
  modulos: ModuloRecorrido[];
  examen: EjercicioRecorrido;
  glosario: { termino: string; definicion: string }[];
  actualizado_at?: string;
}

/** Del cuestionario: con estas respuestas bien, se aprueba. */
export const APRUEBA_CUESTIONARIO = 4;

export type EstadoEntrega = "borrador" | "enviada" | "a_corregir" | "aprobada";
export interface EntregaAcademia {
  id: string;
  uid: string;
  nombre: string;
  recorrido_id: string;
  modulo_id: string | null;
  item_id: string;
  item_titulo: string;
  estado: EstadoEntrega;
  attachments_crudo?: DriveAttachmentRef[];
  nota_alumno?: string;
  devolucion?: string;
  marcas?: MarcaCorreccion[];
  enviada_at?: string;
  revisada_at?: string;
  created_at?: string;
  updated_at?: string;
}

export const ID_EXAMEN = "examen";
export const idEjercicioModulo = (moduloId: string) => `${moduloId}-ejercicio`;
export const idEntrega = (uid: string, itemId: string) => `${uid}_${itemId}`;

const P = (texto: string, opciones: string[], correcta: number, porque?: string): PreguntaRecorrido => ({ texto, opciones, correcta, porque });

export const NIVEL_1: Recorrido = {
  id: "productora-nivel-1",
  titulo: "Productora Prodi · Nivel 1",
  descripcion: "4 semanas para aprender a filmar y editar videos que venden, solo con el celular. Sin experiencia previa.",
  roles: ["formacion"],
  modulos: [
    {
      id: "s1",
      titulo: "Semana 1 · Cómo trabaja Prodi y el celular",
      subtitulo: "Qué hacemos, el camino de un video y cómo dejar el celular listo para filmar.",
      lecciones: [
        {
          id: "s1-que-hace-prodi",
          video: "/academia/como-trabaja-prodi.mp4",
          titulo: "Qué hace Prodi",
          objetivo: "Entender para qué sirve cada video que filmás y el camino que hace hasta que se publica.",
          explicacion:
            "Prodi hace videos comerciales para negocios. No son videos para tener likes: son videos que pautamos en Meta (Instagram y Facebook) para que al negocio le escriban y le compren.\nNo hacemos community management: no respondemos mensajes ni manejamos las redes del día a día del cliente.\nCada video hace siempre el mismo camino: guion → rodaje → edición → el cliente lo aprueba en su panel → se publica → se pauta.\nVos vas a estar en el rodaje: si filmás bien, todo lo que viene después sale mejor y más rápido.",
          bien: ["Pensar en quién va a ver el video y qué tiene que hacer después (escribir, comprar).", "Seguir el guion y la lista de tomas.", "Saber en qué etapa está cada video."],
          mal: ["Filmar «lo que salga» sin guion.", "Pensar que el objetivo es que el video sea lindo o tenga likes.", "Prometerle al cliente que le contestamos los mensajes."],
          ejercicio: "Elegí un negocio de tu barrio y escribí en 3 líneas: qué vende, a quién y qué video le harías para que le escriban.",
          checklist: ["Sé qué hace Prodi y qué no hace", "Puedo contar el camino de un video en orden", "Entiendo que el video es para vender"],
        },
        {
          id: "s1-preparar-celular",
          video: "/academia/preparar-celular.mp4",
          titulo: "Preparar el celular",
          objetivo: "Llegar a cada rodaje con el celular listo para no perder tomas ni tiempo.",
          explicacion:
            "Antes de filmar, el celular tiene que estar preparado. Son cinco cosas y te llevan dos minutos.\nLimpiá la lente con un paño: una huella deja la imagen lechosa y no se arregla después.\nDejá memoria libre (al menos 20 GB) y la batería cargada. Llevá batería externa.\nPoné modo avión o no molestar: una llamada en medio de una toma la arruina.\nSubí el brillo de la pantalla al máximo para ver bien lo que filmás, sobre todo afuera.",
          bien: ["Lente limpia antes de cada toma importante.", "Celular en modo avión durante el rodaje.", "Batería al 100 % y batería externa en la mochila."],
          mal: ["Filmar con la lente sucia.", "Quedarte sin memoria en medio del rodaje.", "Que suene una notificación mientras alguien habla."],
          ejercicio: "Prepará tu celular con las cinco cosas y sacale una foto a la pantalla de almacenamiento con lo que tenés libre.",
          checklist: ["Lente limpia", "Memoria libre (20 GB o más)", "Batería cargada", "Modo avión o no molestar", "Brillo al máximo"],
        },
        {
          id: "s1-configuracion",
          titulo: "Configuración de la cámara",
          objetivo: "Que todo lo que filmes salga en el formato y la calidad que usamos en Prodi.",
          explicacion:
            "Siempre filmamos en vertical: los Reels se ven con el celular parado.\nConfigurá la cámara en 1080x1920 (1080p) o en 4K, siempre a 30 fps (cuadros por segundo).\nUsá la lente principal (la de 1x). Nunca uses el zoom digital (pellizcar la pantalla): la imagen se pixela. Si necesitás estar más cerca, acercate caminando.\nBloqueá la exposición y el foco: mantené apretado el dedo sobre lo que filmás hasta que aparezca «Bloqueo AE/AF» (o un candado). Así la luz y el foco no cambian solos en medio de la toma.",
          bien: ["Celular vertical.", "1080p o 4K a 30 fps.", "Lente 1x y acercarte caminando.", "Exposición y foco bloqueados."],
          mal: ["Filmar acostado (horizontal).", "Usar zoom digital.", "Dejar que el foco «respire» y la imagen se oscurezca y aclare sola."],
          ejercicio: "Entrá a la configuración de la cámara, dejala en 1080p o 4K a 30 fps y mandá una captura.",
          checklist: ["Sé dónde se cambia la resolución y los fps", "Dejé 30 fps", "Sé bloquear exposición y foco", "No uso zoom digital"],
        },
        {
          id: "s1-estabilidad",
          titulo: "Estabilidad",
          objetivo: "Que tus tomas se vean firmes y profesionales, sin temblores.",
          explicacion:
            "Una imagen que tiembla se ve casera y cansa. Para que salga firme:\nAgarrá el celular con las dos manos y pegá los codos al cuerpo.\nMovete despacio: si caminás, hacelo con las rodillas un poco flexionadas, como si llevaras un vaso lleno.\nCuando la toma es fija (alguien hablando, un producto), usá trípode. Para seguir algo en movimiento, usá el gimbal.",
          bien: ["Dos manos y codos pegados.", "Movimientos lentos y continuos.", "Trípode para tomas fijas, gimbal para movimiento."],
          mal: ["Filmar con una sola mano.", "Movimientos rápidos o bruscos.", "Caminar normal mientras filmás."],
          ejercicio: "Filmá 10 segundos caminando hacia un objeto: una vez con una mano y otra con las dos manos y los codos pegados. Compará.",
          checklist: ["Filmo con las dos manos", "Me muevo despacio", "Sé cuándo usar trípode y cuándo gimbal"],
        },
      ],
      ejercicio: {
        titulo: "Ejercicio de la semana 1",
        consigna: "5 tomas de 10 segundos de un objeto de tu casa, estables y bien expuestas.",
        pasos: ["Elegí un objeto (una taza, una planta, un perfume).", "Hacé 5 tomas distintas de 10 segundos: de frente, de costado, de cerca, desde arriba y una moviéndote despacio.", "Vertical, 30 fps, lente 1x, exposición y foco bloqueados.", "Subí los 5 videos acá."],
      },
      cuestionario: [
        P("¿Para qué hace videos Prodi?", ["Para que la marca tenga muchos likes", "Para pautarlos en Meta y que al negocio le escriban y le compren", "Para llenar el perfil del cliente"], 1),
        P("¿Prodi responde los mensajes de los clientes de sus clientes?", ["Sí, siempre", "No, no hacemos community management", "Solo los fines de semana"], 1),
        P("¿Cuál es el orden correcto?", ["Rodaje → guion → pauta", "Guion → rodaje → edición → aprobación → publicación → pauta", "Edición → rodaje → publicación"], 1),
        P("Necesitás estar más cerca del producto. ¿Qué hacés?", ["Zoom con los dedos", "Te acercás caminando", "Lo agrandás en la edición"], 1),
        P("¿Para qué sirve mantener apretado el dedo sobre la pantalla?", ["Para sacar una foto", "Para bloquear la exposición y el foco", "Para poner cámara lenta"], 1),
      ],
    },
    {
      id: "s2",
      titulo: "Semana 2 · Luz, encuadre y audio",
      subtitulo: "Las tres cosas que hacen que un video se vea y se escuche profesional.",
      lecciones: [
        {
          id: "s2-luz",
          video: "/academia/filmar-con-celular.mp4",
          titulo: "Luz natural",
          objetivo: "Aprovechar la luz de una ventana para que la imagen se vea limpia y clara.",
          explicacion:
            "La mejor luz es gratis: una ventana. Poné a la persona o al producto de frente o de costado a la ventana.\nNunca con la ventana atrás (contraluz): la persona queda oscura y el fondo quemado.\nNo mezcles luces de distinto color, por ejemplo la ventana (azulada) con una lámpara amarilla: la piel queda de dos colores. Si hay luz de ventana, apagá las lámparas.\nEl aro de luz sirve cuando no hay buena luz natural o es de noche. Ponelo de frente, un poco más arriba de los ojos.",
          bien: ["Ventana de frente o de costado.", "Una sola clase de luz.", "Aro de luz cuando falta luz natural."],
          mal: ["La persona con la ventana atrás.", "Lámpara amarilla y ventana al mismo tiempo.", "Filmar en un lugar oscuro y «arreglarlo» después."],
          ejercicio: "Filmá a alguien 5 segundos de espaldas a la ventana y 5 segundos mirando a la ventana. Compará.",
          checklist: ["Sé ubicar a la persona respecto de la ventana", "Reconozco un contraluz", "No mezclo luces de distinto color", "Sé cuándo usar el aro de luz"],
        },
        {
          id: "s2-encuadre",
          titulo: "Encuadre y planos",
          objetivo: "Elegir bien qué entra en cada toma y dejar lugar para los textos de Instagram.",
          explicacion:
            "Hay cuatro planos que vas a usar siempre: general (se ve todo el lugar), medio (la persona de la cintura para arriba), primer plano (la cara) y detalle (algo muy de cerca: unas manos, una etiqueta).\nRegla de tercios: imaginá la pantalla dividida en tres partes, a lo alto y a lo ancho. Poné lo importante sobre esas líneas, no siempre justo en el medio. Podés activar la cuadrícula en la cámara.\nZona segura de los Reels: arriba Instagram pone el nombre de la cuenta y abajo el texto y los botones. No dejes nada importante (cara, producto, cartel) ni muy arriba ni muy abajo.",
          bien: ["Variar planos: general, medio, primer plano y detalle.", "Cuadrícula activada.", "Lo importante en el centro alto de la pantalla, lejos de los bordes."],
          mal: ["Toda la toma en el mismo plano.", "La cabeza cortada arriba o con mucho aire.", "El producto abajo de todo, donde lo tapa el texto."],
          ejercicio: "Filmá a una persona en los cuatro planos: general, medio, primer plano y detalle de las manos.",
          checklist: ["Conozco los cuatro planos", "Activé la cuadrícula", "Sé cuál es la zona segura de los Reels"],
        },
        {
          id: "s2-recurso",
          titulo: "Tomas de recurso (B-roll)",
          objetivo: "Filmar las tomas que le dan ritmo al video y lo hacen fácil de editar.",
          explicacion:
            "Las tomas de recurso (B-roll) son las imágenes que acompañan a lo que se dice: manos trabajando, productos, detalles, gente moviéndose.\nCada toma tiene que durar al menos 10 segundos: en la edición se usan 2 o 3, pero necesitamos margen para elegir.\nFilmá el mismo momento en tres planos distintos, por ejemplo: alguien sirviendo un café en plano medio, en primer plano y en detalle de la taza. Así la editora puede cortar sin que se note.",
          bien: ["Mínimo 10 segundos por toma.", "Cosas en movimiento: manos, vapor, gente.", "El mismo momento en tres planos."],
          mal: ["Tomas de 2 segundos.", "Todo quieto y sin vida.", "Una sola toma de cada cosa."],
          ejercicio: "Filmá alguien haciendo algo con las manos (cocinar, escribir, armar algo) en tres planos, 10 segundos cada uno.",
          checklist: ["Sé qué es una toma de recurso", "Cada toma dura 10 segundos o más", "Filmo el mismo momento en tres planos"],
        },
        {
          id: "s2-audio",
          titulo: "Audio",
          objetivo: "Que se escuche clara la voz de quien habla, sin ruido ni eco.",
          explicacion:
            "La gente perdona una imagen regular, pero no un audio malo. Cuando alguien habla a cámara, usá el micrófono corbatero inalámbrico para celular.\nPonelo en el pecho, a un palmo de la boca, y que no roce con la ropa ni el pelo.\nPedí silencio: apagá ventiladores, aire, música y cerrá ventanas que den a la calle.\nAntes de grabar, hacé una prueba de 5 segundos y escuchala con auriculares. Si suena mal, se arregla ahora, no después.",
          bien: ["Corbatero a un palmo de la boca.", "Lugar en silencio.", "Probar y escuchar con auriculares antes de grabar."],
          mal: ["Grabar con el micrófono del celular lejos de la persona.", "El micrófono rozando la ropa.", "Darte cuenta en la edición de que no se escucha."],
          ejercicio: "Grabá a alguien hablando 10 segundos con el corbatero y 10 sin el corbatero, a dos metros. Escuchá la diferencia con auriculares.",
          checklist: ["Sé conectar y poner el corbatero", "Pido silencio antes de grabar", "Pruebo el audio con auriculares"],
        },
      ],
      ejercicio: {
        titulo: "Ejercicio de la semana 2",
        consigna: "Una persona hablando 20 segundos a cámara con buena luz y audio limpio, más 5 tomas de recurso.",
        pasos: ["Ubicá a la persona de frente o de costado a una ventana.", "Ponele el corbatero y probá el audio con auriculares.", "Filmala en plano medio contando qué hace (20 segundos), mirando a la lente.", "Filmá 5 tomas de recurso de 10 segundos que acompañen lo que dice.", "Subí todo acá."],
      },
      cuestionario: [
        P("¿Dónde ponés a la persona respecto de la ventana?", ["De espaldas a la ventana", "De frente o de costado a la ventana", "Lejos de la ventana"], 1),
        P("Hay luz de ventana y una lámpara amarilla prendida. ¿Qué hacés?", ["Dejo las dos", "Apago la lámpara", "Cierro la ventana"], 1),
        P("¿Qué es la zona segura de un Reel?", ["El centro de la pantalla, lejos de donde Instagram pone sus textos", "El borde de abajo", "Cualquier lugar"], 0),
        P("¿Cuánto tiene que durar como mínimo una toma de recurso?", ["2 segundos", "5 segundos", "10 segundos"], 2),
        P("¿Cuándo probás el audio?", ["En la edición", "Antes de grabar, con auriculares", "No hace falta"], 1),
      ],
    },
    {
      id: "s3",
      titulo: "Semana 3 · El rodaje",
      subtitulo: "Qué hacer antes, durante y después de filmar con un cliente.",
      lecciones: [
        {
          id: "s3-antes",
          video: "/academia/antes-del-rodaje.mp4",
          titulo: "Antes del rodaje",
          objetivo: "Llegar preparada para filmar todo sin olvidarte de nada.",
          explicacion:
            "El día antes, leé el guion y la lista de tomas. Tenés que saber qué se dice y qué se filma.\nRevisá el equipo con el checklist: celular, trípode, gimbal, corbatero, batería externa y memoria libre.\nLlegá 15 minutos antes: para conocer el lugar, ver la luz y armar el equipo sin apuro.",
          bien: ["Guion y lista de tomas leídos el día antes.", "Equipo revisado y cargado.", "Llegar 15 minutos antes."],
          mal: ["Leer el guion en el auto.", "Descubrir en el lugar que el corbatero no tiene batería.", "Llegar justo y armar todo a las corridas."],
          ejercicio: "Armá tu propio checklist de equipo y sacale una foto a todo tu equipo junto.",
          checklist: ["Leo el guion y la lista de tomas antes", "Reviso el equipo con el checklist", "Llego 15 minutos antes"],
        },
        {
          id: "s3-durante",
          titulo: "Durante el rodaje",
          objetivo: "Filmar todo lo que pide la lista y que la persona que habla se sienta cómoda.",
          explicacion:
            "Filmá todo lo que está en la lista de tomas y cada toma dos veces: si una falla, tenés la otra.\nA quien habla a cámara, dirigilo con frases cortas: «mirá a la lente», «más despacio», «arrancamos de nuevo desde…». Si se traba, no pasa nada: se repite la frase.\nCuidá que el cliente se sienta cómodo: hablale con calma, decile qué vas a hacer y felicitalo cuando sale bien. Si está nervioso, se nota en el video.",
          bien: ["Cada toma dos veces.", "Indicaciones cortas y amables.", "Tachar la lista a medida que filmás."],
          mal: ["Irte sin una toma de la lista.", "Dar indicaciones largas y confusas.", "Apurar o retar al cliente."],
          ejercicio: "Pedile a alguien que te cuente qué hace en 15 segundos y dirigilo hasta que salga bien. Filmá todas las tomas.",
          checklist: ["Filmo cada toma dos veces", "Dirijo con frases cortas", "Repito si se traba", "Cuido que el cliente esté cómodo"],
        },
        {
          id: "s3-despues",
          video: "/academia/despues-del-rodaje.mp4",
          titulo: "Después del rodaje",
          objetivo: "Que nada de lo filmado se pierda y la editora lo encuentre fácil.",
          explicacion:
            "El mismo día del rodaje hacé el backup: subí todo a la carpeta del cliente en Drive.\nPonele nombres claros a los archivos: cliente_fecha_toma. Por ejemplo: vitasana_2026-11-05_toma03.mp4.\nNo borres nada del celular hasta confirmar que todo está subido y se abre.",
          bien: ["Backup el mismo día.", "Nombres cliente_fecha_toma.", "Borrar del celular solo cuando todo está en Drive."],
          mal: ["Dejar el backup para la semana que viene.", "Archivos con nombres como IMG_4587.", "Borrar el celular antes de subir."],
          ejercicio: "Renombrá 5 videos tuyos con el formato cliente_fecha_toma y subilos a una carpeta.",
          checklist: ["Hago el backup el mismo día", "Uso nombres cliente_fecha_toma", "Reviso que todo esté subido antes de borrar"],
        },
        {
          id: "s3-reglas",
          titulo: "Reglas de Prodi",
          objetivo: "Conocer lo que nunca se hace en Prodi, para cuidar a los clientes y a las personas.",
          explicacion:
            "Nada se publica sin la aprobación del cliente.\nNo se muestra nada que el cliente no haya autorizado (lugares, personas, precios, productos).\nSe muestra el estado real de cada producto: no se promete lo que no es.\nLas personas que aparecen en un video tienen que dar su permiso.\nNunca se usan personas ni manos generadas con inteligencia artificial.",
          bien: ["Preguntar antes de filmar a alguien.", "Mostrar el producto como es.", "Esperar la aprobación del cliente."],
          mal: ["Filmar a clientes del negocio sin permiso.", "Mostrar algo como terminado cuando no lo está.", "Usar manos o caras hechas con IA."],
          ejercicio: "Escribí con tus palabras las cinco reglas y un ejemplo de qué harías en un rodaje para cumplir cada una.",
          checklist: ["Nada se publica sin aprobación del cliente", "No muestro nada que no esté autorizado", "Muestro el estado real del producto", "Pido permiso a las personas", "Nunca uso personas ni manos de IA"],
        },
      ],
      ejercicio: {
        titulo: "Ejercicio de la semana 3",
        consigna: "Acompañar un rodaje real como asistente y entregar el backup ordenado.",
        pasos: ["Coordiná con Lucas a qué rodaje vas.", "Llevá el equipo revisado y llegá 15 minutos antes.", "Ayudá con la luz, el audio y la lista de tomas.", "Ese mismo día subí el backup con nombres cliente_fecha_toma.", "Subí acá una captura de la carpeta y contá en la nota cómo te fue."],
      },
      cuestionario: [
        P("¿Cuándo leés el guion y la lista de tomas?", ["En el lugar", "El día antes", "Después del rodaje"], 1),
        P("¿Cuántas veces filmás cada toma?", ["Una", "Dos", "Las que quiera el cliente"], 1),
        P("La persona se traba hablando. ¿Qué hacés?", ["Seguís igual", "Le pedís con calma repetir la frase", "Cortás el rodaje"], 1),
        P("¿Cómo se llama bien un archivo?", ["IMG_4587.mp4", "video final final.mp4", "cliente_fecha_toma.mp4"], 2),
        P("¿Se pueden usar manos generadas con IA si quedan bien?", ["Sí", "No, nunca", "Solo si el cliente no se da cuenta"], 1),
      ],
    },
    {
      id: "s4",
      titulo: "Semana 4 · Edición en CapCut",
      subtitulo: "Armar un Reel con ritmo, subtítulos y listo para entregar.",
      lecciones: [
        {
          id: "s4-proyecto",
          titulo: "Proyecto nuevo en 9:16",
          objetivo: "Armar la base del Reel: ordenar las tomas y sacar lo que sobra.",
          explicacion:
            "En CapCut tocá «Nuevo proyecto», elegí los videos y fijate que el formato sea 9:16 (vertical).\nOrdená las tomas como dice el guion.\nCortá los silencios, los errores y las partes donde la persona se traba. Un Reel no tiene «aire»: cada segundo tiene que aportar algo.",
          bien: ["Formato 9:16.", "Tomas en el orden del guion.", "Sin silencios ni errores."],
          mal: ["Formato horizontal con bandas negras.", "Dejar los «eeeh» y las pausas.", "Tomas en cualquier orden."],
          ejercicio: "Importá 5 tomas, ordenalas y cortá los silencios. Exportá un borrador.",
          checklist: ["Sé crear un proyecto 9:16", "Sé cortar y ordenar clips", "Saco silencios y errores"],
        },
        {
          id: "s4-ritmo",
          video: "/academia/edicion-que-vende.mp4",
          titulo: "Ritmo",
          objetivo: "Que la gente no pase de largo el video y llegue hasta el final.",
          explicacion:
            "Los primeros 2 segundos son los más importantes: ahí va el gancho, algo que haga que la persona se quede (una pregunta, un dato, algo que llame la atención).\nCambiá de plano cada 2 o 3 segundos: así el video se siente dinámico.\nTerminá con un llamado a la acción: decí qué tiene que hacer quien mira («escribinos por WhatsApp», «pedí el tuyo»).",
          bien: ["Gancho en los primeros 2 segundos.", "Cambio de plano cada 2 o 3 segundos.", "Cierre con llamado a la acción."],
          mal: ["Arrancar con el logo o un saludo largo.", "Una toma de 10 segundos sin cortes.", "Terminar sin decir qué hacer."],
          ejercicio: "Rearmá tu borrador: buscá un gancho para el inicio y un cierre con llamado a la acción.",
          checklist: ["El video arranca con un gancho", "Cambio de plano cada 2 o 3 segundos", "Termina con un llamado a la acción"],
        },
        {
          id: "s4-subtitulos",
          titulo: "Subtítulos",
          objetivo: "Que el video se entienda aunque se mire sin sonido.",
          explicacion:
            "Mucha gente mira los Reels sin sonido: los subtítulos son obligatorios.\nUsá los subtítulos automáticos de CapCut, pero revisalos siempre palabra por palabra: se equivocan seguido con nombres y marcas.\nPonelos dentro de la zona segura (ni muy arriba ni muy abajo), con textos cortos y una letra que se lea bien.",
          bien: ["Subtítulos revisados y corregidos.", "Dentro de la zona segura.", "Pocas palabras por vez, letra legible."],
          mal: ["Subtítulos automáticos sin revisar.", "Texto abajo de todo, tapado por Instagram.", "Frases larguísimas en letra chica."],
          ejercicio: "Poné subtítulos automáticos a tu borrador y corregí todos los errores.",
          checklist: ["Sé generar subtítulos automáticos", "Los reviso y corrijo", "Quedan dentro de la zona segura"],
        },
        {
          id: "s4-color-exportar",
          titulo: "Color y exportar",
          objetivo: "Entregar un video parejo y en el formato correcto.",
          explicacion:
            "Ajustá el color de forma simple: que todos los clips se vean parecidos (ni uno más oscuro ni uno más naranja). No uses filtros exagerados.\nExportá en 1080x1920 (1080p) a 30 fps.\nNo pongas música ni efectos de sonido: la música la pone Lucas al final.",
          bien: ["Clips parejos de color.", "Exportar 1080p a 30 fps.", "Sin música ni efectos."],
          mal: ["Un filtro distinto en cada clip.", "Exportar en 720p.", "Poner música de moda."],
          ejercicio: "Emparejá el color de tu borrador y exportalo en 1080p a 30 fps, sin música.",
          checklist: ["Los clips quedan parejos de color", "Exporto en 1080p a 30 fps", "No pongo música ni efectos"],
        },
      ],
      ejercicio: {
        titulo: "Ejercicio de la semana 4",
        consigna: "Editar un Reel de 20 a 30 segundos con material real de Prodi. Lucas lo corrige con marcas en el video.",
        pasos: ["Pedile a Lucas el material.", "Armá el proyecto 9:16 y cortá silencios y errores.", "Gancho al inicio, cambio de plano cada 2 o 3 segundos y llamado a la acción al final.", "Subtítulos revisados dentro de la zona segura.", "Exportá en 1080p a 30 fps, sin música, y subilo acá."],
      },
      cuestionario: [
        P("¿En qué formato se arma el proyecto?", ["16:9", "9:16", "1:1"], 1),
        P("¿Qué va en los primeros 2 segundos?", ["El logo", "Un gancho", "Un saludo"], 1),
        P("¿Cada cuánto cambiás de plano?", ["Cada 2 o 3 segundos", "Cada 10 segundos", "Nunca"], 0),
        P("Los subtítulos automáticos…", ["Se usan tal cual salen", "Se revisan y corrigen siempre", "No hacen falta"], 1),
        P("¿Quién pone la música?", ["Vos, la que más te guste", "Lucas, al final", "El cliente"], 1),
      ],
    },
  ],
  examen: {
    titulo: "Examen final",
    consigna: "Con un guion que te da Lucas: planificar las tomas, filmar con el celular y editar un Reel completo. Si Lucas lo aprueba, se te habilita el rol de productora.",
    pasos: ["Pedile el guion a Lucas.", "Escribí la lista de tomas (planos y recursos).", "Filmá con todo lo que aprendiste: luz, encuadre, audio y estabilidad.", "Editalo en CapCut con gancho, ritmo, subtítulos y llamado a la acción.", "Subí el Reel terminado y la lista de tomas acá."],
  },
  glosario: [
    { termino: "Plano", definicion: "Cuánto se ve en la toma: general (todo el lugar), medio (de la cintura para arriba), primer plano (la cara) y detalle (algo muy de cerca)." },
    { termino: "B-roll (toma de recurso)", definicion: "Imágenes que acompañan lo que se dice: manos, productos, detalles, movimiento." },
    { termino: "Gancho", definicion: "Lo que pasa en los primeros 2 segundos para que la gente no pase de largo el video." },
    { termino: "Zona segura", definicion: "La parte del centro de la pantalla que Instagram no tapa con su nombre, textos y botones." },
    { termino: "fps", definicion: "Cuadros por segundo. En Prodi filmamos y exportamos a 30 fps." },
    { termino: "Exposición", definicion: "Cuánta luz tiene la imagen. Muy poca: oscura. Mucha: quemada (blanca). Se bloquea manteniendo apretado el dedo en la pantalla." },
    { termino: "Llamado a la acción", definicion: "Lo que le pedimos a quien mira al final: «escribinos», «pedí el tuyo»." },
    { termino: "Pauta", definicion: "Publicidad paga en Meta (Instagram y Facebook) para que el video le llegue a más gente." },
  ],
};

export const RECORRIDOS_BASE: Recorrido[] = [NIVEL_1];

/** Los recorridos con lo guardado por el admin encima del contenido base (y los nuevos que haya creado). */
export function useRecorridos(): Recorrido[] {
  const [guardados, setGuardados] = useState<Recorrido[]>([]);
  useEffect(
    () =>
      onSnapshot(
        collection(db, "academia_recorridos"),
        (s) => setGuardados(s.docs.map((d) => ({ ...(d.data() as Recorrido), id: d.id }))),
        () => setGuardados([])
      ),
    []
  );
  const porId = new Map(guardados.map((r) => [r.id, r]));
  const base = RECORRIDOS_BASE.map((r) => porId.get(r.id) ?? r);
  return [...base, ...guardados.filter((r) => !RECORRIDOS_BASE.some((b) => b.id === r.id))];
}

export async function guardarRecorrido(r: Recorrido) {
  await setDoc(doc(db, "academia_recorridos", r.id), { ...r, actualizado_at: new Date().toISOString() });
}

/** Las entregas de una persona (o, sin uid, las de todos: solo el admin). */
export function useEntregas(uid: string | undefined | null, todas = false) {
  const [lista, setLista] = useState<EntregaAcademia[] | null>(null);
  useEffect(() => {
    if (!uid && !todas) return;
    const q = todas ? collection(db, "academia_entregas") : query(collection(db, "academia_entregas"), where("uid", "==", uid));
    return onSnapshot(
      q,
      (s) => setLista(s.docs.map((d) => ({ ...(d.data() as EntregaAcademia), id: d.id }))),
      () => setLista([])
    );
  }, [uid, todas]);
  return lista;
}

// ---------------------------------------------------------------------------
// Avance
// ---------------------------------------------------------------------------

export type ProgresoRecorrido = ProgresoAcademia & {
  /** Lo tildado de cada lección (índices del checklist). */
  checklist?: Record<string, number[]>;
  /** Cuestionario de cada módulo: el mejor resultado. */
  cuestionarios?: Record<string, { aciertos: number; total: number; at: string }>;
};

export const leccionHecha = (l: LeccionRecorrido, p: ProgresoRecorrido | null | undefined) =>
  !!p?.completadas?.[l.id] || (l.checklist.length > 0 && (p?.checklist?.[l.id]?.length ?? 0) >= l.checklist.length);

export const cuestionarioAprobado = (m: ModuloRecorrido, p: ProgresoRecorrido | null | undefined) =>
  !m.cuestionario.length || (p?.cuestionarios?.[m.id]?.aciertos ?? 0) >= Math.min(APRUEBA_CUESTIONARIO, m.cuestionario.length);

export const entregaDe = (entregas: EntregaAcademia[] | null | undefined, itemId: string) => entregas?.find((e) => e.item_id === itemId) ?? null;

/** Un módulo está aprobado con el ejercicio de la semana aprobado y el cuestionario aprobado. */
export const moduloAprobado = (m: ModuloRecorrido, p: ProgresoRecorrido | null | undefined, entregas: EntregaAcademia[] | null | undefined) =>
  entregaDe(entregas, idEjercicioModulo(m.id))?.estado === "aprobada" && cuestionarioAprobado(m, p);

/** Se abre el primero y cada uno cuando el anterior está aprobado. El examen, con todos aprobados. */
export function abiertos(r: Recorrido, p: ProgresoRecorrido | null | undefined, entregas: EntregaAcademia[] | null | undefined) {
  const modulos = r.modulos.map((_, i) => i === 0 || moduloAprobado(r.modulos[i - 1], p, entregas));
  const examen = r.modulos.every((m) => moduloAprobado(m, p, entregas));
  return { modulos, examen };
}

/** Avance de un módulo: lecciones hechas + cuestionario + ejercicio. */
export function avanceModulo(m: ModuloRecorrido, p: ProgresoRecorrido | null | undefined, entregas: EntregaAcademia[] | null | undefined) {
  const total = m.lecciones.length + 2;
  const hechas = m.lecciones.filter((l) => leccionHecha(l, p)).length + Number(cuestionarioAprobado(m, p) && m.cuestionario.length > 0) + Number(entregaDe(entregas, idEjercicioModulo(m.id))?.estado === "aprobada");
  return { hechas, total, aprobado: moduloAprobado(m, p, entregas) };
}

export function avanceRecorrido(r: Recorrido, p: ProgresoRecorrido | null | undefined, entregas: EntregaAcademia[] | null | undefined) {
  const aprobados = r.modulos.filter((m) => moduloAprobado(m, p, entregas)).length;
  const examen = entregaDe(entregas, ID_EXAMEN)?.estado === "aprobada";
  return { aprobados, total: r.modulos.length, examen, completo: aprobados === r.modulos.length && examen };
}

export async function tildarChecklist(uid: string, leccionId: string, marcados: number[]) {
  const at = new Date().toISOString();
  await setDoc(doc(db, "academia", uid), { checklist: { [leccionId]: marcados }, actualizado_at: at }, { merge: true });
}

export async function guardarCuestionario(uid: string, moduloId: string, aciertos: number, total: number) {
  const at = new Date().toISOString();
  await setDoc(doc(db, "academia", uid), { cuestionarios: { [moduloId]: { aciertos, total, at } }, actualizado_at: at }, { merge: true });
}

/** Crea (o deja como está) la entrega de un ítem, para poder subirle archivos. */
export async function prepararEntrega(uid: string, nombre: string, recorrido: Recorrido, moduloId: string | null, itemId: string, itemTitulo: string, actual: EntregaAcademia | null) {
  const id = idEntrega(uid, itemId);
  if (actual) return id;
  const at = new Date().toISOString();
  await setDoc(doc(db, "academia_entregas", id), {
    uid,
    nombre,
    recorrido_id: recorrido.id,
    modulo_id: moduloId,
    item_id: itemId,
    item_titulo: itemTitulo,
    estado: "borrador",
    attachments_crudo: [],
    created_at: at,
    updated_at: at,
  });
  return id;
}

export const ESTADO_ENTREGA: Record<EntregaAcademia["estado"], { label: string; clase: string }> = {
  borrador: { label: "Sin mandar", clase: "bg-muted text-muted-foreground" },
  enviada: { label: "En revisión", clase: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
  a_corregir: { label: "Con correcciones", clase: "bg-orange-500/15 text-orange-700 dark:text-orange-300" },
  aprobada: { label: "Aprobado", clase: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
};

/** El último video subido (el que se corrige con marcas). */
export const ultimoVideo = (e: EntregaAcademia | null | undefined) => [...(e?.attachments_crudo ?? [])].reverse().find((a) => a.mime_type?.startsWith("video/")) ?? null;

/** Dónde abrir un ítem a partir de una entrega (para los links de los avisos). */
export function ubicarItem(r: Recorrido, itemId: string): { modulo: string | null; leccion: string | null; examen: boolean } {
  if (itemId === ID_EXAMEN) return { modulo: null, leccion: null, examen: true };
  for (const m of r.modulos) {
    if (itemId === idEjercicioModulo(m.id)) return { modulo: m.id, leccion: null, examen: false };
    if (m.lecciones.some((l) => l.id === itemId)) return { modulo: m.id, leccion: itemId, examen: false };
  }
  return { modulo: null, leccion: null, examen: false };
}

export type { DriveAttachmentRef };

export interface ProximoPaso {
  tipo: "leccion" | "ejercicio" | "cuestionario" | "examen";
  modulo: ModuloRecorrido | null;
  leccion: LeccionRecorrido | null;
  /** Lucas pidió correcciones. */
  corregir: boolean;
  /** Ya mandó todo: le toca a Lucas revisar. */
  espera: boolean;
}

/** Lo que le toca hacer ahora. Primero las correcciones. Sin nada pendiente (recorrido terminado), null. */
export function proximoPaso(r: Recorrido, p: ProgresoRecorrido | null | undefined, entregas: EntregaAcademia[] | null | undefined): ProximoPaso | null {
  const paso = (tipo: ProximoPaso["tipo"], modulo: ModuloRecorrido | null, extra: Partial<ProximoPaso> = {}): ProximoPaso => ({ tipo, modulo, leccion: null, corregir: false, espera: false, ...extra });
  for (const m of r.modulos) {
    if (moduloAprobado(m, p, entregas)) continue;
    const estado = entregaDe(entregas, idEjercicioModulo(m.id))?.estado;
    if (estado === "a_corregir") return paso("ejercicio", m, { corregir: true });
    const leccion = m.lecciones.find((l) => !leccionHecha(l, p));
    if (leccion) return paso("leccion", m, { leccion });
    if (estado !== "enviada" && estado !== "aprobada") return paso("ejercicio", m);
    if (!cuestionarioAprobado(m, p)) return paso("cuestionario", m);
    return paso("ejercicio", m, { espera: true });
  }
  const examen = entregaDe(entregas, ID_EXAMEN)?.estado;
  if (examen === "aprobada") return null;
  return paso("examen", null, { corregir: examen === "a_corregir", espera: examen === "enviada" });
}
