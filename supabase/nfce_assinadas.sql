-- =====================================================================
-- NFC-e: quem fechou e quem assinou (22/11/2026, pedido do dono: "detalhamento dessas assinadas, em nome de quem fechou")
-- Aplica depois de nfce.sql.
--  - A TOTVS manda todas as assinadas no mesmo cliente genérico ("HOSPEDE", código 9): o nome de quem assinou não vem.
--    Mas cada assinada entra no PMS (no mesmo dia ou no seguinte) como lançamento "RESTAURANTE" na conta do quarto, com o
--    mesmo valor: nfce_assinadas_ligar casa uma a uma (valor igual, PMS do dia da venda até 2 dias depois, o mais cedo
--    primeiro) e grava em nfce_notas o quarto, a reserva, o tipo de conta (Guest/Company) e o hóspede (pms_estadias.hospede).
--    Roda no fim de cada nfce_gravar e a cada 30 min (pg_cron nfce-assinadas), porque o PMS lê os lançamentos depois.
--    Só para casas que são hotel (pms_hoteis.totvs_unidade; hoje o Filha da Lua).
--  - De toda venda: operador do caixa (Caixa.Operador.Nome = quem fechou a conta), garçons (AtendenteVenda dos itens) e o
--    cliente da TOTVS (código e nome; sem documento nem contato).
--  - Os dias lidos antes disso (nfce_dias.versao = 1) são relidos pelo histórico (versao 2 = com operador e garçons).
-- Os nomes são dados pessoais: nfce_notas só abre para os sócios (notas_pode_ver).
-- =====================================================================
alter table public.nfce_notas
  add column if not exists operador text,
  add column if not exists atendentes text[] not null default '{}',
  add column if not exists cliente_codigo int,
  add column if not exists cliente_nome text,
  add column if not exists quarto text,
  add column if not exists reserva text,
  add column if not exists hospede text,
  add column if not exists conta_tipo text,
  add column if not exists pms_dia date,
  add column if not exists pms_chave text,
  add column if not exists ligada_em timestamptz;
create unique index if not exists nfce_notas_pms_chave on public.nfce_notas (pms_chave) where pms_chave is not null;
alter table public.nfce_dias add column if not exists versao int not null default 1;

-- Liga cada assinada ao lançamento "RESTAURANTE" de mesmo valor na conta do quarto no PMS (um a um)
create or replace function public.nfce_assinadas_ligar(p_unidade text default null)
returns int language plpgsql security definer set search_path = public as $$
declare a record; t record; n int := 0;
begin
  for a in
    select n.unidade_id, n.chave_venda, n.dia, n.valor, h.id hotel_id
    from public.nfce_notas n join public.pms_hoteis h on h.totvs_unidade = n.unidade_id
    where (p_unidade is null or n.unidade_id = p_unidade) and n.pms_chave is null and n.situacao = 'sem_nota'
      and n.valor > 0 and n.dia >= current_date - 400
      and exists (select 1 from jsonb_array_elements(n.pagamentos) p where p->>'descricao' ilike '%assinad%')
    order by n.dia, n.emissao, n.chave_venda
  loop
    select x.chave, x.dia, x.uh, x.reserva, x.conta_tipo into t
    from public.pms_transacoes x
    where x.hotel_id = a.hotel_id and x.descricao = 'RESTAURANTE' and not coalesce(x.estornado, false)
      and abs(-x.valor - a.valor) < 0.005 and x.dia between a.dia and a.dia + 2
      and not exists (select 1 from public.nfce_notas u where u.pms_chave = x.chave)
    order by x.dia, x.chave limit 1;
    continue when t.chave is null;
    update public.nfce_notas set pms_chave = t.chave, pms_dia = t.dia, quarto = t.uh, reserva = t.reserva, conta_tipo = t.conta_tipo,
      hospede = (select e.hospede from public.pms_estadias e where e.hotel_id = a.hotel_id and e.codigo = t.reserva order by e.visto_em desc nulls last limit 1),
      ligada_em = now()
    where unidade_id = a.unidade_id and chave_venda = a.chave_venda;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.nfce_assinadas_ligar(text) from public, anon, authenticated;

select cron.unschedule('nfce-assinadas') where exists (select 1 from cron.job where jobname = 'nfce-assinadas');
select cron.schedule('nfce-assinadas', '*/30 * * * *', $job$ select public.nfce_assinadas_ligar(null) $job$);

-- nfce_gravar: igual ao de nfce.sql, mais operador, atendentes, cliente_codigo e cliente_nome (no insert e no update),
-- nfce_dias.versao = 2 e, no fim, perform public.nfce_assinadas_ligar(p_unidade). (Versão aplicada no banco em 22/11/2026.)
-- nfce_historico_passo: escolhe também os dias com nfce_dias.versao < 2 (depois dos dias nunca lidos):
--   ... and not exists (select 1 from public.nfce_dias f where f.unidade_id = u.id and f.dia = d.dia and f.versao >= 2) ...
--   order by (exists (select 1 from public.nfce_dias f where f.unidade_id = u.id and f.dia = d.dia)), d.dia desc
-- nfce_leitura: dias_lidos e dias_faltam contam só versao >= 2.
