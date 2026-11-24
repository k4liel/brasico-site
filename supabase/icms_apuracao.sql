-- =====================================================================
-- Apuração do ICMS feita pelo Brasico (22/11/2026, pedido do dono: "faz a apuração")
-- Mesma ideia do agente que lê o SPED Fiscal, mas a partir dos documentos que o Brasico já puxa sozinho:
--   débitos  = ICMS das NFC-e autorizadas (nfce_notas, itens do caixa TOTVS), por alíquota;
--   créditos = ICMS destacado nas NF-e de compra (notas_itens_fiscal), separando o que dá crédito do que não dá;
--   CT-e     = ICMS do frete quando a empresa é a tomadora;
--   fora do RN = DIFAL (uso e consumo, ativo) e possível antecipação (insumos), a confirmar.
-- É uma estimativa para conferir o contador, não substitui a apuração oficial (EFD ICMS/IPI).
-- As premissas que dependem da contabilidade ficam em icms_regras (valor nulo = "a definir").
-- Limite conhecido: a TOTVS só entrega as vendas dos últimos ~16 dias (supabase/totvs_janela_16_dias.sql);
-- dia com venda sem NFC-e lida aparece na cobertura, com o ICMS estimado pela média dos dias lidos.
-- =====================================================================

create table if not exists public.icms_regras (
  chave text primary key,
  nome text not null,
  valor text,
  padrao text not null,
  decisao text,
  definido_por text,
  definido_em date
);
alter table public.icms_regras enable row level security;
drop policy if exists "ver" on public.icms_regras;
create policy "ver" on public.icms_regras for select using (public.notas_pode_ver(auth.uid()));
revoke all on public.icms_regras from public, anon, authenticated;
grant select on public.icms_regras to authenticated;

insert into public.icms_regras (chave, nome, padrao, decisao) values
  ('aliquota_interna', 'Alíquota interna do RN usada no DIFAL (%)', '20', 'Enquanto não definida, usa 20%, a alíquota que os fornecedores do RN destacam nas notas.'),
  ('credito_insumos', 'Restaurante toma crédito do ICMS dos insumos (comida e bebida)?', 'sim', 'Enquanto não definida, a conta considera que sim (regime normal de débito e crédito).'),
  ('regime_restaurante', 'A empresa usa algum regime especial de bares e restaurantes no RN?', 'não', 'Se usar, a conta de débito e crédito muda: confirmar com a contabilidade.'),
  ('antecipacao_insumos', 'O RN cobra antecipação do ICMS nas compras de insumos de outro estado?', 'a confirmar', 'A conta mostra o valor possível à parte, sem somar no total a recolher.'),
  ('credito_ativo', 'Crédito do ativo imobilizado (CIAP, 1/48 por mês)', 'sim', 'Máquinas e equipamentos dão crédito em 48 meses; a conta mostra 1/48 do ICMS no mês da compra.')
on conflict (chave) do nothing;

create or replace function public.icms_apuracao(p_mes text)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  v_ini date := (p_mes || '-01')::date;
  v_fim date := ((p_mes || '-01')::date + interval '1 month')::date;
  v_interna numeric;
  r jsonb;
