-- =====================================================================
-- Receita Federal: custos por empresa (aplicado em 27/10/2026, depois de supabase/receita.sql)
-- Cada empresa tem o próprio contrato do Integra Contador com o SERPRO, faturado por ciclo
-- do dia 21 ao dia 20. Por isso:
--  1) a faixa de preço conta só as chamadas da própria empresa no ciclo (antes: todas, no mês);
--  2) teto de gasto por ciclo (receita_empresas.orcamento_ciclo): passou do teto, o pedido é recusado;
--  3) receita_chamadas entra no Realtime, para o site mostrar o gasto ao vivo;
--  4) receita_ajustar: quem tem acesso muda o limite diário e o teto pelo site.
-- =====================================================================

alter table public.receita_empresas add column if not exists orcamento_ciclo numeric(10,2) not null default 30;

-- Primeiro dia do ciclo de faturamento (dia 21) que contém a data, no horário de Brasília
create or replace function public.receita_ciclo_inicio(p timestamptz default now())
returns date language sql stable set search_path = public as $$
  select case when extract(day from d) >= 21 then date_trunc('month', d)::date + 20
              else (date_trunc('month', d) - interval '1 month')::date + 20 end
  from (select (p at time zone 'America/Sao_Paulo')::date as d) x
$$;
grant execute on function public.receita_ciclo_inicio(timestamptz) to authenticated;

create or replace function public.receita_pedir(p_empresa text, p_ambiente text, p_tipo text, p_parametros jsonb,
  p_origem text, p_user uuid)
returns uuid language plpgsql security definer set search_path = public, vault as $$
declare
  e public.esocial_empresas;
  r public.receita_empresas;
  v_id uuid;
  v_usadas int;
  v_gasto numeric;
begin
  select * into e from public.esocial_empresas where id = p_empresa;
  if e.id is null then raise exception 'Empresa "%" não encontrada.', p_empresa; end if;
  insert into public.receita_empresas (id) values (e.id) on conflict do nothing;
  select * into r from public.receita_empresas where id = e.id;

  if p_ambiente not in ('demonstracao', 'producao') then
    raise exception 'Ambiente inválido (demonstracao ou producao).';
  end if;
  if p_tipo not in ('caixa_postal', 'situacao_fiscal', 'pagamentos') then
    raise exception 'Tipo de pedido desconhecido: %', p_tipo;
  end if;

  if p_ambiente = 'producao' then
    if not r.producao_ligada then
      raise exception 'A Receita em produção ainda não foi ligada para %. Por enquanto só a demonstração.', e.nome;
    end if;
    if e.cert_validade is null or e.cert_validade <= now() then
      raise exception 'O certificado da empresa % venceu ou não existe. Envie o novo pela tela do eSocial.', e.nome;
    end if;
    if not exists (select 1 from vault.secrets where name = 'receita_serpro_' || e.id) then
      raise exception 'Faltam as chaves do contrato do SERPRO para %.', e.nome;
    end if;
    if exists (select 1 from public.receita_execucoes where empresa_id = e.id and ambiente = p_ambiente
               and status in ('na_fila', 'rodando') and created_at > now() - interval '5 minutes') then
      raise exception 'Já há um pedido à Receita em andamento para esta empresa; tente em instantes.';
    end if;
    select count(*) into v_usadas from public.receita_chamadas
    where empresa_id = e.id and ambiente = 'producao' and cobrada
      and (created_at at time zone 'America/Sao_Paulo')::date = (now() at time zone 'America/Sao_Paulo')::date;
    if v_usadas >= r.limite_diario_cobradas then
      raise exception 'Limite de % chamadas cobradas por dia já foi usado para %.', r.limite_diario_cobradas, e.nome;
    end if;
    -- Teto de gasto do ciclo de faturamento do contrato (dia 21 ao dia 20)
    select coalesce(sum(custo), 0) into v_gasto from public.receita_chamadas
    where empresa_id = e.id and ambiente = 'producao' and cobrada
      and created_at >= public.receita_ciclo_inicio()::timestamp at time zone 'America/Sao_Paulo';
    if v_gasto >= r.orcamento_ciclo then
      raise exception 'O teto de R$ % do ciclo (dia 21 ao dia 20) já foi atingido para %. Para continuar, aumente o teto em Gastos.',
        replace(to_char(r.orcamento_ciclo, 'FM9990.00'), '.', ','), e.nome;
    end if;
  end if;

  insert into public.receita_execucoes (empresa_id, ambiente, tipo, parametros, origem, pedido_por)
  values (e.id, p_ambiente, p_tipo, coalesce(p_parametros, '{}'), coalesce(p_origem, 'site'), p_user) returning id into v_id;

  perform net.http_post(
    url := 'https://brasico.vercel.app/api/receita',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-segredo', (select decrypted_secret from vault.decrypted_secrets where name = 'receita_segredo')),
    body := jsonb_build_object('execucao', v_id),
    timeout_milliseconds := 30000);
  return v_id;
