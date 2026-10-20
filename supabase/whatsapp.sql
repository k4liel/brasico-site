-- =====================================================================
-- WhatsApp: o número da Brasico participa dos grupos da companhia.
-- A Evolution API (VPS, pasta whatsapp/) manda cada mensagem para a
-- Edge Function whatsapp-webhook, que grava aqui. Todo dia a função
-- whatsapp-resumo pede ao Claude um resumo por grupo (wa_resumos).
-- Quem vê: só quem está em wa_acesso (os sócios), no site e no conector.
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Quem pode ver os grupos e resumos. Os membros são inseridos direto no
-- banco (não guarde e-mails ou ids neste arquivo, o repositório é público):
--   insert into public.wa_acesso (user_id) values ('<uuid do usuário>');
create table if not exists public.wa_acesso (
  user_id uuid primary key references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.wa_grupos (
  id text primary key,                     -- JID do grupo (…@g.us)
  nome text not null default '',
  descricao text not null default '',
  ativo boolean not null default true,     -- false: para de gravar e de resumir
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.wa_mensagens (
  grupo_id text not null references public.wa_grupos(id),
  id text not null,                        -- id da mensagem no WhatsApp
  autor_jid text not null default '',
  autor_nome text not null default '',
  de_nos boolean not null default false,   -- enviada pelo número da Brasico
  tipo text not null default 'texto',
  texto text not null default '',
  enviada_em timestamptz not null,
  recebida_em timestamptz not null default now(),
  primary key (grupo_id, id)
);
create index if not exists wa_mensagens_dia_idx on public.wa_mensagens (grupo_id, enviada_em);
create index if not exists wa_mensagens_quando_idx on public.wa_mensagens (enviada_em);

create table if not exists public.wa_resumos (
  id uuid primary key default gen_random_uuid(),
  grupo_id text not null references public.wa_grupos(id),
  dia date not null,
  resumo text not null,                    -- Markdown
  total_mensagens int not null default 0,
  modelo text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (grupo_id, dia)
);
create index if not exists wa_resumos_dia_idx on public.wa_resumos (dia desc);

-- Exclusões bloqueadas, como no resto do Brasico
do $$
declare t text;
begin
  foreach t in array array['wa_acesso', 'wa_grupos', 'wa_mensagens', 'wa_resumos'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_sem_exclusao', t);
    execute format('create trigger %I before delete on public.%I for each row execute function public.bloquear_exclusao()',
                   t || '_sem_exclusao', t);
    execute format('drop trigger if exists %I on public.%I', t || '_sem_truncate', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function public.bloquear_exclusao()',
                   t || '_sem_truncate', t);
  end loop;
end $$;

create or replace function public.wa_tocar()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists wa_grupos_tocar on public.wa_grupos;
create trigger wa_grupos_tocar before update on public.wa_grupos for each row execute function public.wa_tocar();
drop trigger if exists wa_resumos_tocar on public.wa_resumos;
create trigger wa_resumos_tocar before update on public.wa_resumos for each row execute function public.wa_tocar();

create or replace function public.wa_pode_ver(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.wa_acesso where user_id = p_user)
$$;
revoke execute on function public.wa_pode_ver(uuid) from public, anon;
grant execute on function public.wa_pode_ver(uuid) to authenticated;

alter table public.wa_acesso enable row level security;
alter table public.wa_grupos enable row level security;
alter table public.wa_mensagens enable row level security;
alter table public.wa_resumos enable row level security;

drop policy if exists "ver acesso" on public.wa_acesso;
create policy "ver acesso" on public.wa_acesso for select using (user_id = auth.uid());
drop policy if exists "ver grupos" on public.wa_grupos;
create policy "ver grupos" on public.wa_grupos for select using (public.wa_pode_ver(auth.uid()));
drop policy if exists "editar grupos" on public.wa_grupos;
create policy "editar grupos" on public.wa_grupos for update using (public.wa_pode_ver(auth.uid())) with check (public.wa_pode_ver(auth.uid()));
drop policy if exists "ver mensagens" on public.wa_mensagens;
create policy "ver mensagens" on public.wa_mensagens for select using (public.wa_pode_ver(auth.uid()));
drop policy if exists "ver resumos" on public.wa_resumos;
create policy "ver resumos" on public.wa_resumos for select using (public.wa_pode_ver(auth.uid()));

revoke all on public.wa_acesso, public.wa_grupos, public.wa_mensagens, public.wa_resumos from anon;
grant select on public.wa_acesso, public.wa_grupos, public.wa_mensagens, public.wa_resumos to authenticated;
grant update (ativo) on public.wa_grupos to authenticated;

do $$ begin alter publication supabase_realtime add table public.wa_resumos; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.wa_mensagens; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.wa_grupos; exception when duplicate_object then null; end $$;

-- wa_grupos guarda todas as conversas do número: grupos e individuais
alter table public.wa_grupos add column if not exists tipo text not null default 'grupo';   -- 'grupo' ou 'contato'
alter table public.wa_grupos add column if not exists foto text not null default '';        -- URL da foto no WhatsApp (expira; o site cai nas iniciais)
alter table public.wa_grupos add column if not exists telefone text not null default '';    -- só contatos
alter table public.wa_mensagens add column if not exists miniatura text not null default '';  -- JPEG pequeno em base64 (fotos e vídeos)
alter table public.wa_mensagens add column if not exists citacao text not null default '';    -- texto da mensagem respondida

-- Site: lista de conversas com total de mensagens e a última (respeita o RLS de quem chama)
drop function if exists public.wa_painel_grupos();
create or replace function public.wa_painel_grupos()
returns table (id text, nome text, tipo text, foto text, telefone text, ativo boolean, total bigint, ultima timestamptz,
               ultima_autor text, ultima_texto text, ultima_tipo text, ultima_de_nos boolean)
language sql stable security invoker set search_path = public as $$
  select g.id, g.nome, g.tipo, g.foto, g.telefone, g.ativo,
         (select count(*) from public.wa_mensagens m where m.grupo_id = g.id),
         u.enviada_em, u.autor_nome, u.texto, u.tipo, u.de_nos
  from public.wa_grupos g
  left join lateral (
    select m.enviada_em, m.autor_nome, m.texto, m.tipo, m.de_nos from public.wa_mensagens m
    where m.grupo_id = g.id order by m.enviada_em desc limit 1
  ) u on true
  order by u.enviada_em desc nulls last, g.nome
$$;
revoke execute on function public.wa_painel_grupos() from public, anon;
grant execute on function public.wa_painel_grupos() to authenticated;

-- ---------------------------------------------------------------------
-- Segredo das Edge Functions (webhook da Evolution e agendamento).
-- Fica no Vault; as funções conferem por aqui, sem variável de ambiente.
-- É gerado ao acaso aqui (o valor nunca aparece no repositório).
-- ---------------------------------------------------------------------
select vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'wa_segredo')
where not exists (select 1 from vault.secrets where name = 'wa_segredo');

create or replace function public.wa_conferir_segredo(p_segredo text)
returns boolean language sql stable security definer set search_path = public, vault as $$
  select coalesce(p_segredo, '') <> ''
     and exists (select 1 from vault.decrypted_secrets where name = 'wa_segredo' and decrypted_secret = p_segredo)
$$;
revoke execute on function public.wa_conferir_segredo(text) from public, anon, authenticated;
grant execute on function public.wa_conferir_segredo(text) to service_role;

-- Sem resumo automático: os sócios pedem o resumo direto ao Claude (conector: whatsapp_mensagens).
-- A Edge Function whatsapp-resumo continua publicada e pode ser chamada à mão (veja whatsapp/LEIA-ME.md).
select cron.unschedule('whatsapp-resumo-diario') where exists (select 1 from cron.job where jobname = 'whatsapp-resumo-diario');

-- ---------------------------------------------------------------------
-- Conector (ferramentas whatsapp_* do Claude)
-- ---------------------------------------------------------------------
create or replace function public.mcp_wa_auth(p_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare a record;
begin
  select * into a from public.mcp_auth(p_token);
  if not public.wa_pode_ver(a.o_user) then
    raise exception 'Sem acesso aos grupos de WhatsApp' using errcode = '42501';
  end if;
  return a.o_user;
end $$;
revoke execute on function public.mcp_wa_auth(text) from public, anon, authenticated;

-- Acha o grupo pelo JID ou por parte do nome
create or replace function public.wa_achar_grupo(p_grupo text)
returns text language plpgsql stable security definer set search_path = public as $$
declare v text; n int;
begin
  select id into v from public.wa_grupos where id = trim(p_grupo);
  if v is not null then return v; end if;
  select count(*), min(id) into n, v from public.wa_grupos where nome ilike '%' || trim(p_grupo) || '%';
  if n = 0 then raise exception 'Grupo "%" não encontrado. Veja os nomes em whatsapp_grupos.', p_grupo; end if;
  if n > 1 then raise exception 'Mais de um grupo com "%" no nome. Use o id de whatsapp_grupos.', p_grupo; end if;
  return v;
end $$;
revoke execute on function public.wa_achar_grupo(text) from public, anon, authenticated;

create or replace function public.mcp_wa_grupos(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.mcp_wa_auth(p_token);
  return jsonb_build_object('hoje', (now() at time zone 'America/Sao_Paulo')::date, 'grupos', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', g.id, 'nome', g.nome, 'ativo', g.ativo,
      'mensagens_7_dias', (select count(*) from public.wa_mensagens m where m.grupo_id = g.id and m.enviada_em > now() - interval '7 days'),
      'ultima_mensagem', (select max(enviada_em) from public.wa_mensagens m where m.grupo_id = g.id),
      'ultimo_resumo', (select max(dia) from public.wa_resumos r where r.grupo_id = g.id)
    ) order by g.ativo desc, g.nome)
    from public.wa_grupos g), '[]'::jsonb));
