-- Área "Brainstorm" (tabelas: ideias): ideias e tarefas da equipe, fora dos projetos.
-- Quadro: entrada → conversa → decidido → fazendo → feito, mais "estacionado".
-- Quem vê: a equipe (quem divide algum projeto com quem criou a ideia);
-- se a ideia está ligada a um projeto, quem é membro desse projeto.

create table if not exists public.ideias (
  id uuid primary key default gen_random_uuid(),
  titulo text not null check (length(trim(titulo)) between 1 and 200),
  descricao text not null default '',
  status text not null default 'entrada'
    check (status in ('entrada', 'conversa', 'decidido', 'fazendo', 'feito', 'estacionado')),
  workspace_id uuid references public.workspaces(id),
  responsavel uuid references auth.users(id),
  prazo date,
  rever_em date,
  decisao text,
  criado_por uuid not null references auth.users(id) default auth.uid(),
  origem text not null default 'web',
  arquivada_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ideia_comentarios (
  id uuid primary key default gen_random_uuid(),
  ideia_id uuid not null references public.ideias(id),
  autor uuid not null references auth.users(id) default auth.uid(),
  texto text not null check (length(trim(texto)) between 1 and 4000),
  origem text not null default 'web',
  created_at timestamptz not null default now()
);

create index if not exists ideias_status_idx on public.ideias (status, updated_at desc);
create index if not exists ideia_comentarios_ideia_idx on public.ideia_comentarios (ideia_id, created_at);

-- Quem pode ver/editar uma ideia
create or replace function public.ideia_acesso(p_criador uuid, p_ws uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when p_user is null then false
    when p_ws is not null then exists (select 1 from public.workspace_members where workspace_id = p_ws and user_id = p_user)
    else p_user = p_criador or exists (
      select 1 from public.workspace_members a join public.workspace_members b on a.workspace_id = b.workspace_id
      where a.user_id = p_user and b.user_id = p_criador)
  end
$$;
revoke execute on function public.ideia_acesso(uuid, uuid, uuid) from public, anon;
grant execute on function public.ideia_acesso(uuid, uuid, uuid) to authenticated;

create or replace function public.ideias_tocar()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists ideias_tocar on public.ideias;
create trigger ideias_tocar before update on public.ideias for each row execute function public.ideias_tocar();

-- Comentário novo "mexe" na ideia (sobe no quadro)
create or replace function public.ideia_comentario_tocar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.ideias set updated_at = now() where id = new.ideia_id;
  return new;
end $$;
drop trigger if exists ideia_comentario_tocar on public.ideia_comentarios;
create trigger ideia_comentario_tocar after insert on public.ideia_comentarios for each row execute function public.ideia_comentario_tocar();

-- Nada some de verdade: arquivar em vez de apagar
drop trigger if exists ideias_sem_exclusao on public.ideias;
create trigger ideias_sem_exclusao before delete on public.ideias for each row execute function public.bloquear_exclusao();
drop trigger if exists ideia_comentarios_sem_exclusao on public.ideia_comentarios;
create trigger ideia_comentarios_sem_exclusao before delete on public.ideia_comentarios for each row execute function public.bloquear_exclusao();

alter table public.ideias enable row level security;
alter table public.ideia_comentarios enable row level security;

drop policy if exists "ver ideias" on public.ideias;
create policy "ver ideias" on public.ideias for select
  using (public.ideia_acesso(criado_por, workspace_id, auth.uid()));
drop policy if exists "criar ideias" on public.ideias;
create policy "criar ideias" on public.ideias for insert
  with check (criado_por = auth.uid() and (workspace_id is null or public.is_member(workspace_id)));
drop policy if exists "editar ideias" on public.ideias;
create policy "editar ideias" on public.ideias for update
  using (public.ideia_acesso(criado_por, workspace_id, auth.uid()))
  with check (workspace_id is null or public.is_member(workspace_id));

drop policy if exists "ver comentarios" on public.ideia_comentarios;
create policy "ver comentarios" on public.ideia_comentarios for select
  using (exists (select 1 from public.ideias i where i.id = ideia_id and public.ideia_acesso(i.criado_por, i.workspace_id, auth.uid())));
drop policy if exists "comentar" on public.ideia_comentarios;
create policy "comentar" on public.ideia_comentarios for insert
  with check (autor = auth.uid() and exists (select 1 from public.ideias i where i.id = ideia_id and public.ideia_acesso(i.criado_por, i.workspace_id, auth.uid())));

grant select, insert, update on public.ideias, public.ideia_comentarios to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.ideias;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.ideia_comentarios;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Conector (Claude): mesmas regras, pelo link do Claude
-- ---------------------------------------------------------------------
create or replace function public.mcp_ideia_json(i public.ideias)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', i.id, 'titulo', i.titulo, 'descricao', i.descricao, 'status', i.status,
    'projeto', (select name from public.workspaces where id = i.workspace_id), 'projeto_id', i.workspace_id,
    'responsavel', (select coalesce(display_name, email) from public.profiles where id = i.responsavel),
    'prazo', i.prazo, 'rever_em', i.rever_em, 'decisao', i.decisao,
    'criada_por', (select coalesce(display_name, email) from public.profiles where id = i.criado_por),
    'criada_em', i.created_at, 'atualizada_em', i.updated_at,
    'comentarios', (select count(*) from public.ideia_comentarios c where c.ideia_id = i.id))
$$;
revoke execute on function public.mcp_ideia_json(public.ideias) from public, anon, authenticated;

create or replace function public.mcp_listar_ideias(p_token text, p_status text default null, p_busca text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record;
begin
  select * into a from public.mcp_auth(p_token);
  return jsonb_build_object(
    'hoje', current_date,
    'ideias', coalesce((
      select jsonb_agg(public.mcp_ideia_json(i) order by
        array_position(array['fazendo','decidido','conversa','entrada','estacionado','feito'], i.status), i.updated_at desc)
      from public.ideias i
      where i.arquivada_em is null
        and public.ideia_acesso(i.criado_por, i.workspace_id, a.o_user)
        and (p_status is null or i.status = p_status)
        and (p_busca is null or i.titulo ilike '%' || p_busca || '%' or i.descricao ilike '%' || p_busca || '%')), '[]'::jsonb));
end $$;

create or replace function public.mcp_ler_ideia(p_token text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record; i public.ideias;
begin
  select * into a from public.mcp_auth(p_token);
  select * into i from public.ideias where id = p_id;
  if i.id is null or not public.ideia_acesso(i.criado_por, i.workspace_id, a.o_user) then raise exception 'Ideia não encontrada'; end if;
  return public.mcp_ideia_json(i) || jsonb_build_object('comentarios', coalesce((
    select jsonb_agg(jsonb_build_object('autor', coalesce(p.display_name, p.email), 'texto', c.texto, 'via', c.origem, 'em', c.created_at) order by c.created_at)
    from public.ideia_comentarios c left join public.profiles p on p.id = c.autor where c.ideia_id = i.id), '[]'::jsonb));
end $$;

create or replace function public.mcp_usuario_por_nome(p_quem text, p_user uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select p.id from public.profiles p
  where (lower(p.email) = lower(trim(p_quem)) or lower(p.display_name) = lower(trim(p_quem))
         or lower(split_part(p.email, '@', 1)) = lower(trim(p_quem)))
    and (p.id = p_user or exists (select 1 from public.workspace_members a join public.workspace_members b on a.workspace_id = b.workspace_id
                                  where a.user_id = p_user and b.user_id = p.id))
  limit 1
$$;
revoke execute on function public.mcp_usuario_por_nome(text, uuid) from public, anon, authenticated;

create or replace function public.mcp_anotar_ideia(p_token text, p_titulo text, p_descricao text default null,
                                                   p_status text default 'entrada', p_projeto uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record; i public.ideias;
begin
  select * into a from public.mcp_auth(p_token);
  if p_projeto is not null and not exists (select 1 from public.workspace_members where workspace_id = p_projeto and user_id = a.o_user) then
    raise exception 'Você não participa desse projeto';
  end if;
  insert into public.ideias (titulo, descricao, status, workspace_id, criado_por, origem)
  values (trim(p_titulo), coalesce(p_descricao, ''), coalesce(p_status, 'entrada'), p_projeto, a.o_user, 'claude')
  returning * into i;
  return public.mcp_ideia_json(i);
end $$;

create or replace function public.mcp_atualizar_ideia(p_token text, p_id uuid, p_titulo text default null, p_descricao text default null,
  p_status text default null, p_projeto uuid default null, p_sem_projeto boolean default false, p_responsavel text default null,
  p_prazo date default null, p_rever_em date default null, p_decisao text default null, p_arquivar boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record; i public.ideias; v_resp uuid;
begin
  select * into a from public.mcp_auth(p_token);
  select * into i from public.ideias where id = p_id for update;
  if i.id is null or not public.ideia_acesso(i.criado_por, i.workspace_id, a.o_user) then raise exception 'Ideia não encontrada'; end if;
  if p_projeto is not null and not exists (select 1 from public.workspace_members where workspace_id = p_projeto and user_id = a.o_user) then
    raise exception 'Você não participa desse projeto';
  end if;
  if p_responsavel is not null and trim(p_responsavel) <> '' then
    v_resp := public.mcp_usuario_por_nome(p_responsavel, a.o_user);
    if v_resp is null then raise exception 'Não achei "%" na equipe. Use o e-mail ou o nome que aparece em listar_membros.', p_responsavel; end if;
  end if;
  update public.ideias set
    titulo = coalesce(nullif(trim(p_titulo), ''), titulo),
    descricao = coalesce(p_descricao, descricao),
    status = coalesce(p_status, status),
    workspace_id = case when p_sem_projeto then null else coalesce(p_projeto, workspace_id) end,
    responsavel = case when p_responsavel is null then responsavel when trim(p_responsavel) = '' then null else v_resp end,
    prazo = coalesce(p_prazo, prazo),
    rever_em = coalesce(p_rever_em, rever_em),
    decisao = coalesce(p_decisao, decisao),
    arquivada_em = case when p_arquivar then now() else arquivada_em end
  where id = i.id returning * into i;
  return public.mcp_ideia_json(i);
end $$;

create or replace function public.mcp_comentar_ideia(p_token text, p_id uuid, p_texto text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record; i public.ideias;
begin
  select * into a from public.mcp_auth(p_token);
  select * into i from public.ideias where id = p_id;
  if i.id is null or not public.ideia_acesso(i.criado_por, i.workspace_id, a.o_user) then raise exception 'Ideia não encontrada'; end if;
  insert into public.ideia_comentarios (ideia_id, autor, texto, origem) values (i.id, a.o_user, trim(p_texto), 'claude');
  return jsonb_build_object('ok', true, 'ideia', i.titulo);
end $$;

revoke execute on function public.mcp_listar_ideias(text, text, text) from public, authenticated;
revoke execute on function public.mcp_ler_ideia(text, uuid) from public, authenticated;
revoke execute on function public.mcp_anotar_ideia(text, text, text, text, uuid) from public, authenticated;
revoke execute on function public.mcp_atualizar_ideia(text, uuid, text, text, text, uuid, boolean, text, date, date, text, boolean) from public, authenticated;
revoke execute on function public.mcp_comentar_ideia(text, uuid, text) from public, authenticated;
grant execute on function public.mcp_listar_ideias(text, text, text) to anon, service_role;
grant execute on function public.mcp_ler_ideia(text, uuid) to anon, service_role;
grant execute on function public.mcp_anotar_ideia(text, text, text, text, uuid) to anon, service_role;
grant execute on function public.mcp_atualizar_ideia(text, uuid, text, text, text, uuid, boolean, text, date, date, text, boolean) to anon, service_role;
grant execute on function public.mcp_comentar_ideia(text, uuid, text) to anon, service_role;
