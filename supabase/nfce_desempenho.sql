-- 22/11/2026: a aba NFC-e ficou presa em "Sem notas ainda" com o histórico entrando (8 mil notas): nfce_meses levava 14 s.
-- 1) A política "notas_pode_ver(auth.uid())" era avaliada linha a linha; com (select ...) o banco calcula uma vez por consulta.
do $$ declare p record; begin
  for p in select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public' and cmd = 'SELECT' and qual = 'notas_pode_ver(auth.uid())'
      and (tablename like 'nfce\_%' or tablename like 'cte\_%' or tablename in ('notas_fiscal', 'notas_itens_fiscal', 'totvs_regras_fiscais',
        'icms_regras', 'totvs_produtos_execucoes'))
  loop
    execute format('alter policy %I on public.%I using ((select public.notas_pode_ver((select auth.uid()))))', p.policyname, p.tablename);
  end loop;
end $$;

-- 2) Índice de cobertura: nfce_meses e nfce_dia_resumo respondem só pelo índice, sem ler os itens (jsonb) das notas.
create index if not exists nfce_notas_resumo on public.nfce_notas (dia, unidade_id, situacao)
  include (emitente_cnpj, valor, servico, icms, pis, cofins, cbs, ibs);
-- Resultado: nfce_meses de 14 s para 0,14 s.

-- 3) Com o histórico em paralelo, nfce_gravar estourava o tempo (e às vezes duas leituras disputavam o mesmo lançamento do
--    PMS) porque no fim chamava nfce_assinadas_ligar para a unidade inteira. Agora só nos dias recentes e sem derrubar a
--    gravação; o histórico das assinadas fica com a rotina nfce-assinadas (a cada 30 min). Os dias que falharam voltam
--    sozinhos pela fila do histórico (nova tentativa depois de 20 min, até 4).
do $$ declare d text; begin
  d := pg_get_functiondef('public.nfce_gravar'::regproc);
  d := replace(d, '  perform public.nfce_assinadas_ligar(p_unidade);',
'  if p_dia >= (now() at time zone ''America/Fortaleza'')::date - 5 then
    begin
      perform public.nfce_assinadas_ligar(p_unidade);
    exception when others then null;
    end;
  end if;');
  execute d;
end $$;
