-- =====================================================================
-- PMS dos hotéis: relatórios extras do PMS, configuráveis — 08/11/2026 (pedido do dono: "precisamos de mais dados").
-- pms_relatorios_config: quais relatórios (metabaseKey do catálogo pms_relatorios_menu) o robô lê, de que jeito e a
--   cada quanto tempo. modo 'foto' = retrato de hoje (StartDate = EndDate = hoje; um por dia, o último do dia vale);
--   modo 'mensal' = mês a mês (o atual a cada intervalo, o anterior a cada 24 h e o passado até meses_historico).
-- pms_relatorio_dados: o resultado inteiro de cada leitura (colunas e linhas como o PMS devolve), por hotel,
--   relatório e período. Erro de leitura fica em `erro` (tenta de novo depois do intervalo / 24 h no passado).
-- Para trazer outro relatório: uma linha em pms_relatorios_config (o robô pega na rodada seguinte).
-- Pode ter dados pessoais de hóspede (uso interno, LGPD): só os sócios veem. Nada se apaga.
-- =====================================================================

create table if not exists public.pms_relatorios_config (
  chave int primary key,                 -- metabaseKey
  nome text not null,
  area text not null,                    -- contas, governanca, tarifas, reservas, consumo, producao
  modo text not null check (modo in ('foto', 'mensal')),
  intervalo_min int not null default 180 check (intervalo_min >= 20),
  meses_historico int not null default 24 check (meses_historico between 0 and 120),
  descricao text,
  ativo boolean not null default true,
  ordem int not null default 0
);

create table if not exists public.pms_relatorio_dados (
  hotel_id text not null references public.pms_hoteis(id),
  chave int not null,
  ini date not null,
  fim date not null,
  colunas jsonb,                         -- [{nome, tipo}]
  linhas jsonb,                          -- [[...], ...]
  n int,
  erro text,
  lido_em timestamptz not null default now(),
  primary key (hotel_id, chave, ini, fim)
);
create index if not exists pms_relatorio_dados_idx on public.pms_relatorio_dados (hotel_id, chave, lido_em desc);

