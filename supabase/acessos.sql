-- Controle de acessos único (15/11/2026, pedido do dono).
-- Três tipos:
--   admin   = Kaliel e Lukasz: veem e editam tudo, gerenciam usuários e conectam o Claude.
--   editor  = conecta o Claude com limites (ex.: Camila): edita as áreas marcadas como "editar"
--             (projetos: todos menos os restritos); o resto só vê, ou nada.
--   usuario = login no site, sem Claude (ex.: Piotr): cada área nada / ver / editar.
-- Quem não está em `acessos` continua com as regras antigas (equipe das casas: compras,
-- câmara fria, escala). A trava é no banco: o gatilho acesso_guarda recusa gravação de quem
-- só vê, venha do site ou do conector (mcp_auth grava o usuário em brasico.usuario).
-- A visão continua pelas tabelas antigas (*_acesso, workspace_members, usuario_areas),
-- que acessos_aplicar mantém em dia a partir de acessos_areas.

create table if not exists public.acessos (
  user_id uuid primary key references auth.users(id),
  tipo text not null check (tipo in ('admin', 'editor', 'usuario')),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid
);

create table if not exists public.acessos_areas (
  user_id uuid not null references public.acessos(user_id),
  area text not null check (area in ('projetos', 'brainstorm', 'whatsapp', 'totvs', 'rh', 'receita',
    'certificados', 'integracoes', 'usuarios', 'conectar', 'hoteis', 'operacao')),
  nivel text not null check (nivel in ('ver', 'editar')),
  primary key (user_id, area)
);

create table if not exists public.acessos_historico (
  id bigserial primary key,
  user_id uuid not null,
  antes jsonb,
  depois jsonb,
  feito_por uuid,
  feito_em timestamptz not null default now()
);

alter table public.workspaces add column if not exists restrito boolean not null default false;

alter table public.acessos enable row level security;
alter table public.acessos_areas enable row level security;
alter table public.acessos_historico enable row level security;

-- quem está fazendo: o usuário do site ou, no conector, o dono do link (mcp_auth)
create or replace function public.acesso_usuario()
returns uuid language sql stable set search_path to 'public' as $$
  select coalesce(auth.uid(), nullif(current_setting('brasico.usuario', true), '')::uuid)
$$;

create or replace function public.acesso_tipo(p_user uuid)
returns text language sql stable security definer set search_path to 'public' as $$
  select tipo from public.acessos where user_id = p_user
$$;

