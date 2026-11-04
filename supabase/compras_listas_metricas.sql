-- =====================================================================
-- Compras · várias listas por pessoa, juntar listas e métricas da projeção (03/11/2026)
-- 1. Cada pessoa pode ter várias listas na semana (ex.: "Mercado", "Ceasa", "Comida de funcionário"),
--    cada uma com título. A análise separa como a pessoa separou no grupo. Nada se apaga:
--    lista trocada por análise nova = 'substituida'; lista juntada a outra = 'juntada' (juntada_a).
-- 2. compras_listas_juntar: a pessoa (ou compras/sócio) junta duas listas suas numa só.
-- 3. Métricas de cada item: média de compra por semana nas últimas 4 semanas (notas da SEFAZ da casa),
--    projeção = média × (1 + % da semana), base (de onde veio a conta). % da semana em compras_semanas.aumento_pct.
-- 4. Revisão diária: lista ainda não mexida pela pessoa é refeita uma vez por dia com as notas novas.
-- =====================================================================

-- ---------- 1. Estrutura ----------
alter table public.compras_listas add column if not exists titulo text;
alter table public.compras_listas add column if not exists juntada_a uuid references public.compras_listas(id);
alter table public.compras_listas add column if not exists juntada_em timestamptz;
alter table public.compras_listas add column if not exists substituida_em timestamptz;
alter table public.compras_listas drop constraint if exists compras_listas_semana_id_pessoa_id_key;
alter table public.compras_listas drop constraint if exists compras_listas_status_check;
alter table public.compras_listas add constraint compras_listas_status_check
  check (status in ('aguardando', 'em_revisao', 'aprovada', 'juntada', 'substituida'));
create index if not exists compras_listas_pessoa on public.compras_listas (semana_id, pessoa_id);

alter table public.compras_itens add column if not exists media_4s numeric;     -- compra média por semana, últimas 4 semanas
alter table public.compras_itens add column if not exists projecao numeric;     -- média × (1 + % da semana), na embalagem
alter table public.compras_itens add column if not exists base text;            -- de onde veio a conta (compras, fornecedor)

alter table public.compras_semanas add column if not exists aumento_pct numeric not null default 0;

-- Lista ativa = aparece na tela (as outras ficam guardadas)
create or replace function public.compras_lista_ativa(p_status text)
returns boolean language sql immutable as $$ select p_status in ('aguardando', 'em_revisao', 'aprovada') $$;

-- A pessoa (ou a Fernanda) já mexeu na lista depois da análise, ou já aprovou?
create or replace function public.compras_lista_tocada(p_lista uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.compras_listas l where l.id = p_lista and l.status = 'aprovada')
      or exists (select 1 from public.compras_itens i join public.compras_listas l on l.id = i.lista_id
                 where i.lista_id = p_lista and i.atualizado_por is not null
                   and i.atualizado_em > coalesce(l.analisada_em, '-infinity'))
$$;
revoke execute on function public.compras_lista_tocada(uuid) from public, anon;
grant execute on function public.compras_lista_tocada(uuid) to authenticated, service_role;

-- Só listas ativas podem ser mexidas
create or replace function public.compras_pode_editar(p_lista uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.compras_listas l join public.compras_semanas s on s.id = l.semana_id
    join public.operacao_pessoas p on p.id = l.pessoa_id
    where l.id = p_lista and s.status = 'aberta' and l.status in ('aguardando', 'em_revisao', 'aprovada')
      and (public.operacao_papel(auth.uid()) in ('socio', 'compras') or (p.user_id = auth.uid() and l.status <> 'aprovada')))
$$;
revoke execute on function public.compras_pode_editar(uuid) from public, anon, authenticated;

