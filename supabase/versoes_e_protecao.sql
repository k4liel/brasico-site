-- =====================================================================
-- Brasico — versões dos capítulos, trava contra sobrescrever e proteção
-- contra exclusões. Aplicado em 18/10/2026.
--
-- 1. Toda mudança num capítulo (ou no CSS do projeto) guarda a versão
--    anterior em public.versoes. Nada se perde; dá para voltar.
-- 2. atualizar_nota exige a "versao" lida em ler_nota/ver_documento. Se
--    outra pessoa mudou o capítulo depois disso, a gravação é recusada.
-- 3. Excluir linhas (DELETE/TRUNCATE) ou tabelas (DROP) do Brasico fica
--    bloqueado, a não ser que alguém libere de propósito na mesma transação:
--      set local brasico.permitir_exclusao = 'sim';
-- =====================================================================

-- ---------------------------------------------------------------------
-- Versões
-- ---------------------------------------------------------------------
create table if not exists public.versoes (
  id              bigint generated always as identity primary key,
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  tipo            text not null check (tipo in ('capitulo', 'estilo')),
  ref_id          uuid not null,          -- id do capítulo (ou do projeto, para o estilo)
  titulo          text,
  conteudo        text,
  substituido_por uuid,                   -- quem fez a mudança que trocou esta versão
  origem          text not null default 'web' check (origem in ('web', 'claude')),
  criado_em       timestamptz not null default now()
);
create index if not exists versoes_ref_idx on public.versoes (ref_id, criado_em desc);

alter table public.versoes enable row level security;
drop policy if exists "membros veem versoes" on public.versoes;
create policy "membros veem versoes" on public.versoes
  for select using (public.is_member(workspace_id));
revoke insert, update, delete, truncate on public.versoes from anon, authenticated;

-- Quem está mexendo: o conector marca o usuário do link (mcp_auth);
-- pelo site vale o login.
create or replace function public.brasico_usuario_atual(out o_user uuid, out o_origem text)
language plpgsql stable set search_path = public as $$
declare v text := nullif(current_setting('brasico.usuario', true), '');
begin
  if v is not null then o_user := v::uuid; o_origem := 'claude';
  else o_user := auth.uid(); o_origem := 'web';
  end if;
end $$;

create or replace function public.guardar_versao_capitulo()
returns trigger language plpgsql security definer set search_path = public as $$
declare u record;
begin
  if old.title is distinct from new.title or old.content is distinct from new.content then
    select * into u from public.brasico_usuario_atual();
    insert into public.versoes (workspace_id, tipo, ref_id, titulo, conteudo, substituido_por, origem)
    values (old.workspace_id, 'capitulo', old.id, old.title, old.content, u.o_user, u.o_origem);
  end if;
  return new;
end $$;

drop trigger if exists notes_versao on public.notes;
create trigger notes_versao before update on public.notes
  for each row execute function public.guardar_versao_capitulo();

create or replace function public.guardar_versao_estilo()
returns trigger language plpgsql security definer set search_path = public as $$
declare u record;
begin
  if old.doc_css is distinct from new.doc_css then
    select * into u from public.brasico_usuario_atual();
    insert into public.versoes (workspace_id, tipo, ref_id, titulo, conteudo, substituido_por, origem)
    values (old.id, 'estilo', old.id, 'CSS do projeto', old.doc_css, u.o_user, u.o_origem);
  end if;
  return new;
end $$;

drop trigger if exists workspaces_versao_estilo on public.workspaces;
create trigger workspaces_versao_estilo before update on public.workspaces
  for each row execute function public.guardar_versao_estilo();

-- ---------------------------------------------------------------------
-- Conector: marca o usuário do link para as versões
-- ---------------------------------------------------------------------
create or replace function public.mcp_auth(p_token text, out o_user uuid, out o_ws uuid)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id uuid;
begin
  select t.id, t.user_id, t.workspace_id into v_id, o_user, o_ws
  from public.mcp_tokens t
  where t.token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and t.revoked_at is null;

  if v_id is null then
    raise exception 'Token inválido ou revogado' using errcode = '28000';
  end if;

  if not exists (select 1 from public.workspace_members m
                 where m.workspace_id = o_ws and m.user_id = o_user) then
    raise exception 'Sem acesso a este espaço' using errcode = '42501';
  end if;

  update public.mcp_tokens set last_used_at = now() where id = v_id;
  perform set_config('brasico.usuario', o_user::text, true);
