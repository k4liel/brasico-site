-- =====================================================================
-- NFC-e (nota fiscal de consumidor, modelo 65): as vendas dos restaurantes no caixa TOTVS Chef Web
-- (22/11/2026, pedido do dono: "puxe todas as NFC-e ... e deixe separado").
--  - Não há serviço da SEFAZ para o emitente baixar as próprias NFC-e. Mas a TOTVS, que emite,
--    devolve em cada venda (CapaVenda/ListPorDataMovimento, a mesma chamada das vendas) a chave
--    de 44 dígitos, o protocolo da SEFAZ, o número e a série, e por item NCM, CFOP, CST, ICMS, PIS,
--    Cofins e IBS/CBS (CST e cClassTrib). A Edge Function totvs-extrair grava isso aqui (nfce_gravar)
--    em toda leitura (ao vivo, diária, histórico).
--  - ModeloFiscal 2 = NFC-e; 3 = venda sem nota fiscal (ex.: assinada que vai para a conta do quarto).
--    Tudo fica guardado, para conferir: situacao = autorizada | cancelada | pendente (modelo 2 sem chave:
--    a nota não saiu) | sem_nota (modelo 3) | venda_cancelada (cancelada sem nota).
--  - O XML pela TOTVS (/api/Fiscal/ListNotasFiscaisVenda) dá erro interno (código 20) desde 10/2026;
--    o PDF (DANFE NFC-e) é montado com os dados da venda em /api/nfce/danfce/<unidade>/<venda>.
--  - Histórico: nfce_historico_passo (pg_cron nfce-historico, a cada minuto) relê, só a parte das vendas,
--    cada dia com venda em totvs_dias que ainda não tem leitura de NFC-e (origem 'nfce' em totvs_execucoes:
--    a Edge Function não mexe em totvs_dias nessa leitura).
--  - Nota de empresa desligada do grupo (fiscal_empresas.desligada_em, ex.: V6 do Midway) não entra.
-- Quem vê: notas_pode_ver (os sócios). Página: /notas, aba NFC-e.
-- =====================================================================

create table if not exists public.nfce_notas (
  unidade_id text not null references public.totvs_unidades(id),
  chave_venda text not null,                     -- ChaveVenda da TOTVS (uma por venda)
  dia date not null,                             -- data de movimento
  emissao timestamptz,                           -- DataRecebimento (fechamento da conta)
  chave text,                                    -- chave de acesso da NFC-e (44 dígitos)
  emitente_cnpj text,
  numero bigint,
  serie text,
  modelo int,                                    -- ModeloFiscal da TOTVS: 2 = NFC-e, 3 = sem nota
  status_nfce int,
  situacao text not null check (situacao in ('autorizada', 'cancelada', 'pendente', 'sem_nota', 'venda_cancelada')),
  protocolo text,
  cupom bigint,
  caixa int,
  pessoas int,
  consumidor_identificado boolean not null default false,  -- CPF na nota (o número não é guardado)
  valor numeric,                                 -- total da venda (ValorTotal)
  subtotal numeric,
  servico numeric,                               -- taxa de serviço
  desconto numeric,
  acrescimo numeric,
  taxa_entrega numeric,
  troco numeric,
  base_icms numeric, icms numeric,
  base_pis numeric, pis numeric,
  base_cofins numeric, cofins numeric,
  cbs numeric, ibs numeric,
  itens jsonb not null default '[]',
  pagamentos jsonb not null default '[]',
  cancelamento jsonb,
  created_at timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  primary key (unidade_id, chave_venda)
);
create index if not exists nfce_notas_dia on public.nfce_notas (dia desc, unidade_id);
create index if not exists nfce_notas_emissao on public.nfce_notas (emissao desc);
create index if not exists nfce_notas_chave on public.nfce_notas (chave) where chave is not null;

