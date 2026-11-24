-- RH: inativo no relógio mas recebendo salário = trabalha sem bater ponto, não "saiu do ponto" (23/11/2026).
-- Pedido do dono ("Fiama e Elvis não aparecem na lista de pessoas"; "por mais que não batam ponto, estão ativos").
-- Os 12 que a página mostrava em "Saíram do ponto" (contador, motoristas, subchefes, supervisores da LAIF) estavam
-- inativos no RHiD mas todos com a folha de outubro/2026 (S-1200). A regra antiga marcava ponto_situacao = 'inativo'
-- → situação "Saiu do ponto" → fora da lista "Na equipe" (e o eSocial ainda gastava acesso relendo-os a cada 7 dias).
-- Agora: inativo no RHiD + folha (S-1200 mensal) nos últimos 2 meses de competência + sem desligamento (S-2299/S-2399)
-- = 'sem_ponto' (como quem está na escala sem bater ponto). Só quem parou de receber continua 'inativo'.
create or replace function public.rhid_sincronizar_rh()
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_novos int; v_marcados int; v_completados int; v_hoje date := (now() at time zone 'America/Fortaleza')::date;
  v_folha_desde text := to_char(((now() at time zone 'America/Fortaleza')::date - interval '2 months'), 'YYYY-MM');
begin
  create temp table _ponto on commit drop as
  select distinct on (left(e.cnpj, 8), p.cpf)
    left(e.cnpj, 8) raiz, p.cpf, p.nome, p.matricula, p.admissao, p.situacao,
    (p.departamento_id is not null or p.cargo_id is not null) pessoa_real,
    case when cc.nome ~* 'cicchetti' then 'CICCHETTI' when cc.nome ~* 'filha da lua' then 'FDL' when cc.nome ~* 'sempre vivo' then 'SV'
         when d.nome ~* '\(CC\)' then 'CICCHETTI' when d.nome ~* '\(FDL\)' then 'FDL' when d.nome ~* '\(SV\)' then 'SV'
         when left(e.cnpj, 8) = '36528542' then 'Genesis' else coalesce(d.nome, '') end depto,
    coalesce(cg.nome, '') cargo,
    (select max(x.dia) from public.rhid_dias x where x.cliente_id = p.cliente_id and x.pessoa_id = p.id
       and jsonb_array_length(x.batidas) > 0) ultima,
    exists (select 1 from public.rhid_justificativas j
            left join public.rhid_justificativa_tipos jt on jt.cliente_id = j.cliente_id and jt.id = j.tipo_id
            where j.cliente_id = p.cliente_id and j.pessoa_id = p.id and coalesce(j.aprovacao, 2) = 2
              and (j.inicio at time zone 'America/Fortaleza')::date <= v_hoje and (j.fim at time zone 'America/Fortaleza')::date >= v_hoje
              and public.rhid_tipo_afasta(coalesce(jt.nome, j.texto))) afastado
  from public.rhid_pessoas p
  join public.rhid_empresas e on e.cliente_id = p.cliente_id and e.id = p.empresa_id
  left join public.rhid_departamentos d on d.cliente_id = p.cliente_id and d.id = p.departamento_id
  left join public.rhid_centros_custo cc on cc.cliente_id = p.cliente_id and cc.id = p.centro_custo_id
  left join public.rhid_cargos cg on cg.cliente_id = p.cliente_id and cg.id = p.cargo_id
  where p.presente and length(p.cpf) = 11 and length(e.cnpj) = 14
  order by left(e.cnpj, 8), p.cpf, p.situacao desc nulls last, p.admissao desc nulls last;

  insert into public.esocial_trabalhadores (empresa_id, cpf, nome, matricula, admissao, unidade, cargo, origem)
  select x.raiz, x.cpf, x.nome, x.matricula, x.admissao, x.depto, x.cargo, 'ponto'
  from _ponto x
  where x.situacao = 1 and x.pessoa_real and exists (select 1 from public.esocial_empresas e where e.id = x.raiz)
  on conflict do nothing;
  get diagnostics v_novos = row_count;

  update public.esocial_trabalhadores t set
    cargo = case when coalesce(t.cargo, '') = '' then x.cargo else t.cargo end,
    unidade = case when coalesce(t.unidade, '') = '' then x.depto else t.unidade end,
    admissao = coalesce(t.admissao, x.admissao)
  from _ponto x
  where x.raiz = t.empresa_id and x.cpf = t.cpf
    and ((coalesce(t.cargo, '') = '' and x.cargo <> '') or (coalesce(t.unidade, '') = '' and x.depto <> '') or (t.admissao is null and x.admissao is not null));
  get diagnostics v_completados = row_count;

  update public.esocial_trabalhadores t set
    ponto_situacao = case
      when x.cpf is null then 'sem_ponto'
      when x.situacao is distinct from 1 and exists (select 1 from public.escala_extras e
        where e.empresa_id = t2.empresa_id and e.cpf = t2.cpf and e.situacao = 'na_escala') then 'sem_ponto'
      -- inativo no relógio, mas recebeu na folha recente e não foi desligado: trabalha sem bater ponto
      when x.situacao is distinct from 1
        and exists (select 1 from public.esocial_eventos v where v.empresa_id = t2.empresa_id and v.cpf_trab = t2.cpf
          and v.tipo = 'S-1200' and v.situacao = 'baixado' and v.per_apur ~ '^\d{4}-\d{2}$' and v.per_apur >= v_folha_desde)
        and not exists (select 1 from public.esocial_eventos v where v.empresa_id = t2.empresa_id and v.cpf_trab = t2.cpf
          and v.tipo in ('S-2299', 'S-2399')) then 'sem_ponto'
      when x.situacao is distinct from 1 then 'inativo'
      when x.afastado then 'afastado'
      when x.ultima >= v_hoje - 3 then 'batendo'
      when x.ultima is null or x.ultima < v_hoje - 7 then 'parou'
      else 'batendo' end,
    ponto_ultima_batida = x.ultima,
    ponto_atualizado_em = now()
  from public.esocial_trabalhadores t2
  left join _ponto x on x.raiz = t2.empresa_id and x.cpf = t2.cpf
  where t.empresa_id = t2.empresa_id and t.cpf = t2.cpf;
  get diagnostics v_marcados = row_count;
  return jsonb_build_object('novos', v_novos, 'completados', v_completados, 'marcados', v_marcados);
end $function$;
