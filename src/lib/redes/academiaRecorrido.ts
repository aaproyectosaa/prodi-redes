import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, setDoc } from "@/lib/db";
import { db } from "@/integrations/firebase/client";
import type { ProgresoAcademia } from "@/lib/redes/academia";

// Recorridos de la Academia: formación teórica por semanas para gente nueva (ej. "Productora Prodi · Nivel 1").
// El contenido vive en academia_recorridos/{id} y lo edita el admin desde la Academia; mientras no se guardó, se usa el de
// acá (RECORRIDOS_BASE). Todo se hace y se corrige dentro de la app: cada lección tiene video, explicación y ejercicios, y
// cada semana un repaso. La semana siguiente se abre con las lecciones hechas y el repaso aprobado. La práctica de verdad
// (filmar, ir a un rodaje) viene después, en el trabajo.

export interface LeccionRecorrido {
  id: string;
  titulo: string;
  objetivo: string;
  /** Explicación corta: un párrafo por línea. */
  explicacion: string;
  bien: string[];
  mal: string[];
  /** Ejercicios de la lección: si sale mal, se vuelve a intentar. */
  ejercicios?: PreguntaRecorrido[];
  /** Video propio (link de YouTube, de Drive o un .mp4). */
  video?: string;
}
/** Elegir una opción (con ___ en el texto, completar la frase), ordenar pasos o unir pares. */
export interface PreguntaRecorrido {
  texto: string;
  opciones: string[];
  correcta: number;
  porque?: string;
  /** Pasos en el orden correcto. */
  ordenar?: string[];
  /** Pares que van juntos. */
  unir?: [string, string][];
}
export interface ModuloRecorrido {
  id: string;
  titulo: string;
  subtitulo: string;
  lecciones: LeccionRecorrido[];
  /** Repaso de la semana. */
  cuestionario: PreguntaRecorrido[];
}
export interface ExamenRecorrido {
  titulo: string;
  consigna: string;
  preguntas: PreguntaRecorrido[];
}
export interface Recorrido {
  id: string;
  titulo: string;
  descripcion: string;
  /** Quiénes lo hacen (el admin los ve todos). */
  roles: string[];
  modulos: ModuloRecorrido[];
  examen: ExamenRecorrido;
  glosario: { termino: string; definicion: string }[];
  actualizado_at?: string;
}

/** Se aprueba con el 80 % bien (4 de 5, 16 de 20). */
export const minimoParaAprobar = (total: number) => Math.ceil(total * 0.8);
export const ID_EXAMEN = "examen";

const P = (texto: string, opciones: string[], correcta: number, porque?: string): PreguntaRecorrido => ({ texto, opciones, correcta, porque });
const O = (texto: string, ordenar: string[]): PreguntaRecorrido => ({ texto, opciones: [], correcta: 0, ordenar });
const U = (texto: string, unir: [string, string][]): PreguntaRecorrido => ({ texto, opciones: [], correcta: 0, unir });