create or replace function public.acesso_eh_admin(p_user uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce(public.acesso_tipo(p_user) = 'admin', false)
$$;

-- 'editar', 'ver' ou null (sem acesso). Admin edita tudo.
create or replace function public.acesso_nivel(p_area text, p_user uuid)
returns text language sql stable security definer set search_path to 'public' as $$
  select case public.acesso_tipo(p_user)
    when 'admin' then 'editar'
    else (select nivel from public.acessos_areas where user_id = p_user and area = p_area) end
$$;

-- pode gravar na área? Rotinas automáticas (sem usuário) e quem segue as regras antigas, sim.
create or replace function public.acesso_pode_editar(p_area text)
returns boolean language plpgsql stable security definer set search_path to 'public' as $$
declare v uuid := public.acesso_usuario();
begin
  if v is null or not exists (select 1 from public.acessos where user_id = v) then return true; end if;
  return public.acesso_nivel(p_area, v) = 'editar';
end $$;

create or replace function public.acesso_guarda()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.acesso_pode_editar(tg_argv[0]) then
    raise exception 'Você só tem acesso para ver esta área (%). Peça a um administrador para liberar a edição.', tg_argv[0]
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;

-- gatilho em todas as tabelas de cada área (os registros de consulta ficam de fora)
do $$
declare
  r record;
  v_area text;
begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    v_area := case
      when r.tablename in ('activity_log', 'mcp_tokens', 'profiles', 'cicchetti_consultas', 'esocial_consultas',
                           'compras_testes', '_brasico_teste', 'acessos_historico') then null
      when r.tablename like '%\_consultas' or r.tablename like 'totvs\_dias\_copia%' then null
      when r.tablename in ('notes', 'files', 'metrics', 'tasks', 'versoes', 'workspaces', 'workspace_members',
                           'workspace_invites', 'celulas_editaveis', 'celulas_editaveis_historico',
                           'filhadalua_capitulos', 'filhadalua_estilo', 'hoteis_capitulos') then 'projetos'
      when r.tablename in ('listas', 'lista_itens', 'ideias', 'ideia_comentarios') then 'brainstorm'
      when r.tablename like 'wa\_%' and r.tablename <> 'wa_acesso' then 'whatsapp'
      when r.tablename like 'totvs\_%' and r.tablename <> 'totvs_acesso' then 'totvs'
      when (r.tablename like 'esocial\_%' or r.tablename like 'rhid\_%' or r.tablename like 'escala\_%')
           and r.tablename not in ('esocial_acesso', 'rhid_acesso') then 'rh'
      when (r.tablename like 'receita\_%' or r.tablename like 'fiscal\_%') and r.tablename <> 'receita_acesso' then 'receita'
      when r.tablename = 'certificados' then 'certificados'
      when r.tablename like 'pms\_%' or r.tablename = 'hoteis' then 'hoteis'
      when r.tablename like 'compras\_%' or r.tablename like 'notas%' or r.tablename like 'nfse\_%'
           or r.tablename like 'precos\_%' or r.tablename like 'fichas%' or r.tablename like 'insumos%'
           or r.tablename like 'estoque\_%' or r.tablename like 'producao\_%' then 'operacao'
      when r.tablename like '%\_acesso' or r.tablename in ('usuario_areas', 'operacao_pessoas', 'acessos', 'acessos_areas') then 'usuarios'
      else null end;
    if v_area is not null then
      execute format('drop trigger if exists acesso_guarda on public.%I', r.tablename);
      execute format('create trigger acesso_guarda before insert or update or delete on public.%I
                      for each row execute function public.acesso_guarda(%L)', r.tablename, v_area);
    end if;
  end loop;
end $$;

-- Aplica os acessos de uma pessoa nas tabelas antigas (menu, páginas, dados, projetos).
create or replace function public.acessos_aplicar(p_user uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_tipo text := public.acesso_tipo(p_user);
  v_areas text[];
  v_socio boolean;
begin
  if v_tipo is null then return; end if;
  perform set_config('brasico.permitir_exclusao', 'sim', true);
  perform set_config('brasico.usuario', '', true); -- a aplicação é do sistema, não da pessoa

  select coalesce(array_agg(area order by area), '{}') into v_areas
  from public.acessos_areas where user_id = p_user;
  if v_tipo = 'admin' then v_areas := null; end if;

  -- menu e páginas: admin sem linha (= tudo); os outros só as áreas marcadas
  if v_areas is null then
    delete from public.usuario_areas where user_id = p_user;
  else
    if v_tipo = 'editor' and not ('conectar' = any(v_areas)) then v_areas := array_append(v_areas, 'conectar'::text); end if;
    insert into public.usuario_areas (user_id, areas) values (p_user, v_areas)
      on conflict (user_id) do update set areas = excluded.areas;
  end if;

  -- dados de cada área
  v_socio := v_areas is null or v_areas && array['receita', 'certificados', 'integracoes', 'hoteis', 'operacao', 'usuarios'];
  if v_socio then insert into public.notas_acesso (user_id) values (p_user) on conflict do nothing;
  else delete from public.notas_acesso where user_id = p_user; end if;
  if v_areas is null or 'totvs' = any(v_areas) then insert into public.totvs_acesso (user_id) values (p_user) on conflict do nothing;
  else delete from public.totvs_acesso where user_id = p_user; end if;
  if v_areas is null or 'rh' = any(v_areas) then
    insert into public.esocial_acesso (user_id) values (p_user) on conflict do nothing;
    insert into public.rhid_acesso (user_id) values (p_user) on conflict do nothing;
  else
    delete from public.esocial_acesso where user_id = p_user;
    delete from public.rhid_acesso where user_id = p_user;
  end if;
  if v_areas is null or 'whatsapp' = any(v_areas) then insert into public.wa_acesso (user_id) values (p_user) on conflict do nothing;
  else delete from public.wa_acesso where user_id = p_user; end if;
  if v_areas is null or 'receita' = any(v_areas) then insert into public.receita_acesso (user_id) values (p_user) on conflict do nothing;
  else delete from public.receita_acesso where user_id = p_user; end if;
  if v_areas is null or 'operacao' = any(v_areas) then insert into public.cicchetti_acesso (user_id) values (p_user) on conflict do nothing;
  else delete from public.cicchetti_acesso where user_id = p_user; end if;

  -- projetos: admin em todos; quem tem a área em todos os não restritos
  if v_areas is null then
    insert into public.workspace_members (workspace_id, user_id, role)
      select w.id, p_user, 'member' from public.workspaces w on conflict do nothing;
  elsif 'projetos' = any(v_areas) then
    insert into public.workspace_members (workspace_id, user_id, role)
      select w.id, p_user, 'member' from public.workspaces w where not w.restrito on conflict do nothing;
    delete from public.workspace_members m using public.workspaces w
      where m.workspace_id = w.id and m.user_id = p_user and w.restrito;
  else
    delete from public.workspace_members where user_id = p_user;
  end if;
end $$;

-- projeto novo: entra para os admins e para quem tem a área de projetos
create or replace function public.acessos_projeto_novo()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role)
    select new.id, a.user_id, 'member' from public.acessos a
    where a.tipo = 'admin'
       or (not new.restrito and exists (select 1 from public.acessos_areas x where x.user_id = a.user_id and x.area = 'projetos'))
    on conflict do nothing;
  return new;
end $$;
drop trigger if exists acessos_projeto_novo on public.workspaces;
create trigger acessos_projeto_novo after insert on public.workspaces
  for each row execute function public.acessos_projeto_novo();

-- ---------- funções da tela (só administradores) ----------
create or replace function public.acessos_lista()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.acesso_eh_admin(auth.uid()) then raise exception 'Só administradores' using errcode = '42501'; end if;
  return jsonb_build_object(
    'pessoas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'nome', p.display_name, 'email', p.email,
        'tipo', a.tipo,
        'areas', coalesce((select jsonb_object_agg(x.area, x.nivel) from public.acessos_areas x where x.user_id = p.id), '{}'::jsonb),
        'papel_antigo', case when a.tipo is null then public.operacao_papel(p.id) end,
        'claude', exists (select 1 from public.mcp_tokens t where t.user_id = p.id and t.revoked_at is null)
      ) order by a.tipo nulls last, p.display_name)
      from public.profiles p left join public.acessos a on a.user_id = p.id
      where a.user_id is not null or public.operacao_papel(p.id) = 'socio'), '[]'::jsonb),
    'projetos', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'nome', w.name, 'restrito', w.restrito) order by w.name)
      from public.workspaces w where w.removido_em is null), '[]'::jsonb));
