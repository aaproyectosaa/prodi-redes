-- Prodi Redes · base de datos en Postgres (Neon).
-- Se puede correr las veces que quieras: no borra nada (pnpm db:setup).
--
-- Cada colección del sistema (clientes, videos, facturas, …) es un conjunto de documentos JSON
-- en la tabla `documentos`. Las subcolecciones usan la ruta completa (ej. chats/<id>/mensajes).
-- `rev` crece con cada cambio: la app lo usa para enterarse de lo nuevo sin recargar.
-- Abajo hay vistas con nombres en castellano para consultar a mano (o desde un asistente).

create sequence if not exists documentos_rev;

create table if not exists documentos (
  coleccion   text        not null,
  id          text        not null,
  data        jsonb       not null default '{}'::jsonb,
  rev         bigint      not null default nextval('documentos_rev'),
  creado      timestamptz not null default now(),
  actualizado timestamptz not null default now(),
  primary key (coleccion, id)
);
create index if not exists documentos_rev_idx on documentos (rev);
create index if not exists documentos_data_idx on documentos using gin (data jsonb_path_ops);
create index if not exists documentos_proyecto_idx on documentos (coleccion, (data ->> 'proyecto_id'));
create index if not exists documentos_mes_idx on documentos (coleccion, (data ->> 'mes'));

-- Lo borrado queda anotado un tiempo para que las pantallas abiertas se enteren.
create table if not exists borrados (
  coleccion text   not null,
  id        text   not null,
  rev       bigint not null,
  borrado   timestamptz not null default now(),
  primary key (coleccion, id)
);
create index if not exists borrados_rev_idx on borrados (rev);

create or replace function documentos_tocar() returns trigger language plpgsql as $$
begin
  new.rev := nextval('documentos_rev');
  new.actualizado := now();
  if tg_op = 'INSERT' then
    delete from borrados where coleccion = new.coleccion and id = new.id;
  end if;
  return new;
end $$;

create or replace function documentos_borrar() returns trigger language plpgsql as $$
begin
  insert into borrados (coleccion, id, rev) values (old.coleccion, old.id, nextval('documentos_rev'))
  on conflict (coleccion, id) do update set rev = excluded.rev, borrado = now();
  return old;
end $$;

drop trigger if exists documentos_tocar_trg on documentos;
create trigger documentos_tocar_trg before insert or update on documentos
  for each row execute function documentos_tocar();
drop trigger if exists documentos_borrar_trg on documentos;
create trigger documentos_borrar_trg after delete on documentos
  for each row execute function documentos_borrar();

-- Usuarios que entran al sistema (el perfil, con nombre y rol, está en la colección `profiles`).
create table if not exists usuarios (
  uid          text primary key,
  email        text not null unique,
  clave_hash   text,
  nombre       text,
  desactivado  boolean not null default false,
  -- Sube cuando hay que cerrar todas las sesiones (cambio de clave, desactivar).
  sesion_ver   integer not null default 0,
  creado       timestamptz not null default now(),
  ultimo_login timestamptz
);

-- Suscripciones de avisos push (navegador o celular de cada usuario).
create table if not exists push_suscripciones (
  endpoint   text primary key,
  uid        text not null,
  datos      jsonb not null,
  creado     timestamptz not null default now()
);
create index if not exists push_uid_idx on push_suscripciones (uid);

-- Vistas para leer a mano.
create or replace view clientes          as select id, data, actualizado from documentos where coleccion = 'projects';
create or replace view perfiles          as select id, data, actualizado from documentos where coleccion = 'profiles';
create or replace view videos            as select id, data, actualizado from documentos where coleccion = 'videos';
create or replace view rodajes           as select id, data, actualizado from documentos where coleccion = 'rodajes';
create or replace view piezas            as select id, data, actualizado from documentos where coleccion = 'piezas_ia';
create or replace view planes            as select id, data, actualizado from documentos where coleccion = 'planes_redes';
create or replace view facturas          as select id, data, actualizado from documentos where coleccion = 'facturas';
create or replace view cobros_mp         as select id, data, actualizado from documentos where coleccion = 'cobros';
create or replace view gastos            as select id, data, actualizado from documentos where coleccion = 'gastos';
create or replace view deudas            as select id, data, actualizado from documentos where coleccion = 'obligaciones';
create or replace view pagos_equipo      as select id, data, actualizado from documentos where coleccion = 'equipo_liquidaciones';
create or replace view reuniones         as select id, data, actualizado from documentos where coleccion = 'reuniones';
