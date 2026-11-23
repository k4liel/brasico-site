-- =====================================================================
-- Conferência fiscal das NF-e de compra (22/11/2026, pedido do dono: "a mesma conferência para as NF-e de compra";
-- aplica depois de notas.sql e nfce_conferencia.sql).
--  - notas_fiscal e notas_itens_fiscal: os campos fiscais do XML de cada NF-e completa, já separados (emitente, regime
--    do fornecedor, UF, totais; por item NCM, CFOP, CST/CSOSN, ICMS, ST, IPI, PIS, Cofins e IBS/CBS). Preenchidas pelo
--    gatilho notas_fiscal_gatilho a cada nota completa que chega (e numa leitura inicial de todas).
--  - nfe_conferencia(de, ate, empresa): confere as notas do período com regras fixas (sem IA) e devolve os achados:
--      total_nota      soma dos itens + frete + seguro + outras + IPI + ST − desconto diferente do total da nota
--      cfop_uf         CFOP 5 (dentro do estado) com fornecedor de outra UF, ou 6 com fornecedor do RN
--      cfop_especial   entrada que não é compra comum (bonificação, remessa, transferência, devolução)
--      ncm_invalido    item sem NCM válido
--      icms_conta      base × alíquota diferente do ICMS destacado no item
--      st_misturado    mesmo NCM comprado com substituição tributária de um fornecedor e sem de outro
--      ibscbs_ausente  fornecedor do regime normal sem o grupo IBS/CBS no item (o crédito de CBS a partir de 2027 depende dele)
--      duplicada       mesmo fornecedor e mesmo valor em notas diferentes com até 3 dias de diferença
--      destinatario    nota emitida para outro CNPJ (não o da empresa que recebeu)
--      so_resumo       nota só em resumo há mais de 10 dias: sem os itens, não dá para conferir
--      cancelada       nota cancelada pelo fornecedor: confirmar que não foi paga
-- Quem vê: os sócios (notas_pode_ver).
-- =====================================================================

