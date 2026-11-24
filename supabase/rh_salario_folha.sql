-- RH: salário atual pela folha (S-1200), 23/11/2026, pedido do dono ("tem vários salários faltando").
-- O salário de contrato (vrSalFx do S-2200/S-2206) faltava para 38 pessoas e estava velho para muitas outras:
--  * transferidos no grupo (motivo 11) têm o S-2200 enviado na data da transferência, não na admissão da planilha,
--    então a janela da admissão volta vazia;
--  * os reajustes (salário mínimo 1.412 → 1.518 → 1.621, convenção) não chegam como S-2206.
-- A folha de cada mês já é baixada (S-1200) e traz a rubrica 8781 do contador = salário do mês, com os dias (qtdRubr).
-- Conferido em 23/11/2026: 117 de 127 ativos têm a rubrica; com 30 dias ela bate com o contrato quando não houve reajuste.
-- Esta view dá, por pessoa, o salário do último mês da folha: mês cheio = o valor; mês com menos dias (admissão, férias)
-- = o valor do último mês cheio se for o mesmo salário, senão o proporcional levado a 30 dias.
-- security_invoker: vale a mesma regra de quem vê os eventos (esocial_pode_ver). A página escolhe entre esta e o contrato
-- (o mais novo vale; lib/esocial/rh.ts, montarPessoas).
create or replace view public.rh_salario_folha with (security_invoker = on) as
with validos as (
  select v.* from public.esocial_eventos v
  where v.tipo = 'S-1200' and v.situacao = 'baixado' and v.ambiente = 1 and v.cpf_trab is not null
    and v.per_apur ~ '^\d{4}-\d{2}$' and v.xml_evento like '%<indApuracao>1</indApuracao>%'
    and not exists (select 1 from public.esocial_eventos r where r.empresa_id = v.empresa_id and r.situacao = 'baixado'
      and ((r.tipo = 'S-3000' and r.resumo->>'nrRecEvt' = v.nr_recibo)
        or (r.tipo = 'S-1200' and r.resumo->>'indRetif' = '2' and r.resumo->>'nrRecibo' = v.nr_recibo)))
), itens as (
  select v.empresa_id, v.cpf_trab as cpf, v.per_apur,
    sum(nullif(substring(p from '<vrRubr>([^<]*)'), '')::numeric) as vr,
    sum(coalesce(nullif(substring(p from '<qtdRubr>([^<]*)'), '')::numeric, 30)) as dias
  from validos v, regexp_split_to_table(v.xml_evento, '</itensRemun>') as p
  where p like '%<codRubr>8781</codRubr>%'
  group by 1, 2, 3
), meses as (
  -- proporcional levado a 30 dias; centavos de arredondamento (1.620,99) voltam para o real inteiro
  select i.*, case when i.dias between 1 and 29 then
      case when abs(i.vr * 30 / i.dias - round(i.vr * 30 / i.dias)) <= 0.10 then round(i.vr * 30 / i.dias) else round(i.vr * 30 / i.dias, 2) end
    else i.vr end as mensal,
    row_number() over (partition by i.empresa_id, i.cpf order by i.per_apur desc) as n
  from itens i where i.vr > 0
)
select m.empresa_id, m.cpf, m.per_apur, m.dias,
  case when m.dias >= 30 then m.vr
       when c.vr is not null and abs(c.vr - m.mensal) <= c.vr * 0.01 then c.vr
       else m.mensal end as salario,
  m.dias < 30 and not (c.vr is not null and abs(c.vr - m.mensal) <= c.vr * 0.01) as proporcional
from meses m
left join lateral (select f.vr from meses f where f.empresa_id = m.empresa_id and f.cpf = m.cpf and f.dias >= 30
                   order by f.per_apur desc limit 1) c on true
where m.n = 1;
grant select on public.rh_salario_folha to authenticated;
