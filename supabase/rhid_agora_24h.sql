-- RHiD: leitura "agora" a cada minuto, 24 horas por dia (14/11/2026, pedido do dono: "a cada 1 minuto, direto").
-- Antes parava da meia-noite às 6h de Fortaleza (agenda '* 0-2,9-23 * * *' em UTC).
select cron.alter_job((select jobid from cron.job where jobname = 'rhid-agora'), schedule := '* * * * *');
