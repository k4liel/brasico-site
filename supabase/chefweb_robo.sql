-- =====================================================================
-- Robô do Chef Web (TOTVS) com login próprio (22/11/2026, decisão do dono: "Robô com login próprio")
-- A API de integração da TOTVS não libera produtos nem regras fiscais (código 20). O robô do PMS na VPS
-- (robos/pms-navegador/robo.mjs) passou a rodar, uma vez por dia, a leitura do Chef Web (robos/chefweb/chefweb.mjs,
-- baixado do GitHub a cada leitura): entra em chefwebcloud.chef.totvs.com.br com o usuário do Vault, lê o relatório de
-- regras fiscais (todas as lojas) e, em cada loja, o cadastro de cada produto ativo (Cadastros/ProdutoServico/Edit?id=…:
-- NCM, CEST, ICMS, CFOP, CST, PIS/Cofins, IBS/CBS, cClassTrib). Só leitura: nunca clica em Salvar.
-- Login e senha só no Vault (chefweb_usuario, chefweb_senha), cadastrados por um sócio no SQL Editor:
--   select vault.create_secret('<usuário>', 'chefweb_usuario');
--   select vault.create_secret('<senha>', 'chefweb_senha');
-- O robô usa o mesmo segredo do robô do PMS (pms_robo_segredo, conferido por pms_robo_ok).
-- =====================================================================

create table if not exists public.totvs_produtos_cadastro (
  loja_codigo int not null,
  loja_nome text,
  codigo text not null,
  nome text,
  grupo text, subgrupo text, preco numeric, situacao text,
  texto_fiscal text, ncm text, cest text, imposto numeric, tributo text, cfop text, cst text,
  pis_cst text, pis numeric, cofins_cst text, cofins numeric,
  ibscbs_cst text, cclasstrib text, cbs numeric, ibs_uf numeric, ibs_mun numeric,
  campos jsonb not null default '{}',
  lido_em timestamptz not null default now(),
  primary key (loja_codigo, codigo)
);
alter table public.totvs_produtos_cadastro enable row level security;
drop policy if exists "ver" on public.totvs_produtos_cadastro;
create policy "ver" on public.totvs_produtos_cadastro for select using ((select public.notas_pode_ver((select auth.uid()))));
revoke all on public.totvs_produtos_cadastro from public, anon, authenticated;
grant select on public.totvs_produtos_cadastro to authenticated;

create table if not exists public.chefweb_execucoes (
  id uuid primary key default gen_random_uuid(),
  inicio timestamptz not null default now(),
  fim timestamptz,
  status text not null default 'rodando',
  resumo jsonb not null default '{}',
  erro text
);
alter table public.chefweb_execucoes enable row level security;
drop policy if exists "ver" on public.chefweb_execucoes;
create policy "ver" on public.chefweb_execucoes for select using ((select public.notas_pode_ver((select auth.uid()))));
revoke all on public.chefweb_execucoes from public, anon, authenticated;
grant select on public.chefweb_execucoes to authenticated;

-- O que o robô precisa: login, se a leitura do dia já foi feita e o id da execução
create or replace function public.chefweb_robo_comecar(p_segredo text, p_forcar boolean default false)
returns jsonb language plpgsql security definer set search_path = public, vault as $$
declare v_usuario text; v_senha text; v_id uuid;
begin
  if not public.pms_robo_ok(p_segredo) then raise exception 'sem permissão' using errcode = '42501'; end if;
  select decrypted_secret into v_usuario from vault.decrypted_secrets where name = 'chefweb_usuario';
  select decrypted_secret into v_senha from vault.decrypted_secrets where name = 'chefweb_senha';
  if v_usuario is null or v_senha is null then return jsonb_build_object('fazer', false, 'motivo', 'faltam chefweb_usuario e chefweb_senha no Vault'); end if;
  -- uma leitura por dia (a madrugada é o melhor horário; antes das 5h de Fortaleza ou a qualquer hora se a última passou de 30 h)
  if not p_forcar and exists (select 1 from public.chefweb_execucoes where status in ('ok', 'parcial', 'rodando') and inicio > now() - interval '20 hours') then
    return jsonb_build_object('fazer', false, 'motivo', 'já leu hoje');
  end if;
  update public.chefweb_execucoes set status = 'falha', erro = 'presa', fim = now() where status = 'rodando';
  insert into public.chefweb_execucoes default values returning id into v_id;
  return jsonb_build_object('fazer', true, 'execucao', v_id, 'usuario', v_usuario, 'senha', v_senha);
end $$;
revoke execute on function public.chefweb_robo_comecar(text, boolean) from public, authenticated;
grant execute on function public.chefweb_robo_comecar(text, boolean) to anon;

