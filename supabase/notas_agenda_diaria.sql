-- =====================================================================
-- Notas fiscais: rotina diária (substitui a de segunda de supabase/notas_agenda.sql, pedido do dono em 29/10/2026;
-- a consulta à SEFAZ não tem custo)
--  - Todo dia às 6h (Fortaleza, 09h UTC): busca na SEFAZ de cada empresa com notas_empresas.ativa ligada.
--    A continuação e a ciência se encadeiam sozinhas (no máximo 30 pedidos por empresa por dia).
--  - Todo dia às 9h (12h UTC): nova rodada, que traz as notas completas depois da ciência
--    (a SEFAZ pede 1 hora entre consultas sem documento novo; notas_pedir respeita bloqueado_ate).
-- =====================================================================

select cron.unschedule('notas-segunda') where exists (select 1 from cron.job where jobname = 'notas-segunda');
select cron.unschedule('notas-segunda-completas') where exists (select 1 from cron.job where jobname = 'notas-segunda-completas');
select cron.unschedule('notas-diaria') where exists (select 1 from cron.job where jobname = 'notas-diaria');
select cron.schedule('notas-diaria', '0 9 * * *', $job$ select public.notas_rodada() $job$);
select cron.unschedule('notas-diaria-completas') where exists (select 1 from cron.job where jobname = 'notas-diaria-completas');
select cron.schedule('notas-diaria-completas', '0 12 * * *', $job$ select public.notas_rodada() $job$);
