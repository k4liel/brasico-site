-- =====================================================================
-- Produção (Operação · fase 5)
--  - Plano de produção (ex.: fim de ano 2026) copiado do projeto "Produção Sempre Vivo"
--    (abas 02 · O que produzir e 03 · Cronograma), que continua como está.
--  - producao_metas: cada produto com o total, a unidade e quanto vai para cada casa.
--  - producao_tarefas: o cronograma dia a dia. Quem produz marca feito / parcial / não feito
--    e, se guardou na câmara fria, a quantidade vira uma entrada no estoque (estoque_movimentos,
--    origem 'producao', referencia 'tarefa:<id>').
--  - producao_repor: o que repor na câmara fria pela média de saídas das últimas 4 semanas e o mínimo.
-- Quem vê e marca: quem pode no estoque (estoque_pode). Página: /producao.
-- =====================================================================

create table if not exists public.producao_planos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  inicio date not null,
  fim date not null,
  origem text,                                    -- de onde foi copiado
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.producao_metas (
  id uuid primary key default gen_random_uuid(),
  plano_id uuid not null references public.producao_planos(id),
  ordem int not null default 0,
  categoria text,
  produto text not null,
  total numeric,
  total_texto text,
  unidade text,
  detalhe text,
  destinos jsonb not null default '[]',           -- [{destino, texto}]
  ficha_casa boolean not null default false,
  estoque_item_id uuid references public.estoque_itens(id),
  removido boolean not null default false
);

