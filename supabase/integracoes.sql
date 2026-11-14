-- Painel de integrações (13/11/2026, pedido do dono: "um painel para vermos em tempo real tudo que estamos conectados").
-- Página /integracoes (components/Integracoes.tsx, regras de situação em lib/integracoes.ts).
-- Uma função só, de leitura, para os sócios (notas_pode_ver): junta de cada integração a última leitura boa,
-- a última falha e o erro, quantas rodaram nas últimas 24 h, o que ficou preso, as agendas do pg_cron,
-- os certificados e uma linha do tempo com as leituras mais recentes de todas as fontes. Não grava nada.

-- Resumo de uma tabela de execuções (privada: só a função do painel chama).
create or replace function public.integracoes_exec(p_tabela text, p_filtro text default 'true', p_quando text default 'created_at')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb; v_erro text; v_erro_em timestamptz; v_horas jsonb;
begin
  execute format($q$
    select jsonb_build_object(
      'ultima', max(%2$s),
      'ultima_ok', max(coalesce(fim, %2$s)) filter (where status in ('ok','sem_dados','sem_movimento','parcial','pulada','sem_pedido')),
      'ultima_falha', max(%2$s) filter (where status = 'falha'),
      'ok_24h', count(*) filter (where %2$s > now() - interval '24 hours' and status in ('ok','sem_dados','sem_movimento','parcial','pulada','sem_pedido')),
      'falha_24h', count(*) filter (where %2$s > now() - interval '24 hours' and status = 'falha'),
      'rodando', count(*) filter (where status in ('rodando','na_fila','pendente','no_lote') and %2$s > now() - interval '1 hour'),
      'presos', count(*) filter (where status in ('rodando','na_fila','pendente') and %2$s <= now() - interval '1 hour' and %2$s > now() - interval '3 days'))
    from public.%1$I where %2$s > now() - interval '45 days' and (%3$s)$q$, p_tabela, p_quando, p_filtro)
  into r;
  execute format($q$select left(coalesce(erro, ''), 300), %2$s from public.%1$I
    where status = 'falha' and %2$s > now() - interval '7 days' and (%3$s) order by %2$s desc limit 1$q$, p_tabela, p_quando, p_filtro)
  into v_erro, v_erro_em;
  -- Atividade por hora nas últimas 24 h: [ok, falha] de cada hora, da mais antiga (posição 0) para a mais nova (23)
  execute format($q$select coalesce(jsonb_agg(jsonb_build_array(coalesce(x.ok, 0), coalesce(x.f, 0)) order by g.h), '[]'::jsonb)
    from generate_series(0, 23) g(h) left join (
      select floor(extract(epoch from (now() - %2$s)) / 3600)::int as h,
        count(*) filter (where status in ('ok','sem_dados','sem_movimento','parcial','pulada','sem_pedido')) as ok,
        count(*) filter (where status = 'falha') as f
      from public.%1$I where %2$s > now() - interval '24 hours' and (%3$s) group by 1) x on x.h = 23 - g.h$q$, p_tabela, p_quando, p_filtro)
  into v_horas;
  return r || jsonb_build_object('ultimo_erro', nullif(v_erro, ''), 'ultimo_erro_em', v_erro_em, 'horas', v_horas);
end $$;
revoke all on function public.integracoes_exec(text, text, text) from public, anon, authenticated;

