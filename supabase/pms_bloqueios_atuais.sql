-- =====================================================================
-- PMS dos hotéis: só os bloqueios que ainda existem no PMS — 08/11/2026.
-- Ao alterar um bloqueio, o PMS cria outro (id novo) e tira o antigo; liberar um bloqueio também o tira. Como nada se
-- apaga em pms_bloqueios, o mapa mostrava os dois (ex.: 4B do Sempre Vivo, 04–10/11 virou 04–07/11). O robô relê os
-- bloqueios de 60 dias atrás a ~10 meses à frente a cada rodada: dentro dessa janela, bloqueio que não veio na última
-- leitura (visto_em mais de 10 min antes da leitura mais recente do hotel) foi tirado no PMS e sai da visão.
-- Fora da janela (mais antigos), ficam como estão. A tabela guarda tudo (histórico).
-- =====================================================================

create or replace view public.pms_bloqueios_atuais with (security_invoker = true) as
select b.*
from public.pms_bloqueios b
where b.fim < (now() at time zone 'America/Fortaleza')::date - 55
   or b.visto_em >= (select max(x.visto_em) from public.pms_bloqueios x where x.hotel_id = b.hotel_id) - interval '10 minutes';
grant select on public.pms_bloqueios_atuais to authenticated;
