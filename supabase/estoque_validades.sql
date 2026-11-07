-- =====================================================================
-- Câmara fria: validade por lote (07/11/2026, pedido do dono)
--  - Cada movimento pode ter validade. Uma contagem é um conjunto de linhas
--    do mesmo item com o mesmo "quando" (uma por validade); o total do item é a soma.
--  - estoque_lotes: saldo de cada item por validade = lote da última contagem
--    + entradas daquela validade − saídas daquela validade. Saída sem validade
--    sai do lote que vence primeiro (FEFO).
--  - estoque_saldo continua com as mesmas colunas (Produção usa).
-- =====================================================================

alter table public.estoque_movimentos add column if not exists validade date;

-- Total do item: soma de todas as linhas da última contagem + entradas − saídas depois dela
create or replace view public.estoque_saldo with (security_invoker = true) as
with ultq as (
  select item_id, max(quando) quando from public.estoque_movimentos
  where tipo = 'contagem' and not removido group by item_id
), ult as (
  select m.item_id, sum(m.quantidade) quantidade, q.quando from public.estoque_movimentos m
  join ultq q on q.item_id = m.item_id and q.quando = m.quando
  where m.tipo = 'contagem' and not m.removido group by m.item_id, q.quando
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

-- Saldo por validade (lote). validade null = "sem validade"
create or replace view public.estoque_lotes with (security_invoker = true) as
with ult as (
  select item_id, max(quando) quando from public.estoque_movimentos
  where tipo = 'contagem' and not removido group by item_id
), validos as (
  select m.* from public.estoque_movimentos m
  join public.estoque_itens i on i.id = m.item_id and i.ativo
  left join ult u on u.item_id = m.item_id
  where not m.removido
    and ((m.tipo = 'contagem' and m.quando = u.quando) or (m.tipo <> 'contagem' and (u.quando is null or m.quando > u.quando)))
), base as (
  select item_id, validade,
    sum(case when tipo = 'saida' then -quantidade else quantidade end) qtd,
    max(quando) ultimo
  from validos where not (tipo = 'saida' and validade is null)
  group by item_id, validade
), livres as (
  select item_id, sum(quantidade) s from validos where tipo = 'saida' and validade is null group by item_id
), ord as (
  select b.*, coalesce(l.s, 0) livre,
    sum(greatest(b.qtd, 0)) over (partition by b.item_id order by b.validade nulls last rows unbounded preceding) cum
  from base b left join livres l on l.item_id = b.item_id
)
select item_id, validade,
  case when qtd <= 0 then qtd else greatest(0, least(qtd, cum - livre)) end quantidade,
  ultimo
from ord;
grant select on public.estoque_lotes to authenticated;

-- Entrada ou saída com validade (saída sem validade = sai do que vence primeiro)
create or replace function public.estoque_registrar_lote(p_item uuid, p_tipo text, p_quantidade numeric, p_validade date, p_destino text, p_observacao text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if not public.estoque_pode(auth.uid()) then raise exception 'Sem acesso ao estoque' using errcode = '42501'; end if;
  if p_tipo not in ('entrada', 'saida') then raise exception 'Tipo inválido.'; end if;
  if p_quantidade is null or p_quantidade <= 0 then raise exception 'Informe a quantidade.'; end if;
  if p_tipo = 'entrada' and p_validade is null then raise exception 'Informe a validade da etiqueta.'; end if;
  insert into public.estoque_movimentos (item_id, tipo, quantidade, validade, destino, origem, observacao, registrado_por)
  values (p_item, p_tipo, p_quantidade, p_validade, nullif(p_destino, ''), 'tela', nullif(trim(p_observacao), ''), auth.uid())
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.estoque_registrar_lote(uuid, text, numeric, date, text, text) from public, anon;
grant execute on function public.estoque_registrar_lote(uuid, text, numeric, date, text, text) to authenticated;

-- Contagem de um item, um lote por validade: [{quantidade, validade}]. Lista vazia = item zerado.
create or replace function public.estoque_contar(p_item uuid, p_lotes jsonb, p_observacao text)
returns int language plpgsql security definer set search_path = public as $$
declare l jsonb; v_quando timestamptz := now(); v_n int := 0;
begin
  if not public.estoque_pode(auth.uid()) then raise exception 'Sem acesso ao estoque' using errcode = '42501'; end if;
  for l in select * from jsonb_array_elements(coalesce(p_lotes, '[]')) loop
    if coalesce((l->>'quantidade')::numeric, -1) < 0 then raise exception 'Quantidade inválida num lote.'; end if;
    if (l->>'quantidade')::numeric = 0 then continue; end if;
    insert into public.estoque_movimentos (item_id, tipo, quantidade, validade, origem, observacao, quando, registrado_por)
    values (p_item, 'contagem', (l->>'quantidade')::numeric, nullif(l->>'validade', '')::date, 'tela',
      nullif(trim(coalesce(l->>'observacao', p_observacao, '')), ''), v_quando, auth.uid());
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then
    insert into public.estoque_movimentos (item_id, tipo, quantidade, origem, observacao, quando, registrado_por)
    values (p_item, 'contagem', 0, 'tela', nullif(trim(p_observacao), ''), v_quando, auth.uid());
  end if;
  return v_n;
end $$;
revoke execute on function public.estoque_contar(uuid, jsonb, text) from public, anon;
grant execute on function public.estoque_contar(uuid, jsonb, text) to authenticated;

-- Desfazer: numa contagem, desfaz todos os lotes daquela contagem
create or replace function public.estoque_desfazer(p_mov bigint)
returns void language plpgsql security definer set search_path = public as $$
declare m record;
begin
  if not public.estoque_pode(auth.uid()) then raise exception 'Sem acesso ao estoque' using errcode = '42501'; end if;
  select * into m from public.estoque_movimentos where id = p_mov;
  if m is null then return; end if;
  if not (public.notas_pode_ver(auth.uid()) or m.registrado_por = auth.uid()) then return; end if;
  if m.tipo = 'contagem' then
    update public.estoque_movimentos set removido = true where item_id = m.item_id and tipo = 'contagem' and quando = m.quando;
  else
    update public.estoque_movimentos set removido = true where id = p_mov;
  end if;
end $$;

-- Conector: saldo com os lotes por validade
create or replace function public.mcp_estoque_situacao(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record;
begin
  select * into a from public.mcp_auth(p_token);
  if not public.notas_pode_ver(a.o_user) then raise exception 'Sem acesso ao estoque (só os sócios)' using errcode = '42501'; end if;
  return jsonb_build_object(
    'itens', (select jsonb_agg(jsonb_build_object('id', s.item_id, 'nome', s.nome, 'unidade', s.unidade, 'pacote', s.pacote_nome,
        'pacote_tamanho', s.pacote_tamanho, 'saldo', s.saldo, 'contada_em', s.contada_em, 'minimo', s.minimo,
        'lotes', (select jsonb_agg(jsonb_build_object('validade', l.validade, 'quantidade', l.quantidade) order by l.validade nulls last)
          from public.estoque_lotes l where l.item_id = s.item_id and l.quantidade <> 0),
        'apelidos', (select apelidos from public.estoque_itens where id = s.item_id)) order by s.ordem, s.nome) from public.estoque_saldo s),
    'ultimas_saidas_do_grupo', (select jsonb_agg(jsonb_build_object('item', i.nome, 'quantidade', m.quantidade, 'destino', m.destino, 'quando', m.quando, 'referencia', m.referencia) order by m.quando desc)
      from (select * from public.estoque_movimentos where origem = 'grupo' and not removido order by quando desc limit 30) m join public.estoque_itens i on i.id = m.item_id),
    'como_fazer', 'Por enquanto o dono lança entradas, saídas e contagens no site (/estoque), com a validade de cada lote: use isto só para consultar o saldo. Não registre saídas a partir do grupo PEDIDOS/PRODUÇÃO sem o dono pedir (fica para o futuro).');
end $$;

-- Itens novos no grupo certo e ragu em pacotes de 2 kg (como na etiqueta)
update public.estoque_itens set ordem = 26 where nome = 'Almôndega';
update public.estoque_itens set ordem = 27 where nome = 'Carne de ossobuco';
update public.estoque_itens set pacote_tamanho = 2 where nome = 'Ragu de ossobuco';

-- A contagem de 07/11/2026 (fotos do WhatsApp) foi regravada um lote por validade:
-- as 17 contagens sem validade ficaram removido = true e entraram as linhas por lote.
-- Quando a legenda e a etiqueta divergiam, valeu a data mais cedo.
