import json, urllib.request, time
# Prueba las reglas de acceso contra el servidor (pnpm local) con los datos de ejemplo (pnpm db:ejemplo).
# Uso: python3 scripts/probar-seguridad.py   (opcional: BASE=https://tu-app.vercel.app python3 …)
import os
B=os.environ.get("BASE","http://localhost:3001")
def post(path, body, tok=None):
    req=urllib.request.Request(B+path, data=json.dumps(body).encode(), headers={"content-type":"application/json", **({"authorization":"Bearer "+tok} if tok else {})})
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
def login(email): return post("/api/auth/login", {"email":email,"password":"prodi2026"})[1]["token"]
T={k:login(e) for k,e in {"lucas":"lucas@somosprodi.com","cli1":"martin@dontano.com.ar","nati":"natalia@somosprodi.com","lucii":"administracion@somosprodi.com","lucia":"lucia@somosprodi.com","nuevo":"nuevo@ejemplo.com","karen":"karen@somosprodi.com"}.items()}
def q(tok, **c): return post("/api/db/consultar", {"consultas":[c]}, tok)
def w(tok, *ops): return post("/api/db/escribir", {"ops":list(ops)}, tok)
res=[]
def chk(nombre, cond): res.append((nombre, cond)); print(("OK  " if cond else "FALLA ")+nombre)

