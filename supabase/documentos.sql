-- =====================================================================
-- Brasico — Central de projetos: documento, compartilhamento e Claude
-- =====================================================================

-- Compartilhamento público (somente leitura) e rodapé do documento
alter table public.workspaces
  add column if not exists is_public boolean not null default false,
  add column if not exists public_slug text unique,
  add column if not exists doc_rodape text;

-- Documento público: só devolve se o projeto estiver compartilhado
create or replace function public.documento_publico(p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'nome', w.name,
    'rodape', w.doc_rodape,
    'capitulos', coalesce((
      select jsonb_agg(jsonb_build_object('titulo', n.title, 'conteudo', n.content, 'atualizado', n.updated_at)
                       order by n.title)
      from public.notes n where n.workspace_id = w.id), '[]'::jsonb))
  from public.workspaces w
  where w.public_slug = p_slug and w.is_public;
$$;

revoke execute on function public.documento_publico(text) from public;
grant execute on function public.documento_publico(text) to anon, authenticated;

-- ---------- Conector do Claude: projetos ----------

-- Documento completo do projeto ativo do link
create or replace function public.mcp_documento(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record;
begin
  select * into a from public.mcp_auth(p_token);
  return (
    select jsonb_build_object(
      'projeto_id', w.id, 'projeto', w.name, 'rodape', w.doc_rodape,
      'publico', w.is_public, 'slug_publico', w.public_slug,
      'capitulos', coalesce((
        select jsonb_agg(jsonb_build_object('id', n.id, 'titulo', n.title, 'conteudo', n.content) order by n.title)
        from public.notes n where n.workspace_id = w.id), '[]'::jsonb))
    from public.workspaces w where w.id = a.o_ws);
end $$;

-- Projetos de que o dono do link participa
create or replace function public.mcp_listar_projetos(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record;
begin
  select * into a from public.mcp_auth(p_token);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', w.id, 'nome', w.name, 'ativo', w.id = a.o_ws,
      'publico', w.is_public, 'slug_publico', w.public_slug,
      'capitulos', (select count(*) from public.notes n where n.workspace_id = w.id)) order by w.created_at)
    from public.workspaces w
    join public.workspace_members m on m.workspace_id = w.id and m.user_id = a.o_user), '[]'::jsonb);
end $$;

-- Troca o projeto em que o Claude está trabalhando
create or replace function public.mcp_usar_projeto(p_token text, p_projeto uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare a record; v_nome text;
begin
  select * into a from public.mcp_auth(p_token);
  if not exists (select 1 from public.workspace_members
                 where workspace_id = p_projeto and user_id = a.o_user) then
    raise exception 'Você não participa desse projeto';
  end if;
  update public.mcp_tokens set workspace_id = p_projeto
  where token_hash = encode(digest(p_token, 'sha256'), 'hex') and revoked_at is null;
  select name into v_nome from public.workspaces where id = p_projeto;
  return jsonb_build_object('projeto_id', p_projeto, 'projeto', v_nome, 'ativo', true);
end $$;

-- Cria um projeto novo e passa a trabalhar nele
create or replace function public.mcp_criar_projeto(p_token text, p_nome text, p_rodape text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare a record; v_id uuid;
begin
  select * into a from public.mcp_auth(p_token);
  if coalesce(trim(p_nome), '') = '' then raise exception 'Informe o nome do projeto'; end if;
  insert into public.workspaces (name, created_by, doc_rodape)
  values (trim(p_nome), a.o_user, p_rodape)
  returning id into v_id;
  update public.mcp_tokens set workspace_id = v_id
  where token_hash = encode(digest(p_token, 'sha256'), 'hex') and revoked_at is null;
  perform public.mcp_log(v_id, a.o_user, 'insert', 'workspaces', v_id, trim(p_nome));
  return jsonb_build_object('projeto_id', v_id, 'projeto', trim(p_nome), 'ativo', true);
end $$;

-- Liga/desliga o link público do projeto ativo
create or replace function public.mcp_compartilhar(p_token text, p_publico boolean)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare a record; v_slug text;
begin
  select * into a from public.mcp_auth(p_token);
  update public.workspaces
  set is_public = p_publico,
      public_slug = coalesce(public_slug, encode(gen_random_bytes(6), 'hex'))
  where id = a.o_ws
  returning public_slug into v_slug;
  perform public.mcp_log(a.o_ws, a.o_user, 'update', 'workspaces', a.o_ws,
                         case when p_publico then 'link público ativado' else 'link público desativado' end);
  return jsonb_build_object('publico', p_publico, 'caminho', '/p/' || v_slug);
end $$;

-- Rodapé do documento do projeto ativo
create or replace function public.mcp_definir_rodape(p_token text, p_rodape text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record;
begin
  select * into a from public.mcp_auth(p_token);
  update public.workspaces set doc_rodape = nullif(trim(p_rodape), '') where id = a.o_ws;
  return jsonb_build_object('rodape', nullif(trim(p_rodape), ''));
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'mcp_documento(text)', 'mcp_listar_projetos(text)', 'mcp_usar_projeto(text, uuid)',
    'mcp_criar_projeto(text, text, text)', 'mcp_compartilhar(text, boolean)', 'mcp_definir_rodape(text, text)'
  ] loop
    execute format('revoke execute on function public.%s from public', f);
    execute format('revoke execute on function public.%s from authenticated', f);
    execute format('grant execute on function public.%s to anon', f);
  end loop;
end $$;
