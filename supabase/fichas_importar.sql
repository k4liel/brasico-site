-- =====================================================================
-- Fichas técnicas: cópia das abas do projeto "Fichas técnicas" para as tabelas (fase 3)
--  - Lê cada <article class="ficha"> das abas (nome, tag, foto, tabela de ingredientes,
--    preparo e observações). Só lê o projeto: nada nele é alterado.
--  - Ficha que já existe (mesma unidade e nome) não é copiada de novo.
--  - Ingrediente com o nome de outra ficha da mesma unidade vira sub-preparo; o resto
--    ganha (ou reaproveita) um insumo do cadastro único.
-- Uso: select public.fichas_importar('<id do projeto Fichas técnicas>');
-- Atenção: no regex do Postgres o primeiro quantificador decide se o padrão todo é guloso;
-- por isso '<tr[^>]*?>' (e não '<tr[^>]*>'), senão uma linha engole a tabela inteira.
-- =====================================================================
create or replace function public.fichas_texto(p text)
returns text language sql immutable as $$
  select nullif(trim(regexp_replace(replace(replace(replace(replace(regexp_replace(coalesce(p, ''), '<[^>]+>', ' ', 'g'),
    '&amp;', '&'), '&nbsp;', ' '), '&lt;', '<'), '&gt;', '>'), '\s+', ' ', 'g')), '')
$$;

-- "0,5" → 0.5; "1/2" → 0.5; "q.b." → null
create or replace function public.fichas_numero(p text)
returns numeric language plpgsql immutable as $$
declare t text := replace(trim(coalesce(p, '')), ' ', '');
begin
  if t ~ '^\d+/\d+$' then return split_part(t, '/', 1)::numeric / nullif(split_part(t, '/', 2)::numeric, 0); end if;
  t := replace(t, ',', '.');
  if t ~ '^\d*\.?\d+$' then return t::numeric; end if;
  return null;
end $$;

create or replace function public.insumos_unidade_base(p text)
returns text language sql immutable as $$
  select case when lower(coalesce(p, '')) in ('kg', 'g', 'gr') then 'kg'
              when lower(coalesce(p, '')) in ('l', 'lt', 'ml') then 'L'
              else 'un' end
$$;

