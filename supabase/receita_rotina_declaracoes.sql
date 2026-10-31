-- Rotina da Receita, passo 5: declarações e parcelamentos (31/10/2026).
-- Antes só eventos, caixa postal, pagamentos e situação fiscal se atualizavam sozinhos; DCTFWeb, MIT, PGDAS-D,
-- parcelamentos do Simples, DTE, DEFIS e opção de regime eram lidos uma vez, à mão (lote tipo 'servico').
-- Agora a rotina monta um lote por empresa, no máximo um por dia, só com o que venceu:
--   DCTFWeb (todas): recibo do mês passado e do retrasado quando o evento E0301 mudou depois da última leitura,
--                    ou a cada 7 dias enquanto o mês passado ainda não tem recibo; declaração completa do mês passado
--                    quando o evento mudou ou ela ainda não foi lida.
--   MIT (Lucro Presumido): lista do ano a cada 30 dias (em jan e fev também a do ano anterior) e o detalhe
--                    (316) das apurações dos últimos 6 meses ainda não lidas, até 3 por vez.
--   PGDAS-D (Simples): declarações do ano uma vez por mês, a partir do dia 21 (em janeiro também o ano anterior),
--                    e o extrato (16) dos DAS dos últimos 3 períodos ainda não lidos.
--   PARCSN (Simples): pedidos de parcelamento a cada 30 dias; o detalhe (164) só dos que estão em parcelamento.
--   DTE (todas): a cada 90 dias.  DEFIS (Simples): uma vez em abril ou maio.  Opção de regime (Simples): uma vez em janeiro.
-- Liga e desliga em receita_rotinas (id 'declaracoes'). O limite diário e o teto do ciclo continuam valendo (receita_pedir).

insert into public.receita_rotinas (id, nome, o_que_faz, quando, custo_mes_empresa, ligada, ordem)
values ('declaracoes', 'Declarações e parcelamentos',
  'Relê DCTFWeb, MIT, PGDAS-D, parcelamentos do Simples, DTE, DEFIS e opção de regime só quando venceu ou quando a Receita avisou que mudou.',
  'Uma vez por dia, depois dos outros passos', 'Cerca de R$ 1 a R$ 3', true, 5)
on conflict (id) do update set nome = excluded.nome, o_que_faz = excluded.o_que_faz, quando = excluded.quando,
  custo_mes_empresa = excluded.custo_mes_empresa, ordem = excluded.ordem;

