-- Operação dos hotéis (15/11/2026, pedido do dono): área livre dentro de cada hotel, criada pelo Claude
-- de quem tem a área "Operação do <hotel>" para editar, só pelo conector do Brasico (sem Supabase, Vercel
-- nem GitHub). Por hotel:
--   * banco próprio: schema op_<hotel> (dono = papel de banco op_<hotel>, que NÃO enxerga o resto do
--     Brasico: o schema public e o net deixaram de ser abertos a todos os papéis);
--   * dados do hotel só para ler: schema op_<hotel>_dados (visões filtradas do PMS);
--   * telas: HTML/JS completos em op_paginas, mostrados numa caixa isolada (iframe sem a mesma origem),
--     com rascunho, publicação e histórico; a tela fala com o banco só pelas funções api_* do schema.
-- Conector: operacao_guia, operacao_dados, operacao_sql, operacao_paginas, operacao_ler_pagina,
-- operacao_salvar_pagina, operacao_publicar, operacao_arquivar_pagina, operacao_testar.

-- ---------- 1. fechar o schema public e o net para quem não tem permissão explícita ----------
do $$
declare r text;
begin
  foreach r in array array['authenticator', 'pgbouncer', 'supabase_auth_admin', 'supabase_storage_admin',
    'supabase_functions_admin', 'supabase_etl_admin', 'supabase_read_only_user', 'supabase_replication_admin',
    'supabase_realtime_admin', 'dashboard_user', 'supabase_privileged_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('grant usage on schema public to %I', r);
    end if;
  end loop;
end $$;
revoke usage on schema public from public;
revoke usage on schema net from public;

-- ---------- 2. tabelas das telas e do registro ----------
create table if not exists public.op_paginas (
  hotel text not null check (hotel in ('filha-da-lua', 'sempre-vivo')),
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,60}$'),
  titulo text not null,
  descricao text,
  icone text,
  ordem int not null default 100,
  html text,                     -- versão publicada (o que a equipe vê)
  rascunho text,                 -- versão em trabalho
  publicado_em timestamptz,
  publicado_por uuid,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid,
  arquivado_em timestamptz,
  primary key (hotel, slug)
);
create table if not exists public.op_paginas_historico (
  id bigserial primary key,
  hotel text not null,
  slug text not null,
  tipo text not null check (tipo in ('rascunho', 'publicado', 'arquivado', 'restaurado')),
  titulo text,
  html text,
  por uuid,
  em timestamptz not null default now()
);
create table if not exists public.op_sql_historico (
  id bigserial primary key,
  hotel text not null,
  sql text not null,
  por uuid,
  em timestamptz not null default now(),
  ok boolean,
  resposta text
);
alter table public.op_paginas enable row level security;
alter table public.op_paginas_historico enable row level security;
alter table public.op_sql_historico enable row level security;

-- ---------- 3. áreas novas no controle de acessos ----------
alter table public.acessos_areas drop constraint if exists acessos_areas_area_check;
alter table public.acessos_areas add constraint acessos_areas_area_check check (area in ('projetos', 'brainstorm',
  'whatsapp', 'totvs', 'rh', 'receita', 'certificados', 'integracoes', 'usuarios', 'conectar', 'hoteis', 'operacao',
  'op_filha_da_lua', 'op_sempre_vivo'));

create or replace function public.op_area(p_hotel text)
returns text language sql immutable as $$ select 'op_' || replace(p_hotel, '-', '_') $$;

-- nível na Operação de um hotel: admin edita; quem tem a área, o nível dela; sócio das regras antigas, ver
create or replace function public.op_nivel(p_hotel text, p_user uuid)
returns text language sql stable security definer set search_path to 'public' as $$
  select case
    when p_user is null or p_hotel not in ('filha-da-lua', 'sempre-vivo') then null
    when exists (select 1 from public.acessos where user_id = p_user) then public.acesso_nivel(public.op_area(p_hotel), p_user)
    when public.notas_pode_ver(p_user) then 'ver'
    else null end
