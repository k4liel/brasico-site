-- =====================================================================
-- Histórico completo das NFC-e pela data de integração (22/11/2026, pedido do dono: "adiante a pesquisa de todas as
-- nossas NFC-e, coloque em paralelo e vamos ler tudo")
-- A CapaVenda por data de movimento só responde os últimos ~16 dias (supabase/totvs_janela_16_dias.sql). Conferido no
-- mesmo dia: CapaVenda/ListPorDataIntegracaoChefweb (vendas pelo dia em que chegaram à nuvem da TOTVS) responde o
-- histórico (01/10/2026 trouxe 29 vendas com itens e impostos). A Edge Function totvs-nfce-historico lê um dia de
-- integração e grava cada venda no seu dia de movimento (nfce_gravar).
-- Ritmo: a cada minuto, até 6 dias por unidade ao mesmo tempo (cada dia leva 1 a 4 s na TOTVS) (em paralelo), do mais novo para trás, até o primeiro
-- dia com venda da unidade (totvs_dias). Dia que falha é tentado de novo depois de 20 min, no máximo 4 vezes.
-- =====================================================================

alter table public.totvs_execucoes drop constraint if exists totvs_execucoes_origem_check;
alter table public.totvs_execucoes add constraint totvs_execucoes_origem_check
  check (origem in ('site', 'agenda', 'claude', 'historico', 'ao_vivo', 'nfce', 'nfce_int'));

-- Dia lido por partes (várias datas de integração): conta as vendas guardadas do dia, não só as da última leitura
do $$ declare d text; begin
  d := pg_get_functiondef('public.nfce_gravar'::regproc);
  d := replace(d, 'values (p_unidade, p_dia, jsonb_array_length(coalesce(p_vendas, ''[]'')),',
    'values (p_unidade, p_dia, (select count(*) from public.nfce_notas where unidade_id = p_unidade and dia = p_dia),');
  execute d;
end $$;

create or replace function public.nfce_integracao_pedir(p_unidade text, p_dia date)
returns uuid language plpgsql security definer set search_path = public, vault as $$
declare v_id uuid;
begin
  insert into public.totvs_execucoes (unidade_id, dia, origem) values (p_unidade, p_dia, 'nfce_int') returning id into v_id;
  perform net.http_post(
    url := 'https://doajznzouxxqbqkvsclv.supabase.co/functions/v1/totvs-nfce-historico',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-segredo', (select decrypted_secret from vault.decrypted_secrets where name = 'totvs_segredo')),
    body := jsonb_build_object('execucao', v_id),
    timeout_milliseconds := 30000);
  return v_id;
end $$;
revoke execute on function public.nfce_integracao_pedir(text, date) from public, anon, authenticated;

create or replace function public.nfce_integracao_passo()
returns int language plpgsql security definer set search_path = public as $$
declare u record; v_dia date; n int := 0; v_rodando int; v_hoje date := (now() at time zone 'America/Fortaleza')::date;
  v_inicio date; k int;
begin
  -- solta execuções presas (a função vive no máximo 150 s)
  update public.totvs_execucoes set status = 'falha', erro = 'presa: sem resposta da função', fim = now()
  where origem = 'nfce_int' and status in ('na_fila', 'rodando') and created_at < now() - interval '6 minutes';

  for u in select id from public.totvs_unidades where ativa and loja is not null and encerrada_em is null loop
    select min(dia) into v_inicio from public.totvs_dias where unidade_id = u.id and vendas > 0;
    continue when v_inicio is null;
    select count(*) into v_rodando from public.totvs_execucoes
    where unidade_id = u.id and origem = 'nfce_int' and status in ('na_fila', 'rodando');
    for k in 1 .. greatest(0, 6 - v_rodando) loop
      select g.d::date into v_dia
      from generate_series(v_hoje - 1, v_inicio, interval '-1 day') g(d)
      where not exists (select 1 from public.totvs_execucoes x where x.unidade_id = u.id and x.origem = 'nfce_int' and x.dia = g.d::date
                          and (x.status in ('ok', 'sem_movimento', 'na_fila', 'rodando') or x.created_at > now() - interval '20 minutes'))
        and (select count(*) from public.totvs_execucoes x where x.unidade_id = u.id and x.origem = 'nfce_int' and x.dia = g.d::date and x.status = 'falha') < 4
      order by g.d desc limit 1;
      exit when v_dia is null;
      perform public.nfce_integracao_pedir(u.id, v_dia);
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;
revoke execute on function public.nfce_integracao_passo() from public, anon, authenticated;

-- Andamento (para a aba Leituras): dias de integração lidos × a ler, por unidade
create or replace view public.nfce_integracao_andamento with (security_invoker = true) as
select u.id unidade_id, u.nome,
  (select min(dia) from public.totvs_dias t where t.unidade_id = u.id and t.vendas > 0) inicio,
  count(*) filter (where x.status in ('ok', 'sem_movimento')) lidos,
  count(*) filter (where x.status = 'falha') falhas,
  count(*) filter (where x.status in ('na_fila', 'rodando')) rodando,
  min(x.dia) filter (where x.status in ('ok', 'sem_movimento')) lido_ate
from public.totvs_unidades u left join public.totvs_execucoes x on x.unidade_id = u.id and x.origem = 'nfce_int'
where u.ativa and u.loja is not null and u.encerrada_em is null
group by u.id, u.nome;
grant select on public.nfce_integracao_andamento to authenticated;

select cron.schedule('nfce-integracao', '* * * * *', $$select public.nfce_integracao_passo()$$);