create table if not exists public.producao_tarefas (
  id bigint generated always as identity primary key,
  plano_id uuid not null references public.producao_planos(id),
  semana text not null,                           -- S1…S6
  semana_titulo text,
  entrega text,                                   -- o que chega na semana
  dia date not null,
  ordem int not null default 0,
  tipo text not null default 'tarefa' check (tipo in ('tarefa', 'rotina', 'feriado')),
  atencao boolean not null default false,
  produto text not null,
  quantidade_texto text,
  detalhe text,
  status text not null default 'a_fazer' check (status in ('a_fazer', 'feito', 'parcial', 'nao_feito')),
  observacao text,
  feito_em timestamptz,
  feito_por uuid references auth.users(id),
  estoque_item_id uuid references public.estoque_itens(id),
  estoque_mov_id bigint references public.estoque_movimentos(id),
  removido boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists producao_tarefas_dia on public.producao_tarefas (plano_id, dia, ordem);

create table if not exists public.producao_tarefas_historico (
  id bigint generated always as identity primary key,
  tarefa_id bigint not null references public.producao_tarefas(id),
  status text, observacao text, quantidade numeric, estoque_item_id uuid,
  feito_por uuid, quando timestamptz not null default now()
);

-- Entrada vinda da produção
alter table public.estoque_movimentos drop constraint if exists estoque_movimentos_origem_check;
alter table public.estoque_movimentos add constraint estoque_movimentos_origem_check check (origem in ('tela', 'grupo', 'projeto', 'producao'));

do $$ declare t text; begin
  foreach t in array array['producao_planos', 'producao_metas', 'producao_tarefas', 'producao_tarefas_historico'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "ver" on public.%I', t);
    execute format('create policy "ver" on public.%I for select using (public.estoque_pode(auth.uid()))', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop trigger if exists %I on public.%I', t || '_sem_exclusao', t);
    execute format('create trigger %I before delete on public.%I for each row execute function public.bloquear_exclusao()', t || '_sem_exclusao', t);
    execute format('drop trigger if exists %I on public.%I', t || '_sem_truncate', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function public.bloquear_exclusao()', t || '_sem_truncate', t);
  end loop;
end $$;
do $$ begin alter publication supabase_realtime add table public.producao_tarefas; exception when duplicate_object then null; end $$;

-- Marcar uma tarefa. Com p_item e p_quantidade > 0, o que foi guardado vira entrada no estoque
-- (refazer a marcação troca a entrada anterior, nunca soma duas vezes).
create or replace function public.producao_tarefa_marcar(p_tarefa bigint, p_status text, p_observacao text, p_item uuid, p_quantidade numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare x public.producao_tarefas; v_mov bigint;
begin
  if not public.estoque_pode(auth.uid()) then raise exception 'Sem acesso à produção' using errcode = '42501'; end if;
  if p_status not in ('a_fazer', 'feito', 'parcial', 'nao_feito') then raise exception 'Situação inválida.'; end if;
  select * into x from public.producao_tarefas where id = p_tarefa and not removido for update;
  if not found then raise exception 'Tarefa não encontrada.'; end if;
  if p_quantidade is not null and p_quantidade < 0 then raise exception 'Quantidade inválida.'; end if;

  if x.estoque_mov_id is not null then
    update public.estoque_movimentos set removido = true where id = x.estoque_mov_id;
  end if;
  v_mov := null;
  if p_item is not null and coalesce(p_quantidade, 0) > 0 and p_status in ('feito', 'parcial') then
    insert into public.estoque_movimentos (item_id, tipo, quantidade, origem, referencia, observacao, registrado_por)
    values (p_item, 'entrada', p_quantidade, 'producao', 'tarefa:' || p_tarefa || ':' || extract(epoch from clock_timestamp())::bigint,
      'Produção ' || to_char(x.dia, 'DD/MM') || ': ' || x.produto, auth.uid())
    returning id into v_mov;
  end if;

  update public.producao_tarefas set status = p_status, observacao = nullif(trim(p_observacao), ''),
    feito_em = case when p_status = 'a_fazer' then null else now() end,
    feito_por = case when p_status = 'a_fazer' then null else auth.uid() end,
    estoque_item_id = case when v_mov is null then null else p_item end, estoque_mov_id = v_mov
  where id = p_tarefa;
  insert into public.producao_tarefas_historico (tarefa_id, status, observacao, quantidade, estoque_item_id, feito_por)
  values (p_tarefa, p_status, nullif(trim(p_observacao), ''), p_quantidade, p_item, auth.uid());
  return jsonb_build_object('status', p_status, 'entrada_no_estoque', v_mov is not null);
end $$;
revoke execute on function public.producao_tarefa_marcar(bigint, text, text, uuid, numeric) from public, anon;
grant execute on function public.producao_tarefa_marcar(bigint, text, text, uuid, numeric) to authenticated;

-- O que repor na câmara fria: média de saídas das últimas 4 semanas (ou o mínimo, o que for maior) − saldo
create or replace view public.producao_repor with (security_invoker = true) as
select s.item_id, s.nome, s.unidade, s.pacote_nome, s.pacote_tamanho, s.saldo, s.minimo, s.ordem,
  round(coalesce(sum(m.quantidade), 0) / 4.0, 2) saida_semanal,
  greatest(coalesce(s.minimo, 0), round(coalesce(sum(m.quantidade), 0) / 4.0, 2)) alvo,
  greatest(0, greatest(coalesce(s.minimo, 0), round(coalesce(sum(m.quantidade), 0) / 4.0, 2)) - s.saldo) repor
from public.estoque_saldo s
left join public.estoque_movimentos m on m.item_id = s.item_id and m.tipo = 'saida' and not m.removido and m.quando > now() - interval '28 days'
group by s.item_id, s.nome, s.unidade, s.pacote_nome, s.pacote_tamanho, s.saldo, s.minimo, s.ordem;
grant select on public.producao_repor to authenticated;

-- Conector: andamento do plano (só leitura)
create or replace function public.mcp_producao(p_token text, p_dia date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record; v_dia date := coalesce(p_dia, (now() at time zone 'America/Fortaleza')::date); v_plano uuid;
begin
  select * into a from public.mcp_auth(p_token);
  if not public.notas_pode_ver(a.o_user) then raise exception 'Sem acesso à produção (só os sócios)' using errcode = '42501'; end if;
  select id into v_plano from public.producao_planos where ativo order by inicio desc limit 1;
  return jsonb_build_object(
    'plano', (select to_jsonb(p) from public.producao_planos p where id = v_plano),
    'dia', v_dia,
    'tarefas_do_dia', (select jsonb_agg(jsonb_build_object('id', id, 'produto', produto, 'quantidade', quantidade_texto, 'detalhe', detalhe,
        'status', status, 'observacao', observacao) order by ordem) from public.producao_tarefas where plano_id = v_plano and dia = v_dia and not removido),
    'andamento_por_semana', (select jsonb_agg(x order by x->>'semana') from (select jsonb_build_object('semana', semana, 'titulo', min(semana_titulo),
        'tarefas', count(*) filter (where tipo = 'tarefa'), 'feitas', count(*) filter (where tipo = 'tarefa' and status = 'feito'),
        'parciais', count(*) filter (where status = 'parcial'), 'nao_feitas', count(*) filter (where status = 'nao_feito'),
        'atrasadas', count(*) filter (where tipo = 'tarefa' and status = 'a_fazer' and dia < v_dia)) x
      from public.producao_tarefas where plano_id = v_plano and not removido group by semana) s),
    'repor_camara', (select jsonb_agg(jsonb_build_object('item', nome, 'saldo', saldo, 'unidade', unidade, 'repor', repor) order by ordem)
      from public.producao_repor where repor > 0));
end $$;
revoke execute on function public.mcp_producao(text, date) from public, authenticated;
grant execute on function public.mcp_producao(text, date) to anon;

-- O plano "Fim de ano 2026" (36 dias, 131 tarefas, 30 produtos) foi copiado uma vez em 28/10/2026
-- das abas 02 e 03 do projeto Produção Sempre Vivo, pelo SQL Editor; todas as tarefas começam "a fazer".