export const NIVEL_1: Recorrido = {
  id: "productora-nivel-1",
  titulo: "Productora Prodi · Nivel 1",
  descripcion: "4 semanas para entender cómo se filman y se editan videos que venden, con videos cortos y ejercicios. Sin experiencia previa.",
  roles: ["formacion"],
  modulos: [
    {
      id: "s1",
      titulo: "Semana 1 · Cómo trabaja Prodi y el celular",
      subtitulo: "Qué hacemos, el camino de un video y cómo dejar el celular listo para filmar.",
      lecciones: [
        {
          id: "s1-que-hace-prodi",
          ejercicios: [
            O("Ordená el camino de un video", ["Guion", "Rodaje", "Edición", "El cliente lo aprueba", "Se publica", "Se pauta"]),
            P("Los videos de Prodi son para que al negocio le ___.", ["escriban y le compren", "pongan muchos likes", "sigan en Instagram"], 0, "No buscamos likes: buscamos que le escriban y le compren."),
          ],
          video: "/academia/como-trabaja-prodi.mp4",
          titulo: "Qué hace Prodi",
          objetivo: "Entender para qué sirve cada video que filmás y el camino que hace hasta que se publica.",
          explicacion:
            "Prodi hace videos comerciales para negocios. No son videos para tener likes: son videos que pautamos en Meta (Instagram y Facebook) para que al negocio le escriban y le compren.\nNo hacemos community management: no respondemos mensajes ni manejamos las redes del día a día del cliente.\nCada video hace siempre el mismo camino: guion → rodaje → edición → el cliente lo aprueba en su panel → se publica → se pauta.\nVos vas a estar en el rodaje: si filmás bien, todo lo que viene después sale mejor y más rápido.",
          bien: ["Pensar en quién va a ver el video y qué tiene que hacer después (escribir, comprar).", "Seguir el guion y la lista de tomas.", "Saber en qué etapa está cada video."],
          mal: ["Filmar «lo que salga» sin guion.", "Pensar que el objetivo es que el video sea lindo o tenga likes.", "Prometerle al cliente que le contestamos los mensajes."],
        },
        {
          id: "s1-preparar-celular",
          ejercicios: [
            U("Uní cada cosa con para qué sirve", [["Limpiar la lente", "La imagen no sale borrosa"], ["Modo avión", "Nada corta la toma"], ["Brillo al máximo", "Ves bien lo que filmás"], ["20 GB libres", "No te quedás sin memoria"]]),
            P("Antes de filmar, dejá al menos ___ libres.", ["2 GB", "20 GB", "200 GB"], 1),
          ],
          video: "/academia/preparar-celular.mp4",
          titulo: "Preparar el celular",
          objetivo: "Llegar a cada rodaje con el celular listo para no perder tomas ni tiempo.",
          explicacion:
            "Antes de filmar, el celular tiene que estar preparado. Son cinco cosas y te llevan dos minutos.\nLimpiá la lente con un paño: una huella deja la imagen borrosa y no se arregla después.\nDejá memoria libre (al menos 20 GB) y la batería cargada. Llevá batería externa.\nPoné modo avión o no molestar: una llamada en medio de una toma la arruina.\nSubí el brillo de la pantalla al máximo para ver bien lo que filmás, sobre todo afuera.",
          bien: ["Lente limpia antes de cada toma importante.", "Celular en modo avión durante el rodaje.", "Batería al 100 % y batería externa en la mochila."],
          mal: ["Filmar con la lente sucia.", "Quedarte sin memoria en medio del rodaje.", "Que suene una notificación mientras alguien habla."],
        },
        {
          id: "s1-configuracion",
          ejercicios: [
            P("En Prodi filmamos a ___ cuadros por segundo.", ["24", "30", "60"], 1),
            P("Necesitás estar más cerca de un producto. ¿Qué hacés?", ["Pellizco la pantalla y hago zoom", "Me acerco caminando", "Filmo igual y se arregla en edición"], 1, "El zoom digital pixela la imagen."),
          ],
          video: "/academia/configuracion-camara.mp4",
          titulo: "Configuración de la cámara",
          objetivo: "Que todo lo que filmes salga en el formato y la calidad que usamos en Prodi.",
          explicacion:
            "Siempre filmamos en vertical: los Reels se ven con el celular parado.\nConfigurá la cámara en 1080x1920 (1080p) o en 4K, siempre a 30 fps (cuadros por segundo).\nUsá la lente principal (la de 1x). Nunca uses el zoom digital (pellizcar la pantalla): la imagen se pixela. Si necesitás estar más cerca, acercate caminando.\nBloqueá la exposición y el foco: mantené apretado el dedo sobre lo que filmás hasta que aparezca «Bloqueo AE/AF» (o un candado). Así la luz y el foco no cambian solos en medio de la toma.",
          bien: ["Celular vertical.", "1080p o 4K a 30 fps.", "Lente 1x y acercarte caminando.", "Exposición y foco bloqueados."],
          mal: ["Filmar acostado (horizontal).", "Usar zoom digital.", "Dejar que el foco «respire» y la imagen se oscurezca y aclare sola."],
        },
        {
          id: "s1-estabilidad",
          ejercicios: [
            U("¿Qué usás en cada caso?", [["Alguien hablando a cámara", "Trípode"], ["Seguir algo en movimiento", "Gimbal"], ["Filmar a mano", "Dos manos y codos pegados"]]),
            P("Cuando caminás filmando, andá como si llevaras ___.", ["un vaso lleno", "mucho apuro", "el celular en una mano"], 0),
          ],
          video: "/academia/estabilidad.mp4",
          titulo: "Estabilidad",
          objetivo: "Que tus tomas se vean firmes y profesionales, sin temblores.",
          explicacion:
            "Una imagen que tiembla se ve casera y cansa. Para que salga firme:\nAgarrá el celular con las dos manos y pegá los codos al cuerpo.\nMovete despacio: si caminás, hacelo con las rodillas un poco flexionadas, como si llevaras un vaso lleno.\nCuando la toma es fija (alguien hablando, un producto), usá trípode. Para seguir algo en movimiento, usá el gimbal.",
          bien: ["Dos manos y codos pegados.", "Movimientos lentos y continuos.", "Trípode para tomas fijas, gimbal para movimiento."],
          mal: ["Filmar con una sola mano.", "Movimientos rápidos o bruscos.", "Caminar normal mientras filmás."],
        },
      ],
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
          ejercicios: [
            P("Una persona va a hablar a cámara en un local. ¿Dónde la ponés?", ["De espaldas a la ventana", "De frente o de costado a la ventana", "Abajo de una lámpara amarilla"], 1, "Con la ventana atrás queda a contraluz: oscura y con el fondo quemado."),
            P("Hay luz de ventana y una lámpara amarilla prendida. ¿Qué hacés?", ["Dejo las dos", "Apago la lámpara", "Cierro la ventana"], 1, "Si mezclás luces, la piel queda de dos colores."),
          ],
          video: "/academia/filmar-con-celular.mp4",
          titulo: "Luz natural",
          objetivo: "Aprovechar la luz de una ventana para que la imagen se vea limpia y clara.",
          explicacion:
            "La mejor luz es gratis: una ventana. Poné a la persona o al producto de frente o de costado a la ventana.\nNunca con la ventana atrás (contraluz): la persona queda oscura y el fondo quemado.\nNo mezcles luces de distinto color, por ejemplo la ventana (azulada) con una lámpara amarilla: la piel queda de dos colores. Si hay luz de ventana, apagá las lámparas.\nEl aro de luz sirve cuando no hay buena luz natural o es de noche. Ponelo de frente, un poco más arriba de los ojos.",
          bien: ["Ventana de frente o de costado.", "Una sola clase de luz.", "Aro de luz cuando falta luz natural."],
          mal: ["La persona con la ventana atrás.", "Lámpara amarilla y ventana al mismo tiempo.", "Filmar en un lugar oscuro y «arreglarlo» después."],
        },
        {
          id: "s2-encuadre",
          ejercicios: [
            U("Uní cada plano con lo que muestra", [["General", "Todo el lugar"], ["Medio", "De la cintura para arriba"], ["Primer plano", "La cara"], ["Detalle", "Algo muy de cerca"]]),
            P("En un Reel, ¿dónde no tiene que quedar la cara?", ["Muy arriba ni muy abajo", "Sobre una línea de tercios", "Cerca del centro"], 0, "Ahí Instagram pone el nombre, el texto y los botones."),
          ],
          video: "/academia/encuadre-planos.mp4",
          titulo: "Encuadre y planos",
          objetivo: "Elegir bien qué entra en cada toma y dejar lugar para los textos de Instagram.",
          explicacion:
            "Hay cuatro planos que vas a usar siempre: general (se ve todo el lugar), medio (la persona de la cintura para arriba), primer plano (la cara) y detalle (algo muy de cerca: unas manos, una etiqueta).\nRegla de tercios: imaginá la pantalla dividida en tres partes, a lo alto y a lo ancho. Poné lo importante sobre esas líneas, no siempre justo en el medio. Podés activar la cuadrícula en la cámara.\nZona segura de los Reels: arriba Instagram pone el nombre de la cuenta y abajo el texto y los botones. No dejes nada importante (cara, producto, cartel) ni muy arriba ni muy abajo.",
          bien: ["Variar planos: general, medio, primer plano y detalle.", "Cuadrícula activada.", "Lo importante en el centro alto de la pantalla, lejos de los bordes."],
          mal: ["Toda la toma en el mismo plano.", "La cabeza cortada arriba o con mucho aire.", "El producto abajo de todo, donde lo tapa el texto."],
        },
        {
          id: "s2-recurso",
          ejercicios: [
            P("Cada toma de recurso tiene que durar al menos ___ segundos.", ["3", "10", "60"], 1, "En la edición se usan 2 o 3, pero hace falta margen para elegir."),
            O("Ordená del plano más abierto al más cerrado", ["Plano medio de alguien sirviendo un café", "Primer plano", "Detalle de la taza"]),
          ],
          video: "/academia/tomas-recurso.mp4",
          titulo: "Tomas de recurso (B-roll)",
          objetivo: "Filmar las tomas que le dan ritmo al video y lo hacen fácil de editar.",
          explicacion:
            "Las tomas de recurso (B-roll) son las imágenes que acompañan a lo que se dice: manos trabajando, productos, detalles, gente moviéndose.\nCada toma tiene que durar al menos 10 segundos: en la edición se usan 2 o 3, pero necesitamos margen para elegir.\nFilmá el mismo momento en tres planos distintos, por ejemplo: alguien sirviendo un café en plano medio, en primer plano y en detalle de la taza. Así la editora puede cortar sin que se note.",
          bien: ["Mínimo 10 segundos por toma.", "Cosas en movimiento: manos, vapor, gente.", "El mismo momento en tres planos."],
          mal: ["Tomas de 2 segundos.", "Todo quieto y sin vida.", "Una sola toma de cada cosa."],
        },
        {
          id: "s2-audio",
          ejercicios: [
            O("Ordená lo que hacés antes de grabar a alguien hablando", ["Le ponés el corbatero en el pecho", "Pedís silencio y apagás lo que hace ruido", "Grabás 5 segundos de prueba", "La escuchás con auriculares", "Recién ahí, grabás"]),
            P("El aire acondicionado hace ruido. ¿Qué hacés?", ["Lo apago mientras grabamos", "Lo arreglo en la edición", "Le pido que hable más fuerte"], 0),
          ],
          video: "/academia/audio.mp4",
          titulo: "Audio",
          objetivo: "Que se escuche clara la voz de quien habla, sin ruido ni eco.",
          explicacion:
            "La gente perdona una imagen regular, pero no un audio malo. Cuando alguien habla a cámara, usá el micrófono corbatero inalámbrico para celular.\nPonelo en el pecho, a un palmo de la boca, y que no roce con la ropa ni el pelo.\nPedí silencio: apagá ventiladores, aire, música y cerrá ventanas que den a la calle.\nAntes de grabar, hacé una prueba de 5 segundos y escuchala con auriculares. Si suena mal, se arregla ahora, no después.",
          bien: ["Corbatero a un palmo de la boca.", "Lugar en silencio.", "Probar y escuchar con auriculares antes de grabar."],
          mal: ["Grabar con el micrófono del celular lejos de la persona.", "El micrófono rozando la ropa.", "Darte cuenta en la edición de que no se escucha."],
        },
      ],
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
          ejercicios: [
            O("Ordená lo que hacés antes de un rodaje", ["El día antes, leés el guion y la lista de tomas", "Revisás el equipo", "Llegás 15 minutos antes", "Ves la luz y armás el equipo"]),
            P("Llegá ___ antes, para ver la luz y armar sin apuro.", ["1 minuto", "15 minutos", "2 horas"], 1),
          ],
          video: "/academia/antes-del-rodaje.mp4",
          titulo: "Antes del rodaje",
          objetivo: "Llegar preparada para filmar todo sin olvidarte de nada.",
          explicacion:
            "El día antes, leé el guion y la lista de tomas. Tenés que saber qué se dice y qué se filma.\nRevisá el equipo con el checklist: celular, trípode, gimbal, corbatero, batería externa y memoria libre.\nLlegá 15 minutos antes: para conocer el lugar, ver la luz y armar el equipo sin apuro.",
          bien: ["Guion y lista de tomas leídos el día antes.", "Equipo revisado y cargado.", "Llegar 15 minutos antes."],
          mal: ["Leer el guion en el auto.", "Descubrir en el lugar que el corbatero no tiene batería.", "Llegar justo y armar todo a las corridas."],
        },
        {
          id: "s3-durante",
          ejercicios: [
            P("Filmá cada toma ___.", ["una sola vez", "dos veces", "diez veces"], 1, "Si una falla, tenés la otra."),
            P("La persona se traba mientras habla a cámara. ¿Qué hacés?", ["Le digo con calma que repetimos la frase", "Corto todo el rodaje", "La dejo seguir así"], 0),
          ],
          video: "/academia/durante-rodaje.mp4",
          titulo: "Durante el rodaje",
          objetivo: "Filmar todo lo que pide la lista y que la persona que habla se sienta cómoda.",
          explicacion:
            "Filmá todo lo que está en la lista de tomas y cada toma dos veces: si una falla, tenés la otra.\nA quien habla a cámara, dirigilo con frases cortas: «mirá a la lente», «más despacio», «arrancamos de nuevo desde…». Si se traba, no pasa nada: se repite la frase.\nCuidá que el cliente se sienta cómodo: hablale con calma, decile qué vas a hacer y felicitalo cuando sale bien. Si está nervioso, se nota en el video.",
          bien: ["Cada toma dos veces.", "Indicaciones cortas y amables.", "Tachar la lista a medida que filmás."],
          mal: ["Irte sin una toma de la lista.", "Dar indicaciones largas y confusas.", "Apurar o retar al cliente."],
        },
        {
          id: "s3-despues",
          ejercicios: [
            P("¿Cuál es un buen nombre para un archivo?", ["video final nuevo.mp4", "vitasana_2026-11-05_toma03.mp4", "IMG_4667.mov"], 1, "Siempre cliente_fecha_toma."),
            O("Ordená lo que hacés al terminar el rodaje", ["Les ponés nombres claros a los archivos", "Subís todo a la carpeta del cliente", "Confirmás que se abre", "Recién ahí, borrás del celular"]),
          ],
          video: "/academia/despues-del-rodaje.mp4",
          titulo: "Después del rodaje",
          objetivo: "Que nada de lo filmado se pierda y la editora lo encuentre fácil.",
          explicacion:
            "El mismo día del rodaje hacé el backup: subí todo a la carpeta del cliente en Drive.\nPonele nombres claros a los archivos: cliente_fecha_toma. Por ejemplo: vitasana_2026-11-05_toma03.mp4.\nNo borres nada del celular hasta confirmar que todo está subido y se abre.",
          bien: ["Backup el mismo día.", "Nombres cliente_fecha_toma.", "Borrar del celular solo cuando todo está en Drive."],
          mal: ["Dejar el backup para la semana que viene.", "Archivos con nombres como IMG_4587.", "Borrar el celular antes de subir."],
        },
        {
          id: "s3-reglas",
          ejercicios: [
            P("El cliente todavía no aprobó el video, pero está apurado. ¿Se publica?", ["Sí, si está apurado", "No: nada se publica sin su aprobación", "Solo en historias"], 1),
            U("Uní cada caso con la regla", [["Antes de publicar", "El cliente aprueba"], ["Alguien aparece en el video", "Tiene que dar permiso"], ["Un producto", "Se muestra su estado real"], ["Personas y manos", "Nunca con IA"]]),
          ],
          video: "/academia/reglas-prodi.mp4",
          titulo: "Reglas de Prodi",
          objetivo: "Conocer lo que nunca se hace en Prodi, para cuidar a los clientes y a las personas.",
          explicacion:
            "Nada se publica sin la aprobación del cliente.\nNo se muestra nada que el cliente no haya autorizado (lugares, personas, precios, productos).\nSe muestra el estado real de cada producto: no se promete lo que no es.\nLas personas que aparecen en un video tienen que dar su permiso.\nNunca se usan personas ni manos generadas con inteligencia artificial.",
          bien: ["Preguntar antes de filmar a alguien.", "Mostrar el producto como es.", "Esperar la aprobación del cliente."],
          mal: ["Filmar a clientes del negocio sin permiso.", "Mostrar algo como terminado cuando no lo está.", "Usar manos o caras hechas con IA."],
        },
      ],
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
          ejercicios: [
            P("El formato de un Reel es ___.", ["16:9", "9:16", "1:1"], 1),
            O("Ordená cómo arrancás una edición", ["Nuevo proyecto y elegís los videos", "Te fijás que sea 9:16", "Ordenás las tomas como dice el guion", "Cortás silencios y errores"]),
          ],
          video: "/academia/proyecto-capcut.mp4",
          titulo: "Proyecto nuevo en 9:16",
          objetivo: "Armar la base del Reel: ordenar las tomas y sacar lo que sobra.",
          explicacion:
            "En CapCut tocá «Nuevo proyecto», elegí los videos y fijate que el formato sea 9:16 (vertical).\nOrdená las tomas como dice el guion.\nCortá los silencios, los errores y las partes donde la persona se traba. Un Reel no tiene «aire»: cada segundo tiene que aportar algo.",
          bien: ["Formato 9:16.", "Tomas en el orden del guion.", "Sin silencios ni errores."],
          mal: ["Formato horizontal con bandas negras.", "Dejar los «eeeh» y las pausas.", "Tomas en cualquier orden."],
        },
        {
          id: "s4-ritmo",
          ejercicios: [
            P("¿Con qué arranca un Reel que vende?", ["Con el logo", "Con una pregunta o un dato que llame la atención", "Con una toma larga del local"], 1, "Los primeros 2 segundos deciden si la persona se queda."),
            P("Cambiá de plano cada ___ segundos.", ["2 o 3", "10", "30"], 0),
          ],
          video: "/academia/edicion-que-vende.mp4",
          titulo: "Ritmo",
          objetivo: "Que la gente no pase de largo el video y llegue hasta el final.",
          explicacion:
            "Los primeros 2 segundos son los más importantes: ahí va el gancho, algo que haga que la persona se quede (una pregunta, un dato, algo que llame la atención).\nCambiá de plano cada 2 o 3 segundos: así el video se siente dinámico.\nTerminá con un llamado a la acción: decí qué tiene que hacer quien mira («escribinos por WhatsApp», «pedí el tuyo»).",
          bien: ["Gancho en los primeros 2 segundos.", "Cambio de plano cada 2 o 3 segundos.", "Cierre con llamado a la acción."],
          mal: ["Arrancar con el logo o un saludo largo.", "Una toma de 10 segundos sin cortes.", "Terminar sin decir qué hacer."],
        },
        {
          id: "s4-subtitulos",
          ejercicios: [
            P("Salieron los subtítulos automáticos. ¿Qué hacés?", ["Los dejo como salieron", "Los reviso palabra por palabra", "Los saco"], 1, "Se equivocan seguido con nombres y marcas."),
            P("Los subtítulos van dentro de la ___.", ["zona segura", "parte de arriba de todo", "parte de abajo de todo"], 0),
          ],
          video: "/academia/subtitulos.mp4",
          titulo: "Subtítulos",
          objetivo: "Que el video se entienda aunque se mire sin sonido.",
          explicacion:
            "Mucha gente mira los Reels sin sonido: los subtítulos son obligatorios.\nUsá los subtítulos automáticos de CapCut, pero revisalos siempre palabra por palabra: se equivocan seguido con nombres y marcas.\nPonelos dentro de la zona segura (ni muy arriba ni muy abajo), con textos cortos y una letra que se lea bien.",
          bien: ["Subtítulos revisados y corregidos.", "Dentro de la zona segura.", "Pocas palabras por vez, letra legible."],
          mal: ["Subtítulos automáticos sin revisar.", "Texto abajo de todo, tapado por Instagram.", "Frases larguísimas en letra chica."],
        },
        {
          id: "s4-color-exportar",
          ejercicios: [
            U("Uní cada cosa con cómo va", [["Resolución", "1080x1920"], ["Cuadros por segundo", "30"], ["Color", "Todos los clips parecidos"], ["Música", "La pone Lucas al final"]]),
            P("Un clip quedó más oscuro que los otros. ¿Qué hacés?", ["Lo emparejo con los demás", "Le pongo un filtro fuerte", "Lo dejo así"], 0),
          ],
          video: "/academia/color-exportar.mp4",
          titulo: "Color y exportar",
          objetivo: "Entregar un video parejo y en el formato correcto.",
          explicacion:
            "Ajustá el color de forma simple: que todos los clips se vean parecidos (ni uno más oscuro ni uno más naranja). No uses filtros exagerados.\nExportá en 1080x1920 (1080p) a 30 fps.\nNo pongas música ni efectos de sonido: la música la pone Lucas al final.",
          bien: ["Clips parejos de color.", "Exportar 1080p a 30 fps.", "Sin música ni efectos."],
          mal: ["Un filtro distinto en cada clip.", "Exportar en 720p.", "Poner música de moda."],
        },
      ],
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
    consigna: "20 situaciones de todo lo que aprendiste. Se aprueba con 16 bien y lo podés hacer las veces que quieras.",
    preguntas: [
      O("Ordená un día de rodaje", ["Leer el guion y la lista de tomas", "Revisar el equipo", "Llegar 15 minutos antes", "Filmar cada toma dos veces", "Hacer el backup ese mismo día"]),
      P("Un cliente te pregunta si Prodi le va a contestar los mensajes de Instagram. ¿Qué le decís?", ["Que sí, que le contestamos todo", "Que no hacemos community management", "Que lo vas a hacer vos"], 1),
      P("Llegás y el dueño quiere hablar con la ventana atrás. ¿Qué hacés?", ["Filmo igual", "Lo pongo de frente o de costado a la ventana", "Subo el brillo de la pantalla"], 1, "Con la ventana atrás queda a contraluz."),
      P("Siempre filmamos en ___.", ["horizontal", "vertical", "cuadrado"], 1),
      P("El producto queda lejos. ¿Qué hacés?", ["Hago zoom con los dedos", "Me acerco caminando", "Lo arreglo en la edición"], 1),
      U("Uní cada palabra con lo que significa", [["Gancho", "Lo que frena a la gente al principio"], ["B-roll", "Imágenes que acompañan lo que se dice"], ["Zona segura", "Lo que Instagram no tapa"], ["Llamado a la acción", "Lo que le pedimos a quien mira"]]),
      P("Hay luz de ventana y una lámpara amarilla. ¿Qué hacés?", ["Apago la lámpara", "Prendo otra lámpara", "Dejo las dos"], 0),
      P("La prueba de audio suena mal. ¿Qué hacés?", ["Grabo igual", "Lo arreglo ahora, antes de grabar", "Le aviso a la editora que lo arregle"], 1),
      P("La persona que habla está nerviosa y se traba. ¿Qué hacés?", ["Le hablo con calma y repetimos la frase", "Le digo que lo hace mal", "Sigo filmando sin decir nada"], 0),
      P("Los archivos se nombran ___.", ["como salen del celular", "cliente_fecha_toma", "final_final_2"], 1),
      P("Terminó el rodaje. ¿Cuándo podés borrar los videos del celular?", ["Apenas termino", "Cuando confirmo que están subidos y se abren", "Nunca los subo"], 1),
      P("El cliente no aprobó el video y hay apuro por publicarlo. ¿Qué pasa?", ["Se publica igual", "No se publica hasta que lo apruebe", "Se publica y después le aviso"], 1),
      P("Alguien aparece en el video y no dio permiso. ¿Qué hacés?", ["Lo publico igual", "Le pido permiso o no uso esa toma", "Le pongo un filtro"], 1),
      O("Ordená una edición", ["Proyecto nuevo en 9:16", "Ordenar las tomas como dice el guion", "Cortar silencios y errores", "Revisar los subtítulos", "Emparejar el color", "Exportar en 1080x1920 a 30 fps"]),
      P("¿Qué va en los primeros 2 segundos?", ["El logo", "El gancho", "Los créditos"], 1),
      P("¿Quién le pone la música al video?", ["Lucas, al final", "Vos, en CapCut", "El cliente"], 0),
      P("Los subtítulos automáticos están listos. ¿Qué hacés?", ["Los reviso palabra por palabra", "Exporto", "Los saco"], 0),
      P("Cambiá de plano cada ___ segundos.", ["2 o 3", "10", "20"], 0),
      P("¿Se pueden usar manos o personas hechas con inteligencia artificial?", ["Sí, si se ven bien", "Nunca", "Solo de fondo"], 1),
      U("Uní cada equipo con para qué sirve", [["Corbatero", "Que se escuche bien"], ["Trípode", "Tomas fijas"], ["Gimbal", "Seguir algo en movimiento"], ["Batería externa", "No quedarte sin carga"]]),
    ],
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

