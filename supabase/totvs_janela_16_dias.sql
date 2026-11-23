-- 22/11/2026: a TOTVS passou a recusar (HTTP 403) a CapaVenda de dias com mais de ~16 dias.
-- Conferido no mesmo dia: 06/11 respondeu em 62 s; 01/11 a 05/11 (e todo o histórico de set/out) voltam 403 em ~5 s,
-- nas duas lojas e no Ponta Negra. Em outubro o histórico de 2025 ainda abria: a limitação é nova.
-- Pedir mais (ou em paralelo) não adianta: o histórico das NFC-e e a releitura do Ponta Negra passam a pedir só dias
-- dentro da janela. A ao vivo (a cada minuto) e o histórico dos últimos 15 dias deixam tudo completo daqui para frente;
-- as NFC-e antigas têm de vir dos XML (exportação do Chef Web ou do contador).
do $$ declare d text; begin
  d := pg_get_functiondef('public.nfce_historico_passo'::regproc);
  d := replace(d, 'where d.unidade_id = u.id and d.vendas > 0 and d.dia < v_hoje', 'where d.unidade_id = u.id and d.vendas > 0 and d.dia < v_hoje and d.dia >= v_hoje - 15');
  execute d;
  d := pg_get_functiondef('public.totvs_ponta_negra_reler'::regproc);
  d := replace(d, 'generate_series(date ''2026-11-01'', v_ontem', 'generate_series(greatest(date ''2026-11-01'', v_ontem - 14), v_ontem');
  execute d;
end $$;
