-- =====================================================================
-- Integrações: CT-e (fretes) e NFC-e (vendas) no painel (22/11/2026; aplica depois de integracoes*.sql, cte.sql e nfce.sql)
--  - Fonte nova 'cte' (cte_execucoes, CNPJs, esperando 1 h, CT-e em 7 dias) e os eventos dela na linha do tempo.
--  - Na fonte 'totvs': NFC-e autorizadas e pendentes nos últimos 7 dias (as notas vêm junto com as vendas).
--  - Regras do cartão em lib/integracoes.ts (CT-e: verde até 3 h sem leitura boa, amarelo até 8 h).
-- Feito por troca de texto na função atual (para não reescrever integracoes_painel inteira).
-- =====================================================================
do $$
declare d text := pg_get_functiondef('public.integracoes_painel()'::regprocedure);
begin
  if position('''cte''' in d) = 0 then
    d := replace(d, $a$      'totvs', public.integracoes_exec('totvs_execucoes') || jsonb_build_object($a$,
      $b$      'cte', public.integracoes_exec('cte_execucoes') || jsonb_build_object(
        'empresas', (select count(*) from public.cte_empresas where ativa),
        'bloqueadas', (select count(*) from public.cte_empresas where ativa and bloqueado_ate > now()),
        'ctes_7d', (select count(*) from public.cte_notas where created_at > now() - interval '7 days')),
      'totvs', public.integracoes_exec('totvs_execucoes') || jsonb_build_object(
        'nfce_7d', (select count(*) from public.nfce_notas where dia > (now() at time zone 'America/Fortaleza')::date - 7 and situacao = 'autorizada'),
        'nfce_pendentes_7d', (select count(*) from public.nfce_notas where dia > (now() at time zone 'America/Fortaleza')::date - 7 and situacao = 'pendente'),$b$);
    d := replace(d, $a$        union all (select 'totvs', status,$a$,
      $b$        union all (select 'cte', status, created_at, empresa_cnpj, left(erro, 200) from public.cte_execucoes order by created_at desc limit 12)
        union all (select 'totvs', status,$b$);
    if position('''cte''' in d) = 0 then raise exception 'não achei onde incluir o CT-e'; end if;
    execute d;
  end if;
end $$;