s,r=q(T["cli1"], coleccion="videos", filtros=[], orden=[])
proys={d["data"]["proyecto_id"] for d in r["resultados"][0]["docs"]}
chk("cliente solo ve videos de su cliente", proys=={"p1"})
s,r=q(T["cli1"], coleccion="videos", filtros=[{"campo":"proyecto_id","op":"==","valor":"p2"}], orden=[])
chk("cliente no ve videos de otro cliente", r["resultados"][0]["docs"]==[])
s,r=q(T["cli1"], ruta="projects/p2"); chk("cliente no abre otro cliente", r["resultados"][0].get("error")=="permission-denied")
s,r=q(T["cli1"], coleccion="facturas", filtros=[], orden=[]); fs=r["resultados"][0]["docs"]
chk("cliente ve solo sus boletas emitidas", all(d["data"]["proyecto_id"]=="p1" and d["data"]["estado"] in ("pendiente","cobrada") for d in fs) and len(fs)>0)
s,r=q(T["cli1"], coleccion="gastos", filtros=[], orden=[]); chk("cliente no ve gastos", r["resultados"][0]["docs"]==[])
s,r=q(T["cli1"], coleccion="ia_memoria", filtros=[], orden=[]); chk("cliente no ve la memoria de la IA", r["resultados"][0]["docs"]==[])
s,r=q(T["cli1"], coleccion="profiles", filtros=[], orden=[]); chk("cliente solo ve su perfil", [d["id"] for d in r["resultados"][0]["docs"]]==["u_cli1"])
s,r=q(T["cli1"], coleccion="cobros", filtros=[], orden=[]); chk("cliente solo ve sus pagos", all(d["data"]["proyecto_id"]=="p1" for d in r["resultados"][0]["docs"]))
# escrituras del cliente
s,r=q(T["lucas"], coleccion="videos", filtros=[{"campo":"proyecto_id","op":"==","valor":"p1"},{"campo":"etapa","op":"==","valor":"revision_cliente"}], orden=[])
vid=r["resultados"][0]["docs"][0]["id"]
s,_=w(T["cli1"], {"tipo":"update","ruta":f"videos/{vid}","data":{"titulo":"hackeado"}}); chk("cliente no puede cambiar el título de un video", s==403)
s,_=w(T["cli1"], {"tipo":"update","ruta":f"videos/{vid}","data":{"etapa":"para_publicar","feedback_cliente":None,"updated_at":"x"}}); chk("cliente aprueba su video", s==200)
s,r=q(T["lucas"], coleccion="videos", filtros=[{"campo":"proyecto_id","op":"==","valor":"p2"}], orden=[], limite=1); v2=r["resultados"][0]["docs"][0]["id"]
s,_=w(T["cli1"], {"tipo":"update","ruta":f"videos/{v2}","data":{"etapa":"para_publicar"}}); chk("cliente no toca videos de otro", s==403)
s,_=w(T["cli1"], {"tipo":"set","ruta":"videos/nuevo1","data":{"proyecto_id":"p1","titulo":"x"}}); chk("cliente no crea videos", s==403)
s,_=w(T["cli1"], {"tipo":"update","ruta":"profiles/u_cli1","data":{"role":"admin"}}); chk("cliente no se cambia el rol", s==403)
s,_=w(T["cli1"], {"tipo":"update","ruta":"profiles/u_cli1","data":{"nombre":"Martín G."}}); chk("cliente cambia su nombre", s==200)
s,_=w(T["cli1"], {"tipo":"update","ruta":"profiles/u_cli1","data":{"nombre":"ok"}}, {"tipo":"update","ruta":"projects/p1","data":{"nombre":"x"}}); chk("lote con algo prohibido se rechaza entero", s==403)
s,r=q(T["lucas"], ruta="profiles/u_cli1"); chk("…y no quedó nada a medias", r["resultados"][0]["doc"]["data"]["nombre"]=="Martín G.")
# equipo
s,r=q(T["nati"], coleccion="gastos", filtros=[], orden=[]); chk("editora no ve gastos", r["resultados"][0]["docs"]==[])
s,_=w(T["nati"], {"tipo":"set","ruta":"gastos/g_x","data":{"monto":1}}); chk("editora no carga gastos", s==403)
s,_=w(T["nati"], {"tipo":"update","ruta":"projects/p1","data":{"facturacion":{"tipo":"factura"}}}); chk("editora no toca la facturación", s==403)
s,r=q(T["lucii"], coleccion="gastos", filtros=[], orden=[]); chk("administración ve gastos", len(r["resultados"][0]["docs"])>0)
s,_=w(T["lucii"], {"tipo":"update","ruta":"projects/p1","data":{"facturacion.sin_recordatorios":True}}); chk("administración cambia datos de facturación", s==200)
s,_=w(T["lucii"], {"tipo":"update","ruta":"projects/p1","data":{"plan_redes_id":"pl_full"}}); chk("administración no cambia el plan", s==403)
s,r=q(T["lucii"], coleccion="videos", filtros=[], orden=[], limite=3); chk("administración solo lee videos", len(r["resultados"][0]["docs"])==3)
s,_=w(T["lucia"], {"tipo":"update","ruta":"projects/p1","data":{"marca.tono":"Cercano"}}); chk("producción edita la marca", s==200)
s,_=w(T["lucia"], {"tipo":"update","ruta":"projects/p1","data":{"team_roles.cliente":[]}}); chk("producción no cambia el equipo", s==403)
s,r=q(T["karen"], coleccion="ia_memoria", filtros=[], orden=[]); chk("diseño ve la memoria de la IA", len(r["resultados"][0]["docs"])>0)
s,r=q(T["nuevo"], coleccion="projects", filtros=[], orden=[]); chk("usuario pendiente no ve clientes", r["resultados"][0]["docs"]==[])
s,r=q(T["nuevo"], ruta="profiles/u_new"); chk("usuario pendiente ve su perfil", r["resultados"][0]["doc"] is not None)
s,_=q(None, coleccion="projects", filtros=[], orden=[]); chk("sin sesión no entra", s==401)
s,_=post("/api/db/consultar", {"consultas":[{"coleccion":"projects","filtros":[],"orden":[]}]}, T["lucas"][:-3]+"abc"); chk("token adulterado no entra", s==401)
s,r=q(T["lucas"], coleccion="chats", filtros=[], orden=[]); chat=[d for d in r["resultados"][0]["docs"] if "u_cli1" not in d["data"].get("miembros",[])][0]["id"]
s,r=q(T["cli1"], coleccion=f"chats/{chat}/mensajes", filtros=[], orden=[]); chk("cliente no lee chats ajenos", r["resultados"][0].get("docs")==[])
s,_=w(T["cli1"], {"tipo":"set","ruta":f"chats/{chat}/mensajes/m_x","data":{"by":"u_cli1","texto":"hola"}}); chk("cliente no escribe en chats ajenos", s==403)
s,_=w(T["cli1"], {"tipo":"set","ruta":"chats/cliente_p1/mensajes/m_ok","data":{"by":"u_cli1","texto":"hola","at":"2026-10-06T00:00:00Z"}}); chk("cliente escribe en su chat", s==200)
s,_=w(T["cli1"], {"tipo":"set","ruta":"chats/cliente_p1/mensajes/m_falso","data":{"by":"u_lucas","texto":"soy lucas"}}); chk("no se puede escribir haciéndose pasar por otro", s==403)
# cambios en vivo
s,r=post("/api/db/cambios", {"desde":None}, T["lucas"]); r0=r["rev"]
w(T["lucas"], {"tipo":"set","ruta":"gastos/g_vivo","data":{"concepto":"x","monto":1,"mes":"2026-10"}})
s,r=post("/api/db/cambios", {"desde":r0}, T["lucas"]); chk("se avisa el cambio (gastos)", "gastos" in r["colecciones"])
w(T["lucas"], {"tipo":"delete","ruta":"gastos/g_vivo"})
s,r=post("/api/db/cambios", {"desde":r0}, T["lucas"]); chk("se avisa el borrado", "gastos" in r["colecciones"])
# cambio de clave corta otras sesiones
tok_viejo=T["nati"]
s,r=post("/api/auth/cambiar-clave", {"actual":"prodi2026","nueva":"otra-clave-1"}, tok_viejo); nuevo=r.get("token")
s1,_=q(tok_viejo, ruta="profiles/u_nati"); s2,_=q(nuevo, ruta="profiles/u_nati")
chk("cambiar la clave cierra las otras sesiones", s1==401 and s2==200)
post("/api/auth/cambiar-clave", {"actual":"otra-clave-1","nueva":"prodi2026"}, nuevo)
print(f"\n{sum(1 for _,c in res if c)}/{len(res)} pruebas OK")
