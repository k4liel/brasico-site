-- =====================================================================
-- Rotina da Receita: situação fiscal relida depois de pagamento (05/11/2026)
--  - Antes, a situação fiscal (SITFIS) só era relida a cada 7 dias: o que se pagava levava até uma semana
--    para sair dos débitos da página.
--  - Agora, além dos 7 dias, ela é relida quando há pagamento novo (lido pela rotina de pagamentos, que já
--    roda quando o evento E0701 da Receita muda) e a última SITFIS foi tirada antes de a Receita dar a baixa:
--    espera 2 dias depois da arrecadação (medido em 03 → 05/11/2026: a baixa já tinha saído).
--  - Continua no máximo uma SITFIS por dia por empresa (R$ 0,32 cada).
-- =====================================================================
create or replace function public.receita_rotina_passo()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  e record;
  v_ini timestamptz := (now() at time zone 'America/Sao_Paulo')::date::timestamp at time zone 'America/Sao_Paulo';
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_feitos int := 0;
  v_tipo text;
  v_rotina text;
  v_par jsonb;
  v_itens jsonb;
  v_sitfis date;
  ult record;
  ligada jsonb := coalesce((select jsonb_object_agg(id, ligada) from public.receita_rotinas), '{}');
begin
  for e in
    select r.id from public.receita_empresas r join public.esocial_empresas s on s.id = r.id
    where r.producao_ligada order by r.id
  loop
    v_tipo := null; v_par := '{}';
    if exists (select 1 from public.receita_execucoes where empresa_id = e.id and status in ('na_fila', 'rodando')
               and created_at > now() - interval '10 minutes') then
      continue;
    end if;

    -- 1) Eventos de atualização (grátis)
    if coalesce((ligada->>'eventos')::boolean, false) then
      select * into ult from public.receita_execucoes
      where empresa_id = e.id and ambiente = 'producao' and tipo = 'eventos' and created_at >= v_ini
      order by created_at desc limit 1;
      if ult.id is null then
        v_tipo := 'eventos';
      elsif ult.status = 'ok' and ult.resultado ? 'pendentes'
            and (select count(*) from public.receita_execucoes where empresa_id = e.id and tipo = 'eventos' and created_at >= v_ini) < 3 then
        v_tipo := 'eventos'; v_par := jsonb_build_object('pendentes', ult.resultado->'pendentes');
      end if;
    end if;

    -- 2) Caixa postal: uma vez por dia
    if v_tipo is null and coalesce((ligada->>'caixa_postal')::boolean, false)
       and not exists (select 1 from public.receita_execucoes where empresa_id = e.id and ambiente = 'producao'
                       and tipo = 'caixa_postal' and created_at >= v_ini) then
      v_tipo := 'caixa_postal';
    end if;

    -- 3) Pagamentos: só quando a Receita registrou mudança depois da última busca que deu certo
    if v_tipo is null and coalesce((ligada->>'pagamentos')::boolean, false)
       and exists (
         select 1 from public.receita_eventos ev
         where ev.empresa_id = e.id and ev.evento = 'E0701' and ev.atualizado_em is not null
           and ev.atualizado_em >= coalesce((
             select max((x.created_at at time zone 'America/Sao_Paulo')::date) from public.receita_execucoes x
             where x.empresa_id = e.id and x.ambiente = 'producao' and x.tipo = 'pagamentos' and x.status in ('ok', 'sem_dados')), '2000-01-01'::date))
       and not exists (select 1 from public.receita_execucoes where empresa_id = e.id and ambiente = 'producao'
                       and tipo = 'pagamentos' and created_at >= v_ini) then
      v_tipo := 'pagamentos';
    end if;

    -- 4) Situação fiscal: a cada 7 dias, ou 2 dias depois de pagamento novo que a última ainda não mostrava
    if v_tipo is null and coalesce((ligada->>'situacao_fiscal')::boolean, false)
       and not exists (select 1 from public.receita_execucoes where empresa_id = e.id and ambiente = 'producao'
                       and tipo = 'situacao_fiscal' and created_at >= v_ini) then
      select max((x.created_at at time zone 'America/Sao_Paulo')::date) into v_sitfis from public.receita_execucoes x
      where x.empresa_id = e.id and x.ambiente = 'producao' and x.tipo = 'situacao_fiscal' and x.status = 'ok' and x.resultado ? 'texto';
      if v_sitfis is null or v_sitfis <= v_hoje - 7
         or exists (select 1 from public.receita_pagamentos p
                    where p.empresa_id = e.id and p.ambiente = 'producao' and p.data_arrecadacao is not null
                      and p.data_arrecadacao + 2 > v_sitfis and p.data_arrecadacao + 2 <= v_hoje) then
        v_tipo := 'situacao_fiscal';
      end if;
    end if;

    -- 5) Declarações e parcelamentos: um lote por dia, só com o que venceu (receita_lote_declaracoes)
    if v_tipo is null and coalesce((ligada->>'declaracoes')::boolean, false)
       and not exists (select 1 from public.receita_execucoes where empresa_id = e.id and ambiente = 'producao'
                       and tipo = 'servico' and origem = 'rotina' and created_at >= v_ini) then
      v_itens := public.receita_lote_declaracoes(e.id);
      if jsonb_array_length(v_itens) > 0 then
        v_tipo := 'servico'; v_par := jsonb_build_object('itens', v_itens);
      end if;
    end if;

    if v_tipo is null then continue; end if;
    v_rotina := case v_tipo when 'servico' then 'declaracoes' else v_tipo end;
    begin
      perform public.receita_pedir(e.id, 'producao', v_tipo, v_par, 'rotina', null);
      update public.receita_rotinas set ultima_vez = now() where id = v_rotina;
      v_feitos := v_feitos + 1;
    exception when others then
      raise notice 'Receita, rotina de %: %', e.id, sqlerrm;
    end;
  end loop;
  return v_feitos;
end $function$;
revoke execute on function public.receita_rotina_passo() from public, anon, authenticated;

update public.receita_rotinas set quando = 'A cada 7 dias e 2 dias depois de pagamento novo' where id = 'situacao_fiscal';
