-- Abas em grupos: com doc_abas_grupos ligado, os capítulos seguidos que
-- começam com o mesmo nome antes do " · " (ex.: "15 · Sempre Vivo · Seg 28/12")
-- viram uma aba só na faixa de cima ("Sempre Vivo"), com uma segunda faixa
-- de abas para cada capítulo do grupo. Vale só para o projeto que ligar.
alter table public.workspaces add column if not exists doc_abas_grupos boolean not null default false;

drop function if exists public.mcp_definir_abas(text, boolean);

create or replace function public.mcp_definir_abas(p_token text, p_ativar boolean, p_grupos boolean default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare a record; g boolean;
begin
  select * into a from public.mcp_auth(p_token);
  update public.workspaces
     set doc_abas = coalesce(p_ativar, false),
         doc_abas_grupos = coalesce(p_grupos, doc_abas_grupos)
   where id = a.o_ws
  returning doc_abas_grupos into g;
  perform public.mcp_log(a.o_ws, a.o_user, 'update', 'workspaces', a.o_ws,
    case when not coalesce(p_ativar, false) then 'capítulos corridos'
         when g then 'capítulos em abas por grupo'
         else 'capítulos em abas' end);
  return jsonb_build_object('ok', true, 'abas', coalesce(p_ativar, false), 'grupos', g);
end $function$;

revoke all on function public.mcp_definir_abas(text, boolean, boolean) from public;
grant execute on function public.mcp_definir_abas(text, boolean, boolean) to anon, service_role;

-- Link público: passa a opção de grupos para a página /p/<código>
create or replace function public.documento_publico(p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'nome', w.name,
    'rodape', w.doc_rodape, 'rodape_en', w.doc_rodape_en, 'rodape_pl', w.doc_rodape_pl, 'rodape_fr', w.doc_rodape_fr,
    'css', w.doc_css,
    'abas', coalesce(w.doc_abas, false),
    'abas_grupos', coalesce(w.doc_abas_grupos, false),
    'capitulos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'titulo', n.title, 'conteudo', n.content,
               'titulo_en', n.title_en, 'conteudo_en', n.content_en,
               'titulo_pl', n.title_pl, 'conteudo_pl', n.content_pl,
               'titulo_fr', n.title_fr, 'conteudo_fr', n.content_fr)
             order by n.title)
      from public.notes n where n.workspace_id = w.id and n.archived_at is null), '[]'::jsonb))
  from public.workspaces w
  where length(coalesce(p_slug, '')) >= 32
    and w.public_slug = p_slug and w.is_public and w.removido_em is null;
$$;
