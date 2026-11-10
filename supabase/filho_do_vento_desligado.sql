-- =====================================================================
-- Filho do Vento fora de Hotéis — 10/11/2026, a pedido do dono.
-- O hotel usa outro sistema e o acesso ao PMS da TOTVS está inativo.
-- O robô só lê os hotéis com pms_hoteis.ativa; a página e o item do menu saíram do código.
-- Os dados já lidos ficam guardados (nada se apaga).
-- =====================================================================
update public.pms_hoteis set ativa = false where id = 'filho-do-vento';