$$;

create or replace function public.op_guarda_paginas()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v uuid := public.acesso_usuario();
begin
  if v is not null and coalesce(public.op_nivel(coalesce(new.hotel, old.hotel), v), '') <> 'editar' then
    raise exception 'Sem permissão para editar a Operação deste hotel.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists op_guarda on public.op_paginas;
create trigger op_guarda before insert or update or delete on public.op_paginas
  for each row execute function public.op_guarda_paginas();

-- ---------- 4. o banco de cada hotel ----------
create or replace function public.op_preparar_hotel(p_hotel text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  k text := replace(p_hotel, '-', '_');
  r text := 'op_' || k;          -- papel e schema da operação
  d text := 'op_' || k || '_dados'; -- dados do PMS, só leitura
  v record;
begin
  if not exists (select 1 from pg_roles where rolname = r) then
    execute format('create role %I nologin noinherit', r);
  end if;
  execute format('grant %I to postgres', r);
  execute format('create schema if not exists %I authorization %I', r, r);
  execute format('create schema if not exists %I', d);
  execute format('grant usage on schema %I to %I', d, r);
  execute format('alter role %I set statement_timeout = %L', r, '20s');

  -- visões do PMS só deste hotel (rodam com o dono, por isso o filtro isola o hotel)
  for v in select * from (values
      ('quartos', 'pms_uhs'), ('reservas', 'pms_estadias_canal'), ('hospedes', 'pms_hospedes'),
      ('reserva_hospedes', 'pms_reserva_hospedes'), ('reserva_detalhes', 'pms_reserva_detalhes'),
      ('reserva_historico', 'pms_reserva_historico'), ('bloqueios', 'pms_bloqueios_atuais'),
      ('dias', 'pms_dia_hotel'), ('meses', 'pms_mes_hotel'), ('previsao', 'pms_previsao_atual'),
      ('transacoes', 'pms_transacoes'), ('agora', 'pms_horas'), ('tipos_uh', 'pms_categoria_uhs')
    ) as x(nome, origem) loop
    execute format('create or replace view %I.%I as select * from public.%I where hotel_id = %L', d, v.nome, v.origem, p_hotel);
    execute format('grant select on %I.%I to %I', d, v.nome, r);
  end loop;

  -- executor: roda o SQL com o papel da operação (security definer, dono = papel do hotel)
  execute format($f$
    create or replace function %1$I.__executar(p_sql text)
    returns jsonb language plpgsql security definer set search_path = %1$I, %2$I, pg_catalog as $b$
    declare v_r jsonb; v_n bigint; v_sql text := btrim(p_sql, E' \n\r\t;');
    begin
      if v_sql ~* '^(select|with|values|table)\M' then
        begin
          execute format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from (%%s) t', v_sql) into v_r;
          return jsonb_build_object('linhas', v_r);
        exception when sqlstate '0A000' then null; -- WITH que grava: roda direto
        end;
      end if;
      execute v_sql;
      get diagnostics v_n = row_count;
      return jsonb_build_object('ok', true, 'linhas_afetadas', v_n);
    end $b$
  $f$, r, d);
  execute format('alter function %I.__executar(text) owner to %I', r, r);
  execute format('revoke all on function %I.__executar(text) from public', r);

  -- chamada de uma função api_* pela tela ou pelo teste
  execute format($f$
    create or replace function %1$I.__chamar(p_funcao text, p_args jsonb, p_usuario jsonb)
    returns jsonb language plpgsql security definer set search_path = %1$I, %2$I, pg_catalog as $b$
    declare v_r jsonb;
    begin
      if p_funcao !~ '^api_[a-z0-9_]{1,60}$' then
        raise exception 'A tela só chama funções que começam com api_ (recebido: %%)', p_funcao;
      end if;
      perform set_config('op.usuario', coalesce(p_usuario, '{}'::jsonb)::text, true);
      execute format('select to_jsonb(%%I.%%I($1))', %3$L, p_funcao) into v_r using coalesce(p_args, '{}'::jsonb);
      return v_r;
    end $b$
  $f$, r, d, r);
  execute format('alter function %I.__chamar(text, jsonb, jsonb) owner to %I', r, r);
  execute format('revoke all on function %I.__chamar(text, jsonb, jsonb) from public', r);

  -- quem está usando a tela (dentro das funções api_*): select eu()
  execute format($f$
    create or replace function %1$I.eu() returns jsonb language sql stable as $b$
      select coalesce(nullif(current_setting('op.usuario', true), ''), '{}')::jsonb
    $b$
  $f$, r);
  execute format('alter function %I.eu() owner to %I', r, r);
end $$;
revoke all on function public.op_preparar_hotel(text) from public, anon, authenticated;

select public.op_preparar_hotel('filha-da-lua');
select public.op_preparar_hotel('sempre-vivo');

-- ---------- 5. funções usadas pelo site ----------
-- telas publicadas do hotel (e os rascunhos para quem edita)
create or replace function public.operacao_paginas_site(p_hotel text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_nivel text := public.op_nivel(p_hotel, auth.uid());
begin
  if v_nivel is null then raise exception 'Sem acesso à Operação deste hotel.' using errcode = '42501'; end if;
  return jsonb_build_object('nivel', v_nivel, 'paginas', coalesce((select jsonb_agg(jsonb_build_object(
      'slug', p.slug, 'titulo', p.titulo, 'descricao', p.descricao, 'icone', p.icone, 'ordem', p.ordem,
      'html', p.html, 'publicado_em', p.publicado_em, 'atualizado_em', p.atualizado_em,
      'rascunho', case when v_nivel = 'editar' then p.rascunho end,
      'tem_rascunho', p.rascunho is not null and p.rascunho is distinct from p.html
    ) order by p.ordem, p.titulo)
    from public.op_paginas p where p.hotel = p_hotel and p.arquivado_em is null
      and (p.html is not null or v_nivel = 'editar')), '[]'::jsonb));
end $$;
grant execute on function public.operacao_paginas_site(text) to authenticated;

-- a tela chama uma função api_* do banco do hotel (quem só vê roda em modo só leitura)
create or replace function public.operacao_chamar(p_hotel text, p_funcao text, p_args jsonb default '{}')
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_nivel text := public.op_nivel(p_hotel, auth.uid());
  v_r jsonb;
begin
  if v_nivel is null then raise exception 'Sem acesso à Operação deste hotel.' using errcode = '42501'; end if;
  if v_nivel <> 'editar' and not exists (select 1 from public.acessos where user_id = auth.uid() and tipo = 'admin') then
    perform set_config('transaction_read_only', 'on', true);
  end if;
  execute format('select %I.__chamar($1, $2, $3)', 'op_' || replace(p_hotel, '-', '_')) into v_r
    using p_funcao, p_args, jsonb_build_object('id', auth.uid(), 'nome',
      (select display_name from public.profiles where id = auth.uid()), 'nivel', v_nivel);
  return v_r;
end $$;
grant execute on function public.operacao_chamar(text, text, jsonb) to authenticated;

create or replace function public.operacao_publicar_site(p_hotel text, p_slug text)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if public.op_nivel(p_hotel, auth.uid()) is distinct from 'editar' then
    raise exception 'Só quem edita a Operação publica.' using errcode = '42501';
  end if;
  update public.op_paginas set html = rascunho, publicado_em = now(), publicado_por = auth.uid()
    where hotel = p_hotel and slug = p_slug and rascunho is not null;
  insert into public.op_paginas_historico (hotel, slug, tipo, titulo, html, por)
    select hotel, slug, 'publicado', titulo, html, auth.uid() from public.op_paginas where hotel = p_hotel and slug = p_slug;
end $$;
grant execute on function public.operacao_publicar_site(text, text) to authenticated;

-- ---------- 6. funções do conector (Claude) ----------
-- dono do link com permissão de editar a Operação do hotel
create or replace function public.op_mcp_editor(p_token text, p_hotel text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_user uuid; v_ws uuid;
begin
  select o_user, o_ws into v_user, v_ws from public.mcp_auth(p_token);
  if p_hotel not in ('filha-da-lua', 'sempre-vivo') then
    raise exception 'Hotel desconhecido: use filha-da-lua ou sempre-vivo.';
  end if;
  if public.op_nivel(p_hotel, v_user) is distinct from 'editar' then
    raise exception 'Seu acesso não permite editar a Operação deste hotel.' using errcode = '42501';
  end if;
  return v_user;
end $$;
revoke all on function public.op_mcp_editor(text, text) from public, anon, authenticated;

create or replace function public.mcp_operacao_sql(p_token text, p_hotel text, p_sql text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_user uuid := public.op_mcp_editor(p_token, p_hotel); v_r jsonb; v_id bigint;
begin
  insert into public.op_sql_historico (hotel, sql, por) values (p_hotel, p_sql, v_user) returning id into v_id;
  begin
    execute format('select %I.__executar($1)', 'op_' || replace(p_hotel, '-', '_')) into v_r using p_sql;
  exception when others then
    update public.op_sql_historico set ok = false, resposta = sqlerrm where id = v_id;
    return jsonb_build_object('ok', false, 'erro', sqlerrm, 'codigo', sqlstate);
  end;
  update public.op_sql_historico set ok = true, resposta = left(v_r::text, 2000) where id = v_id;
  return v_r;
end $$;

create or replace function public.mcp_operacao_dados(p_token text, p_hotel text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_user uuid := public.op_mcp_editor(p_token, p_hotel);
  s text := 'op_' || replace(p_hotel, '-', '_');
begin
  return jsonb_build_object(
    'banco_da_operacao', s,
    'dados_do_pms_so_leitura', s || '_dados',
    'visoes', (select jsonb_object_agg(c.table_name, c.colunas) from (
        select table_name, jsonb_agg(column_name || ' ' || data_type order by ordinal_position) colunas
        from information_schema.columns where table_schema = s || '_dados' group by table_name) c),
    'tabelas_criadas', coalesce((select jsonb_object_agg(c.table_name, c.colunas) from (
        select table_name, jsonb_agg(column_name || ' ' || data_type order by ordinal_position) colunas
        from information_schema.columns where table_schema = s group by table_name) c), '{}'::jsonb),
    'funcoes_api', coalesce((select jsonb_agg(p.proname || '(' || pg_get_function_arguments(p.oid) || ')')
        from pg_proc p where p.pronamespace = s::regnamespace and p.proname like 'api\_%'), '[]'::jsonb));
end $$;

create or replace function public.mcp_operacao_paginas(p_token text, p_hotel text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_user uuid := public.op_mcp_editor(p_token, p_hotel);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('slug', slug, 'titulo', titulo, 'descricao', descricao,
      'icone', icone, 'ordem', ordem, 'publicada', html is not null, 'publicado_em', publicado_em,
      'rascunho_diferente', rascunho is distinct from html, 'arquivada', arquivado_em is not null,
      'tamanho_rascunho', length(rascunho)) order by ordem, titulo)
    from public.op_paginas where hotel = p_hotel), '[]'::jsonb);
end $$;

create or replace function public.mcp_operacao_ler_pagina(p_token text, p_hotel text, p_slug text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_user uuid := public.op_mcp_editor(p_token, p_hotel);
begin
  return (select jsonb_build_object('slug', slug, 'titulo', titulo, 'descricao', descricao, 'icone', icone,
      'ordem', ordem, 'rascunho', rascunho, 'publicada', html, 'publicado_em', publicado_em)
    from public.op_paginas where hotel = p_hotel and slug = p_slug);
end $$;

create or replace function public.mcp_operacao_salvar_pagina(p_token text, p_hotel text, p_slug text, p_titulo text,
  p_html text, p_descricao text default null, p_icone text default null, p_ordem int default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_user uuid := public.op_mcp_editor(p_token, p_hotel);
begin
  if length(p_html) > 1500000 then raise exception 'Tela grande demais (máximo 1,5 MB).'; end if;
  insert into public.op_paginas (hotel, slug, titulo, descricao, icone, ordem, rascunho, atualizado_por)
    values (p_hotel, p_slug, p_titulo, p_descricao, p_icone, coalesce(p_ordem, 100), p_html, v_user)
    on conflict (hotel, slug) do update set titulo = excluded.titulo,
      descricao = coalesce(excluded.descricao, op_paginas.descricao), icone = coalesce(excluded.icone, op_paginas.icone),
      ordem = coalesce(p_ordem, op_paginas.ordem), rascunho = excluded.rascunho,
      atualizado_em = now(), atualizado_por = v_user, arquivado_em = null;
  insert into public.op_paginas_historico (hotel, slug, tipo, titulo, html, por) values (p_hotel, p_slug, 'rascunho', p_titulo, p_html, v_user);
  return jsonb_build_object('ok', true, 'situacao', 'rascunho salvo; a equipe só vê depois de operacao_publicar',
    'ver_no_site', '/hoteis/' || p_hotel || '/operacao/' || p_slug || '?rascunho=1');
end $$;

create or replace function public.mcp_operacao_publicar(p_token text, p_hotel text, p_slug text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_user uuid := public.op_mcp_editor(p_token, p_hotel);
begin
  update public.op_paginas set html = rascunho, publicado_em = now(), publicado_por = v_user
    where hotel = p_hotel and slug = p_slug and rascunho is not null;
  if not found then raise exception 'Tela % não existe ou está sem rascunho.', p_slug; end if;
  insert into public.op_paginas_historico (hotel, slug, tipo, titulo, html, por)
    select hotel, slug, 'publicado', titulo, html, v_user from public.op_paginas where hotel = p_hotel and slug = p_slug;
  return jsonb_build_object('ok', true, 'publicada', '/hoteis/' || p_hotel || '/operacao/' || p_slug);
end $$;

create or replace function public.mcp_operacao_arquivar_pagina(p_token text, p_hotel text, p_slug text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_user uuid := public.op_mcp_editor(p_token, p_hotel);
begin
  update public.op_paginas set arquivado_em = now(), atualizado_por = v_user where hotel = p_hotel and slug = p_slug;
  insert into public.op_paginas_historico (hotel, slug, tipo, por) values (p_hotel, p_slug, 'arquivado', v_user);
  return jsonb_build_object('ok', found);
end $$;

create or replace function public.mcp_operacao_testar(p_token text, p_hotel text, p_funcao text, p_args jsonb default '{}')
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_user uuid := public.op_mcp_editor(p_token, p_hotel); v_r jsonb;
begin
  execute format('select %I.__chamar($1, $2, $3)', 'op_' || replace(p_hotel, '-', '_')) into v_r
    using p_funcao, p_args, jsonb_build_object('id', v_user, 'nome', (select display_name from public.profiles where id = v_user), 'nivel', 'editar', 'teste', true);
  return v_r;
exception when others then
  return jsonb_build_object('ok', false, 'erro', sqlerrm, 'codigo', sqlstate);
end $$;

do $$
declare f text;
begin
  foreach f in array array['mcp_operacao_sql(text,text,text)', 'mcp_operacao_dados(text,text)', 'mcp_operacao_paginas(text,text)',
    'mcp_operacao_ler_pagina(text,text,text)', 'mcp_operacao_salvar_pagina(text,text,text,text,text,text,text,integer)',
    'mcp_operacao_publicar(text,text,text)', 'mcp_operacao_arquivar_pagina(text,text,text)', 'mcp_operacao_testar(text,text,text,jsonb)'] loop
    execute format('revoke all on function public.%s from public, authenticated', f);
    execute format('grant execute on function public.%s to anon', f);
  end loop;
end $$;
