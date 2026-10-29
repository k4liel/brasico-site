-- =====================================================================
-- Estoque da câmara fria (Operação · fase 4)
--  - Sem contagem no dia a dia: o saldo se calcula sozinho.
--    Entrada: quem leva da Produção para a câmara fria registra o que colocou (tela /estoque).
--    Saída: os pedidos das unidades no grupo PEDIDOS/PRODUÇÃO (o Claude lê e registra
--    pelo conector, estoque_registrar; cada mensagem uma vez só, pela referencia).
--    Ajuste: uma contagem de vez em quando substitui o saldo e mostra a diferença.
--  - Quantidades na unidade do item (porção, L, kg, un); pacote_tamanho converte pacotes.
--  - Saldo = última contagem + entradas depois dela − saídas depois dela.
-- Quem vê: sócios e quem tem operacao_pessoas.registra_estoque. Página: /estoque.
-- =====================================================================

alter table public.operacao_pessoas add column if not exists registra_estoque boolean not null default false;

create table if not exists public.estoque_itens (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  unidade text not null check (unidade in ('porção', 'L', 'kg', 'un')),
  pacote_nome text not null default 'pacote',
  pacote_tamanho numeric,                         -- quanto da unidade vem em 1 pacote (ravioli 10 porções, molho 2 L)
  ficha_id uuid references public.fichas(id),
  minimo numeric,                                 -- abaixo disso aparece como "acabando"
  apelidos text[] not null default '{}',          -- como aparece nos pedidos do grupo (raviole, parpadelle…)
  ativo boolean not null default true,
  ordem int not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists estoque_itens_nome on public.estoque_itens (lower(nome));

create table if not exists public.estoque_movimentos (
  id bigint generated always as identity primary key,
  item_id uuid not null references public.estoque_itens(id),
  tipo text not null check (tipo in ('entrada', 'saida', 'contagem')),
  quantidade numeric not null check (quantidade >= 0),  -- contagem: o saldo contado
  destino text,                                   -- saída: cicchetti_centro, sempre_vivo, filha_da_lua…
  origem text not null check (origem in ('tela', 'grupo', 'projeto')),
  referencia text,                                -- saída do grupo: "<quando>|<autor>" da mensagem
  observacao text,
  quando timestamptz not null default now(),
  registrado_por uuid references auth.users(id),
  removido boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists estoque_movimentos_item on public.estoque_movimentos (item_id, quando);
create unique index if not exists estoque_movimentos_ref on public.estoque_movimentos (item_id, referencia) where referencia is not null and not removido;

create or replace function public.estoque_pode(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.notas_pode_ver(p_user) or exists (select 1 from public.operacao_pessoas where user_id = p_user and ativo and registra_estoque)
$$;
revoke execute on function public.estoque_pode(uuid) from public, anon;
grant execute on function public.estoque_pode(uuid) to authenticated;

do $$ declare t text; begin
  foreach t in array array['estoque_itens', 'estoque_movimentos'] loop
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
do $$ begin alter publication supabase_realtime add table public.estoque_movimentos; exception when duplicate_object then null; end $$;

-- Saldo de cada item: última contagem + entradas − saídas depois dela
create or replace view public.estoque_saldo with (security_invoker = true) as
with ult as (
  select distinct on (item_id) item_id, quantidade, quando from public.estoque_movimentos
  where tipo = 'contagem' and not removido order by item_id, quando desc, id desc
)
select i.id item_id, i.nome, i.unidade, i.pacote_nome, i.pacote_tamanho, i.minimo, i.ordem,
  u.quantidade contagem, u.quando contada_em,
  coalesce(sum(m.quantidade) filter (where m.tipo = 'entrada'), 0) entradas,
  coalesce(sum(m.quantidade) filter (where m.tipo = 'saida'), 0) saidas,
  coalesce(u.quantidade, 0) + coalesce(sum(m.quantidade) filter (where m.tipo = 'entrada'), 0)
    - coalesce(sum(m.quantidade) filter (where m.tipo = 'saida'), 0) saldo,
  max(m.quando) ultimo_movimento
from public.estoque_itens i
left join ult u on u.item_id = i.id
left join public.estoque_movimentos m on m.item_id = i.id and not m.removido and m.tipo <> 'contagem'
  and (u.quando is null or m.quando > u.quando)
where i.ativo
group by i.id, u.quantidade, u.quando;
grant select on public.estoque_saldo to authenticated;

-- Registrar pela tela: entrada (o que foi guardado), saída à mão ou contagem
create or replace function public.estoque_registrar_tela(p_item uuid, p_tipo text, p_quantidade numeric, p_destino text, p_observacao text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if not public.estoque_pode(auth.uid()) then raise exception 'Sem acesso ao estoque' using errcode = '42501'; end if;
  if p_tipo not in ('entrada', 'saida', 'contagem') then raise exception 'Tipo inválido.'; end if;
  if p_quantidade is null or p_quantidade < 0 then raise exception 'Informe a quantidade.'; end if;
  if p_tipo <> 'contagem' and p_quantidade = 0 then raise exception 'Informe a quantidade.'; end if;
  insert into public.estoque_movimentos (item_id, tipo, quantidade, destino, origem, observacao, registrado_por)
  values (p_item, p_tipo, p_quantidade, nullif(p_destino, ''), 'tela', nullif(trim(p_observacao), ''), auth.uid())
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.estoque_registrar_tela(uuid, text, numeric, text, text) from public, anon;
grant execute on function public.estoque_registrar_tela(uuid, text, numeric, text, text) to authenticated;

create or replace function public.estoque_desfazer(p_mov bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.estoque_pode(auth.uid()) then raise exception 'Sem acesso ao estoque' using errcode = '42501'; end if;
  update public.estoque_movimentos set removido = true where id = p_mov
    and (public.notas_pode_ver(auth.uid()) or registrado_por = auth.uid());
end $$;
revoke execute on function public.estoque_desfazer(bigint) from public, anon;
grant execute on function public.estoque_desfazer(bigint) to authenticated;

-- ---------------------------------------------------------------------
-- Conector: o Claude lê o grupo PEDIDOS/PRODUÇÃO e registra as saídas
-- ---------------------------------------------------------------------
create or replace function public.mcp_estoque_situacao(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record;
begin
  select * into a from public.mcp_auth(p_token);
  if not public.notas_pode_ver(a.o_user) then raise exception 'Sem acesso ao estoque (só os sócios)' using errcode = '42501'; end if;
  return jsonb_build_object(
    'itens', (select jsonb_agg(jsonb_build_object('id', s.item_id, 'nome', s.nome, 'unidade', s.unidade, 'pacote', s.pacote_nome,
        'pacote_tamanho', s.pacote_tamanho, 'saldo', s.saldo, 'contada_em', s.contada_em, 'minimo', s.minimo,
        'apelidos', (select apelidos from public.estoque_itens where id = s.item_id)) order by s.ordem, s.nome) from public.estoque_saldo s),
    'ultimas_saidas_do_grupo', (select jsonb_agg(jsonb_build_object('item', i.nome, 'quantidade', m.quantidade, 'destino', m.destino, 'quando', m.quando, 'referencia', m.referencia) order by m.quando desc)
      from (select * from public.estoque_movimentos where origem = 'grupo' and not removido order by quando desc limit 30) m join public.estoque_itens i on i.id = m.item_id),
    'como_fazer', 'Leia o grupo PEDIDOS/PRODUÇÃO (whatsapp_mensagens). Cada pedido de uma unidade ("30 porções chorizo", "6 pacotes de raviole") vira uma saída na unidade do item (pacotes × pacote_tamanho). referencia = "<quando>|<autor>" da mensagem: a mesma mensagem nunca entra duas vezes. Item que não existe: avise em vez de inventar.');
end $$;
revoke execute on function public.mcp_estoque_situacao(text) from public, authenticated;
grant execute on function public.mcp_estoque_situacao(text) to anon;

-- p_saidas: [{item_id, quantidade, destino, referencia, quando, observacao}]
create or replace function public.mcp_estoque_registrar(p_token text, p_saidas jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record; s jsonb; v_novas int := 0; v_repetidas int := 0;
begin
  select * into a from public.mcp_auth(p_token);
  if not public.notas_pode_ver(a.o_user) then raise exception 'Sem acesso ao estoque (só os sócios)' using errcode = '42501'; end if;
  for s in select * from jsonb_array_elements(coalesce(p_saidas, '[]')) loop
    if coalesce((s->>'quantidade')::numeric, 0) <= 0 then raise exception 'Saída sem quantidade: %', s; end if;
    if coalesce(s->>'referencia', '') = '' then raise exception 'Saída sem referencia da mensagem: %', s; end if;
    insert into public.estoque_movimentos (item_id, tipo, quantidade, destino, origem, referencia, observacao, quando, registrado_por)
    values ((s->>'item_id')::uuid, 'saida', (s->>'quantidade')::numeric, nullif(s->>'destino', ''), 'grupo', s->>'referencia',
      nullif(s->>'observacao', ''), coalesce((s->>'quando')::timestamptz, now()), a.o_user)
    on conflict do nothing;
    if found then v_novas := v_novas + 1; else v_repetidas := v_repetidas + 1; end if;
  end loop;
  return jsonb_build_object('registradas', v_novas, 'ja_estavam', v_repetidas);
end $$;
revoke execute on function public.mcp_estoque_registrar(text, jsonb) from public, authenticated;
grant execute on function public.mcp_estoque_registrar(text, jsonb) to anon;

-- ---------------------------------------------------------------------
-- Quem registra (migration estoque_quem_registra)
--  - papel 'estoque': alguém da câmara fria que só abre /estoque (registra_estoque sempre ligado)
--  - registra_estoque em quem já pede compras: continua nas Compras e ganha o Estoque
-- ---------------------------------------------------------------------
alter table public.operacao_pessoas drop constraint if exists operacao_pessoas_papel_check;
alter table public.operacao_pessoas add constraint operacao_pessoas_papel_check check (papel in ('solicitante', 'compras', 'estoque'));

create or replace function public.estoque_pode(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.notas_pode_ver(p_user) or exists (select 1 from public.operacao_pessoas
    where user_id = p_user and ativo and (registra_estoque or papel = 'estoque'))
$$;

-- Nota avulsa: só quem pede compras (não quem é só da câmara fria)
create or replace function public.notas_pode_lancar(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.notas_pode_ver(p_user) or exists (select 1 from public.operacao_pessoas
    where user_id = p_user and ativo and papel in ('solicitante', 'compras'))
$$;

create or replace function public.estoque_pessoa_ligar(p_pessoa uuid, p_sim boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.operacao_papel(auth.uid()) <> 'socio' then raise exception 'Só os sócios escolhem quem registra o estoque.' using errcode = '42501'; end if;
  update public.operacao_pessoas set registra_estoque = coalesce(p_sim, false) where id = p_pessoa;
end $$;
revoke execute on function public.estoque_pessoa_ligar(uuid, boolean) from public, anon;
grant execute on function public.estoque_pessoa_ligar(uuid, boolean) to authenticated;

create or replace function public.estoque_pessoa_trg() returns trigger language plpgsql set search_path = public as $$
begin
  if new.papel = 'estoque' then new.registra_estoque := true; end if;
  return new;
end $$;
drop trigger if exists operacao_pessoas_estoque on public.operacao_pessoas;
create trigger operacao_pessoas_estoque before insert or update of papel on public.operacao_pessoas
  for each row execute function public.estoque_pessoa_trg();

-- Itens e primeiro saldo (contagens de 23 e 24/10 do projeto Estoque Câmara Fria, que continua como está)
-- foram cadastrados uma vez pelo SQL Editor; origem 'projeto' em estoque_movimentos.