begin
  if not public.notas_pode_ver(auth.uid()) then raise exception 'sem acesso'; end if;
  select coalesce(nullif(valor, ''), padrao)::numeric into v_interna from public.icms_regras where chave = 'aliquota_interna';

  with
  -- Casa do caixa TOTVS → CNPJ que emite as NFC-e (pela chave das notas)
  casa as (
    select distinct on (unidade_id) unidade_id, substr(chave, 7, 14) cnpj
    from public.nfce_notas where chave ~ '^\d{44}$'
    group by unidade_id, substr(chave, 7, 14) order by unidade_id, count(*) desc
  ),
  vitens as (
    select substr(n.chave, 7, 14) cnpj, n.unidade_id, n.dia, i
    from public.nfce_notas n, jsonb_array_elements(n.itens) i
    where n.situacao = 'autorizada' and n.dia >= v_ini and n.dia < v_fim and n.chave ~ '^\d{44}$'
      and not coalesce((i->>'cancelado')::boolean, false)
  ),
  debitos as (
    select cnpj,
      case when (i->>'cst') in ('060', '60', '500') then 'st'
           when coalesce((i->'icms'->>'valor')::numeric, 0) = 0 then 'sem_icms'
           else 'tributado' end tipo,
      coalesce((i->'icms'->>'aliquota')::numeric, 0) aliquota,
      (upper(i->>'nome') like 'TX SERV%' or upper(i->>'nome') like 'TAXA DE SERV%') taxa,
      count(*) itens, sum((i->>'valor_total')::numeric) valor,
      sum(coalesce((i->'icms'->>'base')::numeric, 0)) base, sum(coalesce((i->'icms'->>'valor')::numeric, 0)) icms
    from vitens group by 1, 2, 3, 4
  ),
  -- Cobertura: dias com venda no caixa × dias com NFC-e lidas, por CNPJ
  cobertura as (
    select c.cnpj, count(*) filter (where t.vendas > 0) dias_venda,
      count(*) filter (where t.vendas > 0 and exists (select 1 from public.nfce_dias f where f.unidade_id = t.unidade_id and f.dia = t.dia)) dias_lidos,
      sum(t.total) filter (where t.vendas > 0) total_caixa,
      sum(t.total) filter (where t.vendas > 0 and not exists (select 1 from public.nfce_dias f where f.unidade_id = t.unidade_id and f.dia = t.dia)) total_sem_nota,
      min(t.dia) filter (where t.vendas > 0 and not exists (select 1 from public.nfce_dias f where f.unidade_id = t.unidade_id and f.dia = t.dia)) falta_de,
      max(t.dia) filter (where t.vendas > 0 and not exists (select 1 from public.nfce_dias f where f.unidade_id = t.unidade_id and f.dia = t.dia)) falta_ate
    from casa c join public.totvs_dias t on t.unidade_id = c.unidade_id
    where t.dia >= v_ini and t.dia < v_fim and t.dia < (now() at time zone 'America/Fortaleza')::date
    group by c.cnpj
  ),
  vendido_lido as (
    select substr(n.chave, 7, 14) cnpj, sum(n.valor) valor, sum(n.icms) icms
    from public.nfce_notas n where n.situacao = 'autorizada' and n.dia >= v_ini and n.dia < v_fim and n.chave ~ '^\d{44}$' group by 1
  ),
  -- Compras: cada item com a sua classificação de crédito
  citens as (
    select n.empresa_cnpj cnpj, n.chave, n.emitente_nome fornecedor, n.emissao, f.emit_uf, f.emit_crt,
      fi.n_item, fi.ncm, fi.cfop, fi.cst_icms, fi.csosn, fi.p_icms, coalesce(fi.v_prod, 0) - coalesce(fi.v_desc, 0) v_prod,
      coalesce(fi.v_icms, 0) v_icms, coalesce(fi.v_ipi, 0) v_ipi, ni.descricao,
      case
        when fi.cfop in ('5922', '6922') then 'faturamento'
        when fi.cst_icms in ('10', '30', '60', '70') or fi.csosn in ('201', '202', '203', '500') then 'st'
        when fi.csosn = '101' then 'simples_credito'
        when coalesce(fi.v_icms, 0) = 0 then 'sem_icms'
        when left(fi.ncm, 2) between '01' and '24' then 'insumo'
        when left(fi.ncm, 2) in ('84', '85', '90', '94') and coalesce(fi.v_prod, 0) >= 1200 then 'ativo'
        else 'uso_consumo'
      end tipo
    from public.notas n join public.notas_fiscal f using (chave)
    join public.notas_itens_fiscal fi on fi.chave = n.chave
    left join public.notas_itens ni on ni.chave = fi.chave and ni.n_item = fi.n_item
    where n.situacao = 'autorizada' and n.origem = 'sefaz'
      and (n.emissao at time zone 'America/Fortaleza')::date >= v_ini and (n.emissao at time zone 'America/Fortaleza')::date < v_fim
  ),
  creditos as (
    select cnpj, tipo, count(*) itens, count(distinct chave) notas, sum(v_prod) valor, sum(v_icms) icms
    from citens group by 1, 2
  ),
  -- Fora do RN: DIFAL de uso e consumo e ativo; antecipação possível dos insumos
  fora as (
    select cnpj, chave, fornecedor, emissao, emit_uf, tipo, string_agg(distinct cfop, ', ') cfops, count(*) itens,
      sum(v_prod + v_ipi) valor, sum(v_icms) icms, min(p_icms) aliq_min, max(p_icms) aliq_max,
      round(sum(case when p_icms is not null and p_icms < v_interna then (v_prod + v_ipi) * (v_interna - p_icms) / 100 else 0 end), 2) diferenca,
      min(descricao) exemplo
    from citens where emit_uf is not null and emit_uf <> 'RN' and tipo not in ('faturamento')
    group by 1, 2, 3, 4, 5, 6
  ),
  cte as (
    select empresa_cnpj cnpj, count(*) ctes, sum(valor_prestacao) valor, sum(coalesce(icms, 0)) icms
    from public.cte_notas where 'tomador' = any(papeis) and situacao = 'autorizada' and emissao >= v_ini and emissao < v_fim group by 1
  ),
  empresas as (
    select cnpj from debitos union select cnpj from creditos union select cnpj from cobertura
  ),
  por_empresa as (
    select e.cnpj, coalesce(fe.apelido, fe.fantasia, fe.razao, e.cnpj) nome, fe.simples, fe.regime,
      coalesce((select sum(icms) from debitos d where d.cnpj = e.cnpj), 0) debito,
      coalesce((select sum(icms) from debitos d where d.cnpj = e.cnpj and d.taxa), 0) debito_taxa,
      coalesce((select sum(icms) from creditos c where c.cnpj = e.cnpj and c.tipo = 'insumo'), 0) credito_insumos,
      coalesce((select sum(icms) from creditos c where c.cnpj = e.cnpj and c.tipo = 'ativo'), 0) icms_ativo,
      coalesce((select sum(icms) from cte t where t.cnpj = e.cnpj), 0) credito_cte,
      round(coalesce((select sum(diferenca) from fora f where f.cnpj = e.cnpj and f.tipo in ('uso_consumo', 'ativo', 'sem_icms')), 0), 2) difal,
      round(coalesce((select sum(diferenca) from fora f where f.cnpj = e.cnpj and f.tipo = 'insumo'), 0), 2) antecipacao,
      (select to_jsonb(c) - 'cnpj' from cobertura c where c.cnpj = e.cnpj) cobertura,
      (select to_jsonb(v) - 'cnpj' from vendido_lido v where v.cnpj = e.cnpj) vendido,
      coalesce((select jsonb_agg(to_jsonb(d) - 'cnpj' order by d.icms desc) from debitos d where d.cnpj = e.cnpj), '[]') debitos,
      coalesce((select jsonb_agg(to_jsonb(c) - 'cnpj' order by c.icms desc) from creditos c where c.cnpj = e.cnpj), '[]') creditos,
      coalesce((select jsonb_agg(to_jsonb(f) - 'cnpj' order by f.valor desc) from fora f where f.cnpj = e.cnpj), '[]') fora,
      (select to_jsonb(t) - 'cnpj' from cte t where t.cnpj = e.cnpj) cte
    from empresas e left join public.fiscal_empresas fe on fe.cnpj = e.cnpj
    where coalesce(fe.simples, false) = false and fe.desligada_em is null
      and (exists (select 1 from debitos d where d.cnpj = e.cnpj) or exists (select 1 from cobertura c where c.cnpj = e.cnpj))
  )
  select jsonb_build_object(
    'mes', p_mes, 'aliquota_interna', v_interna,
    'regras', coalesce((select jsonb_agg(to_jsonb(x) order by x.chave) from public.icms_regras x), '[]'),
    'empresas', coalesce((select jsonb_agg(
        to_jsonb(p) || jsonb_build_object(
          -- ICMS dos dias com venda e sem NFC-e lida, pela proporção ICMS ÷ total do caixa dos dias lidos
          'debito_estimado_faltante', case when coalesce((p.cobertura->>'total_caixa')::numeric, 0) - coalesce((p.cobertura->>'total_sem_nota')::numeric, 0) > 0
            then round(coalesce((p.cobertura->>'total_sem_nota')::numeric, 0) * coalesce((p.vendido->>'icms')::numeric, 0)
              / ((p.cobertura->>'total_caixa')::numeric - coalesce((p.cobertura->>'total_sem_nota')::numeric, 0)), 2) else 0 end,
          'credito_ativo_mes', round(p.icms_ativo / 48, 2),
          -- nome da casa (Cicchetti Pipa, Hotel Filha da Lua) ao lado da empresa
          'casas_nome', (select string_agg(u.nome, ' + ' order by u.ordem) from casa c2 join public.totvs_unidades u on u.id = c2.unidade_id where c2.cnpj = p.cnpj))
        order by p.debito desc) from por_empresa p), '[]')
  ) into r;
  return r;
end $$;
revoke execute on function public.icms_apuracao(text) from public, anon;
grant execute on function public.icms_apuracao(text) to authenticated;
