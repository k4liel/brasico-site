-- =====================================================================
-- PMS dos hotéis: resumo financeiro de cada reserva, pelas transações — 08/11/2026 (prévia do mapa).
-- No PMS a cobrança entra negativa e o pagamento positivo: aqui todos aparecem positivos (estorno reduz).
-- lancado = diárias + taxas + consumo + spa + serviços; saldo = lançado − pago (positivo = falta pagar).
-- =====================================================================

create or replace view public.pms_reserva_financeiro with (security_invoker = true) as
select hotel_id, reserva,
       sum(case when grupo = 'Diária' then -valor else 0 end) as diarias,
       sum(case when grupo = 'Taxa' then -valor else 0 end) as taxas,
       sum(case when grupo = 'Consumo' then -valor else 0 end) as consumo,
       sum(case when grupo = 'Spa' then -valor else 0 end) as spa,
       sum(case when grupo not in ('Diária', 'Taxa', 'Consumo', 'Spa', 'Pagamento') then -valor else 0 end) as servicos,
       sum(case when grupo <> 'Pagamento' then -valor else 0 end) as lancado,
       sum(case when grupo = 'Pagamento' then valor else 0 end) as pago,
       sum(case when grupo <> 'Pagamento' then -valor else 0 end) - sum(case when grupo = 'Pagamento' then valor else 0 end) as saldo,
       count(*) as lancamentos,
       max(dia) as ultimo_lancamento
from public.pms_transacoes
where reserva is not null
group by hotel_id, reserva;
grant select on public.pms_reserva_financeiro to authenticated;