create or replace function public.receita_lote_declaracoes(p_empresa text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  m1 date := (date_trunc('month', (now() at time zone 'America/Sao_Paulo')) - interval '1 month')::date;
  m2 date := (date_trunc('month', (now() at time zone 'America/Sao_Paulo')) - interval '2 months')::date;
  itens jsonb := '[]';
  fe record;
  presumido boolean; simples boolean;
  ev date; ult_dctf date; m1_entregue boolean;
  r record;
  -- última vez (data em SP) que um serviço foi lido com sucesso nesta empresa
  ultimo_ok text := $q$
    select max((x.created_at at time zone 'America/Sao_Paulo')::date)
    from public.receita_execucoes x cross join lateral jsonb_array_elements(x.resultado->'respostas') v
    where x.empresa_id = $1 and x.tipo = 'servico' and x.ambiente = 'producao'
      and v->>'servico' = $2 and (v->>'ok')::boolean $q$;
  d date;
begin
  select coalesce(f.regime, '') ilike '%PRESUMIDO%' as presumido, coalesce(f.simples, false) as simples into fe
  from public.fiscal_empresas f where f.raiz = p_empresa and substr(f.cnpj, 9, 4) = '0001' limit 1;
  presumido := coalesce(fe.presumido, false); simples := coalesce(fe.simples, false);

  -- DCTFWeb
  select atualizado_em into ev from public.receita_eventos where empresa_id = p_empresa and evento = 'E0301';
  execute ultimo_ok into ult_dctf using p_empresa, 'DCTFWEB/CONSRECIBO32';
  select coalesce(bool_or(tem_pdf), false) into m1_entregue from public.receita_respostas
  where empresa_id = p_empresa and servico = 'DCTFWEB/CONSRECIBO32'
    and pedido->>'anoPA' = to_char(m1, 'YYYY') and pedido->>'mesPA' = to_char(m1, 'MM');
  if (ev is not null and ev >= coalesce(ult_dctf, '2000-01-01'))
     or (not m1_entregue and coalesce(ult_dctf, '2000-01-01') <= hoje - 7) then
    itens := itens || jsonb_build_array(
      jsonb_build_object('servico', 'DCTFWEB/CONSRECIBO32', 'dados', jsonb_build_object('anoPA', to_char(m1, 'YYYY'), 'mesPA', to_char(m1, 'MM'), 'categoria', 'GERAL_MENSAL')),
      jsonb_build_object('servico', 'DCTFWEB/CONSRECIBO32', 'dados', jsonb_build_object('anoPA', to_char(m2, 'YYYY'), 'mesPA', to_char(m2, 'MM'), 'categoria', 'GERAL_MENSAL')));
  end if;
  if m1_entregue and ((ev is not null and ev >= coalesce(ult_dctf, '2000-01-01')) or not exists (
       select 1 from public.receita_respostas where empresa_id = p_empresa and servico = 'DCTFWEB/CONSDECCOMPLETA33'
         and pedido->>'anoPA' = to_char(m1, 'YYYY') and pedido->>'mesPA' = to_char(m1, 'MM'))) then
    itens := itens || jsonb_build_array(jsonb_build_object('servico', 'DCTFWEB/CONSDECCOMPLETA33',
      'dados', jsonb_build_object('anoPA', to_char(m1, 'YYYY'), 'mesPA', to_char(m1, 'MM'), 'categoria', 'GERAL_MENSAL')));
  end if;

  -- MIT (Lucro Presumido)
  if presumido then
    execute ultimo_ok into d using p_empresa, 'MIT/LISTAAPURACOES317';
    if coalesce(d, '2000-01-01') <= hoje - 30 then
      itens := itens || jsonb_build_array(jsonb_build_object('servico', 'MIT/LISTAAPURACOES317', 'dados', jsonb_build_object('anoApuracao', extract(year from hoje)::int)));
      if extract(month from hoje) <= 2 then
        itens := itens || jsonb_build_array(jsonb_build_object('servico', 'MIT/LISTAAPURACOES317', 'dados', jsonb_build_object('anoApuracao', extract(year from hoje)::int - 1)));
      end if;
    end if;
    for r in
      select (a->>'idApuracao')::bigint as id
      from public.receita_respostas l cross join lateral jsonb_array_elements(coalesce(l.dados->'Apuracoes', '[]')) a
      where l.empresa_id = p_empresa and l.servico = 'MIT/LISTAAPURACOES317'
        and (a->>'periodoApuracao')::int >= to_char(hoje - 190, 'YYYYMM')::int
        and not exists (select 1 from public.receita_respostas c where c.empresa_id = p_empresa and c.servico = 'MIT/CONSAPURACAO316'
                        and (c.pedido->>'idApuracao')::bigint = (a->>'idApuracao')::bigint)
      order by (a->>'periodoApuracao')::int desc limit 3
    loop
      itens := itens || jsonb_build_array(jsonb_build_object('servico', 'MIT/CONSAPURACAO316', 'dados', jsonb_build_object('idApuracao', r.id)));
    end loop;
  end if;

  -- Simples Nacional
  if simples then
    execute ultimo_ok into d using p_empresa, 'PGDASD/CONSDECLARACAO13';
    if extract(day from hoje) >= 21 and coalesce(d, '2000-01-01') < date_trunc('month', hoje)::date + 20 then
      itens := itens || jsonb_build_array(jsonb_build_object('servico', 'PGDASD/CONSDECLARACAO13', 'dados', jsonb_build_object('anoCalendario', to_char(hoje, 'YYYY'))));
      if extract(month from hoje) = 1 then
        itens := itens || jsonb_build_array(jsonb_build_object('servico', 'PGDASD/CONSDECLARACAO13', 'dados', jsonb_build_object('anoCalendario', to_char(hoje - 31, 'YYYY'))));
      end if;
    end if;
    for r in
      select distinct o->'indiceDas'->>'numeroDas' as das, (p->>'periodoApuracao')::int as per
      from public.receita_respostas l
      cross join lateral jsonb_array_elements(coalesce(l.dados->'periodos', '[]')) p
      cross join lateral jsonb_array_elements(coalesce(p->'operacoes', '[]')) o
      where l.empresa_id = p_empresa and l.servico = 'PGDASD/CONSDECLARACAO13'
        and o->'indiceDas'->>'numeroDas' is not null
        and (p->>'periodoApuracao')::int >= to_char(hoje - 100, 'YYYYMM')::int
        and not exists (select 1 from public.receita_respostas c where c.empresa_id = p_empresa and c.servico = 'PGDASD/CONSEXTRATO16'
                        and c.pedido->>'numeroDas' = o->'indiceDas'->>'numeroDas')
      order by per desc limit 3
    loop
      itens := itens || jsonb_build_array(jsonb_build_object('servico', 'PGDASD/CONSEXTRATO16', 'dados', jsonb_build_object('numeroDas', r.das)));
    end loop;

    execute ultimo_ok into d using p_empresa, 'PARCSN/PEDIDOSPARC163';
    if coalesce(d, '2000-01-01') <= hoje - 30 then
      itens := itens || jsonb_build_array(jsonb_build_object('servico', 'PARCSN/PEDIDOSPARC163'));
    end if;
    for r in
      select (p->>'numero')::int as numero
      from public.receita_respostas l cross join lateral jsonb_array_elements(coalesce(l.dados->'parcelamentos', '[]')) p
      where l.empresa_id = p_empresa and l.servico = 'PARCSN/PEDIDOSPARC163' and p->>'situacao' ilike '%em parcelamento%'
    loop
      execute ultimo_ok || $q$ and (v->'dados_pedido'->>'numeroParcelamento')::int = $3 $q$ into d using p_empresa, 'PARCSN/OBTERPARC164', r.numero;
      if coalesce(d, '2000-01-01') <= hoje - 7 then
        itens := itens || jsonb_build_array(jsonb_build_object('servico', 'PARCSN/OBTERPARC164', 'dados', jsonb_build_object('numeroParcelamento', r.numero)));
      end if;
    end loop;

    if extract(month from hoje) in (4, 5) then
      execute ultimo_ok into d using p_empresa, 'DEFIS/CONSDECLARACAO142';
      if coalesce(d, '2000-01-01') < make_date(extract(year from hoje)::int, 4, 1) then
        itens := itens || jsonb_build_array(jsonb_build_object('servico', 'DEFIS/CONSDECLARACAO142'));
      end if;
    end if;
    if extract(month from hoje) = 1 then
      execute ultimo_ok into d using p_empresa, 'REGIMEAPURACAO/CONSULTAROPCAOREGIME103';
      if coalesce(d, '2000-01-01') < date_trunc('year', hoje)::date then
        itens := itens || jsonb_build_array(jsonb_build_object('servico', 'REGIMEAPURACAO/CONSULTAROPCAOREGIME103', 'dados', jsonb_build_object('anoCalendario', extract(year from hoje)::int)));
      end if;
    end if;
  end if;

  -- DTE
  execute ultimo_ok into d using p_empresa, 'DTE/CONSULTASITUACAODTE111';
  if coalesce(d, '2000-01-01') <= hoje - 90 then
    itens := itens || jsonb_build_array(jsonb_build_object('servico', 'DTE/CONSULTASITUACAODTE111'));
  end if;

  return itens;
end $$;
revoke execute on function public.receita_lote_declaracoes(text) from public, anon, authenticated;

create or replace function public.receita_rotina_passo()
returns int language plpgsql security definer set search_path = public as $$
declare
  e record;
  v_ini timestamptz := (now() at time zone 'America/Sao_Paulo')::date::timestamp at time zone 'America/Sao_Paulo';
  v_feitos int := 0;
  v_tipo text;
  v_rotina text;
  v_par jsonb;
  v_itens jsonb;
  ult record;
  ligada jsonb := coalesce((select jsonb_object_agg(id, ligada) from public.receita_rotinas), '{}');
begin
  for e in
    select r.id from public.receita_empresas r join public.esocial_empresas s on s.id = r.id
    where r.producao_ligada order by r.id
  loop
    v_tipo := null; v_par := '{}';
    -- Um pedido por vez por empresa
    if exists (select 1 from public.receita_execucoes where empresa_id = e.id and status in ('na_fila', 'rodando')
               and created_at > now() - interval '10 minutes') then
      continue;
    end if;

    -- 1) Eventos de atualização (grátis). Se ficaram protocolos para ler, lê na passada seguinte (até 3 por dia).
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

    -- 2) Caixa postal: uma vez por dia (o aviso de mensagem nova é grátis)
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

    -- 4) Situação fiscal: a cada 7 dias
    if v_tipo is null and coalesce((ligada->>'situacao_fiscal')::boolean, false)
       and not exists (select 1 from public.receita_execucoes where empresa_id = e.id and ambiente = 'producao'
                       and tipo = 'situacao_fiscal' and (status = 'ok' and resultado ? 'texto' and created_at > now() - interval '7 days' or created_at >= v_ini)) then
      v_tipo := 'situacao_fiscal';
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
end $$;
revoke execute on function public.receita_rotina_passo() from public, anon, authenticated;