/** Recorridos: los guardados pisan a los de acá (uno guardado con el formato viejo, sin examen de preguntas, no se usa). */
export function useRecorridos(): Recorrido[] {
  const [guardados, setGuardados] = useState<Recorrido[]>([]);
  useEffect(
    () =>
      onSnapshot(
        collection(db, "academia_recorridos"),
        (s) => setGuardados(s.docs.map((d) => ({ ...(d.data() as Recorrido), id: d.id })).filter((r) => Array.isArray(r.examen?.preguntas))),
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

export type ProgresoRecorrido = ProgresoAcademia & {
  /** Repaso de cada módulo y examen final (clave "examen"): el mejor resultado. */
  cuestionarios?: Record<string, { aciertos: number; total: number; at: string }>;
};

export const leccionHecha = (l: LeccionRecorrido, p: ProgresoRecorrido | null | undefined) => !!p?.completadas?.[l.id];

export const cuestionarioAprobado = (m: ModuloRecorrido, p: ProgresoRecorrido | null | undefined) =>
  !m.cuestionario.length || (p?.cuestionarios?.[m.id]?.aciertos ?? 0) >= minimoParaAprobar(m.cuestionario.length);

export const examenAprobado = (r: Recorrido, p: ProgresoRecorrido | null | undefined) =>
  (p?.cuestionarios?.[ID_EXAMEN]?.aciertos ?? 0) >= minimoParaAprobar(r.examen.preguntas.length);

/** Una semana está aprobada con todas las lecciones hechas y el repaso aprobado. */
export const moduloAprobado = (m: ModuloRecorrido, p: ProgresoRecorrido | null | undefined) => m.lecciones.every((l) => leccionHecha(l, p)) && cuestionarioAprobado(m, p);

/** Se abre la primera y cada una cuando la anterior está aprobada. El examen, con todas aprobadas. */
export function abiertos(r: Recorrido, p: ProgresoRecorrido | null | undefined) {
  const modulos = r.modulos.map((_, i) => i === 0 || moduloAprobado(r.modulos[i - 1], p));
  const examen = r.modulos.every((m) => moduloAprobado(m, p));
  return { modulos, examen };
}

export function avanceRecorrido(r: Recorrido, p: ProgresoRecorrido | null | undefined) {
  const aprobados = r.modulos.filter((m) => moduloAprobado(m, p)).length;
  const examen = examenAprobado(r, p);
  return { aprobados, total: r.modulos.length, examen, completo: aprobados === r.modulos.length && examen };
}

export async function guardarCuestionario(uid: string, clave: string, aciertos: number, total: number) {
  const at = new Date().toISOString();
  await setDoc(doc(db, "academia", uid), { cuestionarios: { [clave]: { aciertos, total, at } }, actualizado_at: at }, { merge: true });
}

export interface ProximoPaso {
  tipo: "leccion" | "cuestionario" | "examen";
  modulo: ModuloRecorrido | null;
  leccion: LeccionRecorrido | null;
}

/** Lo que le toca hacer ahora. Con el recorrido terminado, null. */
export function proximoPaso(r: Recorrido, p: ProgresoRecorrido | null | undefined): ProximoPaso | null {
  for (const m of r.modulos) {
    if (moduloAprobado(m, p)) continue;
    const leccion = m.lecciones.find((l) => !leccionHecha(l, p));
    return leccion ? { tipo: "leccion", modulo: m, leccion } : { tipo: "cuestionario", modulo: m, leccion: null };
  }
  return examenAprobado(r, p) ? null : { tipo: "examen", modulo: null, leccion: null };
}