-- Grava: tipo 'regras' (texto do relatório, 36 colunas com |), 'produtos' (lista de produtos de uma loja) ou 'fim'
create or replace function public.chefweb_robo_gravar(p_segredo text, p_execucao uuid, p_tipo text, p_dados jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n int := 0; p jsonb;
  num constant text := '^-?[0-9]+([.,][0-9]+)?$';
begin
  if not public.pms_robo_ok(p_segredo) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_tipo = 'regras' then
    n := public.totvs_regras_fiscais_gravar(p_dados->>'texto', 'robo_chefweb');
  elsif p_tipo = 'produtos' then
    for p in select * from jsonb_array_elements(coalesce(p_dados->'produtos', '[]')) loop
      insert into public.totvs_produtos_cadastro as t (loja_codigo, loja_nome, codigo, nome, grupo, subgrupo, preco, situacao, texto_fiscal,
        ncm, cest, imposto, tributo, cfop, cst, pis_cst, pis, cofins_cst, cofins, ibscbs_cst, cclasstrib, cbs, ibs_uf, ibs_mun, campos, lido_em)
      values ((p_dados->>'loja_codigo')::int, p_dados->>'loja_nome', p->>'codigo', nullif(p->>'nome', ''), nullif(p->>'grupo', ''),
        nullif(p->>'subgrupo', ''), case when p->>'preco' ~ num then replace(p->>'preco', ',', '.')::numeric end, nullif(p->>'situacao', ''),
        nullif(p->>'texto_fiscal', ''), nullif(p->>'ncm', ''), nullif(p->>'cest', ''),
        case when p->>'imposto' ~ num then replace(p->>'imposto', ',', '.')::numeric end, nullif(p->>'tributo', ''), nullif(p->>'cfop', ''),
        nullif(p->>'cst', ''), nullif(p->>'pis_cst', ''), case when p->>'pis' ~ num then replace(p->>'pis', ',', '.')::numeric end,
        nullif(p->>'cofins_cst', ''), case when p->>'cofins' ~ num then replace(p->>'cofins', ',', '.')::numeric end,
        nullif(p->>'ibscbs_cst', ''), nullif(p->>'cclasstrib', ''),
        case when p->>'cbs' ~ num then replace(p->>'cbs', ',', '.')::numeric end, case when p->>'ibs_uf' ~ num then replace(p->>'ibs_uf', ',', '.')::numeric end,
        case when p->>'ibs_mun' ~ num then replace(p->>'ibs_mun', ',', '.')::numeric end, coalesce(p->'campos', '{}'), now())
      on conflict (loja_codigo, codigo) do update set loja_nome = excluded.loja_nome, nome = excluded.nome, grupo = excluded.grupo,
        subgrupo = excluded.subgrupo, preco = excluded.preco, situacao = excluded.situacao, texto_fiscal = excluded.texto_fiscal, ncm = excluded.ncm,
        cest = excluded.cest, imposto = excluded.imposto, tributo = excluded.tributo, cfop = excluded.cfop, cst = excluded.cst,
        pis_cst = excluded.pis_cst, pis = excluded.pis, cofins_cst = excluded.cofins_cst, cofins = excluded.cofins, ibscbs_cst = excluded.ibscbs_cst,
        cclasstrib = excluded.cclasstrib, cbs = excluded.cbs, ibs_uf = excluded.ibs_uf, ibs_mun = excluded.ibs_mun, campos = excluded.campos, lido_em = now();
      n := n + 1;
    end loop;
  elsif p_tipo = 'fim' then
    update public.chefweb_execucoes set status = coalesce(p_dados->>'status', 'ok'), fim = now(), resumo = resumo || coalesce(p_dados->'resumo', '{}'),
      erro = p_dados->>'erro' where id = p_execucao;
    return jsonb_build_object('ok', true);
  end if;
  update public.chefweb_execucoes set resumo = resumo || jsonb_build_object(p_tipo || coalesce('_' || (p_dados->>'loja_codigo'), ''),
    coalesce((resumo->>(p_tipo || coalesce('_' || (p_dados->>'loja_codigo'), '')))::int, 0) + n) where id = p_execucao;
  return jsonb_build_object('gravados', n);
end $$;
revoke execute on function public.chefweb_robo_gravar(text, uuid, text, jsonb) from public, authenticated;
grant execute on function public.chefweb_robo_gravar(text, uuid, text, jsonb) to anon;

-- Pedido de leitura na hora (botão do site, só sócios): o robô confere a cada rodada do PMS (~30 min)
create or replace function public.chefweb_pedir_leitura()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.notas_pode_ver(auth.uid()) then raise exception 'sem acesso'; end if;
  update public.chefweb_execucoes set status = 'refazer' where status in ('ok', 'parcial') and inicio > now() - interval '20 hours';
end $$;
revoke execute on function public.chefweb_pedir_leitura() from public, anon;
grant execute on function public.chefweb_pedir_leitura() to authenticated;
