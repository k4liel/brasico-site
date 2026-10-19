-- =====================================================================
-- Brasico — link público de um projeto (só leitura, sem login)
-- Quem tem o link vê só o documento daquele projeto: capítulos, idiomas,
-- rodapé e estilo. Nada de membros, e-mails, mudanças, arquivos ou outros
-- projetos. O link é um código aleatório de 32 caracteres; gerar um novo
-- invalida o anterior; desativar tira o acesso na hora.
-- =====================================================================

-- Começa tudo fechado: links antigos (código curto) deixam de valer.
update public.workspaces set is_public = false, public_slug = null
where is_public or public_slug is not null;

-- Documento público: só o conteúdo, e só se o link estiver ativo
create or replace function public.documento_publico(p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'nome', w.name,
    'rodape', w.doc_rodape, 'rodape_en', w.doc_rodape_en, 'rodape_pl', w.doc_rodape_pl,
    'css', w.doc_css,
    'abas', coalesce(w.doc_abas, false),
    'capitulos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'titulo', n.title, 'conteudo', n.content,
               'titulo_en', n.title_en, 'conteudo_en', n.content_en,
               'titulo_pl', n.title_pl, 'conteudo_pl', n.content_pl)
             order by n.title)
      from public.notes n where n.workspace_id = w.id and n.archived_at is null), '[]'::jsonb))
  from public.workspaces w
  where length(coalesce(p_slug, '')) >= 32
    and w.public_slug = p_slug and w.is_public and w.removido_em is null;
$$;
revoke execute on function public.documento_publico(text) from public;
grant execute on function public.documento_publico(text) to anon, authenticated;

-- Ativar, desativar ou trocar o link (só membros do projeto, pelo site)
create or replace function public.compartilhar_projeto(p_projeto uuid, p_ativo boolean, p_novo boolean default false)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_slug text;
begin
  if not public.is_member(p_projeto) then raise exception 'Você não faz parte deste projeto'; end if;
  update public.workspaces
     set is_public = p_ativo,
         public_slug = case when p_novo or public_slug is null or length(public_slug) < 32
                            then encode(gen_random_bytes(16), 'hex') else public_slug end
   where id = p_projeto
  returning public_slug into v_slug;
  insert into public.activity_log (workspace_id, user_id, action, entity, entity_id, details, source)
  values (p_projeto, auth.uid(), 'update', 'workspaces', p_projeto,
          case when not p_ativo then 'link público desativado' when p_novo then 'novo link público' else 'link público ativado' end, 'web');
  return jsonb_build_object('publico', p_ativo, 'caminho', '/p/' || v_slug);
end $$;
revoke execute on function public.compartilhar_projeto(uuid, boolean, boolean) from public, anon;
grant execute on function public.compartilhar_projeto(uuid, boolean, boolean) to authenticated;

-- Mesmo controle pelo conector do Claude
drop function if exists public.mcp_compartilhar(text, boolean);
create or replace function public.mcp_compartilhar(p_token text, p_publico boolean, p_novo boolean default false)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare a record; v_slug text;
begin
  select * into a from public.mcp_auth(p_token);
  update public.workspaces
     set is_public = p_publico,
         public_slug = case when p_novo or public_slug is null or length(public_slug) < 32
                            then encode(gen_random_bytes(16), 'hex') else public_slug end
   where id = a.o_ws
  returning public_slug into v_slug;
  perform public.mcp_log(a.o_ws, a.o_user, 'update', 'workspaces', a.o_ws,
          case when not p_publico then 'link público desativado' when p_novo then 'novo link público' else 'link público ativado' end);
  return jsonb_build_object('publico', p_publico, 'caminho', '/p/' || v_slug);
end $$;
revoke execute on function public.mcp_compartilhar(text, boolean, boolean) from public, authenticated;
grant execute on function public.mcp_compartilhar(text, boolean, boolean) to anon;
