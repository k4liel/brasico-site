-- =====================================================================
-- WhatsApp: resumos em todos os idiomas do site (29/10/2026).
-- traducoes = {"en": "...", "pl": "...", "fr": "...", "de": "..."}, o mesmo
-- Markdown do resumo traduzido. A Edge Function whatsapp-resumo traduz o
-- resumo do dia e, a cada chamada, os que ainda não têm tradução (inclusive
-- os gravados pelo conector). O site mostra o idioma escolhido e, se faltar,
-- o original em português com um aviso.
-- =====================================================================

alter table public.wa_resumos_gerais add column if not exists traducoes jsonb not null default '{}'::jsonb;

-- Conector: as traduções podem vir junto (opcional; sem elas, a Edge Function traduz depois)
drop function if exists public.mcp_wa_salvar_resumo(text, text, date, date);
create or replace function public.mcp_wa_salvar_resumo(p_token text, p_resumo text, p_de date default null, p_ate date default null,
  p_traducoes jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_de date; v_ate date; v_msgs int; v_grupos int; v_trad jsonb; r public.wa_resumos_gerais;
begin
  v_user := public.mcp_wa_auth(p_token);
  if coalesce(trim(p_resumo), '') = '' then raise exception 'O resumo está vazio.'; end if;
  v_ate := coalesce(p_ate, (now() at time zone 'America/Sao_Paulo')::date);
  v_de := coalesce(p_de, v_ate);
  if v_de > v_ate then raise exception 'A data inicial é depois da final.'; end if;
  -- Só en, pl, fr e de, com texto
  select coalesce(jsonb_object_agg(k, trim(v)), '{}'::jsonb) into v_trad
    from jsonb_each_text(case when jsonb_typeof(p_traducoes) = 'object' then p_traducoes else '{}'::jsonb end) t(k, v)
   where k in ('en', 'pl', 'fr', 'de') and trim(v) <> '';
  select count(*), count(distinct m.grupo_id) into v_msgs, v_grupos
    from public.wa_mensagens m join public.wa_grupos g on g.id = m.grupo_id and g.tipo = 'grupo'
   where m.enviada_em >= (v_de::timestamp at time zone 'America/Sao_Paulo')
     and m.enviada_em < ((v_ate + 1)::timestamp at time zone 'America/Sao_Paulo');
  insert into public.wa_resumos_gerais (de, ate, resumo, traducoes, total_mensagens, total_grupos, criado_por)
  values (v_de, v_ate, trim(p_resumo), v_trad, v_msgs, v_grupos, v_user) returning * into r;
  return jsonb_build_object('id', r.id, 'de', r.de, 'ate', r.ate, 'mensagens', r.total_mensagens,
    'grupos', r.total_grupos, 'idiomas', (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(r.traducoes) k),
    'salvo_em', to_char(r.created_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI'));
end $$;

revoke execute on function public.mcp_wa_salvar_resumo(text, text, date, date, jsonb) from public, authenticated;
grant execute on function public.mcp_wa_salvar_resumo(text, text, date, date, jsonb) to anon;