end $$;
revoke execute on function public.receita_pedir(text, text, text, jsonb, text, uuid) from public, anon, authenticated;

create or replace function public.receita_worker_concluir(p_segredo text, p_execucao uuid, p_status text,
  p_resultado jsonb, p_erro text, p_chamadas jsonb, p_mensagens jsonb, p_relatorios jsonb, p_pagamentos jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  x public.receita_execucoes;
  c jsonb; m jsonb; p jsonb; r jsonb;
  v_cat text; v_cobrada boolean; v_no_mes int;
begin
  perform public.receita_conferir_segredo(p_segredo);
  update public.receita_execucoes set status = p_status, resultado = coalesce(p_resultado, '{}'),
    erro = left(coalesce(p_erro, ''), 1000), fim = now()
  where id = p_execucao and status = 'rodando' returning * into x;
  if x.id is null then return; end if;

  for c in select * from jsonb_array_elements(coalesce(p_chamadas, '[]')) loop
    v_cat := case c->>'endpoint' when 'Consultar' then 'consulta' when 'Emitir' then 'emissao'
                                 when 'Declarar' then 'declaracao' else 'gratis' end;
    v_cobrada := x.ambiente = 'producao' and v_cat <> 'gratis' and (c->>'http_status')::int in (200, 202, 403);
    if v_cobrada then
      select count(*) + 1 into v_no_mes from public.receita_chamadas
      -- a faixa de preço é do contrato da própria empresa, no ciclo de faturamento (dia 21 ao dia 20)
      where ambiente = 'producao' and cobrada and categoria = v_cat and empresa_id = x.empresa_id
        and created_at >= public.receita_ciclo_inicio()::timestamp at time zone 'America/Sao_Paulo';
    end if;
    insert into public.receita_chamadas (execucao_id, empresa_id, ambiente, endpoint, id_sistema, id_servico,
      http_status, codigo, categoria, cobrada, custo, duracao_ms)
    values (x.id, x.empresa_id, x.ambiente, c->>'endpoint', coalesce(c->>'id_sistema', ''), coalesce(c->>'id_servico', ''),
      (c->>'http_status')::int, left(coalesce(c->>'codigo', ''), 200), v_cat, v_cobrada,
      case when v_cobrada then public.receita_preco(v_cat, v_no_mes) else 0 end, (c->>'duracao_ms')::int);
  end loop;

  for m in select * from jsonb_array_elements(coalesce(p_mensagens, '[]')) loop
    insert into public.receita_mensagens as t (ambiente, empresa_id, isn, assunto, remetente, enviada_em, relevancia,
      lida_na_receita, ciencia_em, corpo, detalhe, detalhada_em)
    values (x.ambiente, x.empresa_id, m->>'isn', coalesce(m->>'assunto', ''), coalesce(m->>'remetente', ''),
      public.receita_data(m->>'enviada_em'), coalesce(m->>'relevancia', ''), coalesce((m->>'lida')::boolean, false),
      public.receita_data(m->>'ciencia_em'), m->>'corpo', m->'detalhe', case when m ? 'corpo' then now() end)
    on conflict (ambiente, empresa_id, isn) do update set
      assunto = case when excluded.assunto <> '' then excluded.assunto else t.assunto end,
      remetente = case when excluded.remetente <> '' then excluded.remetente else t.remetente end,
      enviada_em = coalesce(excluded.enviada_em, t.enviada_em),
      relevancia = case when excluded.relevancia <> '' then excluded.relevancia else t.relevancia end,
      lida_na_receita = excluded.lida_na_receita or t.lida_na_receita,
      ciencia_em = coalesce(excluded.ciencia_em, t.ciencia_em),
      corpo = coalesce(excluded.corpo, t.corpo),
      detalhe = coalesce(excluded.detalhe, t.detalhe),
      detalhada_em = coalesce(excluded.detalhada_em, t.detalhada_em);
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_relatorios, '[]')) loop
    insert into public.receita_relatorios (ambiente, empresa_id, tipo, pdf_base64, tamanho, execucao_id)
    values (x.ambiente, x.empresa_id, coalesce(r->>'tipo', 'situacao_fiscal'), r->>'pdf_base64',
      length(r->>'pdf_base64') * 3 / 4, x.id);
  end loop;

  for p in select * from jsonb_array_elements(coalesce(p_pagamentos, '[]')) loop
    insert into public.receita_pagamentos as t (ambiente, empresa_id, numero_documento, tipo_documento, codigo_receita,
      descricao_receita, periodo_apuracao, data_arrecadacao, data_vencimento, valor_total, dados)
    values (x.ambiente, x.empresa_id, p->>'numero_documento', coalesce(p->>'tipo_documento', ''),
      coalesce(p->>'codigo_receita', ''), coalesce(p->>'descricao_receita', ''), public.receita_data(p->>'periodo_apuracao'),
      public.receita_data(p->>'data_arrecadacao'), public.receita_data(p->>'data_vencimento'),
      (p->>'valor_total')::numeric, coalesce(p->'dados', '{}'))
    on conflict (ambiente, empresa_id, numero_documento) do update set
      tipo_documento = excluded.tipo_documento, codigo_receita = excluded.codigo_receita,
      descricao_receita = excluded.descricao_receita, periodo_apuracao = excluded.periodo_apuracao,
      data_arrecadacao = excluded.data_arrecadacao, data_vencimento = excluded.data_vencimento,
      valor_total = excluded.valor_total, dados = excluded.dados, atualizado_em = now();
  end loop;