end $$;

create or replace function public.mcp_wa_mensagens(p_token text, p_grupo text default null, p_de date default null,
  p_ate date default null, p_busca text default null, p_limite int default 300)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_grupo text; v_de date; v_ate date;
begin
  perform public.mcp_wa_auth(p_token);
  if p_grupo is not null then v_grupo := public.wa_achar_grupo(p_grupo); end if;
  v_ate := coalesce(p_ate, (now() at time zone 'America/Sao_Paulo')::date);
  v_de := coalesce(p_de, v_ate);
  return jsonb_build_object('de', v_de, 'ate', v_ate, 'mensagens', coalesce((
    select jsonb_agg(x.j order by x.enviada_em) from (
      select m.enviada_em, jsonb_build_object(
        'grupo', g.nome,
        'quando', to_char(m.enviada_em at time zone 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI'),
        'autor', coalesce(nullif(m.autor_nome, ''), split_part(m.autor_jid, '@', 1)),
        'tipo', m.tipo, 'texto', m.texto) j
      from public.wa_mensagens m join public.wa_grupos g on g.id = m.grupo_id
      where (v_grupo is null or m.grupo_id = v_grupo)
        and m.enviada_em >= (v_de::timestamp at time zone 'America/Sao_Paulo')
        and m.enviada_em < ((v_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
        and (p_busca is null or m.texto ilike '%' || p_busca || '%' or m.autor_nome ilike '%' || p_busca || '%')
      order by m.enviada_em desc
      limit least(greatest(coalesce(p_limite, 300), 1), 2000)
    ) x), '[]'::jsonb));
end $$;

create or replace function public.mcp_wa_resumos(p_token text, p_grupo text default null, p_de date default null, p_ate date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_grupo text; v_de date; v_ate date;
begin
  perform public.mcp_wa_auth(p_token);
  if p_grupo is not null then v_grupo := public.wa_achar_grupo(p_grupo); end if;
  v_ate := coalesce(p_ate, (now() at time zone 'America/Sao_Paulo')::date);
  v_de := coalesce(p_de, v_ate - 1);
  return jsonb_build_object('de', v_de, 'ate', v_ate, 'resumos', coalesce((
    select jsonb_agg(jsonb_build_object('dia', r.dia, 'grupo', g.nome, 'grupo_id', g.id,
      'mensagens', r.total_mensagens, 'resumo', r.resumo) order by r.dia desc, g.nome)
    from public.wa_resumos r join public.wa_grupos g on g.id = r.grupo_id
    where r.dia between v_de and v_ate and (v_grupo is null or r.grupo_id = v_grupo)), '[]'::jsonb));
end $$;

create or replace function public.mcp_wa_monitorar(p_token text, p_grupo text, p_ativo boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_grupo text; g public.wa_grupos;
begin
  v_user := public.mcp_wa_auth(p_token);
  v_grupo := public.wa_achar_grupo(p_grupo);
  update public.wa_grupos set ativo = p_ativo where id = v_grupo returning * into g;
  return jsonb_build_object('id', g.id, 'nome', g.nome, 'ativo', g.ativo);
end $$;

revoke execute on function public.mcp_wa_grupos(text) from public, authenticated;
revoke execute on function public.mcp_wa_mensagens(text, text, date, date, text, int) from public, authenticated;
revoke execute on function public.mcp_wa_resumos(text, text, date, date) from public, authenticated;
revoke execute on function public.mcp_wa_monitorar(text, text, boolean) from public, authenticated;
grant execute on function public.mcp_wa_grupos(text) to anon;
grant execute on function public.mcp_wa_mensagens(text, text, date, date, text, int) to anon;
grant execute on function public.mcp_wa_resumos(text, text, date, date) to anon;
grant execute on function public.mcp_wa_monitorar(text, text, boolean) to anon;

-- ---------------------------------------------------------------------
-- Mídias completas, telefone do autor e agenda de contatos
-- ---------------------------------------------------------------------
alter table public.wa_mensagens add column if not exists midia text not null default '';          -- caminho no bucket whatsapp
alter table public.wa_mensagens add column if not exists midia_mime text not null default '';
alter table public.wa_mensagens add column if not exists midia_nome text not null default '';     -- nome do arquivo (documentos)
alter table public.wa_mensagens add column if not exists midia_bytes bigint not null default 0;
alter table public.wa_mensagens add column if not exists midia_segundos int not null default 0;   -- duração de áudio e vídeo
alter table public.wa_mensagens add column if not exists autor_telefone text not null default '';

-- Edições e votos de enquete chegam criptografados (secretEncryptedMessage): não são mensagens novas
update public.wa_mensagens set tipo = 'sistema' where tipo in ('messageContextInfo', 'secretEncryptedMessage');

-- Agenda: nome (o que a pessoa colocou no WhatsApp) e telefone de cada contato do número
create table if not exists public.wa_contatos (
  id text primary key,                     -- JID (…@s.whatsapp.net ou …@lid)
  nome text not null default '',
  telefone text not null default '',
  foto text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.wa_contatos enable row level security;
drop policy if exists "ver contatos" on public.wa_contatos;
create policy "ver contatos" on public.wa_contatos for select using (public.wa_pode_ver(auth.uid()));
revoke all on public.wa_contatos from anon;
grant select on public.wa_contatos to authenticated;
drop trigger if exists wa_contatos_sem_exclusao on public.wa_contatos;
create trigger wa_contatos_sem_exclusao before delete on public.wa_contatos for each row execute function public.bloquear_exclusao();
drop trigger if exists wa_contatos_sem_truncate on public.wa_contatos;
create trigger wa_contatos_sem_truncate before truncate on public.wa_contatos for each statement execute function public.bloquear_exclusao();

-- Completa dados de mensagens já gravadas (telefone do autor e mídia), sem apagar o que existe
create or replace function public.wa_completar_mensagens(p jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.wa_mensagens m set
    autor_telefone = case when m.autor_telefone = '' then coalesce(x->>'autor_telefone', '') else m.autor_telefone end,
    midia          = case when coalesce(x->>'midia', '') <> '' then x->>'midia' else m.midia end,
    midia_mime     = case when coalesce(x->>'midia', '') <> '' then coalesce(x->>'midia_mime', '') else m.midia_mime end,
    midia_nome     = case when m.midia_nome = '' then coalesce(x->>'midia_nome', '') else m.midia_nome end,
    midia_bytes    = case when coalesce((x->>'midia_bytes')::bigint, 0) > 0 then (x->>'midia_bytes')::bigint else m.midia_bytes end,
    midia_segundos = case when coalesce((x->>'midia_segundos')::int, 0) > 0 then (x->>'midia_segundos')::int else m.midia_segundos end
  from jsonb_array_elements(p) x
  where m.grupo_id = x->>'grupo_id' and m.id = x->>'id';
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.wa_completar_mensagens(jsonb) from public, anon, authenticated;
grant execute on function public.wa_completar_mensagens(jsonb) to service_role;

-- Bucket privado das mídias: só quem está em wa_acesso lê; só o webhook (service_role) grava
insert into storage.buckets (id, name, public) values ('whatsapp', 'whatsapp', false) on conflict (id) do nothing;
drop policy if exists "socios leem midias do whatsapp" on storage.objects;
create policy "socios leem midias do whatsapp" on storage.objects for select to authenticated
  using (bucket_id = 'whatsapp' and public.wa_pode_ver(auth.uid()));

-- Lista de conversas: ignora as mensagens de sistema e completa o nome do contato pela agenda
drop function if exists public.wa_painel_grupos();
create or replace function public.wa_painel_grupos()
returns table (id text, nome text, tipo text, foto text, telefone text, ativo boolean, total bigint, ultima timestamptz,
               ultima_autor text, ultima_texto text, ultima_tipo text, ultima_de_nos boolean)
language sql stable security invoker set search_path = public as $$
  select g.id,
         coalesce(nullif(g.nome, ''), c.nome, ''),
         g.tipo,
         coalesce(nullif(g.foto, ''), c.foto, ''),
         coalesce(nullif(g.telefone, ''), c.telefone, ''),
         g.ativo,
         (select count(*) from public.wa_mensagens m where m.grupo_id = g.id and m.tipo <> 'sistema'),
         u.enviada_em, u.autor_nome, u.texto, u.tipo, u.de_nos
  from public.wa_grupos g
  left join public.wa_contatos c on c.id = g.id
  left join lateral (
    select m.enviada_em, m.autor_nome, m.texto, m.tipo, m.de_nos from public.wa_mensagens m
    where m.grupo_id = g.id and m.tipo <> 'sistema' order by m.enviada_em desc limit 1
  ) u on true
  order by u.enviada_em desc nulls last, g.nome
$$;
revoke execute on function public.wa_painel_grupos() from public, anon;
grant execute on function public.wa_painel_grupos() to authenticated;

-- Mensagem sem telefone do autor: completa pela agenda (o participante vem como @lid)
create or replace function public.wa_completar_autor()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.autor_telefone = '' and new.autor_jid <> '' then
    select c.telefone into new.autor_telefone from public.wa_contatos c where c.id = new.autor_jid and c.telefone <> '';
    new.autor_telefone := coalesce(new.autor_telefone, '');
  end if;
  if new.autor_nome = '' and new.autor_jid <> '' and not new.de_nos then
    select c.nome into new.autor_nome from public.wa_contatos c where c.id = new.autor_jid and c.nome <> '';
    new.autor_nome := coalesce(new.autor_nome, '');
  end if;
  return new;
end $$;
drop trigger if exists wa_mensagens_autor on public.wa_mensagens;
create trigger wa_mensagens_autor before insert or update of autor_telefone on public.wa_mensagens
  for each row execute function public.wa_completar_autor();

-- ---------------------------------------------------------------------
-- Envio de mensagens pelo site (Edge Function whatsapp-enviar)
-- Desligado por padrão; os sócios ligam e desligam no próprio site.
-- O endereço e a chave da Evolution ficam no Vault, criados à mão (nunca neste arquivo):
--   select vault.create_secret('<url da Evolution>', 'wa_evolution_url');
--   select vault.create_secret('<AUTHENTICATION_API_KEY>', 'wa_evolution_chave');
-- ---------------------------------------------------------------------
create table if not exists public.wa_ajustes (
  id int primary key default 1 check (id = 1),
  envio_ativo boolean not null default false,
  alterado_por uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
insert into public.wa_ajustes (id) values (1) on conflict (id) do nothing;
alter table public.wa_ajustes enable row level security;
drop policy if exists "ver ajustes" on public.wa_ajustes;
create policy "ver ajustes" on public.wa_ajustes for select using (public.wa_pode_ver(auth.uid()));
drop policy if exists "mudar ajustes" on public.wa_ajustes;
create policy "mudar ajustes" on public.wa_ajustes for update using (public.wa_pode_ver(auth.uid())) with check (public.wa_pode_ver(auth.uid()));
revoke all on public.wa_ajustes from anon;
grant select on public.wa_ajustes to authenticated;
grant update (envio_ativo) on public.wa_ajustes to authenticated;
drop trigger if exists wa_ajustes_sem_exclusao on public.wa_ajustes;
create trigger wa_ajustes_sem_exclusao before delete on public.wa_ajustes for each row execute function public.bloquear_exclusao();

-- Quem ligou/desligou e quando
create or replace function public.wa_ajustes_tocar()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  new.alterado_por := auth.uid();
  return new;
end $$;
drop trigger if exists wa_ajustes_tocar on public.wa_ajustes;
create trigger wa_ajustes_tocar before update on public.wa_ajustes for each row execute function public.wa_ajustes_tocar();

-- Registro de cada mensagem enviada pelo site (quem mandou, para onde, o quê)
create table if not exists public.wa_envios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  conversa_id text not null references public.wa_grupos(id),
  texto text not null,
  ok boolean not null default false,
  erro text not null default '',
  mensagem_id text not null default '',
  created_at timestamptz not null default now()
);
alter table public.wa_envios enable row level security;
drop policy if exists "ver envios" on public.wa_envios;
create policy "ver envios" on public.wa_envios for select using (public.wa_pode_ver(auth.uid()));
revoke all on public.wa_envios from anon;
grant select on public.wa_envios to authenticated;
drop trigger if exists wa_envios_sem_exclusao on public.wa_envios;
create trigger wa_envios_sem_exclusao before delete on public.wa_envios for each row execute function public.bloquear_exclusao();

do $$ begin alter publication supabase_realtime add table public.wa_ajustes; exception when duplicate_object then null; end $$;

create or replace function public.wa_evolution()
returns table (url text, chave text) language sql stable security definer set search_path = public, vault as $$
  select (select decrypted_secret from vault.decrypted_secrets where name = 'wa_evolution_url'),
         (select decrypted_secret from vault.decrypted_secrets where name = 'wa_evolution_chave')
$$;
revoke execute on function public.wa_evolution() from public, anon, authenticated;
grant execute on function public.wa_evolution() to service_role;

-- ---------------------------------------------------------------------
-- Nome do perfil: quando o WhatsApp não manda o nome, a Evolution põe o código interno (@lid)
-- ou o número no lugar. "Nome" que é só número não vale: usa o nome do perfil que está na agenda.
-- ---------------------------------------------------------------------
create or replace function public.wa_nome_valido(p text)
returns boolean language sql immutable as $$
  select coalesce(trim(p), '') <> '' and trim(p) !~ '^[0-9 +().-]+$'
$$;

create or replace function public.wa_completar_autor()
returns trigger language plpgsql security definer set search_path = public as $$
declare v text;
begin
  if new.autor_telefone = '' and new.autor_jid <> '' then
    select c.telefone into v from public.wa_contatos c where c.id = new.autor_jid and c.telefone <> '';
    new.autor_telefone := coalesce(v, '');
  end if;
  if not new.de_nos and not public.wa_nome_valido(new.autor_nome) and new.autor_jid <> '' then
    v := null;
    select c.nome into v from public.wa_contatos c where c.id = new.autor_jid and public.wa_nome_valido(c.nome);
    if v is null and new.autor_telefone <> '' then
      select c.nome into v from public.wa_contatos c
      where c.id = new.autor_telefone || '@s.whatsapp.net' and public.wa_nome_valido(c.nome);
    end if;
    new.autor_nome := coalesce(v, '');
  end if;
  return new;
end $$;
drop trigger if exists wa_mensagens_autor on public.wa_mensagens;
create trigger wa_mensagens_autor before insert or update of autor_telefone, autor_nome on public.wa_mensagens
  for each row execute function public.wa_completar_autor();

-- A agenda nunca guarda número como nome
create or replace function public.wa_contatos_limpar()
returns trigger language plpgsql set search_path = public as $$
begin
  if not public.wa_nome_valido(new.nome) then
    new.nome := case when tg_op = 'UPDATE' and public.wa_nome_valido(old.nome) then old.nome else '' end;
  end if;
  return new;
end $$;
drop trigger if exists wa_contatos_limpar on public.wa_contatos;
create trigger wa_contatos_limpar before insert or update on public.wa_contatos
  for each row execute function public.wa_contatos_limpar();

-- Quando a agenda ganha o nome de alguém, as mensagens e conversas dessa pessoa passam a mostrar o nome
create or replace function public.wa_contatos_propagar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.wa_nome_valido(new.nome) then
    update public.wa_mensagens set autor_nome = new.nome
      where autor_jid = new.id and not de_nos and not public.wa_nome_valido(autor_nome);
    update public.wa_grupos set nome = new.nome
      where id = new.id and tipo = 'contato' and not public.wa_nome_valido(nome);
  end if;
  return new;
end $$;
drop trigger if exists wa_contatos_propagar on public.wa_contatos;
create trigger wa_contatos_propagar after insert or update of nome on public.wa_contatos
  for each row execute function public.wa_contatos_propagar();
