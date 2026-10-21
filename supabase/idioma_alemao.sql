-- Versão em alemão dos projetos (opcional, por capítulo), no mesmo modelo do inglês, do polonês e do francês.
-- Idiomas: pt (original), en, pl, fr, de.

alter table public.notes add column if not exists title_de text;
alter table public.notes add column if not exists content_de text;
alter table public.workspaces add column if not exists doc_rodape_de text;

create or replace function public.guardar_versao_capitulo()
returns trigger language plpgsql security definer set search_path = public as $$
declare u record;
begin
  select * into u from public.brasico_usuario_atual();
  if old.title is distinct from new.title or old.content is distinct from new.content then
    insert into public.versoes (workspace_id, tipo, ref_id, titulo, conteudo, substituido_por, origem)
    values (old.workspace_id, 'capitulo', old.id, old.title, old.content, u.o_user, u.o_origem);
  end if;
  if (old.title_en is distinct from new.title_en or old.content_en is distinct from new.content_en)
     and (old.title_en is not null or old.content_en is not null) then
    insert into public.versoes (workspace_id, tipo, ref_id, titulo, conteudo, substituido_por, origem, idioma)
    values (old.workspace_id, 'capitulo', old.id, old.title_en, old.content_en, u.o_user, u.o_origem, 'en');
  end if;
  if (old.title_pl is distinct from new.title_pl or old.content_pl is distinct from new.content_pl)
     and (old.title_pl is not null or old.content_pl is not null) then
    insert into public.versoes (workspace_id, tipo, ref_id, titulo, conteudo, substituido_por, origem, idioma)
    values (old.workspace_id, 'capitulo', old.id, old.title_pl, old.content_pl, u.o_user, u.o_origem, 'pl');
  end if;
  if (old.title_fr is distinct from new.title_fr or old.content_fr is distinct from new.content_fr)
     and (old.title_fr is not null or old.content_fr is not null) then
    insert into public.versoes (workspace_id, tipo, ref_id, titulo, conteudo, substituido_por, origem, idioma)
    values (old.workspace_id, 'capitulo', old.id, old.title_fr, old.content_fr, u.o_user, u.o_origem, 'fr');
  end if;
  if (old.title_de is distinct from new.title_de or old.content_de is distinct from new.content_de)
     and (old.title_de is not null or old.content_de is not null) then
    insert into public.versoes (workspace_id, tipo, ref_id, titulo, conteudo, substituido_por, origem, idioma)
    values (old.workspace_id, 'capitulo', old.id, old.title_de, old.content_de, u.o_user, u.o_origem, 'de');
  end if;
  return new;
end $$;

create or replace function public.mcp_atualizar_nota(p_token text, p_id uuid, p_title text default null,
                                                     p_content text default null, p_versao timestamptz default null,
                                                     p_idioma text default 'pt')
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record; r public.notes; v_quem text; v_idioma text := coalesce(p_idioma, 'pt');
begin
  select * into a from public.mcp_auth(p_token);
  if v_idioma not in ('pt', 'en', 'pl', 'fr', 'de') then raise exception 'Idioma deve ser pt, en, pl, fr ou de'; end if;
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

  if v_idioma = 'en' then
    update public.notes set title_en = coalesce(nullif(p_title, ''), title_en), content_en = coalesce(p_content, content_en)
    where id = r.id returning * into r;
    perform public.mcp_log(a.o_ws, a.o_user, 'update', 'notes', r.id, r.title || ' (inglês)');
  elsif v_idioma = 'pl' then
    update public.notes set title_pl = coalesce(nullif(p_title, ''), title_pl), content_pl = coalesce(p_content, content_pl)
    where id = r.id returning * into r;
    perform public.mcp_log(a.o_ws, a.o_user, 'update', 'notes', r.id, r.title || ' (polonês)');
  elsif v_idioma = 'fr' then
    update public.notes set title_fr = coalesce(nullif(p_title, ''), title_fr), content_fr = coalesce(p_content, content_fr)
    where id = r.id returning * into r;
    perform public.mcp_log(a.o_ws, a.o_user, 'update', 'notes', r.id, r.title || ' (francês)');
  elsif v_idioma = 'de' then
    update public.notes set title_de = coalesce(nullif(p_title, ''), title_de), content_de = coalesce(p_content, content_de)
    where id = r.id returning * into r;
    perform public.mcp_log(a.o_ws, a.o_user, 'update', 'notes', r.id, r.title || ' (alemão)');
  else
    update public.notes set title = coalesce(p_title, title), content = coalesce(p_content, content)
    where id = r.id returning * into r;
    perform public.mcp_log(a.o_ws, a.o_user, 'update', 'notes', r.id, r.title);
  end if;
  return jsonb_build_object('id', r.id, 'title', r.title, 'title_en', r.title_en, 'title_pl', r.title_pl, 'title_fr', r.title_fr, 'title_de', r.title_de,
                            'idioma', v_idioma, 'versao', r.updated_at);
end $$;

