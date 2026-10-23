-- TOTVS: conferência pelo que foi pago (22/10/2026)
-- O valor de cada venda passa a ser o ValorTotal da TOTVS (com o ajuste de troco), e não a soma dos itens:
-- descontos grandes nem sempre chegam inteiros aos itens, e isso deixava centenas de dias "para revisar".
-- Agora "revisar" só quando o que foi pago não bate com o que foi vendido. As diferenças internas da TOTVS
-- (taxa de serviço arredondada, desconto fora dos itens, item sem garçom) ficam em "avisos", sem marcar o dia.

alter table public.totvs_dias add column if not exists avisos jsonb not null default '[]';

-- Conector: os avisos vêm junto com o detalhe do dia
create or replace function public.mcp_totvs_vendas(p_token text, p_unidade text default null, p_de date default null,
  p_ate date default null, p_detalhe boolean default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_unidade text; v_de date; v_ate date; v_detalhe boolean;
begin
  perform public.mcp_totvs_auth(p_token);
  if p_unidade is not null then v_unidade := public.totvs_achar_unidade(p_unidade); end if;
  v_ate := coalesce(p_ate, (now() at time zone 'America/Fortaleza')::date - 1);
  v_de := coalesce(p_de, v_ate);
  if v_ate - v_de > 92 then raise exception 'Período longo demais (máximo de 93 dias).'; end if;
  v_detalhe := coalesce(p_detalhe, v_ate - v_de <= 1);
  return jsonb_build_object('de', v_de, 'ate', v_ate, 'dias', coalesce((
    select jsonb_agg(
      jsonb_build_object('unidade', u.nome, 'unidade_id', u.id, 'dia', d.dia, 'status', d.status,
        'vendas', d.vendas, 'pessoas', d.pessoas, 'total', d.total, 'resumo', d.resumo, 'divergencias', d.divergencias,
        'atualizado_em', to_char(d.atualizado_em at time zone 'America/Fortaleza', 'YYYY-MM-DD HH24:MI'))
      || case when v_detalhe then jsonb_build_object('produtos', d.produtos, 'pagamentos', d.pagamentos,
           'garcons', d.garcons, 'sangrias', d.sangrias, 'fechamentos', d.fechamentos, 'cancelados', d.cancelados,
           'avisos', d.avisos)
         else '{}'::jsonb end
      order by d.dia desc, u.ordem)
    from public.totvs_dias d join public.totvs_unidades u on u.id = d.unidade_id
    where d.dia between v_de and v_ate and (v_unidade is null or d.unidade_id = v_unidade)), '[]'::jsonb));
end $$;

-- Recálculo único dos dias já guardados, com a mesma regra da Edge Function totvs-extrair.
-- Cópia de segurança antes: public.totvs_dias_copia_20261022.
create table if not exists public.totvs_dias_copia_20261022 as
  select unidade_id, dia, status, total, resumo, divergencias, vendas_detalhe from public.totvs_dias;
alter table public.totvs_dias_copia_20261022 enable row level security;

with v as (
  select d.unidade_id, d.dia, x.ord, x.e,
    (x.e->>'subtotal')::numeric sub, (x.e->>'descontos')::numeric dsc, (x.e->>'acrescimos')::numeric acr,
    (x.e->>'troco')::numeric troco, (x.e->>'total_totvs')::numeric tt,
    (x.e->>'pagamentos')::numeric + (x.e->>'troco_nos_pagamentos')::numeric pbruto,
    (x.e->>'itens')::numeric itens, (x.e->>'taxa_item')::numeric taxa_item, (x.e->>'servico')::numeric servico
  from public.totvs_dias d, jsonb_array_elements(d.vendas_detalhe) with ordinality x(e, ord)
  where d.status in ('ok', 'revisar')
), a as (
  select *, case when troco > 0 and (abs(sub - dsc + acr - (tt + troco)) <= 0.01 or abs(sub - dsc + acr - (tt - troco)) <= 0.01)
    then sub - dsc + acr else tt end venda
  from v
), b as (
  select *, case when troco > 0 and abs(pbruto - venda - troco) <= 0.01 then troco else 0 end tnp,
    itens + coalesce(nullif(taxa_item, 0), servico) + acr soma_itens
  from a
), c as (
  select *, pbruto - tnp pago from b
), dia as (
  select unidade_id, dia,
    jsonb_agg(e || jsonb_build_object('valor', round(venda, 2), 'pagamentos', round(pago, 2), 'troco_nos_pagamentos', round(tnp, 2)) order by ord) detalhe,
    round(sum(venda), 2) total, round(sum(pago), 2) pagos, round(sum(tnp), 2) tnp,
    jsonb_agg(e->'cupom' order by ord) filter (where abs(venda - pago) > 1) nao_pagas,
    round(sum(venda - pago) filter (where abs(venda - pago) > 1), 2) nao_pagas_valor,
    jsonb_agg(e->'cupom' order by ord) filter (where abs(soma_itens - venda) > 0.01) itens_dif,
    round(sum(soma_itens - venda) filter (where abs(soma_itens - venda) > 0.01), 2) itens_dif_valor
  from c group by 1, 2
), novo as (
  select d.unidade_id, d.dia, n.detalhe, n.total,
    d.resumo || jsonb_build_object('total', n.total, 'pagamentos_total', n.pagos, 'troco_nos_pagamentos', n.tnp,
      'pagamentos_caixa', round((d.resumo->>'pagamentos_caixa')::numeric + (d.resumo->>'troco_nos_pagamentos')::numeric - n.tnp, 2)) resumo,
    (case when abs(n.total - n.pagos) > 1 then jsonb_build_array(jsonb_build_object('conferencia', 'Total das vendas × soma dos pagamentos',
        'a', n.total, 'b', n.pagos, 'diferenca', round(n.total - n.pagos, 2))) else '[]'::jsonb end)
    || (case when n.nao_pagas is not null then jsonb_build_array(jsonb_build_object('conferencia', 'Vendas em que o pago não bate com o total',
        'vendas', n.nao_pagas, 'valor', n.nao_pagas_valor)) else '[]'::jsonb end) divergencias,
    (case when (d.resumo->>'itens_taxa_servico')::numeric <> 0 and (d.resumo->>'servico')::numeric <> 0
          and abs((d.resumo->>'itens_taxa_servico')::numeric - (d.resumo->>'servico')::numeric) > 1
        then jsonb_build_array(jsonb_build_object('aviso', 'Taxa de serviço nos itens × no totalizador da TOTVS',
          'a', (d.resumo->>'itens_taxa_servico')::numeric, 'b', (d.resumo->>'servico')::numeric,
          'diferenca', round((d.resumo->>'itens_taxa_servico')::numeric - (d.resumo->>'servico')::numeric, 2))) else '[]'::jsonb end)
    || (case when n.itens_dif is not null then jsonb_build_array(jsonb_build_object('aviso', 'Vendas com itens diferentes do total da TOTVS (desconto fora dos itens)',
        'vendas', n.itens_dif, 'valor', n.itens_dif_valor)) else '[]'::jsonb end)
    || coalesce((select jsonb_agg(jsonb_build_object('aviso', x->>'conferencia', 'valor', x->'valor'))
        from jsonb_array_elements(d.divergencias) x where x->>'conferencia' = 'Itens sem atendente no ranking'), '[]'::jsonb) avisos
  from public.totvs_dias d join dia n using (unidade_id, dia)
)
update public.totvs_dias t set
  total = novo.total, resumo = novo.resumo, vendas_detalhe = novo.detalhe, divergencias = novo.divergencias, avisos = novo.avisos,
  status = case when jsonb_array_length(novo.divergencias) = 0 then 'ok' else 'revisar' end
from novo where t.unidade_id = novo.unidade_id and t.dia = novo.dia;
-- Os poucos dias em que o troco saiu de outro pagamento são puxados de novo da TOTVS (pela própria Edge Function).

-- 23/10/2026: os 22 dias em que o troco mudou de forma de pagamento foram puxados de novo da TOTVS,
-- um por vez, pela agenda temporária totvs-refazer-troco (a cada 45 s; ela se desliga sozinha no fim).
-- Função usada: public.totvs_refazer_troco() (lista fixa de unidade e dia; chama totvs_pedir com origem 'claude').
