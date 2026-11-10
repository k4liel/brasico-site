-- RH: líquido pago (S-1210) e saúde dos dados (10/11/2026, revisão do RH pedida pelo dono)

-- 1) Pagamentos de cada pessoa, tirados do XML do S-1210 já baixado (um por <infoPgto>): data, mês de referência,
--    tipo (mensal, 13º, férias, rescisão) e o líquido pago. Versões corrigidas (retificação) e excluídas (S-3000) saem.
--    security_invoker: vale a mesma regra de quem vê os eventos (esocial_pode_ver).
create or replace view public.rh_pagamentos with (security_invoker = on) as
with validos as (
  select v.* from public.esocial_eventos v
  where v.tipo = 'S-1210' and v.situacao = 'baixado' and v.ambiente = 1 and v.cpf_trab is not null
    and not exists (select 1 from public.esocial_eventos r where r.empresa_id = v.empresa_id and r.situacao = 'baixado'
      and ((r.tipo = 'S-3000' and r.resumo->>'nrRecEvt' = v.nr_recibo)
        or (r.tipo = 'S-1210' and r.resumo->>'indRetif' = '2' and r.resumo->>'nrRecibo' = v.nr_recibo)))
), blocos as (
  select v.empresa_id, v.cpf_trab as cpf, v.per_apur, v.nr_recibo, b[1] as x
  from validos v, regexp_matches(v.xml_evento, '<infoPgto>(.*?)</infoPgto>', 'g') as b
)
select empresa_id, cpf, per_apur, nr_recibo,
  nullif(substring(x from '<dtPgto>([^<]+)</dtPgto>'), '')::date as dt_pgto,
  substring(x from '<perRef>([^<]+)</perRef>') as per_ref,
  case
    when substring(x from '<ideDmDev>([^<]+)</ideDmDev>') ~* 'RESC' then 'rescisão'
    when substring(x from '<ideDmDev>([^<]+)</ideDmDev>') ~* 'FER' then 'férias'
    when length(coalesce(substring(x from '<perRef>([^<]+)</perRef>'), '')) = 4 then '13º salário'
    else 'mensal' end as tipo,
  coalesce(nullif(substring(x from '<vrLiq>([^<]+)</vrLiq>'), '')::numeric, 0) as vr_liq
from blocos;
grant select on public.rh_pagamentos to authenticated;

-- 2) Saúde dos dados do RH: cada fonte com a hora da última leitura boa e o que está na fila.
--    Só para quem vê o RH (esocial_pode_ver). A página mostra no topo; a aba "Dados" mostra o detalhe.
create or replace function public.rh_saude()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.esocial_pode_ver(auth.uid()) then raise exception 'Sem acesso ao RH.' using errcode = '42501'; end if;
  select jsonb_build_object(
    'agora', now(),
    'rhid', jsonb_build_object(
      'ultima_agora', (select max(fim) from public.rhid_execucoes where tipo = 'agora' and status = 'ok'),
      'ultima_apuracao', (select max(fim) from public.rhid_execucoes where tipo = 'batidas' and status = 'ok'),
      'ultimo_cadastro', (select max(fim) from public.rhid_execucoes where tipo = 'cadastros' and status = 'ok'),
      'falhas_24h', (select count(*) from public.rhid_execucoes where created_at > now() - interval '24 hours' and status = 'falha'),
      'ativos', (select count(*) from public.rhid_pessoas where situacao = 1 and demissao is null),
      'com_banco', (select count(distinct (d.cliente_id, d.pessoa_id)) from public.rhid_dias d join public.rhid_pessoas p
        on p.cliente_id = d.cliente_id and p.id = d.pessoa_id where p.situacao = 1 and p.demissao is null
        and d.dia >= current_date - 3 and d.saldo_banco is not null)),
    'esocial', (select coalesce(jsonb_agg(jsonb_build_object(
      'empresa_id', e.id, 'nome', e.nome, 'ligada', e.leitura_automatica, 'limite', e.limite_diario,
      'ultima_resposta', (select max(x.created_at) from public.esocial_execucoes x where x.empresa_id = e.id and x.ambiente = 1
        and x.status in ('ok', 'sem_dados') and x.tipo <> 'teste_conexao'),
      'acessos_hoje', (select contados from public.esocial_acessos_hoje(e.id, 1)),
      'ativos', (select count(*) from public.esocial_trabalhadores t where t.empresa_id = e.id and t.ativo),
      'nunca_lidos', (select count(*) from public.esocial_trabalhadores t where t.empresa_id = e.id and t.ativo and t.consultado_ate is null),
      'fila_admissao', (select count(*) from public.esocial_trabalhadores t where t.empresa_id = e.id and t.ativo
        and not t.admissao_consultada and t.admissao >= '2019-04-01'),
      'a_baixar', (select count(*) from public.esocial_eventos v where v.empresa_id = e.id and v.ambiente = 1 and v.situacao = 'pendente'),
      'baixados', (select count(*) from public.esocial_eventos v where v.empresa_id = e.id and v.ambiente = 1 and v.situacao = 'baixado')
    ) order by e.ordem, e.nome), '[]'::jsonb) from public.esocial_empresas e)
  ) into r;
  return r;
end $$;
revoke execute on function public.rh_saude() from public, anon;
grant execute on function public.rh_saude() to authenticated;
