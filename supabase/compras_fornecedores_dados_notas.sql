-- Cadastro de fornecedores completado com os dados reais das notas fiscais (NF-e) (04/11/2026, pedido do dono).
-- De cada fornecedor, a nota completa mais recente (de qualquer CNPJ dele) dá: nome fantasia, inscrição estadual,
-- endereço, cidade/UF/CEP e telefone. Das notas dos últimos 12 meses saem a forma de pagamento mais usada (tPag)
-- e o prazo de pagamento mais comum (dias entre a emissão e cada vencimento das duplicatas).
-- Regra: só PREENCHE o que está vazio (telefone, razão social, forma e prazo de pagamento) e só troca o nome pelo
-- nome fantasia se ninguém editou o fornecedor na tela; os campos que vêm só das notas (fantasia, IE, endereço,
-- cidade, UF, CEP, resumo) são sempre atualizados. Antes de mudar, guarda a versão anterior no histórico.
-- Roda todo dia às 6h50 de Fortaleza (depois da leitura das notas), pg_cron 'compras-fornecedores-notas'.

alter table public.compras_fornecedores
  add column if not exists nome_fantasia text,
  add column if not exists inscricao_estadual text,
  add column if not exists endereco text,
  add column if not exists cidade text,
  add column if not exists uf text,
  add column if not exists cep text,
  add column if not exists dados_notas jsonb,
  add column if not exists dados_notas_em timestamptz;