do $$
declare t text;
begin
  foreach t in array array['pms_relatorios_config', 'pms_relatorio_dados'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "socios veem" on public.%I', t);
    execute format('create policy "socios veem" on public.%I for select using (public.notas_pode_ver(auth.uid()))', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop trigger if exists %I on public.%I', t || '_sem_exclusao', t);
    execute format('create trigger %I before delete on public.%I for each row execute function public.bloquear_exclusao()', t || '_sem_exclusao', t);
  end loop;
end $$;

insert into public.pms_relatorios_config (chave, nome, area, modo, intervalo_min, meses_historico, ordem, descricao) values
  (379,  'Saldo de Contas Abertas',                         'contas',     'foto',   30,  0, 10, 'Contas abertas e o saldo de cada uma agora'),
  (2221, 'Contas em Aberto em dias com saldo',              'contas',     'foto',   60,  0, 11, 'Há quantos dias cada conta está com saldo'),
  (7166, 'Conferência de Adiantamento em Aberto',           'contas',     'foto',   180, 0, 12, 'Adiantamentos ainda não usados'),
  (302,  'Créditos dos Clientes',                           'contas',     'foto',   180, 0, 13, 'Créditos que cada cliente tem com o hotel'),
  (4157, 'Notas Fiscais a Faturar',                         'contas',     'foto',   180, 0, 14, 'Notas fiscais ainda não emitidas'),
  (9514, 'Relatório Analítico - Governança',                'governanca', 'foto',   30,  0, 20, 'Situação de cada UH (limpeza, ocupação)'),
  (4558, 'Performance Housekeeping',                        'governanca', 'mensal', 360, 12, 21, 'Desempenho da governança no mês'),
  (377,  'Orçamento - Log de Alterações de Valores de Diárias', 'tarifas', 'mensal', 120, 12, 30, 'Cada mudança de valor de diária (tarifas)'),
  (1685, 'Análise Orçado x Realizado Período - Dia a Dia',  'tarifas',    'mensal', 360, 12, 31, 'Orçado x realizado por dia'),
  (2491, 'Análise de Ocupação e Receita Prevista e Real',   'tarifas',    'mensal', 360, 12, 32, 'Ocupação e receita previstas x reais'),
  (3879, 'Reservas Canceladas por Período',                 'reservas',   'mensal', 120, 24, 40, 'Reservas canceladas no mês'),
  (2623, 'Evolução de Reservas',                            'reservas',   'mensal', 360, 12, 41, 'Como as reservas evoluíram no mês'),
  (8,    'Pernoites por Cliente, Origem e Segmento',        'reservas',   'mensal', 360, 24, 42, 'Pernoites por cliente, origem e segmento'),
  (304,  'POS Itens por Ponto de Venda e Data',             'consumo',    'mensal', 120, 24, 50, 'Itens vendidos em cada ponto de venda'),
  (212,  'Lançamentos de POS',                              'consumo',    'mensal', 120, 24, 51, 'Lançamentos dos pontos de venda'),
  (128,  'Receita de Hospedagem no Período (Analítico)',    'producao',   'mensal', 360, 24, 60, 'Receita de hospedagem detalhada')
on conflict (chave) do update set nome = excluded.nome, area = excluded.area, modo = excluded.modo, intervalo_min = excluded.intervalo_min,
  meses_historico = excluded.meses_historico, ordem = excluded.ordem, descricao = excluded.descricao;

-- Fila de leituras de um hotel (até p_limite): retratos vencidos, mês atual vencido, mês anterior com mais de 24 h,
-- e o passado que falta (ou que deu erro há mais de 24 h), do mais novo para o mais velho.
create or replace function public.pms_robo_relatorios_fila(p_segredo text, p_hotel text, p_limite int default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_hoje date := (now() at time zone 'America/Fortaleza')::date; v_mes date := date_trunc('month', v_hoje)::date; r jsonb;
begin
  if not public.pms_robo_ok(p_segredo) then raise exception 'sem permissão' using errcode = '42501'; end if;
  with alvo as (
    select c.chave, c.ordem, 1 as prioridade, v_hoje as ini, v_hoje as fim, c.intervalo_min
    from public.pms_relatorios_config c where c.ativo and c.modo = 'foto'
    union all
    select c.chave, c.ordem, case when g.n = 0 then 2 when g.n = 1 then 3 else 4 end, (v_mes - make_interval(months => g.n))::date,
           ((v_mes - make_interval(months => g.n - 1))::date - 1), c.intervalo_min
    from public.pms_relatorios_config c cross join lateral generate_series(0, c.meses_historico) g(n)
    where c.ativo and c.modo = 'mensal'
  ), devidos as (
    select a.*, d.lido_em, d.erro from alvo a
    left join public.pms_relatorio_dados d on d.hotel_id = p_hotel and d.chave = a.chave and d.ini = a.ini and d.fim = a.fim
    where d.lido_em is null
       or (a.prioridade in (1, 2) and d.lido_em < now() - make_interval(mins => a.intervalo_min))
       or (a.prioridade = 3 and d.lido_em < now() - interval '24 hours')
       or (a.prioridade = 4 and d.erro is not null and d.lido_em < now() - interval '24 hours')
  )
  select coalesce(jsonb_agg(jsonb_build_object('chave', chave, 'ini', ini, 'fim', fim) order by prioridade, ini desc, ordem), '[]') into r
  from (select * from devidos order by prioridade, ini desc, ordem limit greatest(1, least(coalesce(p_limite, 30), 100))) x;
  return r;
end $$;
revoke execute on function public.pms_robo_relatorios_fila(text, text, int) from public, authenticated;
grant execute on function public.pms_robo_relatorios_fila(text, text, int) to anon;

create or replace function public.pms_robo_gravar_relatorio(p_segredo text, p_hotel text, p_chave int, p_ini date, p_fim date,
  p_colunas jsonb, p_linhas jsonb, p_erro text default null)
returns int language plpgsql security definer set search_path = public as $$
begin
  if not public.pms_robo_ok(p_segredo) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_erro is not null then
    -- erro não apaga o que já estava lido: só marca a tentativa
    insert into public.pms_relatorio_dados (hotel_id, chave, ini, fim, erro, lido_em) values (p_hotel, p_chave, p_ini, p_fim, left(p_erro, 300), now())
    on conflict (hotel_id, chave, ini, fim) do update set erro = excluded.erro, lido_em = now();
    return 0;
  end if;
  insert into public.pms_relatorio_dados (hotel_id, chave, ini, fim, colunas, linhas, n, erro, lido_em)
  values (p_hotel, p_chave, p_ini, p_fim, p_colunas, p_linhas, coalesce(jsonb_array_length(p_linhas), 0), null, now())
  on conflict (hotel_id, chave, ini, fim) do update set colunas = excluded.colunas, linhas = excluded.linhas, n = excluded.n, erro = null, lido_em = now();
  return coalesce(jsonb_array_length(p_linhas), 0);
end $$;
revoke execute on function public.pms_robo_gravar_relatorio(text, text, int, date, date, jsonb, jsonb, text) from public, authenticated;
grant execute on function public.pms_robo_gravar_relatorio(text, text, int, date, date, jsonb, jsonb, text) to anon;