-- ---------- 2. Juntar e renomear ----------
create or replace function public.compras_listas_juntar(p_destino uuid, p_origem uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare d public.compras_listas; o public.compras_listas; v_ordem int;
begin
  select * into d from public.compras_listas where id = p_destino;
  select * into o from public.compras_listas where id = p_origem;
  if d.id is null or o.id is null or d.id = o.id then raise exception 'Escolha duas listas diferentes.'; end if;
  if d.pessoa_id <> o.pessoa_id or d.semana_id <> o.semana_id then raise exception 'Só dá para juntar listas da mesma pessoa e da mesma semana.'; end if;
  if not public.compras_pode_editar(p_destino) or not public.compras_pode_editar(p_origem) then
    raise exception 'Uma das listas não pode mais ser mudada (aprovada ou semana fechada).' using errcode = '42501';
  end if;
  select coalesce(max(ordem), 0) into v_ordem from public.compras_itens where lista_id = p_destino;
  update public.compras_itens set lista_id = p_destino, ordem = v_ordem + ordem, atualizado_por = auth.uid(), atualizado_em = now()
  where lista_id = p_origem;
  update public.compras_listas set status = 'juntada', juntada_a = p_destino, juntada_em = now() where id = p_origem;
  update public.compras_listas set status = 'em_revisao',
    titulo = concat_ws(' + ', nullif(d.titulo, ''), nullif(o.titulo, '')),
    pedido_texto = concat_ws(E'\n\n', d.pedido_texto, o.pedido_texto),
    aprovada_em = null, aprovada_por = null
  where id = p_destino;
  return p_destino;
end $$;
revoke execute on function public.compras_listas_juntar(uuid, uuid) from public, anon;
grant execute on function public.compras_listas_juntar(uuid, uuid) to authenticated;

create or replace function public.compras_lista_titulo(p_lista uuid, p_titulo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.compras_pode_editar(p_lista) then raise exception 'Esta lista não pode mais ser mudada.' using errcode = '42501'; end if;
  update public.compras_listas set titulo = nullif(trim(p_titulo), '') where id = p_lista;
end $$;
revoke execute on function public.compras_lista_titulo(uuid, text) from public, anon;
grant execute on function public.compras_lista_titulo(uuid, text) to authenticated;

-- % a mais da semana (feriado, evento): compras ou sócio
create or replace function public.compras_semana_aumento(p_semana uuid, p_pct numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.operacao_papel(auth.uid()) not in ('socio', 'compras') then raise exception 'Só o setor de compras muda a porcentagem.' using errcode = '42501'; end if;
  if p_pct is null or p_pct < -50 or p_pct > 200 then raise exception 'Porcentagem fora do normal (entre -50%% e 200%%).'; end if;
  update public.compras_semanas set aumento_pct = p_pct where id = p_semana and status = 'aberta';
end $$;
revoke execute on function public.compras_semana_aumento(uuid, numeric) from public, anon;
grant execute on function public.compras_semana_aumento(uuid, numeric) to authenticated;

-- ---------- 3. Métricas (ferramenta buscar_compras da análise) ----------
-- Casa de cada CNPJ das notas: Brasico77 filial 0002 = Cicchetti Centro; matriz 0001 = Filha da Lua; demais = grupo
create or replace function public.compras_casa_cnpj(p_cnpj text)
returns text language sql immutable as $$
  select case p_cnpj when '24021962000276' then 'cicchetti_centro' when '24021962000195' then 'filha_da_lua' else 'grupo' end
$$;

drop function if exists public.compras_auto_buscar(text);
drop function if exists public.compras_auto_buscar(text, text);
-- Produtos das notas parecidos com o item pedido, em duas camadas:
--  (a) nome parecido: semelhança de trigramas sem acento (aguenta erro de digitação e abreviação de nota,
--      ex.: "queido mutssarela" → "QUEIJO MUSSARELA", "manteiga sem sal" → "MANT S/SAL");
--  (b) cadastro único de insumos: o pedido parece com o nome de um insumo ou com um apelido dele (ficha, nota,
--      grupo), e os nomes de nota desse insumo entram como candidatos (confirmados pesam mais).
-- Cada candidato (descrição + unidade + fornecedor das notas da SEFAZ, 120 dias) vem com a semelhança, por que
-- entrou e as métricas: na casa da pessoa e no grupo todo, compra das últimas 4 semanas, média por semana,
-- número de compras em 4 e 8 semanas, última compra e último preço.
create or replace function public.compras_auto_buscar(p_busca text, p_unidade text default null)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare v_q text := lower(extensions.unaccent(trim(coalesce(p_busca, ''))));
begin
  if length(v_q) < 3 then return '{"candidatos": [], "recentes": []}'::jsonb; end if;
  return jsonb_build_object(
    'candidatos', coalesce((
      with itens as (
        select i.descricao, upper(trim(coalesce(i.unidade, ''))) un, n.emitente_nome forn, n.chave, n.emissao, i.quantidade, i.preco_efetivo,
          public.compras_casa_cnpj(n.empresa_cnpj) casa, lower(extensions.unaccent(i.descricao)) d
        from public.notas_itens i join public.notas n on n.chave = i.chave
        where n.emissao > now() - interval '120 days' and coalesce(n.situacao, '') not ilike '%cancel%' and i.quantidade > 0
      ),
      nomes as (select distinct d from itens),
      por_nome as (
        select d, greatest(extensions.word_similarity(v_q, d), extensions.similarity(v_q, d)) sem from nomes
        where extensions.word_similarity(v_q, d) > 0.35 or extensions.similarity(v_q, d) > 0.25
      ),
      ins as (
        select x.insumo_id, max(x.sem) sem from (
          select id insumo_id, greatest(extensions.word_similarity(v_q, lower(extensions.unaccent(nome))), extensions.similarity(v_q, lower(extensions.unaccent(nome)))) sem
          from public.insumos where ativo
          union all
          select insumo_id, greatest(extensions.word_similarity(v_q, lower(extensions.unaccent(apelido))), extensions.similarity(v_q, lower(extensions.unaccent(apelido))))
          from public.insumos_apelidos) x
        where x.sem >= 0.45 group by x.insumo_id order by max(x.sem) desc limit 5
      ),
      por_insumo as (
        select lower(extensions.unaccent(a.apelido)) d, max(ins.sem * case when a.confirmado then 0.95 else 0.75 end) sem, min(s.nome) insumo
        from ins join public.insumos_apelidos a on a.insumo_id = ins.insumo_id and a.origem = 'nota'
        join public.insumos s on s.id = ins.insumo_id
        group by 1
      ),
      cand as (
        select d, max(sem) sem, max(insumo) insumo, string_agg(distinct via, ' + ') via from (
          select d, sem, null::text insumo, 'nome parecido' via from por_nome
          union all select d, sem, insumo, 'cadastro de insumos' from por_insumo) u
        group by d order by max(sem) desc limit 25
      ),
      metr as (
        select c.d, c.sem, c.insumo, c.via, it.descricao, it.un, it.forn,
          sum(it.quantidade) filter (where it.casa = p_unidade and it.emissao > now() - interval '28 days') casa_4s,
          count(distinct it.chave) filter (where it.casa = p_unidade and it.emissao > now() - interval '28 days') casa_compras_4s,
          sum(it.quantidade) filter (where it.emissao > now() - interval '28 days') grupo_4s,
          count(distinct it.chave) filter (where it.emissao > now() - interval '28 days') grupo_compras_4s,
          count(distinct it.chave) filter (where it.emissao > now() - interval '56 days') compras_8s,
          max(it.emissao)::date ultima,
          (array_agg(it.quantidade order by it.emissao desc))[1] ultima_qtd,
          (array_agg(it.preco_efetivo order by it.emissao desc))[1] ultimo_preco,
          (array_agg(it.casa order by it.emissao desc))[1] ultima_casa
        from cand c join itens it on it.d = c.d
        group by c.d, c.sem, c.insumo, c.via, it.descricao, it.un, it.forn
      )
      select jsonb_agg(jsonb_build_object(
          'descricao_na_nota', descricao, 'unidade', un, 'fornecedor', forn, 'semelhanca', round(sem::numeric, 2), 'entrou_por', via,
          'insumo_cadastrado', insumo,
          'casa_da_pessoa', jsonb_build_object('comprado_4s', round(coalesce(casa_4s, 0), 3), 'media_semanal_4s', round(coalesce(casa_4s, 0) / 4.0, 3),
                                               'compras_4s', casa_compras_4s),
          'grupo_todo', jsonb_build_object('comprado_4s', round(coalesce(grupo_4s, 0), 3), 'media_semanal_4s', round(coalesce(grupo_4s, 0) / 4.0, 3),
                                           'compras_4s', grupo_compras_4s, 'compras_8s', compras_8s),
          'ultima', ultima, 'ultima_qtd', ultima_qtd, 'ultimo_preco', round(ultimo_preco, 2), 'ultima_casa', ultima_casa)
        order by sem desc, ultima desc)
      from (select * from metr order by sem desc, ultima desc limit 15) z), '[]'::jsonb),
    'recentes', coalesce((select jsonb_agg(x) from (
      select jsonb_build_object('data', h.data_emissao::date, 'fonte', 'cicchetti_' || h.unidade, 'fornecedor', h.fornecedor,
        'descricao', h.descricao, 'unidade', h.unidade_compra, 'quantidade', h.quantidade, 'preco', round(h.preco_efetivo, 2)) x
      from public.precos_historico h
      where h.data_emissao > now() - interval '120 days'
        and extensions.word_similarity(v_q, lower(extensions.unaccent(h.descricao))) > 0.4
      order by extensions.word_similarity(v_q, lower(extensions.unaccent(h.descricao))) desc, h.data_emissao desc limit 6) s), '[]'::jsonb));
end $$;
revoke execute on function public.compras_auto_buscar(text, text) from public, anon, authenticated;
grant execute on function public.compras_auto_buscar(text, text) to service_role;

-- Produto da nota escolhido para o item e a confiança da ligação
alter table public.compras_itens add column if not exists produto_nota text;
alter table public.compras_itens add column if not exists confianca text check (confianca in ('alta', 'media', 'baixa'));

-- ---------- 4. Análise: contexto, gravar e fila ----------
-- Como a próxima análise da pessoa deve gravar: substituir (nenhuma lista dela foi mexida) ou só adicionar
-- listas novas com as mensagens depois da última análise (já mexeu ou aprovou alguma)
create or replace function public.compras_auto_contexto(p_pessoa uuid, p_semana uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'modo', case when exists (select 1 from public.compras_listas l where l.semana_id = p_semana and l.pessoa_id = p_pessoa
                               and public.compras_lista_ativa(l.status) and public.compras_lista_tocada(l.id)) then 'adicionar' else 'substituir' end,
    'desde', (select max(a.inicio) from public.compras_analises a where a.semana_id = p_semana and a.pessoa_id = p_pessoa and a.status = 'ok'),
    'aumento_pct', (select aumento_pct from public.compras_semanas where id = p_semana),
    'listas', coalesce((select jsonb_agg(jsonb_build_object('titulo', l.titulo, 'status', l.status, 'mexida', public.compras_lista_tocada(l.id)))
               from public.compras_listas l where l.semana_id = p_semana and l.pessoa_id = p_pessoa and public.compras_lista_ativa(l.status)), '[]'))
$$;
revoke execute on function public.compras_auto_contexto(uuid, uuid) from public, anon, authenticated;
grant execute on function public.compras_auto_contexto(uuid, uuid) to service_role;

-- p_listas: [{titulo, itens: [{nome, fornecedor, unidade, qtd_pedida, qtd_sugerida, motivo, preco, media_4s, projecao, base, produto_nota, confianca}]}]
drop function if exists public.compras_auto_gravar(uuid, uuid, jsonb, text);
create or replace function public.compras_auto_gravar(p_pessoa uuid, p_semana uuid, p_listas jsonb, p_pedido_texto text, p_modo text default 'substituir')
returns jsonb language plpgsql security definer set search_path = public as $$
declare lst jsonb; i jsonb; v_lista uuid; k int; n_listas int := 0; n_itens int := 0;
begin
  if (select status from public.compras_semanas where id = p_semana) <> 'aberta' then raise exception 'A semana já foi fechada.'; end if;
  if p_modo = 'substituir' then
    if exists (select 1 from public.compras_listas l where l.semana_id = p_semana and l.pessoa_id = p_pessoa
               and public.compras_lista_ativa(l.status) and public.compras_lista_tocada(l.id)) then
      raise exception 'A pessoa já começou a revisar esta lista.';
    end if;
    update public.compras_listas set status = 'substituida', substituida_em = now()
    where semana_id = p_semana and pessoa_id = p_pessoa and status in ('aguardando', 'em_revisao');
  end if;
  for lst in select * from jsonb_array_elements(coalesce(p_listas, '[]')) loop
    if jsonb_array_length(coalesce(lst->'itens', '[]')) = 0 then continue; end if;
    insert into public.compras_listas (semana_id, pessoa_id, titulo, status, pedido_texto, pedido_em, analisada_em)
    values (p_semana, p_pessoa, nullif(trim(lst->>'titulo'), ''), 'em_revisao', nullif(p_pedido_texto, ''), now(), now())
    returning id into v_lista;
    n_listas := n_listas + 1; k := 0;
    for i in select * from jsonb_array_elements(lst->'itens') loop
      k := k + 1; n_itens := n_itens + 1;
      insert into public.compras_itens (lista_id, ordem, nome, fornecedor, unidade, qtd_pedida, qtd_sugerida, motivo, qtd, preco,
        media_4s, projecao, base, produto_nota, confianca)
      values (v_lista, k, coalesce(nullif(trim(i->>'nome'), ''), 'Item ' || k), nullif(trim(i->>'fornecedor'), ''), nullif(trim(i->>'unidade'), ''),
        (i->>'qtd_pedida')::numeric, (i->>'qtd_sugerida')::numeric, nullif(trim(i->>'motivo'), ''),
        coalesce((i->>'qtd_sugerida')::numeric, (i->>'qtd_pedida')::numeric), (i->>'preco')::numeric,
        (i->>'media_4s')::numeric, (i->>'projecao')::numeric, nullif(trim(i->>'base'), ''),
        nullif(trim(i->>'produto_nota'), ''), case when i->>'confianca' in ('alta', 'media', 'baixa') then i->>'confianca' end);
    end loop;
  end loop;
  if n_listas = 0 then raise exception 'A análise não trouxe nenhum item.'; end if;
  return jsonb_build_object('listas', n_listas, 'itens', n_itens);
end $$;
revoke execute on function public.compras_auto_gravar(uuid, uuid, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.compras_auto_gravar(uuid, uuid, jsonb, text, text) to service_role;

-- Fila: mensagem nova depois da última análise, ou revisão diária (lista ainda não mexida, análise com mais de 20 h)
create or replace function public.compras_auto_proxima(p_semana uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_inicio date; v_de timestamptz; v_ate timestamptz; p record; v_analise bigint;
  c_grupo constant text := '120363040261291910@g.us';
begin
  perform pg_advisory_xact_lock(hashtext('compras_auto_proxima'));
  select inicio into v_inicio from public.compras_semanas where id = p_semana and status = 'aberta';
  if v_inicio is null then return null; end if;
  select j.de, j.ate into v_de, v_ate from public.compras_janela(v_inicio) j;
  update public.compras_analises set status = 'falha', erro = 'tempo esgotado', fim = now()
  where semana_id = p_semana and status = 'analisando' and inicio < now() - interval '15 minutes';

  select o.*, u.ultima, ult.inicio ultima_analise into p
  from public.operacao_pessoas o
  join lateral (select max(m.enviada_em) ultima from public.wa_mensagens m
    where m.grupo_id = c_grupo and not m.de_nos and m.enviada_em >= v_de and m.enviada_em < v_ate
      and public.compras_nome(m.autor_nome) = public.compras_nome(o.wa_nome)) u on u.ultima is not null
  left join lateral (select max(a.inicio) inicio from public.compras_analises a
    where a.semana_id = p_semana and a.pessoa_id = o.id and a.status <> 'falha') ult on true
  where o.ativo and o.papel = 'solicitante' and coalesce(trim(o.wa_nome), '') <> ''
    and not exists (select 1 from public.compras_analises a where a.semana_id = p_semana and a.pessoa_id = o.id and a.status = 'analisando')
    and (select count(*) from public.compras_analises a where a.semana_id = p_semana and a.pessoa_id = o.id
         and a.status = 'falha' and a.inicio > greatest(u.ultima, now() - interval '20 hours')) < 2
    and (
      ult.inicio is null or ult.inicio < u.ultima
      -- revisão diária: só enquanto a janela da semana está aberta e nenhuma lista da pessoa foi mexida
      or (ult.inicio < now() - interval '20 hours' and now() < v_ate
          and exists (select 1 from public.compras_listas l where l.semana_id = p_semana and l.pessoa_id = o.id and l.status in ('aguardando', 'em_revisao'))
          and not exists (select 1 from public.compras_listas l where l.semana_id = p_semana and l.pessoa_id = o.id
                          and public.compras_lista_ativa(l.status) and public.compras_lista_tocada(l.id)))
    )
  order by (ult.inicio is null or ult.inicio < u.ultima) desc, u.ultima limit 1;
  if p.id is null then return null; end if;

  insert into public.compras_analises (semana_id, pessoa_id, status) values (p_semana, p.id, 'analisando') returning id into v_analise;
  return jsonb_build_object('id', p.id, 'nome', p.nome, 'unidade', p.unidade, 'setor', p.setor, 'wa_nome', p.wa_nome,
    'analise', v_analise, 'de', v_de, 'ate', v_ate);
end $$;
revoke execute on function public.compras_auto_proxima(uuid) from public, anon, authenticated;
grant execute on function public.compras_auto_proxima(uuid) to service_role;

-- Histórico da pessoa: só listas que valeram (sem as trocadas e as juntadas)
create or replace function public.compras_auto_historico(p_pessoa uuid, p_semana uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('semana', s.inicio, 'titulo', l.titulo, 'status', l.status, 'itens',
    (select jsonb_agg(jsonb_build_object('nome', i.nome, 'fornecedor', i.fornecedor, 'unidade', i.unidade, 'qtd', i.qtd, 'preco', i.preco) order by i.ordem)
     from public.compras_itens i where i.lista_id = l.id and not i.removido)) order by s.inicio desc), '[]'::jsonb)
  from public.compras_listas l join public.compras_semanas s on s.id = l.semana_id
  where l.pessoa_id = p_pessoa and public.compras_lista_ativa(l.status)
    and s.inicio < (select inicio from public.compras_semanas where id = p_semana)
    and s.inicio >= (select inicio from public.compras_semanas where id = p_semana) - 28
$$;
revoke execute on function public.compras_auto_historico(uuid, uuid) from public, anon, authenticated;
grant execute on function public.compras_auto_historico(uuid, uuid) to service_role;

-- Pendências por pessoa (várias listas): aprovada só quando todas as ativas estão aprovadas
create or replace view public.compras_pendencias with (security_invoker = true) as
select s.id semana_id, s.inicio, p.id pessoa_id, p.nome, p.unidade, p.setor,
  case when count(l.id) = 0 then 'sem_lista'
       when bool_and(l.status = 'aprovada') then 'aprovada'
       when bool_or(l.status = 'em_revisao') then 'em_revisao' else 'aguardando' end status,
  (select a.status from public.compras_analises a where a.semana_id = s.id and a.pessoa_id = p.id order by a.inicio desc limit 1) analise
from public.compras_semanas s
cross join public.operacao_pessoas p
left join public.compras_listas l on l.semana_id = s.id and l.pessoa_id = p.id and l.status in ('aguardando', 'em_revisao', 'aprovada')
where p.ativo and p.papel = 'solicitante' and s.status = 'aberta'
group by s.id, s.inicio, p.id, p.nome, p.unidade, p.setor
having count(l.id) = 0 or not bool_and(l.status = 'aprovada');
grant select on public.compras_pendencias to authenticated;

-- Lista única: origem com o título da lista
create or replace function public.compras_consolidar(p_semana uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v int;
begin
  if public.operacao_papel(auth.uid()) not in ('socio', 'compras') then raise exception 'Só o setor de compras junta a lista.' using errcode = '42501'; end if;
  if (select status from public.compras_semanas where id = p_semana) <> 'aberta' then raise exception 'A semana já foi fechada.'; end if;
  with soma as (
    select coalesce(nullif(trim(i.fornecedor), ''), 'Sem fornecedor') fornecedor, trim(i.nome) nome, coalesce(lower(trim(i.unidade)), '') unidade,
      sum(i.qtd) qtd, max(i.preco) preco,
      jsonb_agg(jsonb_build_object('pessoa', p.nome, 'unidade', p.unidade, 'setor', p.setor, 'lista', l.titulo, 'qtd', i.qtd) order by p.unidade, p.setor) origem
    from public.compras_itens i join public.compras_listas l on l.id = i.lista_id join public.operacao_pessoas p on p.id = l.pessoa_id
    where l.semana_id = p_semana and l.status = 'aprovada' and not i.removido and coalesce(i.qtd, 0) > 0
    group by 1, 2, 3
  )
  insert into public.compras_final as f (semana_id, fornecedor, nome, unidade, qtd, preco, origem, atualizado_por)
  select p_semana, fornecedor, nome, unidade, qtd, preco, origem, auth.uid() from soma
  on conflict (semana_id, fornecedor, nome, unidade) do update set
    qtd = case when f.editado then f.qtd else excluded.qtd end,
    preco = case when f.editado then f.preco else excluded.preco end,
    origem = excluded.origem, atualizado_em = now();
  get diagnostics v = row_count;
  return v;
end $$;
revoke execute on function public.compras_consolidar(uuid) from public, anon;
grant execute on function public.compras_consolidar(uuid) to authenticated;

-- ---------- 5. Conector ----------
create or replace function public.mcp_compras_semana(p_token text, p_data date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record; v_sem uuid;
begin
  select * into a from public.mcp_auth(p_token);
  if public.operacao_papel(a.o_user) <> 'socio' then raise exception 'Sem acesso às compras (só os sócios)' using errcode = '42501'; end if;
  v_sem := public.compras_semana_de(p_data);
  return jsonb_build_object(
    'semana', (select to_jsonb(s) from public.compras_semanas s where s.id = v_sem),
    'pessoas', (select jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.nome, 'unidade', p.unidade, 'setor', p.setor, 'papel', p.papel,
        'nome_no_whatsapp', p.wa_nome, 'tem_login', p.user_id is not null,
        'listas', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'titulo', l.titulo, 'status', l.status,
                     'itens', (select count(*) from public.compras_itens i where i.lista_id = l.id and not i.removido)) order by l.created_at), '[]')
                   from public.compras_listas l where l.semana_id = v_sem and l.pessoa_id = p.id and public.compras_lista_ativa(l.status)))
        order by p.unidade, p.setor) from public.operacao_pessoas p where p.ativo),
    'final', (select count(*) from public.compras_final f where f.semana_id = v_sem and not f.removido),
    'como_fazer', 'A leitura do grupo COMPRAS é automática (a cada 15 min). Para gravar à mão: compras_gravar_lista cria uma lista nova da pessoa (com título); com substituir, as listas dela ainda não revisadas são trocadas. qtd_pedida = o que veio no grupo, qtd_sugerida e motivo quando discordar, preco = último preço pago.');