-- Números de NFC-e inutilizados (pulados) informados pela TOTVS
create table if not exists public.nfce_inutilizadas (
  unidade_id text not null references public.totvs_unidades(id),
  serie text not null,
  numero_ini bigint not null,
  numero_fim bigint not null,
  dia date,
  motivo text,
  protocolo text,
  caixa int,
  quando timestamptz,
  created_at timestamptz not null default now(),
  primary key (unidade_id, serie, numero_ini, numero_fim)
);

-- Cada dia já lido (para o histórico e para conferir o total das notas com o do caixa)
create table if not exists public.nfce_dias (
  unidade_id text not null references public.totvs_unidades(id),
  dia date not null,
  vendas int not null default 0,
  notas int not null default 0,
  lido_em timestamptz not null default now(),
  primary key (unidade_id, dia)
);

do $$ declare t text; begin
  foreach t in array array['nfce_notas', 'nfce_inutilizadas', 'nfce_dias'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "ver" on public.%I', t);
    execute format('create policy "ver" on public.%I for select using (public.notas_pode_ver(auth.uid()))', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop trigger if exists %I on public.%I', t || '_sem_exclusao', t);
    execute format('create trigger %I before delete on public.%I for each row execute function public.bloquear_exclusao()', t || '_sem_exclusao', t);
    execute format('drop trigger if exists %I on public.%I', t || '_sem_truncate', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function public.bloquear_exclusao()', t || '_sem_truncate', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Gravação (só a Edge Function totvs-extrair, com a chave de serviço)
-- p_vendas: [{chave_venda, emissao, chave, emitente_cnpj, numero, serie, modelo, status_nfce, situacao, protocolo,
--   cupom, caixa, pessoas, consumidor_identificado, valor, subtotal, servico, desconto, acrescimo, taxa_entrega, troco,
--   base_icms, icms, base_pis, pis, base_cofins, cofins, cbs, ibs, itens, pagamentos, cancelamento}]
-- p_inutilizadas / p_canceladas: listas NotasInutilizadas e NotasCanceladas da TOTVS (já simplificadas)
-- ---------------------------------------------------------------------
create or replace function public.nfce_gravar(p_unidade text, p_dia date, p_vendas jsonb, p_inutilizadas jsonb, p_canceladas jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; n int := 0; fora int := 0; v_desligadas text[];
begin
  select coalesce(array_agg(cnpj), '{}') into v_desligadas from public.fiscal_empresas where desligada_em is not null;

  for v in select * from jsonb_array_elements(coalesce(p_vendas, '[]')) loop
    if v->>'emitente_cnpj' = any(v_desligadas) then fora := fora + 1; continue; end if;
    insert into public.nfce_notas as t (unidade_id, chave_venda, dia, emissao, chave, emitente_cnpj, numero, serie, modelo,
      status_nfce, situacao, protocolo, cupom, caixa, pessoas, consumidor_identificado, valor, subtotal, servico, desconto,
      acrescimo, taxa_entrega, troco, base_icms, icms, base_pis, pis, base_cofins, cofins, cbs, ibs, itens, pagamentos, cancelamento)
    values (p_unidade, v->>'chave_venda', p_dia, (v->>'emissao')::timestamptz, nullif(v->>'chave', ''), nullif(v->>'emitente_cnpj', ''),
      (v->>'numero')::bigint, v->>'serie', (v->>'modelo')::int, (v->>'status_nfce')::int, v->>'situacao', nullif(v->>'protocolo', ''),
      (v->>'cupom')::bigint, (v->>'caixa')::int, (v->>'pessoas')::int, coalesce((v->>'consumidor_identificado')::boolean, false),
      (v->>'valor')::numeric, (v->>'subtotal')::numeric, (v->>'servico')::numeric, (v->>'desconto')::numeric,
      (v->>'acrescimo')::numeric, (v->>'taxa_entrega')::numeric, (v->>'troco')::numeric,
      (v->>'base_icms')::numeric, (v->>'icms')::numeric, (v->>'base_pis')::numeric, (v->>'pis')::numeric,
      (v->>'base_cofins')::numeric, (v->>'cofins')::numeric, (v->>'cbs')::numeric, (v->>'ibs')::numeric,
      coalesce(v->'itens', '[]'), coalesce(v->'pagamentos', '[]'), v->'cancelamento')
    on conflict (unidade_id, chave_venda) do update set
      dia = excluded.dia, emissao = excluded.emissao, chave = coalesce(excluded.chave, t.chave),
      emitente_cnpj = coalesce(excluded.emitente_cnpj, t.emitente_cnpj), numero = excluded.numero, serie = excluded.serie,
      modelo = excluded.modelo, status_nfce = excluded.status_nfce,
      -- nota cancelada não volta a autorizada
      situacao = case when t.situacao = 'cancelada' and excluded.situacao = 'autorizada' then t.situacao else excluded.situacao end,
      protocolo = coalesce(excluded.protocolo, t.protocolo), cupom = excluded.cupom, caixa = excluded.caixa,
      pessoas = excluded.pessoas, consumidor_identificado = excluded.consumidor_identificado, valor = excluded.valor,
      subtotal = excluded.subtotal, servico = excluded.servico, desconto = excluded.desconto, acrescimo = excluded.acrescimo,
      taxa_entrega = excluded.taxa_entrega, troco = excluded.troco, base_icms = excluded.base_icms, icms = excluded.icms,
      base_pis = excluded.base_pis, pis = excluded.pis, base_cofins = excluded.base_cofins, cofins = excluded.cofins,
      cbs = excluded.cbs, ibs = excluded.ibs, itens = excluded.itens, pagamentos = excluded.pagamentos,
      cancelamento = coalesce(excluded.cancelamento, t.cancelamento), atualizado_em = now()
    where (t.dia, t.emissao, t.chave, t.numero, t.situacao, t.valor, t.itens, t.pagamentos, t.protocolo, t.status_nfce)
      is distinct from (excluded.dia, excluded.emissao, coalesce(excluded.chave, t.chave), excluded.numero, excluded.situacao,
        excluded.valor, excluded.itens, excluded.pagamentos, coalesce(excluded.protocolo, t.protocolo), excluded.status_nfce);
    n := n + 1;
  end loop;

  -- Notas canceladas informadas à parte pela TOTVS
  for v in select * from jsonb_array_elements(coalesce(p_canceladas, '[]')) loop
    continue when coalesce(v->>'chave', '') = '';
    continue when substr(v->>'chave', 7, 14) = any(v_desligadas);
    update public.nfce_notas set situacao = 'cancelada',
      cancelamento = coalesce(cancelamento, '{}') || jsonb_strip_nulls(jsonb_build_object('motivo', v->>'motivo', 'quando', v->>'quando', 'protocolo', v->>'protocolo')),
      atualizado_em = now()
    where chave = v->>'chave' and situacao <> 'cancelada';
    if not found and not exists (select 1 from public.nfce_notas where chave = v->>'chave') then
      insert into public.nfce_notas (unidade_id, chave_venda, dia, emissao, chave, emitente_cnpj, numero, serie, modelo, situacao, valor, caixa, cancelamento)
      values (p_unidade, coalesce(nullif(v->>'chave_venda', ''), 'cancelada-' || (v->>'chave')), p_dia, (v->>'quando')::timestamptz,
        v->>'chave', substr(v->>'chave', 7, 14), (v->>'numero')::bigint, v->>'serie', 2, 'cancelada', (v->>'valor')::numeric, (v->>'caixa')::int,
        jsonb_strip_nulls(jsonb_build_object('motivo', v->>'motivo', 'quando', v->>'quando', 'protocolo', v->>'protocolo')))
      on conflict (unidade_id, chave_venda) do nothing;
    end if;
  end loop;

  for v in select * from jsonb_array_elements(coalesce(p_inutilizadas, '[]')) loop
    insert into public.nfce_inutilizadas (unidade_id, serie, numero_ini, numero_fim, dia, motivo, protocolo, caixa, quando)
    values (p_unidade, coalesce(v->>'serie', ''), (v->>'numero_ini')::bigint, (v->>'numero_fim')::bigint, p_dia,
      v->>'motivo', v->>'protocolo', (v->>'caixa')::int, (v->>'quando')::timestamptz)
    on conflict do nothing;
  end loop;

  insert into public.nfce_dias (unidade_id, dia, vendas, notas, lido_em)
  values (p_unidade, p_dia, jsonb_array_length(coalesce(p_vendas, '[]')),
    (select count(*) from public.nfce_notas where unidade_id = p_unidade and dia = p_dia and chave is not null), now())
  on conflict (unidade_id, dia) do update set vendas = excluded.vendas, notas = excluded.notas, lido_em = now();

  return jsonb_build_object('vendas', n, 'fora_do_grupo', fora);
end $$;
revoke execute on function public.nfce_gravar(text, date, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.nfce_gravar(text, date, jsonb, jsonb, jsonb) to service_role;

-- ---------------------------------------------------------------------
-- Histórico: um dia por unidade por vez, do mais novo para o mais antigo, só dos dias com venda
-- ---------------------------------------------------------------------
alter table public.totvs_execucoes drop constraint if exists totvs_execucoes_origem_check;
alter table public.totvs_execucoes add constraint totvs_execucoes_origem_check
  check (origem = any (array['agenda', 'site', 'claude', 'ao_vivo', 'nfce']));

create table if not exists public.nfce_historico_tentativas (
  unidade_id text not null,
  dia date not null,
  tentativas int not null default 0,
  ultima timestamptz not null default now(),
  primary key (unidade_id, dia)
);
alter table public.nfce_historico_tentativas enable row level security;
revoke all on public.nfce_historico_tentativas from public, anon, authenticated;

create or replace function public.nfce_historico_passo()
returns int language plpgsql security definer set search_path = public as $$
declare u record; v_dia date; n int := 0; v_hoje date := (now() at time zone 'America/Fortaleza')::date;
begin
  -- Das 11h à meia-noite (casas abertas) só nos minutos pares: a leitura ao vivo fica com os ímpares
  if extract(hour from now() at time zone 'America/Fortaleza') >= 11 and extract(minute from now())::int % 2 = 1 then return 0; end if;
  for u in select id from public.totvs_unidades where ativa and loja is not null and encerrada_em is null loop
    -- uma leitura por unidade de cada vez (a ao vivo e a diária têm a vez)
    continue when exists (select 1 from public.totvs_execucoes x where x.unidade_id = u.id
      and x.status in ('na_fila', 'rodando') and x.created_at > now() - interval '3 minutes');
    select d.dia into v_dia from public.totvs_dias d
    where d.unidade_id = u.id and d.vendas > 0 and d.dia < v_hoje
      and not exists (select 1 from public.nfce_dias f where f.unidade_id = u.id and f.dia = d.dia)
      and not exists (select 1 from public.nfce_historico_tentativas h where h.unidade_id = u.id and h.dia = d.dia
                      and (h.tentativas >= 5 or h.ultima > now() - interval '30 minutes'))
    order by d.dia desc limit 1;
    continue when v_dia is null;
    insert into public.nfce_historico_tentativas (unidade_id, dia) values (u.id, v_dia)
    on conflict (unidade_id, dia) do update set tentativas = nfce_historico_tentativas.tentativas + 1, ultima = now();
    begin
      perform public.totvs_pedir(u.id, v_dia, 'nfce', null);
      n := n + 1;
    exception when others then null;
    end;
  end loop;
  return n;
end $$;
revoke execute on function public.nfce_historico_passo() from public, anon, authenticated;

select cron.unschedule('nfce-historico') where exists (select 1 from cron.job where jobname = 'nfce-historico');
select cron.schedule('nfce-historico', '* * * * *', $job$ select public.nfce_historico_passo() $job$);

-- ---------------------------------------------------------------------
-- Totais por mês, unidade e CNPJ emitente (aba NFC-e); canceladas e vendas sem nota ficam fora dos valores das notas
-- ---------------------------------------------------------------------
create or replace view public.nfce_meses with (security_invoker = true) as
select to_char(dia, 'YYYY-MM') mes, unidade_id, emitente_cnpj,
  count(*) filter (where situacao = 'autorizada')::int notas,
  count(*) filter (where situacao = 'cancelada')::int canceladas,
  count(*) filter (where situacao = 'pendente')::int pendentes,
  count(*) filter (where situacao = 'sem_nota')::int sem_nota,
  coalesce(sum(valor) filter (where situacao = 'autorizada'), 0) valor,
  coalesce(sum(valor) filter (where situacao = 'sem_nota'), 0) valor_sem_nota,
  coalesce(sum(valor) filter (where situacao = 'pendente'), 0) valor_pendente,
  coalesce(sum(servico) filter (where situacao = 'autorizada'), 0) servico,
  coalesce(sum(icms) filter (where situacao = 'autorizada'), 0) icms,
  coalesce(sum(pis) filter (where situacao = 'autorizada'), 0) pis,
  coalesce(sum(cofins) filter (where situacao = 'autorizada'), 0) cofins,
  coalesce(sum(cbs) filter (where situacao = 'autorizada'), 0) cbs,
  coalesce(sum(ibs) filter (where situacao = 'autorizada'), 0) ibs
from public.nfce_notas
group by 1, 2, 3;
grant select on public.nfce_meses to authenticated;

-- Andamento da leitura por unidade (bloco da aba Leituras)
create or replace view public.nfce_leitura with (security_invoker = true) as
select u.id unidade_id, u.nome,
  (select max(f.lido_em) from public.nfce_dias f where f.unidade_id = u.id) ultima_leitura,
  (select min(f.dia) from public.nfce_dias f where f.unidade_id = u.id) desde,
  (select count(*) from public.nfce_dias f where f.unidade_id = u.id)::int dias_lidos,
  (select count(*) from public.totvs_dias d where d.unidade_id = u.id and d.vendas > 0
     and not exists (select 1 from public.nfce_dias f where f.unidade_id = u.id and f.dia = d.dia))::int dias_faltam
from public.totvs_unidades u
where u.ativa and u.loja is not null and u.encerrada_em is null;
grant select on public.nfce_leitura to authenticated;

-- ---------------------------------------------------------------------
-- Aba NFC-e revista (22/11/2026, pedido do dono: separar as autorizadas do resto e organizar por dia)
-- ---------------------------------------------------------------------
-- Totais por dia, casa e situação (cabeçalho de cada dia na lista)
create or replace view public.nfce_dia_resumo with (security_invoker = true) as
select dia, unidade_id, situacao, count(*)::int vendas, coalesce(sum(valor), 0) valor
from public.nfce_notas group by 1, 2, 3;
grant select on public.nfce_dia_resumo to authenticated;

-- Formas de pagamento por mês, casa e situação (ex.: as vendas sem nota são quase todas "ASSINADA")
create or replace view public.nfce_formas with (security_invoker = true) as
select to_char(n.dia, 'YYYY-MM') mes, n.unidade_id, n.situacao, coalesce(nullif(p->>'descricao', ''), 'Sem pagamento') forma,
  count(distinct n.chave_venda)::int vendas, coalesce(sum((p->>'valor')::numeric), 0) valor
from public.nfce_notas n
left join lateral jsonb_array_elements(n.pagamentos) p on true
group by 1, 2, 3, 4;
grant select on public.nfce_formas to authenticated;