-- telefone da nota formatado; zeros ou número repetido = sem telefone; 0800 fica 0800 xxx xxxx; 0 de DDD na frente sai
create or replace function public.compras_fone_fmt(p text) returns text language sql immutable as $$
  select case
    when d ~ '^(\d)\1+$' or d = '' or substr(d, 3) ~ '^0+$' then null
    when d ~ '^0800\d{7}$' then '0800 ' || substr(d, 5, 3) || ' ' || substr(d, 8)
    when d ~ '^\d{11}$' then '(' || substr(d, 1, 2) || ') ' || substr(d, 3, 5) || '-' || substr(d, 8)
    when d ~ '^\d{10}$' then '(' || substr(d, 1, 2) || ') ' || substr(d, 3, 4) || '-' || substr(d, 7)
    when d ~ '^\d{8}$' then substr(d, 1, 4) || '-' || substr(d, 5)
    when d ~ '^\d{9}$' then d
    else null end
  from (select case when y ~ '^0\d{10,11}$' and y !~ '^0800' then substr(y, 2) else y end d
        from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') y) z) x
$$;

create or replace function public.compras_tpag_nome(p text) returns text language sql immutable as $$
  select case p when '01' then 'Dinheiro' when '02' then 'Cheque' when '03' then 'Cartão de crédito' when '04' then 'Cartão de débito'
    when '05' then 'Crédito na loja' when '10' then 'Vale alimentação' when '11' then 'Vale refeição' when '15' then 'Boleto'
    when '16' then 'Depósito' when '17' then 'PIX' when '18' then 'Transferência' when '99' then 'Outros' else null end
$$;

-- nome fantasia que serve de nome curto: não é CNPJ, nome de filial/centro de distribuição, nem a razão social cortada
drop function if exists public.compras_fantasia_boa(text, text);
create or replace function public.compras_fantasia_boa(p_fant text, p_razao text, p_mun text default null) returns boolean language sql immutable as $$
  select p_fant is not null and length(trim(p_fant)) >= 3
    and upper(p_fant) <> upper(coalesce(p_razao, ''))
    and upper(p_fant) !~ '(\d{2}\.\d{3}|\d{8}|CENTRO|CDD|LOJA|MATRIZ|FILIAL|DISTRIBUI|DEPOSITO|DEP[OÓ]SITO| - |\mRN\M|\mLT\.?$|\mLTD\.?$)'
    and upper(coalesce(p_razao, '')) not like upper(trim(p_fant)) || '%'
    -- nome da loja pela cidade ("NATAL", "NATAL SUL") não serve
    and (p_mun is null or upper(trim(p_fant)) not like upper(trim(p_mun)) || '%')
    -- começa com número, termina em LTDA/SA/ME/EIRELI, ou é só nome de cidade/bairro de loja
    and trim(p_fant) !~ '^\d'
    and upper(trim(p_fant)) !~ '\m(LTDA|S\.?A|ME|EIRELI|EPP)\.?$'
    and upper(trim(p_fant)) !~ '^(NATAL|PARNAMIRIM|MACAIBA|MOSSORO|RECIFE|JOAO PESSOA|FORTALEZA)( (SUL|NORTE|LESTE|OESTE|CENTRO))?$'
$$;

create or replace function public.compras_fornecedores_dados_notas()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  ns text[] := array[array['n', 'http://www.portalfiscal.inf.br/nfe']];
  f record; v_x xml; v_emit xml; v_end xml; v_n int := 0;
  v_fant text; v_ie text; v_end_txt text; v_mun text; v_uf text; v_cep text; v_fone text;
  v_pag text; v_prazo text; v_resumo jsonb; v_editado boolean;
begin
  for f in select * from public.compras_fornecedores where mesclado_em is null loop
    -- nota completa mais recente do fornecedor
    v_x := null;
    select n.xml::xml into v_x from public.notas n
    where n.emitente_cnpj = any(coalesce(f.cnpjs, '{}') || f.cnpj) and n.completa and n.xml is not null
      and coalesce(n.situacao, '') not ilike '%cancel%'
    order by n.emissao desc limit 1;
    if v_x is null then continue; end if;
    v_emit := (xpath('//n:emit', v_x, ns))[1];
    v_end := (xpath('//n:enderEmit', v_x, ns))[1];
    v_fant := nullif(trim((xpath('/n:emit/n:xFant/text()', v_emit, ns))[1]::text), '');
    v_ie := nullif(trim((xpath('/n:emit/n:IE/text()', v_emit, ns))[1]::text), '');
    v_end_txt := nullif(concat_ws(' · ',
      nullif(concat_ws(', ', nullif(trim((xpath('/n:enderEmit/n:xLgr/text()', v_end, ns))[1]::text), ''),
                             nullif(trim((xpath('/n:enderEmit/n:nro/text()', v_end, ns))[1]::text), '')), ''),
      nullif(trim((xpath('/n:enderEmit/n:xCpl/text()', v_end, ns))[1]::text), ''),
      nullif(trim((xpath('/n:enderEmit/n:xBairro/text()', v_end, ns))[1]::text), '')), '');
    v_mun := nullif(trim((xpath('/n:enderEmit/n:xMun/text()', v_end, ns))[1]::text), '');
    v_uf := nullif(trim((xpath('/n:enderEmit/n:UF/text()', v_end, ns))[1]::text), '');
    v_cep := nullif(trim((xpath('/n:enderEmit/n:CEP/text()', v_end, ns))[1]::text), '');
    v_fone := public.compras_fone_fmt((xpath('/n:enderEmit/n:fone/text()', v_end, ns))[1]::text);

    -- forma e prazo de pagamento mais comuns nas notas dos últimos 12 meses
    with notas12 as (
      select n.emissao::date dia, n.xml::xml x from public.notas n
      where n.emitente_cnpj = any(coalesce(f.cnpjs, '{}') || f.cnpj) and n.completa and n.xml is not null
        and coalesce(n.situacao, '') not ilike '%cancel%' and n.emissao > now() - interval '12 months'
    ), pags as (
      select t::text tpag from notas12, unnest(xpath('//n:detPag/n:tPag/text()', x, ns)) t
    ), prazos as (
      select (select string_agg((d::text::date - dia)::text, '/' order by d::text::date) from unnest(xpath('//n:dup/n:dVenc/text()', x, ns)) d) p
      from notas12
    )
    select (select public.compras_tpag_nome(tpag) from pags where public.compras_tpag_nome(tpag) is not null
              group by tpag order by count(*) desc limit 1),
           (select case when p is null then null when p = '0' then 'à vista' when p = '1' then '1 dia' else p || ' dias' end
              from prazos where p is not null group by p order by count(*) desc limit 1)
    into v_pag, v_prazo;

    select jsonb_build_object(
      'notas', count(*), 'primeira', min(n.emissao)::date, 'ultima', max(n.emissao)::date,
      'valor_12m', round(coalesce(sum(n.valor) filter (where n.emissao > now() - interval '12 months'), 0), 2),
      'notas_12m', count(*) filter (where n.emissao > now() - interval '12 months'))
    into v_resumo
    from public.notas n
    where n.emitente_cnpj = any(coalesce(f.cnpjs, '{}') || f.cnpj) and coalesce(n.situacao, '') not ilike '%cancel%';

    v_editado := exists (select 1 from public.compras_fornecedores_historico h where h.fornecedor_id = f.id and h.feito_por is not null);

    if f.nome_fantasia is distinct from v_fant or f.inscricao_estadual is distinct from v_ie or f.endereco is distinct from v_end_txt
       or f.cidade is distinct from v_mun or f.uf is distinct from v_uf or f.cep is distinct from v_cep
       or (coalesce(f.telefone, '') = '' and v_fone is not null)
       or (coalesce(f.forma_pagamento, '') = '' and v_pag is not null)
       or (coalesce(f.prazo_pagamento, '') = '' and v_prazo is not null)
       or f.dados_notas is distinct from v_resumo
       or (not v_editado and public.compras_fantasia_boa(v_fant, f.razao_social, v_mun) and initcap(lower(v_fant)) <> f.nome) then
      insert into public.compras_fornecedores_historico (fornecedor_id, antes, feito_por) values (f.id, to_jsonb(f), null);
      update public.compras_fornecedores set
        nome_fantasia = v_fant, inscricao_estadual = v_ie, endereco = v_end_txt, cidade = v_mun, uf = v_uf, cep = v_cep,
        telefone = case when coalesce(telefone, '') = '' then v_fone else telefone end,
        forma_pagamento = case when coalesce(forma_pagamento, '') = '' then v_pag else forma_pagamento end,
        prazo_pagamento = case when coalesce(prazo_pagamento, '') = '' then v_prazo else prazo_pagamento end,
        -- nome curto: o fantasia (se for diferente da razão social), só enquanto ninguém editou o fornecedor
        nome = case when not v_editado and public.compras_fantasia_boa(v_fant, razao_social, v_mun) then initcap(lower(v_fant)) else nome end,
        -- o nome antigo vira apelido (a busca nas notas e a lista única continuam achando o fornecedor)
        apelidos = case when not v_editado and public.compras_fantasia_boa(v_fant, razao_social, v_mun) and initcap(lower(v_fant)) <> nome
                         and not (nome = any(coalesce(apelidos, '{}'))) then coalesce(apelidos, '{}') || nome else apelidos end,
        dados_notas = v_resumo, dados_notas_em = now(), atualizado_em = now()
      where id = f.id;
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;
revoke all on function public.compras_fornecedores_dados_notas() from public, anon, authenticated;

-- primeira rodada (04/11/2026) refeita com as regras acima: volta nome, telefone, forma e prazo ao que eram antes dela
-- (ninguém tinha editado) e roda de novo
update public.compras_fornecedores f set nome = h.antes->>'nome', telefone = h.antes->>'telefone',
  forma_pagamento = h.antes->>'forma_pagamento', prazo_pagamento = h.antes->>'prazo_pagamento',
  apelidos = array(select jsonb_array_elements_text(h.antes->'apelidos'))
from (select distinct on (fornecedor_id) fornecedor_id, antes from public.compras_fornecedores_historico
      where feito_por is null order by fornecedor_id, feito_em) h
where h.fornecedor_id = f.id;
select public.compras_fornecedores_dados_notas();
-- nome que veio da razão social com número na frente ("38 MARTUNA ...")
update public.compras_fornecedores set nome = regexp_replace(nome, '^\d+\s+', '') where nome ~ '^\d+\s+[A-Za-z]';

select cron.schedule('compras-fornecedores-notas', '50 9 * * *', $$select public.compras_fornecedores_dados_notas()$$);