create or replace function public.integracoes_painel()
returns jsonb language plpgsql stable security definer set search_path = public, cron as $$
declare r jsonb;
begin
  if not coalesce(public.notas_pode_ver(auth.uid()), false) then
    raise exception 'Só os sócios veem o painel de integrações.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'agora', now(),
    'fontes', jsonb_build_object(
      'rhid', public.integracoes_exec('rhid_execucoes') || jsonb_build_object(
        'ultima_agora', (select max(fim) from public.rhid_execucoes where tipo = 'agora' and status = 'ok' and created_at > now() - interval '3 days'),
        'ultima_apuracao', (select max(fim) from public.rhid_execucoes where tipo = 'batidas' and status = 'ok' and created_at > now() - interval '7 days'),
        'ultimo_cadastro', (select max(fim) from public.rhid_execucoes where tipo = 'cadastros' and status = 'ok' and created_at > now() - interval '7 days'),
        'clientes', (select count(*) from public.rhid_clientes where ativo)),
      'esocial', public.integracoes_exec('esocial_execucoes', 'ambiente = 1 and tipo <> ''teste_conexao''') || jsonb_build_object(
        'empresas', (select coalesce(jsonb_agg(jsonb_build_object('nome', e.nome, 'ligada', e.leitura_automatica,
            'limite', e.limite_diario, 'acessos_hoje', (select contados from public.esocial_acessos_hoje(e.id, 1)),
            'a_baixar', (select count(*) from public.esocial_eventos v where v.empresa_id = e.id and v.ambiente = 1 and v.situacao = 'pendente'))
          order by e.ordem, e.nome), '[]'::jsonb) from public.esocial_empresas e)),
      'receita', public.integracoes_exec('receita_execucoes', 'tipo <> ''eventos''') || jsonb_build_object(
        'ultimo_evento', (select max(created_at) from public.receita_execucoes where tipo = 'eventos' and status in ('ok','sem_dados')),
        'empresas_producao', (select count(*) from public.receita_empresas where producao_ligada),
        'gasto_ciclo', (select coalesce(sum(custo), 0) from public.receita_chamadas where cobrada and ambiente = 'producao'
          and created_at >= public.receita_ciclo_inicio(now())),
        'orcamento_ciclo', (select coalesce(sum(orcamento_ciclo), 0) from public.receita_empresas where producao_ligada),
        'cobradas_hoje', (select count(*) from public.receita_chamadas where cobrada and ambiente = 'producao'
          and created_at >= date_trunc('day', now() at time zone 'America/Fortaleza') at time zone 'America/Fortaleza'),
        'chamadas_erro_24h', (select count(*) from public.receita_chamadas where created_at > now() - interval '24 hours' and http_status >= 400)),
      'notas', public.integracoes_exec('notas_execucoes') || jsonb_build_object(
        'empresas', (select count(*) from public.notas_empresas where ativa),
        'bloqueadas', (select count(*) from public.notas_empresas where ativa and bloqueado_ate > now()),
        'notas_7d', (select count(*) from public.notas where created_at > now() - interval '7 days'),
        'ultima_nota', (select max(created_at) from public.notas)),
      'nfse', public.integracoes_exec('nfse_execucoes') || jsonb_build_object(
        'empresas', (select count(*) from public.nfse_empresas where ativa),
        'bloqueadas', (select count(*) from public.nfse_empresas where ativa and bloqueado_ate > now()),
        'notas_7d', (select count(*) from public.nfse_notas where created_at > now() - interval '7 days')),
      'totvs', public.integracoes_exec('totvs_execucoes') || jsonb_build_object(
        'unidades', (select coalesce(jsonb_agg(jsonb_build_object('nome', u.nome,
            'ultimo_dia', (select max(d.dia) from public.totvs_dias d where d.unidade_id = u.id and d.status <> 'sem_movimento'),
            'ontem', (select d.status from public.totvs_dias d where d.unidade_id = u.id
              and d.dia = (now() at time zone 'America/Fortaleza')::date - 1))
          order by u.ordem, u.nome), '[]'::jsonb) from public.totvs_unidades u where u.ativa and u.encerrada_em is null)),
      'cicchetti', jsonb_build_object(
        'ultima', (select max(created_at) from public.cicchetti_consultas),
        'ultima_ok', (select max(created_at) from public.cicchetti_consultas where http_status between 200 and 299),
        'ultima_falha', (select max(created_at) from public.cicchetti_consultas where http_status is null or http_status >= 400),
        'ok_24h', (select count(*) from public.cicchetti_consultas where created_at > now() - interval '24 hours' and http_status between 200 and 299),
        'falha_24h', (select count(*) from public.cicchetti_consultas where created_at > now() - interval '24 hours' and (http_status is null or http_status >= 400)),
        'ultimo_erro', (select left(coalesce(erro, 'HTTP ' || http_status), 300) from public.cicchetti_consultas
          where (http_status is null or http_status >= 400) and created_at > now() - interval '7 days' order by created_at desc limit 1),
        'horas', (select coalesce(jsonb_agg(jsonb_build_array(coalesce(x.ok, 0), coalesce(x.f, 0)) order by g.h), '[]'::jsonb) from generate_series(0, 23) g(h)
          left join (select floor(extract(epoch from (now() - created_at)) / 3600)::int h, count(*) filter (where http_status between 200 and 299) ok,
            count(*) filter (where http_status is null or http_status >= 400) f from public.cicchetti_consultas
            where created_at > now() - interval '24 hours' group by 1) x on x.h = 23 - g.h)),
      'pms', public.integracoes_exec('pms_execucoes', 'origem = ''robo''') || jsonb_build_object(
        'intervalo_min', (select intervalo_min from public.pms_robo_ajustes limit 1),
        'hoteis', (select coalesce(jsonb_agg(jsonb_build_object('nome', h.nome,
            'ultima_leitura', (select max(x.lido_em) from public.pms_horas x where x.hotel_id = h.id)) order by h.ordem, h.nome), '[]'::jsonb)
          from public.pms_hoteis h where h.ativa)),
      'whatsapp', jsonb_build_object(
        'ultima_mensagem', (select max(enviada_em) from public.wa_mensagens where enviada_em > now() - interval '30 days'),
        'mensagens_24h', (select count(*) from public.wa_mensagens where enviada_em > now() - interval '24 hours'),
        'grupos_24h', (select count(distinct grupo_id) from public.wa_mensagens where enviada_em > now() - interval '24 hours'),
        'envios_24h', (select count(*) from public.wa_envios where created_at > now() - interval '24 hours'),
        'envios_falha_24h', (select count(*) from public.wa_envios where created_at > now() - interval '24 hours' and not ok),
        'horas', (select coalesce(jsonb_agg(jsonb_build_array(coalesce(x.n, 0), 0) order by g.h), '[]'::jsonb) from generate_series(0, 23) g(h)
          left join (select floor(extract(epoch from (now() - enviada_em)) / 3600)::int h, count(*) n from public.wa_mensagens
            where enviada_em > now() - interval '24 hours' group by 1) x on x.h = 23 - g.h)),
      'gemini', public.integracoes_exec('compras_analises', 'true', 'inicio'),
      'claude', jsonb_build_object(
        'ultimo_resumo', (select max(created_at) from public.wa_resumos_gerais where criado_por is null),
        'resumo_ontem', exists (select 1 from public.wa_resumos_gerais where criado_por is null
          and de <= (now() at time zone 'America/Fortaleza')::date - 1 and ate >= (now() at time zone 'America/Fortaleza')::date - 1)),
      'conector', jsonb_build_object(
        'links', (select count(*) from public.mcp_tokens where revoked_at is null),
        'ultimo_uso', (select max(last_used_at) from public.mcp_tokens where revoked_at is null))
    ),
    'certificados', (select coalesce(jsonb_agg(jsonb_build_object('nome', nome, 'cnpj', cnpj, 'matriz', matriz, 'validade', validade)
      order by validade), '[]'::jsonb) from public.certificados),
    'agendas', (select coalesce(jsonb_agg(jsonb_build_object('nome', j.jobname, 'horario', j.schedule, 'ativa', j.active,
        'ultima', u.start_time, 'ultima_status', u.status, 'ultima_msg', left(u.return_message, 200),
        'rodadas_24h', coalesce(c.n, 0), 'falhas_24h', coalesce(c.f, 0)) order by j.jobname), '[]'::jsonb)
      from cron.job j
      left join (select distinct on (jobid) jobid, start_time, status, return_message from cron.job_run_details
        where start_time > now() - interval '35 days' order by jobid, start_time desc) u on u.jobid = j.jobid
      left join (select jobid, count(*) n, count(*) filter (where status = 'failed') f from cron.job_run_details
        where start_time > now() - interval '24 hours' group by jobid) c on c.jobid = j.jobid),
    'eventos', (select coalesce(jsonb_agg(e order by e->>'quando' desc), '[]'::jsonb) from (
      select jsonb_build_object('fonte', fonte, 'status', status, 'quando', quando, 'detalhe', detalhe, 'erro', erro) e from (
        (select 'rhid' fonte, status, created_at quando, tipo detalhe, left(erro, 200) erro from public.rhid_execucoes
          where tipo <> 'agora' or status <> 'ok' order by created_at desc limit 12)
        union all (select 'esocial', status, created_at, tipo, left(coalesce(erro, desc_resposta), 200) from public.esocial_execucoes where ambiente = 1 order by created_at desc limit 12)
        union all (select 'receita', status, created_at, tipo, left(erro, 200) from public.receita_execucoes order by created_at desc limit 12)
        union all (select 'notas', status, created_at, tipo, left(erro, 200) from public.notas_execucoes order by created_at desc limit 12)
        union all (select 'nfse', status, created_at, empresa_cnpj, left(erro, 200) from public.nfse_execucoes order by created_at desc limit 12)
        union all (select 'totvs', status, created_at, unidade_id || ' · ' || to_char(dia, 'DD/MM'), left(erro, 200) from public.totvs_execucoes order by created_at desc limit 12)
        union all (select 'pms', status, created_at, origem, left(erro, 200) from public.pms_execucoes order by created_at desc limit 12)
        union all (select 'gemini', status, inicio, 'análise de compras', left(erro, 200) from public.compras_analises order by inicio desc limit 12)
        union all (select 'cicchetti', case when http_status between 200 and 299 then 'ok' else 'falha' end, created_at,
          endpoint || coalesce(' · ' || unidade, ''), left(erro, 200) from public.cicchetti_consultas order by created_at desc limit 12)
      ) x order by quando desc limit 60) y)
  ) into r;
  return r;
end $$;
revoke all on function public.integracoes_painel() from public, anon;
grant execute on function public.integracoes_painel() to authenticated;

-- 13/11/2026: as notas de compra não vêm mais do Cicchetti Management (o Índice de preços lê as da SEFAZ,
-- precos_base). A agenda precos-coleta foi desligada (active = false, nada apagado) e o painel não cobra mais os itens.
select cron.alter_job((select jobid from cron.job where jobname = 'precos-coleta'), active := false);

-- Área do menu (usuario_areas): quem tem áreas definidas só vê o painel se tiver 'integracoes'. Sócios (sem linha) veem.