-- Situação no mapa de acessos e no catálogo, conferida em 30 e 31/10/2026 (lotes lidos com sucesso nas três empresas)
update public.receita_servicos set conferido = true
where id_sistema || '/' || id_servico in ('DCTFWEB/CONSRECIBO32', 'DCTFWEB/CONSDECCOMPLETA33', 'MIT/LISTAAPURACOES317', 'MIT/CONSAPURACAO316',
  'PGDASD/CONSDECLARACAO13', 'PGDASD/CONSEXTRATO16', 'PARCSN/PEDIDOSPARC163', 'PARCSN/OBTERPARC164', 'PARCSN-ESP/PEDIDOSPARC173',
  'PERTSN/PEDIDOSPARC183', 'RELPSN/PEDIDOSPARC193', 'DTE/CONSULTASITUACAODTE111', 'DEFIS/CONSDECLARACAO142', 'REGIMEAPURACAO/CONSULTAROPCAOREGIME103');
update public.receita_servicos set situacao = 'em_uso'
where id_sistema || '/' || id_servico in ('DCTFWEB/CONSRECIBO32', 'DCTFWEB/CONSDECCOMPLETA33', 'MIT/LISTAAPURACOES317', 'MIT/CONSAPURACAO316',
  'PGDASD/CONSDECLARACAO13', 'PGDASD/CONSEXTRATO16', 'PARCSN/PEDIDOSPARC163', 'PARCSN/OBTERPARC164', 'DTE/CONSULTASITUACAODTE111',
  'DEFIS/CONSDECLARACAO142', 'REGIMEAPURACAO/CONSULTAROPCAOREGIME103');

