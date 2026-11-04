-- Cicchetti Midway (Midway Mall, Natal) encerrou todas as atividades em 31/10/2026.
-- A unidade vira só arquivo: nenhuma rotina puxa dados novos, e o que já foi guardado continua
-- disponível para consulta (vendas TOTVS, notas do Cicchetti Management, fichas e o último cardápio).
-- Nada é apagado.

-- 1) TOTVS: unidade encerrada (a agenda diária e o botão "Buscar na TOTVS" só usam unidades ativas)
alter table public.totvs_unidades add column if not exists encerrada_em date;
comment on column public.totvs_unidades.encerrada_em is 'Último dia de operação. Unidade encerrada = só arquivo, sem extração.';
update public.totvs_unidades set ativa = false, encerrada_em = date '2026-10-31', nome = 'Cicchetti Midway' where id = 'midway';

create or replace function public.totvs_pedir(p_unidade text, p_dia date, p_origem text, p_user uuid)
 returns uuid language plpgsql security definer set search_path to 'public', 'vault'
as $function$
declare u public.totvs_unidades; v_id uuid; v_hoje date := (now() at time zone 'America/Fortaleza')::date;
begin
  select * into u from public.totvs_unidades where id = p_unidade;
  if u.id is null then raise exception 'Unidade "%" não encontrada.', p_unidade; end if;
  if u.encerrada_em is not null then
    raise exception 'A unidade % encerrou as atividades em %: fica só como arquivo, sem extração.', u.nome, to_char(u.encerrada_em, 'DD/MM/YYYY');
  end if;
  if not u.ativa or u.loja is null then
    raise exception 'A unidade % não tem loja TOTVS configurada; não dá para extrair.', u.nome;
  end if;
  if p_dia is null or p_dia > v_hoje then raise exception 'Escolha um dia até hoje.'; end if;
  if p_dia < date '2010-01-01' then raise exception 'Dia antigo demais (antes de 2010).'; end if;

  select id into v_id from public.totvs_execucoes
  where unidade_id = u.id and dia = p_dia and status in ('na_fila', 'rodando') and created_at > now() - interval '10 minutes'
  order by created_at desc limit 1;
  if v_id is not null then return v_id; end if;

  insert into public.totvs_execucoes (unidade_id, dia, origem, pedido_por)
  values (u.id, p_dia, p_origem, p_user) returning id into v_id;

  perform net.http_post(
    url := 'https://doajznzouxxqbqkvsclv.supabase.co/functions/v1/totvs-extrair',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-segredo', (select decrypted_secret from vault.decrypted_secrets where name = 'totvs_segredo')),
    body := jsonb_build_object('execucao', v_id),
    timeout_milliseconds := 30000);
  return v_id;
end $function$;

create or replace function public.mcp_totvs_unidades(p_token text)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
begin
  perform public.mcp_totvs_auth(p_token);
  return jsonb_build_object('hoje', (now() at time zone 'America/Fortaleza')::date, 'unidades', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', u.id, 'nome', u.nome, 'loja', u.loja, 'extrai', u.ativa and u.loja is not null and u.encerrada_em is null,
      'encerrada_em', u.encerrada_em,
      'situacao', case when u.encerrada_em is not null then 'encerrada (só arquivo, sem extração)' when u.ativa then 'ativa' else 'sem loja' end,
      'ultimo_dia_extraido', (select max(dia) from public.totvs_dias d where d.unidade_id = u.id),
      'ultimas_execucoes', (select coalesce(jsonb_agg(jsonb_build_object('dia', e.dia, 'status', e.status, 'origem', e.origem,
          'quando', to_char(e.created_at at time zone 'America/Fortaleza', 'YYYY-MM-DD HH24:MI'), 'erro', nullif(e.erro, ''))
          order by e.created_at desc), '[]'::jsonb)
        from (select * from public.totvs_execucoes x where x.unidade_id = u.id order by x.created_at desc limit 5) e)
    ) order by u.encerrada_em nulls first, u.ordem, u.nome)
    from public.totvs_unidades u), '[]'::jsonb));
end $function$;