end $$;

create or replace function public.acessos_salvar(p_user uuid, p_tipo text, p_areas jsonb)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_antes jsonb;
  k text;
begin
  if not public.acesso_eh_admin(auth.uid()) then raise exception 'Só administradores' using errcode = '42501'; end if;
  if p_user = auth.uid() and p_tipo <> 'admin' then raise exception 'Você não pode tirar o seu próprio acesso de administrador'; end if;
  select jsonb_build_object('tipo', a.tipo, 'areas',
           (select jsonb_object_agg(x.area, x.nivel) from public.acessos_areas x where x.user_id = a.user_id))
    into v_antes from public.acessos a where a.user_id = p_user;

  insert into public.acessos (user_id, tipo, atualizado_por) values (p_user, p_tipo, auth.uid())
    on conflict (user_id) do update set tipo = excluded.tipo, atualizado_em = now(), atualizado_por = auth.uid();
  perform set_config('brasico.permitir_exclusao', 'sim', true);
  delete from public.acessos_areas where user_id = p_user;
  if p_tipo <> 'admin' then
    for k in select jsonb_object_keys(coalesce(p_areas, '{}'::jsonb)) loop
      if p_areas->>k in ('ver', 'editar') then
        insert into public.acessos_areas (user_id, area, nivel) values (p_user, k, p_areas->>k);
      end if;
    end loop;
  end if;
  insert into public.acessos_historico (user_id, antes, depois, feito_por)
    values (p_user, v_antes, jsonb_build_object('tipo', p_tipo, 'areas', case when p_tipo = 'admin' then null else p_areas end), auth.uid());
  perform public.acessos_aplicar(p_user);