create table if not exists public.notas_fiscal (
  chave text primary key references public.notas(chave),
  emit_uf text, emit_crt text, dest_cnpj text, dest_uf text, nat_op text, fin_nfe text,
  v_prod numeric, v_desc numeric, v_frete numeric, v_seg numeric, v_outro numeric, v_ipi numeric, v_st numeric, v_nf numeric,
  v_bc numeric, v_icms numeric, v_pis numeric, v_cofins numeric, v_cbs numeric, v_ibs numeric,
  lido_em timestamptz not null default now()
);
alter table public.notas_fiscal add column if not exists v_demais numeric;
alter table public.notas_fiscal add column if not exists v_deson numeric;
create table if not exists public.notas_itens_fiscal (
  chave text not null references public.notas(chave),
  n_item int not null,
  ncm text, cest text, cfop text, orig text, cst_icms text, csosn text,
  v_prod numeric, v_desc numeric,
  v_bc numeric, p_icms numeric, v_icms numeric, p_red_bc numeric, v_bc_st numeric, v_st numeric, v_ipi numeric,
  pis_cst text, v_pis numeric, cofins_cst text, v_cofins numeric,
  ibscbs_cst text, cclasstrib text, v_bc_ibscbs numeric, v_cbs numeric, v_ibs numeric,
  primary key (chave, n_item)
);
create index if not exists notas_itens_fiscal_ncm on public.notas_itens_fiscal (ncm);
do $$ declare t text; begin
  foreach t in array array['notas_fiscal', 'notas_itens_fiscal'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "ver" on public.%I', t);
    execute format('create policy "ver" on public.%I for select using (public.notas_pode_ver(auth.uid()))', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- Lê os campos fiscais do XML de uma nota completa (nfeProc). Reler substitui.
create or replace function public.notas_fiscal_ler(p_chave text)
returns int language plpgsql security definer set search_path = public as $$
declare v_xml text; d xml; ns text[] := array[array['n', 'http://www.portalfiscal.inf.br/nfe']]; det xml; n int := 0;
  tx text := '/n:nfeProc/n:NFe/n:infNFe';
begin
  select xml into v_xml from public.notas where chave = p_chave and completa and xml like '%<infNFe%';
  if v_xml is null then return 0; end if;
  begin
    d := xmlparse(document v_xml);
  exception when others then return 0;
  end;
  if (xpath(tx, d, ns))[1] is null then tx := '/n:NFe/n:infNFe'; end if;

  insert into public.notas_fiscal as f (chave, emit_uf, emit_crt, dest_cnpj, dest_uf, nat_op, fin_nfe, v_prod, v_desc, v_frete, v_seg, v_outro,
    v_ipi, v_st, v_nf, v_bc, v_icms, v_pis, v_cofins, v_cbs, v_ibs, lido_em)
  values (p_chave,
    (xpath(tx || '/n:emit/n:enderEmit/n:UF/text()', d, ns))[1]::text, (xpath(tx || '/n:emit/n:CRT/text()', d, ns))[1]::text,
    coalesce((xpath(tx || '/n:dest/n:CNPJ/text()', d, ns))[1]::text, (xpath(tx || '/n:dest/n:CPF/text()', d, ns))[1]::text),
    (xpath(tx || '/n:dest/n:enderDest/n:UF/text()', d, ns))[1]::text, (xpath(tx || '/n:ide/n:natOp/text()', d, ns))[1]::text,
    (xpath(tx || '/n:ide/n:finNFe/text()', d, ns))[1]::text,
    (xpath(tx || '/n:total/n:ICMSTot/n:vProd/text()', d, ns))[1]::text::numeric, (xpath(tx || '/n:total/n:ICMSTot/n:vDesc/text()', d, ns))[1]::text::numeric,
    (xpath(tx || '/n:total/n:ICMSTot/n:vFrete/text()', d, ns))[1]::text::numeric, (xpath(tx || '/n:total/n:ICMSTot/n:vSeg/text()', d, ns))[1]::text::numeric,
    (xpath(tx || '/n:total/n:ICMSTot/n:vOutro/text()', d, ns))[1]::text::numeric, (xpath(tx || '/n:total/n:ICMSTot/n:vIPI/text()', d, ns))[1]::text::numeric,
    (xpath(tx || '/n:total/n:ICMSTot/n:vST/text()', d, ns))[1]::text::numeric, (xpath(tx || '/n:total/n:ICMSTot/n:vNF/text()', d, ns))[1]::text::numeric,
    (xpath(tx || '/n:total/n:ICMSTot/n:vBC/text()', d, ns))[1]::text::numeric, (xpath(tx || '/n:total/n:ICMSTot/n:vICMS/text()', d, ns))[1]::text::numeric,
    (xpath(tx || '/n:total/n:ICMSTot/n:vPIS/text()', d, ns))[1]::text::numeric, (xpath(tx || '/n:total/n:ICMSTot/n:vCOFINS/text()', d, ns))[1]::text::numeric,
    (xpath(tx || '/n:total/n:IBSCBSTot/n:gCBS/n:vCBS/text()', d, ns))[1]::text::numeric, (xpath(tx || '/n:total/n:IBSCBSTot/n:gIBS/n:vIBS/text()', d, ns))[1]::text::numeric,
    now())
  on conflict (chave) do update set emit_uf = excluded.emit_uf, emit_crt = excluded.emit_crt, dest_cnpj = excluded.dest_cnpj, dest_uf = excluded.dest_uf,
    nat_op = excluded.nat_op, fin_nfe = excluded.fin_nfe, v_prod = excluded.v_prod, v_desc = excluded.v_desc, v_frete = excluded.v_frete, v_seg = excluded.v_seg,
    v_outro = excluded.v_outro, v_ipi = excluded.v_ipi, v_st = excluded.v_st, v_nf = excluded.v_nf, v_bc = excluded.v_bc, v_icms = excluded.v_icms,
    v_pis = excluded.v_pis, v_cofins = excluded.v_cofins, v_cbs = excluded.v_cbs, v_ibs = excluded.v_ibs, lido_em = now();
  -- O resto do que compõe o vNF: FCP-ST, imposto de importação, IPI devolvido e serviços (ISSQN) somam.
  -- O ICMS desonerado só sai do total quando a nota marca indDeduzDeson: fica à parte e a conferência aceita as duas contas.
  update public.notas_fiscal set v_deson = (xpath(tx || '/n:total/n:ICMSTot/n:vICMSDeson/text()', d, ns))[1]::text::numeric, v_demais =
      coalesce((xpath(tx || '/n:total/n:ICMSTot/n:vFCPST/text()', d, ns))[1]::text::numeric, 0)
    + coalesce((xpath(tx || '/n:total/n:ICMSTot/n:vII/text()', d, ns))[1]::text::numeric, 0)
    + coalesce((xpath(tx || '/n:total/n:ICMSTot/n:vIPIDevol/text()', d, ns))[1]::text::numeric, 0)
    + coalesce((xpath(tx || '/n:total/n:ISSQNtot/n:vServ/text()', d, ns))[1]::text::numeric, 0)
  where chave = p_chave;

  foreach det in array xpath(tx || '/n:det', d, ns) loop
    insert into public.notas_itens_fiscal as f (chave, n_item, ncm, cest, cfop, orig, cst_icms, csosn, v_prod, v_desc, v_bc, p_icms, v_icms, p_red_bc,
      v_bc_st, v_st, v_ipi, pis_cst, v_pis, cofins_cst, v_cofins, ibscbs_cst, cclasstrib, v_bc_ibscbs, v_cbs, v_ibs)
    values (p_chave, (xpath('/n:det/@nItem', det, ns))[1]::text::int,
      (xpath('/n:det/n:prod/n:NCM/text()', det, ns))[1]::text, (xpath('/n:det/n:prod/n:CEST/text()', det, ns))[1]::text,
      (xpath('/n:det/n:prod/n:CFOP/text()', det, ns))[1]::text, (xpath('/n:det/n:imposto/n:ICMS/*/n:orig/text()', det, ns))[1]::text,
      (xpath('/n:det/n:imposto/n:ICMS/*/n:CST/text()', det, ns))[1]::text, (xpath('/n:det/n:imposto/n:ICMS/*/n:CSOSN/text()', det, ns))[1]::text,
      (xpath('/n:det/n:prod/n:vProd/text()', det, ns))[1]::text::numeric, (xpath('/n:det/n:prod/n:vDesc/text()', det, ns))[1]::text::numeric,
      (xpath('/n:det/n:imposto/n:ICMS/*/n:vBC/text()', det, ns))[1]::text::numeric, (xpath('/n:det/n:imposto/n:ICMS/*/n:pICMS/text()', det, ns))[1]::text::numeric,
      (xpath('/n:det/n:imposto/n:ICMS/*/n:vICMS/text()', det, ns))[1]::text::numeric, (xpath('/n:det/n:imposto/n:ICMS/*/n:pRedBC/text()', det, ns))[1]::text::numeric,
      (xpath('/n:det/n:imposto/n:ICMS/*/n:vBCST/text()', det, ns))[1]::text::numeric, (xpath('/n:det/n:imposto/n:ICMS/*/n:vICMSST/text()', det, ns))[1]::text::numeric,
      (xpath('/n:det/n:imposto/n:IPI/n:IPITrib/n:vIPI/text()', det, ns))[1]::text::numeric,
      (xpath('/n:det/n:imposto/n:PIS/*/n:CST/text()', det, ns))[1]::text, (xpath('/n:det/n:imposto/n:PIS/*/n:vPIS/text()', det, ns))[1]::text::numeric,
      (xpath('/n:det/n:imposto/n:COFINS/*/n:CST/text()', det, ns))[1]::text, (xpath('/n:det/n:imposto/n:COFINS/*/n:vCOFINS/text()', det, ns))[1]::text::numeric,
      (xpath('/n:det/n:imposto/n:IBSCBS/n:CST/text()', det, ns))[1]::text, (xpath('/n:det/n:imposto/n:IBSCBS/n:cClassTrib/text()', det, ns))[1]::text,
      (xpath('/n:det/n:imposto/n:IBSCBS/n:gIBSCBS/n:vBC/text()', det, ns))[1]::text::numeric,
      (xpath('/n:det/n:imposto/n:IBSCBS/n:gIBSCBS/n:gCBS/n:vCBS/text()', det, ns))[1]::text::numeric,
      (xpath('/n:det/n:imposto/n:IBSCBS/n:gIBSCBS/n:vIBS/text()', det, ns))[1]::text::numeric)
    on conflict (chave, n_item) do update set ncm = excluded.ncm, cest = excluded.cest, cfop = excluded.cfop, orig = excluded.orig, cst_icms = excluded.cst_icms,
      csosn = excluded.csosn, v_prod = excluded.v_prod, v_desc = excluded.v_desc, v_bc = excluded.v_bc, p_icms = excluded.p_icms, v_icms = excluded.v_icms,
      p_red_bc = excluded.p_red_bc, v_bc_st = excluded.v_bc_st, v_st = excluded.v_st, v_ipi = excluded.v_ipi, pis_cst = excluded.pis_cst, v_pis = excluded.v_pis,
      cofins_cst = excluded.cofins_cst, v_cofins = excluded.v_cofins, ibscbs_cst = excluded.ibscbs_cst, cclasstrib = excluded.cclasstrib,
      v_bc_ibscbs = excluded.v_bc_ibscbs, v_cbs = excluded.v_cbs, v_ibs = excluded.v_ibs;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.notas_fiscal_ler(text) from public, anon, authenticated;

-- A cada nota completa que chega (ou que passa de resumo para completa), lê os campos fiscais
create or replace function public.notas_fiscal_gatilho()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.completa and new.xml is not null and (tg_op = 'INSERT' or old.xml is distinct from new.xml or not old.completa) then
    begin
      perform public.notas_fiscal_ler(new.chave);
    exception when others then null;  -- XML que não abre não trava a gravação da nota
    end;
  end if;
  return null;
end $$;
drop trigger if exists notas_fiscal_gatilho on public.notas;
create trigger notas_fiscal_gatilho after insert or update of xml, completa on public.notas
  for each row execute function public.notas_fiscal_gatilho();

-- Leitura inicial de todas as notas completas (feita em 22/11/2026: 1.647 notas, 9.356 itens):
-- do $$ declare c text; begin for c in select chave from public.notas n where completa and xml like '%<infNFe%'
--   and not exists (select 1 from public.notas_fiscal f where f.chave = n.chave) loop perform public.notas_fiscal_ler(c); end loop; end $$;

create or replace function public.nfe_conferencia(p_de date, p_ate date, p_empresa text default null)
returns jsonb language plpgsql stable set search_path = public as $$
declare r jsonb;
begin
  with n as (
    select n.chave, n.empresa_cnpj, n.emitente_cnpj, coalesce(n.emitente_nome, n.emitente_cnpj) fornecedor, n.emissao, n.valor, n.situacao, n.completa,
      ltrim(substr(n.chave, 26, 9), '0') numero, f.emit_uf, f.emit_crt, f.dest_cnpj, f.dest_uf, f.v_prod, f.v_desc, f.v_frete, f.v_seg, f.v_outro,
      f.v_ipi, f.v_st, f.v_nf, f.v_demais, f.v_deson
    from public.notas n left join public.notas_fiscal f on f.chave = n.chave
    where n.origem = 'sefaz' and (n.emissao at time zone 'America/Fortaleza')::date between p_de and p_ate
      and (p_empresa is null or n.empresa_cnpj = p_empresa)
  ),
  it as (
    select n.chave, n.empresa_cnpj, n.emitente_cnpj, n.fornecedor, n.emissao, n.numero, n.emit_uf, n.dest_uf, n.emit_crt,
      fi.n_item, fi.ncm, fi.cfop, fi.cst_icms, fi.csosn, fi.v_prod, fi.v_bc, fi.p_icms, fi.v_icms, fi.v_st, fi.ibscbs_cst, fi.v_cbs, fi.v_ibs, fi.v_bc_ibscbs,
      ni.descricao
    from n join public.notas_itens_fiscal fi on fi.chave = n.chave left join public.notas_itens ni on ni.chave = fi.chave and ni.n_item = fi.n_item
    where n.situacao = 'autorizada'
  ),
  st as (
    select it.*, (cst_icms in ('10', '30', '60', '70') or csosn in ('201', '202', '203', '500')) com_st from it where ncm ~ '^[0-9]{8}$'
  ),
  ncm_misto as (select ncm from st group by ncm having bool_or(com_st) and bool_or(not com_st)),
  achados as (
    select 'total_nota' regra, 'erro' sev, empresa_cnpj, chave, numero, fornecedor, emissao, null::text item, 'Total da nota' campo,
      'itens + frete + seguro + outras + IPI + ST + FCP − desconto = ' || to_char(coalesce(v_prod, 0) - coalesce(v_desc, 0) + coalesce(v_frete, 0) + coalesce(v_seg, 0)
        + coalesce(v_outro, 0) + coalesce(v_ipi, 0) + coalesce(v_st, 0) + coalesce(v_demais, 0), 'FM999G999G990D00') atual,
      'total da nota ' || to_char(v_nf, 'FM999G999G990D00') esperado, 1::bigint itens, v_nf valor,
      round(abs(coalesce(v_prod, 0) - coalesce(v_desc, 0) + coalesce(v_frete, 0) + coalesce(v_seg, 0) + coalesce(v_outro, 0) + coalesce(v_ipi, 0) + coalesce(v_st, 0) + coalesce(v_demais, 0) - v_nf), 2) impacto
    from n where situacao = 'autorizada' and v_nf is not null
      and abs(coalesce(v_prod, 0) - coalesce(v_desc, 0) + coalesce(v_frete, 0) + coalesce(v_seg, 0) + coalesce(v_outro, 0) + coalesce(v_ipi, 0) + coalesce(v_st, 0) + coalesce(v_demais, 0) - v_nf) > 0.05
      and abs(coalesce(v_prod, 0) - coalesce(v_desc, 0) + coalesce(v_frete, 0) + coalesce(v_seg, 0) + coalesce(v_outro, 0) + coalesce(v_ipi, 0) + coalesce(v_st, 0) + coalesce(v_demais, 0) - coalesce(v_deson, 0) - v_nf) > 0.05
    union all
    select 'cfop_uf', 'erro', empresa_cnpj, chave, numero, fornecedor, emissao, min(descricao), 'CFOP',
      string_agg(distinct cfop, ', ') || ' · fornecedor ' || coalesce(emit_uf, '?') || ' → ' || coalesce(dest_uf, '?'),
      case when emit_uf = dest_uf then 'CFOP 5xxx (dentro do estado)' else 'CFOP 6xxx (outro estado)' end, count(*), sum(v_prod), null
    from it where emit_uf is not null and dest_uf is not null and emit_uf <> 'EX'
      and ((emit_uf = dest_uf and cfop like '6%') or (emit_uf <> dest_uf and cfop like '5%'))
    group by empresa_cnpj, chave, numero, fornecedor, emissao, emit_uf, dest_uf
    union all
    select 'cfop_especial', 'atencao', empresa_cnpj, chave, numero, fornecedor, emissao, min(descricao), 'CFOP', string_agg(distinct cfop, ', '),
      'compra comum (5101/5102/5403/5405/6102/6403…): conferir se é bonificação, remessa, transferência ou devolução', count(*), sum(v_prod), null
    from it where cfop in ('5910', '6910', '5911', '6911', '5949', '6949', '5915', '6915', '5916', '6916', '5151', '6151', '5152', '6152', '5409', '6409',
      '5201', '6201', '5202', '6202', '5411', '6411', '5920', '6920', '5921', '6921', '5905', '6905', '5908', '6908', '5909', '6909')
    group by empresa_cnpj, chave, numero, fornecedor, emissao
    union all
    select 'ncm_invalido', 'erro', empresa_cnpj, chave, numero, fornecedor, emissao, min(descricao), 'NCM', coalesce(min(ncm), 'vazio'),
      'NCM de 8 dígitos do produto', count(*), sum(v_prod), null
    from it where ncm is null or ncm !~ '^[0-9]{8}$' or ncm = '00000000'
    group by empresa_cnpj, chave, numero, fornecedor, emissao
    union all
    select 'icms_conta', 'atencao', empresa_cnpj, chave, numero, fornecedor, emissao, min(descricao), 'ICMS do item',
      count(*) || ' itens com base × alíquota diferente do ICMS', 'base × alíquota = ICMS destacado', count(*), sum(v_prod),
      round(sum(abs(coalesce(v_bc, 0) * coalesce(p_icms, 0) / 100 - coalesce(v_icms, 0))), 2)
    from it where p_icms is not null and abs(coalesce(v_bc, 0) * coalesce(p_icms, 0) / 100 - coalesce(v_icms, 0)) > 0.05
    group by empresa_cnpj, chave, numero, fornecedor, emissao
    union all
    select 'st_misturado', 'atencao', empresa_cnpj, null, null, fornecedor, max(emissao), min(descricao), 'Substituição tributária',
      'NCM ' || ncm || (case when bool_or(com_st) then ' com ST' else ' sem ST' end) || ' deste fornecedor',
      'o mesmo NCM veio ' || (case when bool_or(com_st) then 'sem' else 'com' end) || ' ST de outro fornecedor: conferir se cabe ST/antecipação',
      count(*), sum(v_prod), null
    from st where ncm in (select ncm from ncm_misto)
    group by empresa_cnpj, fornecedor, ncm
    union all
    select 'ibscbs_ausente', 'atencao', empresa_cnpj, null, null, fornecedor, max(emissao), min(descricao), 'IBS/CBS',
      count(*) || ' itens sem o grupo IBS/CBS (fornecedor do regime normal)', 'IBS/CBS destacado (o crédito de CBS a partir de 2027 depende dele)',
      count(*), sum(v_prod), null
    from it where emit_crt = '3' and ibscbs_cst is null
    group by empresa_cnpj, fornecedor
    union all
    select 'duplicada', 'atencao', a.empresa_cnpj, a.chave, a.numero, a.fornecedor, a.emissao, null, 'Possível duplicidade',
      'nota ' || a.numero || ' de ' || to_char(a.emissao at time zone 'America/Fortaleza', 'DD/MM'),
      'mesmo valor na nota ' || b.numero || ' de ' || to_char(b.emissao at time zone 'America/Fortaleza', 'DD/MM') || ': conferir se não foi cobrado duas vezes',
      1, a.valor, a.valor
    from n a join n b on b.empresa_cnpj = a.empresa_cnpj and b.emitente_cnpj = a.emitente_cnpj and b.valor = a.valor and b.chave > a.chave
      and abs(extract(epoch from (b.emissao - a.emissao))) <= 3 * 86400
    where a.situacao = 'autorizada' and b.situacao = 'autorizada' and a.valor > 0
    union all
    select 'destinatario', 'atencao', empresa_cnpj, chave, numero, fornecedor, emissao, null, 'Destinatário',
      'nota emitida para o CNPJ ' || dest_cnpj, 'CNPJ da empresa que recebeu (' || empresa_cnpj || ')', 1, v_nf, null
    from n where dest_cnpj is not null and dest_cnpj <> empresa_cnpj and situacao = 'autorizada'
    union all
    select 'so_resumo', 'atencao', empresa_cnpj, chave, numero, fornecedor, emissao, null, 'Nota completa',
      'só o resumo chegou da SEFAZ', 'XML completo (peça ao fornecedor): sem os itens, a nota não é conferida', 1, valor, null
    from n where not completa and situacao = 'autorizada' and emissao < now() - interval '10 days'
    union all
    select 'cancelada', 'atencao', empresa_cnpj, chave, numero, fornecedor, emissao, null, 'Situação',
      'cancelada pelo fornecedor', 'confirmar que não foi paga (ou que o boleto também foi cancelado)', 1, valor, null
    from n where situacao = 'cancelada'
  )
  select jsonb_build_object(
    'de', p_de, 'ate', p_ate,
    'notas', (select count(*) from n where situacao = 'autorizada'),
    'completas', (select count(*) from n where situacao = 'autorizada' and v_nf is not null),
    'valor', (select coalesce(sum(valor), 0) from n where situacao = 'autorizada'),
    'itens', (select count(*) from it),
    'icms', (select coalesce(sum(v_icms), 0) from it),
    'st', (select coalesce(sum(v_st), 0) from it),
    'cbs_ibs', (select coalesce(sum(coalesce(v_cbs, 0) + coalesce(v_ibs, 0)), 0) from it),
    'base_ibscbs', (select coalesce(sum(v_bc_ibscbs), 0) from it),
    'achados', coalesce((select jsonb_agg(to_jsonb(a) order by (a.sev = 'erro') desc, a.impacto desc nulls last, a.valor desc nulls last) from achados a), '[]')
  ) into r;
  return r;
end $$;
revoke execute on function public.nfe_conferencia(date, date, text) from public, anon;
grant execute on function public.nfe_conferencia(date, date, text) to authenticated;
