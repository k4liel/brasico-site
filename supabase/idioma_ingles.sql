-- Versão em inglês dos projetos (opcional, por capítulo).
-- O português continua sendo o original; o site mostra o seletor PT | EN
-- quando algum capítulo tem content_en. Capítulo sem tradução aparece em português.

alter table public.notes add column if not exists title_en text;
alter table public.notes add column if not exists content_en text;
alter table public.workspaces add column if not exists doc_rodape_en text;
alter table public.versoes add column if not exists idioma text not null default 'pt';

-- Guarda também a versão anterior do inglês
create or replace function public.guardar_versao_capitulo()
returns trigger language plpgsql security definer set search_path = public as $$
declare u record;
begin
  if old.title is distinct from new.title or old.content is distinct from new.content then
    select * into u from public.brasico_usuario_atual();
    insert into public.versoes (workspace_id, tipo, ref_id, titulo, conteudo, substituido_por, origem)
    values (old.workspace_id, 'capitulo', old.id, old.title, old.content, u.o_user, u.o_origem);
  end if;
  if (old.title_en is distinct from new.title_en or old.content_en is distinct from new.content_en)
     and (old.title_en is not null or old.content_en is not null) then
    select * into u from public.brasico_usuario_atual();
    insert into public.versoes (workspace_id, tipo, ref_id, titulo, conteudo, substituido_por, origem, idioma)
    values (old.workspace_id, 'capitulo', old.id, old.title_en, old.content_en, u.o_user, u.o_origem, 'en');
  end if;
  return new;
end $$;

-- atualizar_nota com idioma ('pt' = original, 'en' = versão em inglês)
drop function if exists public.mcp_atualizar_nota(text, uuid, text, text, timestamptz);
create or replace function public.mcp_atualizar_nota(p_token text, p_id uuid, p_title text default null,
                                                     p_content text default null, p_versao timestamptz default null,
                                                     p_idioma text default 'pt')
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record; r public.notes; v_quem text;
begin
  select * into a from public.mcp_auth(p_token);
  if coalesce(p_idioma, 'pt') not in ('pt', 'en') then raise exception 'Idioma deve ser pt ou en'; end if;
  select * into r from public.notes where id = p_id and workspace_id = a.o_ws for update;
  if r.id is null then raise exception 'Nota não encontrada neste espaço'; end if;

  if p_versao is not null and r.updated_at is distinct from p_versao then
    select coalesce(p.display_name, p.email) into v_quem
    from public.versoes v left join public.profiles p on p.id = v.substituido_por
    where v.tipo = 'capitulo' and v.ref_id = r.id
    order by v.id desc limit 1;
    raise exception 'O capítulo "%" mudou depois que você leu (por %, em %). Nada foi gravado. Leia de novo com ler_nota, junte as suas mudanças com as novas e envie com a versao nova.',
      r.title, coalesce(v_quem, 'outra pessoa'),
      to_char(r.updated_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI');
  end if;

  if coalesce(p_idioma, 'pt') = 'en' then
    update public.notes set
      title_en   = coalesce(nullif(p_title, ''), title_en),
      content_en = coalesce(p_content, content_en)
    where id = r.id
    returning * into r;
    perform public.mcp_log(a.o_ws, a.o_user, 'update', 'notes', r.id, r.title || ' (inglês)');
  else
    update public.notes set
      title   = coalesce(p_title, title),
      content = coalesce(p_content, content)
    where id = r.id
    returning * into r;
    perform public.mcp_log(a.o_ws, a.o_user, 'update', 'notes', r.id, r.title);
  end if;
  return jsonb_build_object('id', r.id, 'title', r.title, 'title_en', r.title_en, 'idioma', coalesce(p_idioma, 'pt'), 'versao', r.updated_at);
end $$;

-- ver_documento em português (padrão) ou em inglês
drop function if exists public.mcp_documento(text);
create or replace function public.mcp_documento(p_token text, p_idioma text default 'pt')
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record; en boolean := coalesce(p_idioma, 'pt') = 'en';
begin
  select * into a from public.mcp_auth(p_token);
  return (
    select jsonb_build_object(
      'projeto_id', w.id, 'projeto', w.name, 'idioma', case when en then 'en' else 'pt' end,
      'rodape', case when en then coalesce(w.doc_rodape_en, w.doc_rodape) else w.doc_rodape end,
      'rodape_en', w.doc_rodape_en,
      'estilo_css', coalesce(w.doc_css, ''),
      'capitulos', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', n.id,
          'titulo', case when en then coalesce(n.title_en, n.title) else n.title end,
          'versao', n.updated_at,
          'tem_ingles', n.content_en is not null and btrim(n.content_en) <> '',
          'conteudo', case when en then coalesce(n.content_en, '') else n.content end) order by n.title)
        from public.notes n where n.workspace_id = w.id and n.archived_at is null), '[]'::jsonb),
      'capitulos_removidos', coalesce((
        select jsonb_agg(jsonb_build_object('id', n.id, 'titulo', n.title, 'removido_em', n.archived_at) order by n.archived_at desc)
        from public.notes n where n.workspace_id = w.id and n.archived_at is not null), '[]'::jsonb))
    from public.workspaces w where w.id = a.o_ws);