end $$;

create or replace function public.acessos_projeto_restrito(p_projeto uuid, p_restrito boolean)
returns void language plpgsql security definer set search_path to 'public' as $$
declare r record;
begin
  if not public.acesso_eh_admin(auth.uid()) then raise exception 'Só administradores' using errcode = '42501'; end if;
  update public.workspaces set restrito = p_restrito where id = p_projeto;
  for r in select user_id from public.acessos loop perform public.acessos_aplicar(r.user_id); end loop;
end $$;

revoke all on function public.acessos_aplicar(uuid) from public, anon, authenticated;
grant execute on function public.acessos_lista() to authenticated;
grant execute on function public.acessos_salvar(uuid, text, jsonb) to authenticated;
grant execute on function public.acessos_projeto_restrito(uuid, boolean) to authenticated;

-- conectar o Claude: só administradores e editores
drop policy if exists mcp_tokens_insert on public.mcp_tokens;
do $$
declare r record;
begin
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = 'mcp_tokens' and cmd = 'INSERT' loop
    execute format('drop policy %I on public.mcp_tokens', r.policyname);
  end loop;
end $$;
create policy mcp_tokens_insert on public.mcp_tokens for insert to authenticated
  with check (user_id = auth.uid() and is_member(workspace_id)
              and coalesce(public.acesso_tipo(auth.uid()), '') in ('admin', 'editor'));

-- quem só vê não dispara gravações ao abrir a página (sincronização da escala, convites)
do $$
declare d text;
begin
  d := pg_get_functiondef('public.escala_membros_sincronizar(jsonb)'::regprocedure);
  if d not like '%acesso_pode_editar%' then
    d := regexp_replace(d, '(organizam os grupos\.''[^;]*;\s*end if;)', '\1
  if not public.acesso_pode_editar(''rh'') then return 0; end if;');
    execute d;
  end if;
  d := pg_get_functiondef('public.accept_invites()'::regprocedure);
  if d not like '%acesso_pode_editar%' then
    d := regexp_replace(d, '\mbegin\M', 'begin
  if not public.acesso_pode_editar(''projetos'') then return 0; end if;');
    execute d;
  end if;
end $$;

-- convidar para os projetos (Claude e equipe): só administradores (migration acessos_convite_so_admin)
do $$
declare d text;
begin
  d := pg_get_functiondef('public.convidar_equipe(text)'::regprocedure);
  if d not like '%acesso_eh_admin%' then
    d := regexp_replace(d, '\mbegin\M', 'begin
  if exists (select 1 from public.acessos where user_id = auth.uid()) and not public.acesso_eh_admin(auth.uid()) then
    raise exception ''Só os administradores convidam pessoas. Os acessos ficam na página Usuários.'' using errcode = ''42501'';
  end if;');
    execute d;
  end if;
end $$;