update public.fiscal_fontes set situacao = 'temos', atualizado_em = now(), como = 'SERPRO Integra Contador · rotina automática (Declarações e parcelamentos)',
  falta = '—', onde = '/receita'
where id in ('rf_dctfweb', 'rf_mit', 'rf_simples', 'rf_parcsn');
update public.fiscal_fontes set atualizado_em = now(),
  o_que_da = 'Recibo e declaração completa de cada mês (INSS da folha e retenções). Relida quando a Receita avisa que a DCTFWeb mudou.'
where id = 'rf_dctfweb';
update public.fiscal_fontes set atualizado_em = now(),
  o_que_da = 'Pedidos de parcelamento do Simples (PARCSN, especial, PERT e RELP) e o detalhe dos que estão em parcelamento.'
where id = 'rf_parcsn';
update public.fiscal_fontes set atualizado_em = now(), situacao = 'pronto',
  o_que_da = 'Se a empresa aderiu ao DTE (lido a cada 90 dias) e quem tem procuração de cada empresa no e-CAC.',
  falta = 'DTE já é lido. Procurações (41): falta informar o CNPJ ou CPF do procurador (o escritório de contabilidade).'
where id = 'rf_procuracoes';
update public.fiscal_fontes set atualizado_em = now(),
  falta = 'Programar a emissão sob pedido (51), com um formulário na tela para escolher o débito.'
where id = 'rf_darf';