end $$;

-- ---------------------------------------------------------------------
-- Conector: ler devolve a "versao"; atualizar exige a versão lida
-- ---------------------------------------------------------------------
create or replace function public.mcp_ler_nota(p_token text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record; r public.notes;
begin
  select * into a from public.mcp_auth(p_token);
  select * into r from public.notes where id = p_id and workspace_id = a.o_ws;
  if r.id is null then raise exception 'Nota não encontrada neste espaço'; end if;
  return to_jsonb(r) || jsonb_build_object('versao', r.updated_at);
end $$;

create or replace function public.mcp_documento(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record;
begin
  select * into a from public.mcp_auth(p_token);
  return (
    select jsonb_build_object(
      'projeto_id', w.id, 'projeto', w.name, 'rodape', w.doc_rodape, 'estilo_css', coalesce(w.doc_css, ''),
      'capitulos', coalesce((
        select jsonb_agg(jsonb_build_object('id', n.id, 'titulo', n.title, 'versao', n.updated_at, 'conteudo', n.content) order by n.title)
        from public.notes n where n.workspace_id = w.id and n.archived_at is null), '[]'::jsonb),
      'capitulos_removidos', coalesce((
        select jsonb_agg(jsonb_build_object('id', n.id, 'titulo', n.title, 'removido_em', n.archived_at) order by n.archived_at desc)
        from public.notes n where n.workspace_id = w.id and n.archived_at is not null), '[]'::jsonb))
    from public.workspaces w where w.id = a.o_ws);
end $$;

drop function if exists public.mcp_atualizar_nota(text, uuid, text, text);
create or replace function public.mcp_atualizar_nota(p_token text, p_id uuid, p_title text default null,
                                                     p_content text default null, p_versao timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record; r public.notes; v_quem text;
begin
  select * into a from public.mcp_auth(p_token);
  select * into r from public.notes where id = p_id and workspace_id = a.o_ws for update;
  if r.id is null then raise exception 'Nota não encontrada neste espaço'; end if;

  if p_versao is not null and r.updated_at is distinct from p_versao then
    select coalesce(p.display_name, p.email) into v_quem
    from public.activity_log l left join public.profiles p on p.id = l.user_id
    where l.entity = 'notes' and l.entity_id = r.id
    order by l.created_at desc limit 1;
    raise exception 'O capítulo "%" mudou depois que você leu (por %, em %). Nada foi gravado. Leia de novo com ler_nota, junte as suas mudanças com as novas e envie com a versao nova.',
      r.title, coalesce(v_quem, 'outra pessoa'),
      to_char(r.updated_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI');
  end if;

  update public.notes set
    title   = coalesce(p_title, title),
    content = coalesce(p_content, content)
  where id = r.id
  returning * into r;
  perform public.mcp_log(a.o_ws, a.o_user, 'update', 'notes', r.id, r.title);
  return jsonb_build_object('id', r.id, 'title', r.title, 'versao', r.updated_at);
end $$;

-- ---------------------------------------------------------------------
-- Conector: ver e restaurar versões
-- ---------------------------------------------------------------------
create or replace function public.mcp_listar_versoes(p_token text, p_ref uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record;
begin
  select * into a from public.mcp_auth(p_token);
  return coalesce((select jsonb_agg(x) from (
    select v.id as versao_id, v.tipo, v.titulo,
           v.criado_em as substituida_em,
           coalesce(p.display_name, p.email) as substituida_por,
           v.origem, length(coalesce(v.conteudo, '')) as tamanho
    from public.versoes v left join public.profiles p on p.id = v.substituido_por
    where v.workspace_id = a.o_ws
      and (case when p_ref is null then v.tipo = 'estilo' else v.ref_id = p_ref and v.tipo = 'capitulo' end)
    order by v.criado_em desc limit 50) x), '[]'::jsonb);
end $$;

create or replace function public.mcp_ler_versao(p_token text, p_versao bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record; v public.versoes;
begin
  select * into a from public.mcp_auth(p_token);
  select * into v from public.versoes where id = p_versao and workspace_id = a.o_ws;
  if v.id is null then raise exception 'Versão não encontrada neste projeto'; end if;
  return jsonb_build_object('versao_id', v.id, 'tipo', v.tipo, 'ref_id', v.ref_id,
                            'titulo', v.titulo, 'conteudo', v.conteudo, 'substituida_em', v.criado_em);
end $$;

create or replace function public.mcp_restaurar_versao(p_token text, p_versao bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record; v public.versoes; r public.notes;
begin
  select * into a from public.mcp_auth(p_token);
  select * into v from public.versoes where id = p_versao and workspace_id = a.o_ws;
  if v.id is null then raise exception 'Versão não encontrada neste projeto'; end if;

  -- A versão atual é guardada automaticamente antes de voltar (pelos gatilhos).
  if v.tipo = 'capitulo' then
    update public.notes set title = v.titulo, content = v.conteudo
    where id = v.ref_id and workspace_id = a.o_ws returning * into r;
    if r.id is null then raise exception 'O capítulo desta versão não existe mais'; end if;
    perform public.mcp_log(a.o_ws, a.o_user, 'restore_version', 'notes', r.id, r.title);
    return jsonb_build_object('ok', true, 'capitulo', r.id, 'titulo', r.title, 'versao', r.updated_at);
  else
    update public.workspaces set doc_css = v.conteudo where id = a.o_ws;
    perform public.mcp_log(a.o_ws, a.o_user, 'restore_version', 'workspaces', a.o_ws, 'estilo do documento');
    return jsonb_build_object('ok', true, 'estilo', 'restaurado');
  end if;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'mcp_atualizar_nota(text, uuid, text, text, timestamptz)',
    'mcp_listar_versoes(text, uuid)', 'mcp_ler_versao(text, bigint)', 'mcp_restaurar_versao(text, bigint)'
  ] loop
    execute format('revoke execute on function public.%s from public', f);
    execute format('revoke execute on function public.%s from authenticated', f);
    execute format('grant execute on function public.%s to anon', f);
  end loop;
end $$;
revoke execute on function public.brasico_usuario_atual() from public, anon, authenticated;
revoke execute on function public.guardar_versao_capitulo() from public, anon, authenticated;
revoke execute on function public.guardar_versao_estilo() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Proteção contra exclusões
-- ---------------------------------------------------------------------
create or replace function public.bloquear_exclusao()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('brasico.permitir_exclusao', true), '') <> 'sim' then
    raise exception 'Exclusão bloqueada no Brasico (tabela %). Para tirar um capítulo use remover_capitulo. Exclusão de verdade só com pedido explícito do dono, usando: set local brasico.permitir_exclusao = ''sim'';', tg_table_name
      using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else null end;
end $$;

do $$
declare t text;
begin
  foreach t in array array['workspaces', 'workspace_members', 'notes', 'versoes', 'activity_log',
                           'files', 'tasks', 'metrics', 'profiles', 'mcp_tokens'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_sem_exclusao', t);
    execute format('create trigger %I before delete on public.%I for each row execute function public.bloquear_exclusao()',
                   t || '_sem_exclusao', t);
    execute format('drop trigger if exists %I on public.%I', t || '_sem_truncate', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function public.bloquear_exclusao()',
                   t || '_sem_truncate', t);
  end loop;
end $$;

-- Apagar tabelas inteiras (DROP TABLE) também fica bloqueado.
create or replace function public.bloquear_drop()
returns event_trigger language plpgsql set search_path = public as $$
declare o record;
begin
  if coalesce(current_setting('brasico.permitir_exclusao', true), '') = 'sim' then return; end if;
  for o in select * from pg_event_trigger_dropped_objects() loop
    if o.schema_name = 'public' and o.object_type = 'table'
       and o.object_name in ('workspaces', 'workspace_members', 'workspace_invites', 'notes', 'versoes',
                             'activity_log', 'files', 'tasks', 'metrics', 'profiles', 'mcp_tokens') then
      raise exception 'Apagar a tabela % do Brasico está bloqueado. Só com pedido explícito do dono, usando: set local brasico.permitir_exclusao = ''sim'';', o.object_name;
    end if;
  end loop;
end $$;

drop event trigger if exists brasico_sem_drop;
create event trigger brasico_sem_drop on sql_drop execute function public.bloquear_drop();