create or replace function public.fichas_importar(p_projeto uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  n record; art text; v_un text; v_grupo text; v_tipo text; v_nome text; v_tag text; v_foto text;
  cab text[]; i_ing int; i_un int; i_qtd int; linha text; cel text[]; k int;
  v_ficha uuid; v_fichas int := 0; v_itens int := 0; v_pular int := 0; v_notas text; v_preparo text;
  v_qtd_txt text; v_unidade text; v_qtd numeric; v_rend numeric; v_rend_un text; m text[];
begin
  for n in select id, title, content from public.notes where workspace_id = p_projeto and archived_at is null order by title loop
    v_un := case when n.title like '%Midway%' then 'midway' when n.title like '%Cicchetti Centro%' then 'cicchetti_centro'
                 when n.title like '%Filha da Lua%' then 'filha_da_lua' when n.title like '%Produção central%' then 'producao' else null end;
    continue when v_un is null;
    v_grupo := nullif(trim(split_part(n.title, ' · ', 3)), '');
    for art in select (regexp_matches(n.content, '<article class="ficha">(.*?)</article>', 'g'))[1] loop
      v_nome := public.fichas_texto((regexp_match(art, '<h3>(.*?)</h3>'))[1]);
      continue when v_nome is null;
      select id into v_ficha from public.fichas where unidade_negocio = v_un and lower(nome) = lower(v_nome);
      if v_ficha is not null and exists (select 1 from public.fichas_itens where ficha_id = v_ficha and not removido) then
        v_pular := v_pular + 1; continue;
      end if;
      v_tag := public.fichas_texto((regexp_match(art, '<span class="ficha-tag">(.*?)</span>'))[1]);
      v_foto := (regexp_match(art, 'class="ficha-foto" src="([^"]+)"'))[1];
      v_tipo := case when v_un = 'producao' or coalesce(v_grupo, '') ilike 'Bases%' then 'preparo'
                     when v_un = 'cicchetti_centro' or coalesce(v_grupo, '') ilike 'Drinks%' then 'drink' else 'prato' end;
      select string_agg(public.fichas_texto(x[1]), E'\n' order by ord) into v_preparo
        from regexp_matches(art, '<li>(.*?)</li>', 'g') with ordinality as t(x, ord);
      select string_agg(public.fichas_texto(x[1]), E'\n' order by ord) into v_notas
        from regexp_matches(art, '<p[^>]*?>(.*?)</p>', 'g') with ordinality as t(x, ord)
        where public.fichas_texto(x[1]) is not null and public.fichas_texto(x[1]) !~* '^preparo:?$';
      m := regexp_match(coalesce(v_notas, ''), 'Rende\s+([\d.,]+)\s*([A-Za-zçõ]+)');
      v_rend := public.fichas_numero(m[1]); v_rend_un := m[2];

      if v_ficha is null then
        insert into public.fichas (nome, unidade_negocio, grupo, tipo, rendimento, rendimento_unidade, preparo, observacoes, foto, origem_nota_id)
        values (v_nome, v_un, coalesce(v_grupo, v_tag), v_tipo, v_rend, v_rend_un, v_preparo, v_notas, v_foto, n.id)
        returning id into v_ficha;
      else
        update public.fichas set preparo = v_preparo, observacoes = v_notas, rendimento = v_rend, rendimento_unidade = v_rend_un,
          atualizado_em = now() where id = v_ficha;
      end if;
      v_fichas := v_fichas + 1;

      -- Cabeçalho da tabela: posição de ingrediente, unidade e quantidade
      select array_agg(lower(public.fichas_texto(x[1])) order by ord) into cab
        from regexp_matches(coalesce((regexp_match(art, '<thead>(.*?)</thead>'))[1], ''), '<th[^>]*?>(.*?)</th>', 'g') with ordinality as t(x, ord);
      i_ing := coalesce(array_position(cab, 'ingrediente'), array_position(cab, 'insumo'), 1);
      i_un := array_position(cab, 'un.');
      i_qtd := coalesce(array_position(cab, 'qtd.'), 2);
      k := 0;
      for linha in select (regexp_matches(coalesce((regexp_match(art, '<tbody>(.*?)</tbody>'))[1], ''), '<tr[^>]*?>(.*?)</tr>', 'g'))[1] loop
        select array_agg(coalesce(public.fichas_texto(x[1]), '') order by ord) into cel
          from regexp_matches(linha, '<td[^>]*?>(.*?)</td>', 'g') with ordinality as t(x, ord);
        continue when cel is null or coalesce(cel[i_ing], '') = '';
        k := k + 1;
        v_qtd_txt := cel[i_qtd];
        v_unidade := case when i_un is not null then nullif(cel[i_un], '') end;
        -- Coluna única "Qtd." com a unidade junto (ex.: "50 ml", "2 un")
        if v_unidade is null and v_qtd_txt ~ '^\s*[\d.,/]+\s*[A-Za-z.]+' then
          v_unidade := (regexp_match(v_qtd_txt, '^\s*[\d.,/]+\s*([A-Za-z.]+)'))[1];
          v_qtd_txt := (regexp_match(v_qtd_txt, '^\s*([\d.,/]+)'))[1];
        end if;
        v_qtd := public.fichas_numero(v_qtd_txt);
        insert into public.fichas_itens (ficha_id, ordem, ingrediente, quantidade, quantidade_texto, unidade)
        values (v_ficha, k, cel[i_ing], v_qtd, case when v_qtd is null then nullif(cel[i_qtd], '') end, v_unidade);
        v_itens := v_itens + 1;
      end loop;
    end loop;
  end loop;

  -- Sub-preparos: ingrediente com o nome de outra ficha da mesma unidade (ou da produção)
  update public.fichas_itens fi set sub_ficha_id = s.id
  from public.fichas f, public.fichas s
  where f.id = fi.ficha_id and not fi.removido and fi.sub_ficha_id is null and s.id <> f.id
    and s.unidade_negocio in (f.unidade_negocio, 'producao') and lower(s.nome) = lower(fi.ingrediente);

  -- Insumos: um por nome de ingrediente (sem repetir), com a unidade mais usada
  insert into public.insumos (nome, unidade)
  select distinct on (lower(trim(fi.ingrediente))) trim(fi.ingrediente),
    (select public.insumos_unidade_base(x.unidade) from public.fichas_itens x where not x.removido and lower(trim(x.ingrediente)) = lower(trim(fi.ingrediente))
     group by public.insumos_unidade_base(x.unidade) order by count(*) desc limit 1)
  from public.fichas_itens fi where not fi.removido and fi.sub_ficha_id is null and fi.insumo_id is null
  order by lower(trim(fi.ingrediente))
  on conflict do nothing;
  update public.fichas_itens fi set insumo_id = i.id from public.insumos i
  where not fi.removido and i.ativo and fi.insumo_id is null and fi.sub_ficha_id is null and lower(i.nome) = lower(trim(fi.ingrediente));
  insert into public.insumos_apelidos (insumo_id, apelido, origem, confirmado, semelhanca)
  select distinct on (lower(trim(fi.ingrediente))) fi.insumo_id, trim(fi.ingrediente), 'ficha', true, 1
  from public.fichas_itens fi where not fi.removido and fi.insumo_id is not null
  on conflict do nothing;

  return jsonb_build_object('fichas', v_fichas, 'itens', v_itens, 'ja_existiam', v_pular,
    'insumos', (select count(*) from public.insumos where ativo), 'sub_preparos', (select count(*) from public.fichas_itens where not removido and sub_ficha_id is not null));
end $$;
revoke execute on function public.fichas_importar(uuid) from public, anon, authenticated;