end $$;
revoke execute on function public.receita_worker_concluir(text, uuid, text, jsonb, text, jsonb, jsonb, jsonb, jsonb) from public, authenticated;
grant execute on function public.receita_worker_concluir(text, uuid, text, jsonb, text, jsonb, jsonb, jsonb, jsonb) to anon;

-- Ajustes pelo site (página da Receita → Gastos)
create or replace function public.receita_ajustar(p_empresa text, p_limite_diario int, p_orcamento numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.receita_pode_ver(auth.uid()) then raise exception 'Sem acesso à Receita' using errcode = '42501'; end if;
  if p_limite_diario is null or p_limite_diario < 0 or p_limite_diario > 500 then
    raise exception 'O limite diário vai de 0 a 500 chamadas cobradas.';
  end if;
  if p_orcamento is null or p_orcamento < 0 or p_orcamento > 1000 then
    raise exception 'O teto do ciclo vai de R$ 0 a R$ 1.000.';
  end if;
  update public.receita_empresas set limite_diario_cobradas = p_limite_diario, orcamento_ciclo = round(p_orcamento, 2)
  where id = p_empresa;
  if not found then raise exception 'Esta empresa ainda não tem ficha na Receita.'; end if;
end $$;
revoke execute on function public.receita_ajustar(text, int, numeric) from public, anon;
grant execute on function public.receita_ajustar(text, int, numeric) to authenticated;

-- Gasto ao vivo no site
do $do$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'receita_chamadas') then
    alter publication supabase_realtime add table public.receita_chamadas;
  end if;
end $do$;
