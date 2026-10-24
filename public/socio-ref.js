/*
 * Prodi · link de socio comercial (somosprodi.com/?ref=CODIGO).
 * Se pone una vez en la landing, antes de cerrar </body>:
 *   <script src="https://<la app de Prodi>/socio-ref.js" defer></script>
 * - Si la página abre con ?ref=CODIGO, guarda el código 60 días (localStorage + cookie).
 * - Al mandar el formulario (POST a /api/web/aplicar), le suma "ref" con ese código: el lead entra al CRM como del socio.
 * - window.prodiRef() devuelve el código guardado (o null), por si la landing lo quiere mandar ella misma.
 */
(function () {
  var CLAVE = "prodi_ref";
  var DIAS = 60;
  var OK = /^[a-z0-9][a-z0-9-]{2,29}$/;

  function guardar(codigo) {
    try {
      localStorage.setItem(CLAVE, JSON.stringify({ codigo: codigo, hasta: Date.now() + DIAS * 86400000 }));
    } catch (e) {}
    try {
      document.cookie = CLAVE + "=" + encodeURIComponent(codigo) + ";max-age=" + DIAS * 86400 + ";path=/;SameSite=Lax";
    } catch (e) {}
  }

  function leer() {
    try {
      var g = JSON.parse(localStorage.getItem(CLAVE) || "null");
      if (g && OK.test(g.codigo) && g.hasta > Date.now()) return g.codigo;
    } catch (e) {}
    var m = document.cookie.match(new RegExp("(?:^|; )" + CLAVE + "=([^;]+)"));
    var c = m ? decodeURIComponent(m[1]) : null;
    return c && OK.test(c) ? c : null;
  }

  try {
    var p = new URLSearchParams(location.search).get("ref");
    if (p && OK.test(p.toLowerCase())) guardar(p.toLowerCase());
  } catch (e) {}

  window.prodiRef = leer;

  // Suma el código al formulario de la landing sin tocar su código.
  var original = window.fetch;
  if (!original) return;
  window.fetch = function (url, opciones) {
    try {
      var u = typeof url === "string" ? url : url && url.url;
      var ref = leer();
      if (ref && u && /\/api\/web\/aplicar(\?|$)/.test(u) && opciones && typeof opciones.body === "string") {
        var datos = JSON.parse(opciones.body);
        if (datos && typeof datos === "object" && !datos.ref) {
          datos.ref = ref;
          opciones = Object.assign({}, opciones, { body: JSON.stringify(datos) });
        }
      }
    } catch (e) {}
    return original.call(this, url, opciones);
  };
})();