end $$;

-- Rodapé por idioma
drop function if exists public.mcp_definir_rodape(text, text);
create or replace function public.mcp_definir_rodape(p_token text, p_rodape text, p_idioma text default 'pt')
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record;
begin
  select * into a from public.mcp_auth(p_token);
  if coalesce(p_idioma, 'pt') = 'en' then
    update public.workspaces set doc_rodape_en = nullif(trim(p_rodape), '') where id = a.o_ws;
  else
    update public.workspaces set doc_rodape = nullif(trim(p_rodape), '') where id = a.o_ws;
  end if;
  return jsonb_build_object('rodape', nullif(trim(p_rodape), ''), 'idioma', coalesce(p_idioma, 'pt'));
end $$;

-- Versões mostram o idioma; restaurar volta o idioma certo
create or replace function public.mcp_listar_versoes(p_token text, p_ref uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record;
begin
  select * into a from public.mcp_auth(p_token);
  return coalesce((select jsonb_agg(x) from (
    select v.id as versao_id, v.tipo, v.idioma, v.titulo,
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
  return jsonb_build_object('versao_id', v.id, 'tipo', v.tipo, 'idioma', v.idioma, 'ref_id', v.ref_id,
                            'titulo', v.titulo, 'conteudo', v.conteudo, 'substituida_em', v.criado_em);
end $$;

create or replace function public.mcp_restaurar_versao(p_token text, p_versao bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record; v public.versoes; r public.notes;
begin
  select * into a from public.mcp_auth(p_token);
  select * into v from public.versoes where id = p_versao and workspace_id = a.o_ws;
  if v.id is null then raise exception 'Versão não encontrada neste projeto'; end if;

  if v.tipo = 'capitulo' then
    if v.idioma = 'en' then
      update public.notes set title_en = v.titulo, content_en = v.conteudo
      where id = v.ref_id and workspace_id = a.o_ws returning * into r;
    else
      update public.notes set title = v.titulo, content = v.conteudo
      where id = v.ref_id and workspace_id = a.o_ws returning * into r;
    end if;
    if r.id is null then raise exception 'O capítulo desta versão não existe mais'; end if;
    perform public.mcp_log(a.o_ws, a.o_user, 'restore_version', 'notes', r.id,
                           r.title || case when v.idioma = 'en' then ' (inglês)' else '' end);
    return jsonb_build_object('ok', true, 'capitulo', r.id, 'titulo', r.title, 'idioma', v.idioma, 'versao', r.updated_at);
  else
    update public.workspaces set doc_css = v.conteudo where id = a.o_ws;
    perform public.mcp_log(a.o_ws, a.o_user, 'restore_version', 'workspaces', a.o_ws, 'estilo do documento');
    return jsonb_build_object('ok', true, 'estilo', 'restaurado');
  end if;
end $$;

-- O conector só chama pelas funções, com a chave pública
revoke all on function public.mcp_atualizar_nota(text, uuid, text, text, timestamptz, text) from public, authenticated;
revoke all on function public.mcp_documento(text, text) from public, authenticated;
revoke all on function public.mcp_definir_rodape(text, text, text) from public, authenticated;
grant execute on function public.mcp_atualizar_nota(text, uuid, text, text, timestamptz, text) to anon;
grant execute on function public.mcp_documento(text, text) to anon;
grant execute on function public.mcp_definir_rodape(text, text, text) to anon;
grant execute on function public.mcp_atualizar_nota(text, uuid, text, text, timestamptz, text) to service_role;
grant execute on function public.mcp_documento(text, text) to service_role;
grant execute on function public.mcp_definir_rodape(text, text, text) to service_role;
