-- Proteção contra sobrecarga do banco (23/11/2026)
--
-- O que houve: na noite de 22 para 23/11 a leitura das NFC-e antigas pela data de integração
-- (nfce-integracao, 6 dias por unidade por minuto) leu ~530 dias entre 23h e 1h de Fortaleza.
-- Das 2h às 8h27 o banco ficou lento: as rotinas de cada minuto (totvs-ao-vivo, nfce-integracao,
-- nfce-historico) passaram a levar 30 s a 6 min cada, se acumularam, o pg_cron não conseguia
-- abrir rotinas novas ("job startup timeout") e o site parou (o middleware não respondia em 25 s).
-- O banco foi reiniciado às 8h27 e tudo voltou. O nfce-historico já estava desligado depois disso.
--
-- 1) nfce-integracao: o histórico já foi todo lido; daqui em diante só pega o dia de ontem
--    e repete o que falhou. A cada 20 min basta (antes: a cada minuto, 1,8 s por chamada).
select cron.alter_job((select jobid from cron.job where jobname = 'nfce-integracao'),
  schedule := '*/20 * * * *',
  command := $$set statement_timeout = '50s'; select public.nfce_integracao_passo()$$);

-- 2) totvs-ao-vivo: continua a cada minuto, mas com limite de 50 s (normal: ~1 s), para não
--    acumular rodadas se o banco ficar lento.
select cron.alter_job((select jobid from cron.job where jobname = 'totvs-ao-vivo'),
  command := $$set statement_timeout = '50s'; select public.totvs_ao_vivo()$$);

-- 3) Vendas por produto (aba Produtos): a atualização leva ~35 s; de hora em hora basta
--    (antes: a cada 30 min).
select cron.alter_job((select jobid from cron.job where jobname = 'totvs-produtos-vendas'),
  schedule := '15 * * * *');