end $$;
revoke execute on function public.mcp_compras_semana(text, date) from public, authenticated;
grant execute on function public.mcp_compras_semana(text, date) to anon;

drop function if exists public.mcp_compras_gravar_lista(text, uuid, jsonb, text, date, boolean);
create or replace function public.mcp_compras_gravar_lista(p_token text, p_pessoa uuid, p_itens jsonb, p_pedido_texto text default null,
  p_data date default null, p_substituir boolean default false, p_titulo text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record; v_sem uuid; v_lista uuid; i jsonb; k int := 0;
begin
  select * into a from public.mcp_auth(p_token);
  if public.operacao_papel(a.o_user) <> 'socio' then raise exception 'Sem acesso às compras (só os sócios)' using errcode = '42501'; end if;
  if not exists (select 1 from public.operacao_pessoas where id = p_pessoa and ativo) then raise exception 'Pessoa não encontrada.'; end if;
  if jsonb_array_length(coalesce(p_itens, '[]')) = 0 then raise exception 'A lista precisa de pelo menos um item.'; end if;
  v_sem := public.compras_semana_de(p_data);
  if (select status from public.compras_semanas where id = v_sem) <> 'aberta' then raise exception 'A semana já foi fechada.'; end if;
  if p_substituir then
    update public.compras_listas l set status = 'substituida', substituida_em = now()
    where l.semana_id = v_sem and l.pessoa_id = p_pessoa and l.status in ('aguardando', 'em_revisao') and not public.compras_lista_tocada(l.id);
  end if;
  insert into public.compras_listas (semana_id, pessoa_id, titulo, status, pedido_texto, pedido_em, analisada_em)
  values (v_sem, p_pessoa, nullif(trim(p_titulo), ''), 'em_revisao', nullif(p_pedido_texto, ''), now(), now()) returning id into v_lista;
  for i in select * from jsonb_array_elements(p_itens) loop
    k := k + 1;
    insert into public.compras_itens (lista_id, ordem, nome, fornecedor, unidade, qtd_pedida, qtd_sugerida, motivo, qtd, preco)
    values (v_lista, k, coalesce(nullif(trim(i->>'nome'), ''), 'Item ' || k), nullif(trim(i->>'fornecedor'), ''), nullif(trim(i->>'unidade'), ''),
      (i->>'qtd_pedida')::numeric, (i->>'qtd_sugerida')::numeric, nullif(trim(i->>'motivo'), ''),
      coalesce((i->>'qtd_sugerida')::numeric, (i->>'qtd_pedida')::numeric), (i->>'preco')::numeric);
  end loop;
  return jsonb_build_object('lista', v_lista, 'itens', k);
end $$;
revoke execute on function public.mcp_compras_gravar_lista(text, uuid, jsonb, text, date, boolean, text) from public, authenticated;
grant execute on function public.mcp_compras_gravar_lista(text, uuid, jsonb, text, date, boolean, text) to anon;