create or replace function public.mcp_documento(p_token text, p_idioma text default 'pt')
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record; l text := coalesce(p_idioma, 'pt');
begin
  select * into a from public.mcp_auth(p_token);
  if l not in ('pt', 'en', 'pl', 'fr', 'de') then l := 'pt'; end if;
  return (
    select jsonb_build_object(
      'projeto_id', w.id, 'projeto', w.name, 'idioma', l,
      'rodape', case l when 'en' then coalesce(w.doc_rodape_en, w.doc_rodape)
                       when 'pl' then coalesce(w.doc_rodape_pl, w.doc_rodape)
                       when 'fr' then coalesce(w.doc_rodape_fr, w.doc_rodape)
                       when 'de' then coalesce(w.doc_rodape_de, w.doc_rodape) else w.doc_rodape end,
      'rodape_en', w.doc_rodape_en, 'rodape_pl', w.doc_rodape_pl, 'rodape_fr', w.doc_rodape_fr, 'rodape_de', w.doc_rodape_de,
      'estilo_css', coalesce(w.doc_css, ''),
      'capitulos', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', n.id,
          'titulo', case l when 'en' then coalesce(n.title_en, n.title) when 'pl' then coalesce(n.title_pl, n.title)
                           when 'fr' then coalesce(n.title_fr, n.title) when 'de' then coalesce(n.title_de, n.title) else n.title end,
          'versao', n.updated_at,
          'tem_ingles', n.content_en is not null and btrim(n.content_en) <> '',
          'tem_polones', n.content_pl is not null and btrim(n.content_pl) <> '',
          'tem_frances', n.content_fr is not null and btrim(n.content_fr) <> '',
          'tem_alemao', n.content_de is not null and btrim(n.content_de) <> '',
          'conteudo', case l when 'en' then coalesce(n.content_en, '') when 'pl' then coalesce(n.content_pl, '')
                             when 'fr' then coalesce(n.content_fr, '') when 'de' then coalesce(n.content_de, '') else n.content end)
          order by n.title)
        from public.notes n where n.workspace_id = w.id and n.archived_at is null), '[]'::jsonb),
      'capitulos_removidos', coalesce((
        select jsonb_agg(jsonb_build_object('id', n.id, 'titulo', n.title, 'removido_em', n.archived_at) order by n.archived_at desc)
        from public.notes n where n.workspace_id = w.id and n.archived_at is not null), '[]'::jsonb))
    from public.workspaces w where w.id = a.o_ws);
end $$;

create or replace function public.mcp_definir_rodape(p_token text, p_rodape text, p_idioma text default 'pt')
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record; l text := coalesce(p_idioma, 'pt');
begin
  select * into a from public.mcp_auth(p_token);
  if l = 'en' then
    update public.workspaces set doc_rodape_en = nullif(trim(p_rodape), '') where id = a.o_ws;
  elsif l = 'pl' then
    update public.workspaces set doc_rodape_pl = nullif(trim(p_rodape), '') where id = a.o_ws;
  elsif l = 'fr' then
    update public.workspaces set doc_rodape_fr = nullif(trim(p_rodape), '') where id = a.o_ws;
  elsif l = 'de' then
    update public.workspaces set doc_rodape_de = nullif(trim(p_rodape), '') where id = a.o_ws;
  else
    update public.workspaces set doc_rodape = nullif(trim(p_rodape), '') where id = a.o_ws;
  end if;
  return jsonb_build_object('rodape', nullif(trim(p_rodape), ''), 'idioma', l);
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
    elsif v.idioma = 'pl' then
      update public.notes set title_pl = v.titulo, content_pl = v.conteudo
      where id = v.ref_id and workspace_id = a.o_ws returning * into r;
    elsif v.idioma = 'fr' then
      update public.notes set title_fr = v.titulo, content_fr = v.conteudo
      where id = v.ref_id and workspace_id = a.o_ws returning * into r;
    elsif v.idioma = 'de' then
      update public.notes set title_de = v.titulo, content_de = v.conteudo
      where id = v.ref_id and workspace_id = a.o_ws returning * into r;
    else
      update public.notes set title = v.titulo, content = v.conteudo
      where id = v.ref_id and workspace_id = a.o_ws returning * into r;
    end if;
    if r.id is null then raise exception 'O capítulo desta versão não existe mais'; end if;
    perform public.mcp_log(a.o_ws, a.o_user, 'restore_version', 'notes', r.id,
                           r.title || case v.idioma when 'en' then ' (inglês)' when 'pl' then ' (polonês)' when 'fr' then ' (francês)' when 'de' then ' (alemão)' else '' end);
    return jsonb_build_object('ok', true, 'capitulo', r.id, 'titulo', r.title, 'idioma', v.idioma, 'versao', r.updated_at);
  else
    update public.workspaces set doc_css = v.conteudo where id = a.o_ws;
    perform public.mcp_log(a.o_ws, a.o_user, 'restore_version', 'workspaces', a.o_ws, 'estilo do documento');
    return jsonb_build_object('ok', true, 'estilo', 'restaurado');
  end if;
end $$;

create or replace function public.documento_publico(p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'nome', w.name,
    'rodape', w.doc_rodape, 'rodape_en', w.doc_rodape_en, 'rodape_pl', w.doc_rodape_pl, 'rodape_fr', w.doc_rodape_fr, 'rodape_de', w.doc_rodape_de,
    'css', w.doc_css,
    'abas', coalesce(w.doc_abas, false),
    'abas_grupos', coalesce(w.doc_abas_grupos, false),
    'capitulos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'titulo', n.title, 'conteudo', n.content,
               'titulo_en', n.title_en, 'conteudo_en', n.content_en,
               'titulo_pl', n.title_pl, 'conteudo_pl', n.content_pl,
               'titulo_fr', n.title_fr, 'conteudo_fr', n.content_fr,
               'titulo_de', n.title_de, 'conteudo_de', n.content_de)
             order by n.title)
      from public.notes n where n.workspace_id = w.id and n.archived_at is null), '[]'::jsonb))
  from public.workspaces w
  where length(coalesce(p_slug, '')) >= 32
    and w.public_slug = p_slug and w.is_public and w.removido_em is null;
$$;