-- 2) Cardápio e venda das fichas: a unidade encerrada fica congelada nos últimos dias de operação
create or replace view public.menus_produtos as
 select unidade_id, grupo, subgrupo, categoria, produto, vendidos_60d, preco_medio, ultima_venda,
    (select ft.ficha_id from public.fichas_totvs ft
      where ft.unidade_totvs = v.unidade_id and ft.produto = v.produto and ft.porcoes_por_venda > 0 limit 1) as ficha_id
   from (select d.unidade_id, p.value ->> 'grupo' as grupo, p.value ->> 'subgrupo' as subgrupo, p.value ->> 'categoria' as categoria,
            p.value ->> 'nome' as produto, sum((p.value ->> 'quantidade')::numeric) as vendidos_60d,
            round(sum((p.value ->> 'valor')::numeric) / nullif(sum((p.value ->> 'quantidade')::numeric), 0), 2) as preco_medio,
            max(d.dia) as ultima_venda
           from public.totvs_dias d
           left join public.totvs_unidades u on u.id = d.unidade_id
           cross join lateral jsonb_array_elements(d.produtos) p(value)
          where d.dia > coalesce(u.encerrada_em + 1, current_date) - 60 and d.dia <= coalesce(u.encerrada_em, current_date)
          group by d.unidade_id, p.value ->> 'grupo', p.value ->> 'subgrupo', p.value ->> 'categoria', p.value ->> 'nome') v;

create or replace view public.fichas_venda as
 select ft.ficha_id, ft.unidade_totvs, ft.produto,
    sum((p.value ->> 'quantidade')::numeric) as vendidos_30d,
    round(sum((p.value ->> 'valor')::numeric) / nullif(sum((p.value ->> 'quantidade')::numeric), 0), 2) as preco_medio
   from public.fichas_totvs ft
   left join public.totvs_unidades u on u.id = ft.unidade_totvs
   join public.totvs_dias d on d.unidade_id = ft.unidade_totvs
     and d.dia > coalesce(u.encerrada_em + 1, current_date) - 30 and d.dia <= coalesce(u.encerrada_em, current_date)
   cross join lateral jsonb_array_elements(d.produtos) p(value)
  where ft.porcoes_por_venda > 0 and (p.value ->> 'nome') = ft.produto
  group by ft.ficha_id, ft.unidade_totvs, ft.produto;

-- 3) Cicchetti Management: a coleta de notas não relê mais a lista do Midway
--    (as notas e itens já copiados ficam no Índice de preços como histórico)
alter table public.precos_coleta add column if not exists ativa boolean not null default true;
update public.precos_coleta set ativa = false where unidade = 'midway';
-- precos_coletar: o primeiro laço passa a ser
--   for c in select * from public.precos_coleta where ativa and (lista_lida_em is null or lista_lida_em < now() - interval '6 hours') loop
-- (aplicado com a definição completa da função no banco; o resto da função não mudou)

-- 4) Compras: a análise do grupo COMPRAS não usa mais as compras do Midway como referência
--    (compras_auto_buscar: em "recentes", and h.unidade <> 'midway'; aplicado no banco)

-- 5) Fiscal: anotações da V6 (CNPJ do Midway) e do mapa de acessos
update public.fiscal_empresas
   set observacao = 'Cicchetti Midway (Midway Mall, Natal) encerrou todas as atividades em 31/10/2026. Sem operação, segue com DCTFWeb, ECF e ECD até a baixa do CNPJ.'
 where cnpj = '58076145000156';
update public.fiscal_fontes
   set o_que_da = 'ISS e certidão do Cicchetti Midway (V6), encerrado em 31/10/2026.',
       falta = 'Só até a baixa da V6 na prefeitura de Natal.'
 where id = 'pm_natal';

-- 3b/4b) Aplicação das duas trocas pontuais (precos_coletar e compras_auto_buscar)
do $$
declare d text;
begin
  d := pg_get_functiondef('public.precos_coletar'::regproc);
  if position('where ativa and (' in d) = 0 then
    d := replace(d, 'from public.precos_coleta where lista_lida_em is null or lista_lida_em < now() - interval ''6 hours''',
                    'from public.precos_coleta where ativa and (lista_lida_em is null or lista_lida_em < now() - interval ''6 hours'')');
    if position('where ativa and (' in d) = 0 then raise exception 'precos_coletar: trecho não encontrado'; end if;
    execute d;
  end if;

  d := pg_get_functiondef('public.compras_auto_buscar(text, text)'::regprocedure);
  if position('h.unidade <> ''midway''' in d) = 0 then
    d := replace(d, 'where h.data_emissao > now() - interval ''120 days''',
                    'where h.data_emissao > now() - interval ''120 days'' and h.unidade <> ''midway''');
    if position('h.unidade <> ''midway''' in d) = 0 then raise exception 'compras_auto_buscar: trecho não encontrado'; end if;
    execute d;
  end if;
end $$;
