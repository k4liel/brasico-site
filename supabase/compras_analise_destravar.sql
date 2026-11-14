-- Compras: análise travada é liberada em 4 min, não 15 (14/11/2026). A Edge Function compras-analise nunca vive mais de
-- ~150 s; uma chamada que cai no meio (546) deixava a análise "analisando" e a pessoa esperando 15 min pela nova tentativa.
create or replace function public.compras_auto_proxima(p_semana uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $function$
declare
  v_inicio date; v_de timestamptz; v_ate timestamptz; p record; v_analise bigint;
begin
  perform pg_advisory_xact_lock(hashtext('compras_auto_proxima'));
  select inicio into v_inicio from public.compras_semanas where id = p_semana and status = 'aberta';
  if v_inicio is null then return null; end if;
  select j.de, j.ate into v_de, v_ate from public.compras_janela(v_inicio) j;
  update public.compras_analises set status = 'falha', erro = 'tempo esgotado', fim = now()
  where semana_id = p_semana and ((status = 'analisando' and inicio < now() - interval '4 minutes')
                               or (status = 'no_lote' and inicio < now() - interval '6 hours'));

  select o.*, u.ultima, ult.inicio ultima_analise into p
  from public.operacao_pessoas o
  join lateral (select max(m.enviada_em) ultima from public.compras_mensagens_da_pessoa(o.id, v_de, v_ate) m) u on u.ultima is not null
  left join lateral (select max(a.inicio) inicio from public.compras_analises a
    where a.semana_id = p_semana and a.pessoa_id = o.id and a.status <> 'falha') ult on true
  where o.ativo and o.papel = 'solicitante'
    and not exists (select 1 from public.compras_analises a where a.semana_id = p_semana and a.pessoa_id = o.id and a.status in ('analisando', 'no_lote'))
    and (select count(*) from public.compras_analises a where a.semana_id = p_semana and a.pessoa_id = o.id
         and a.status = 'falha' and a.inicio > greatest(u.ultima, now() - interval '20 hours')) < 4
    -- depois de uma falha, espera 3 min antes de tentar de novo (o Gemini costuma voltar logo)
    and not exists (select 1 from public.compras_analises a where a.semana_id = p_semana and a.pessoa_id = o.id
         and a.status = 'falha' and a.fim > now() - interval '3 minutes')
    and (
      ult.inicio is null or ult.inicio < u.ultima
      or (ult.inicio < now() - interval '20 hours' and now() < v_ate
          and exists (select 1 from public.compras_listas l where l.semana_id = p_semana and l.pessoa_id = o.id and l.status in ('aguardando', 'em_revisao'))
          and not exists (select 1 from public.compras_listas l where l.semana_id = p_semana and l.pessoa_id = o.id
                          and public.compras_lista_ativa(l.status) and public.compras_lista_tocada(l.id)))
    )
  order by (ult.inicio is null or ult.inicio < u.ultima) desc, u.ultima limit 1;
  if p.id is null then return null; end if;

  insert into public.compras_analises (semana_id, pessoa_id, status) values (p_semana, p.id, 'analisando') returning id into v_analise;
  return jsonb_build_object('id', p.id, 'nome', p.nome, 'unidade', p.unidade, 'setor', p.setor, 'wa_nome', p.wa_nome,
    'analise', v_analise, 'de', v_de, 'ate', v_ate);
end $function$;
