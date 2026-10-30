-- =====================================================================
-- Fiscal do grupo (30/10/2026): todas as inscrições do grupo e o que a Receita respondeu
-- - fiscal_empresas: as 14 inscrições ativas do mapa societário (CNPJ, apelido, papel, grupo, observação),
--   com o cadastro público da Receita (BrasilAPI, grátis) atualizado por fiscal_cadastro_atualizar()
--   (agenda fiscal-cadastro-mensal, dia 2 às 6h de Brasília). Não guarda nome, e-mail nem telefone de ninguém.
--   A lista de CNPJs e as observações foram cadastradas direto no banco (não vão para o GitHub).
-- - receita_respostas: a última resposta de cada serviço do lote (tipo 'servico' em receita_execucoes),
--   sem os PDFs; receita_resposta_pdf devolve o PDF (recibo da DCTFWeb) sob pedido.
-- =====================================================================

create table if not exists public.fiscal_empresas (
  cnpj text primary key,
  raiz text generated always as (left(cnpj, 8)) stored,
  ordem int not null default 0,
  apelido text not null,
  papel text not null default '',
  grupo text not null default 'operacao' check (grupo in ('operacao', 'holding', 'marca', 'social', 'parceira', 'terceiro')),
  unidades text not null default '',
  observacao text not null default '',
  razao text, fantasia text, situacao text, data_situacao date, municipio text, uf text,
  cnae text, natureza text, porte text, capital numeric, abertura date,
  simples boolean, simples_desde date, simples_exclusao date, regime text, regime_ano int,
  socios int, socios_exterior int,
  dados jsonb,
  atualizado_em timestamptz,
  erro text
);
alter table public.fiscal_empresas enable row level security;
drop policy if exists "ver fiscal empresas" on public.fiscal_empresas;
create policy "ver fiscal empresas" on public.fiscal_empresas for select using (public.receita_pode_ver(auth.uid()));

create or replace function public.fiscal_cadastro_atualizar(p_cnpj text default null)
returns int language plpgsql security definer set search_path = public, extensions as $$
declare
  f record; r record; j jsonb; v_reg jsonb; n int := 0;
begin
  for f in select cnpj from public.fiscal_empresas where p_cnpj is null or cnpj = p_cnpj order by ordem loop
    begin
      select * into r from extensions.http_get('https://brasilapi.com.br/api/cnpj/v1/' || f.cnpj);
      if r.status <> 200 then
        update public.fiscal_empresas set erro = 'HTTP ' || r.status where cnpj = f.cnpj;
        continue;
      end if;
      j := r.content::jsonb;
      select x into v_reg from jsonb_array_elements(coalesce(j->'regime_tributario', '[]')) x
        order by (x->>'ano')::int desc limit 1;
      update public.fiscal_empresas set
        razao = j->>'razao_social', fantasia = nullif(j->>'nome_fantasia', ''),
        situacao = coalesce(j->>'descricao_situacao_cadastral', case j->>'situacao_cadastral' when '2' then 'ATIVA' when '8' then 'BAIXADA' when '4' then 'INAPTA' when '3' then 'SUSPENSA' else j->>'situacao_cadastral' end),
        data_situacao = nullif(j->>'data_situacao_cadastral', '')::date,
        municipio = j->>'municipio', uf = j->>'uf',
        cnae = (j->>'cnae_fiscal') || ' ' || coalesce(j->>'cnae_fiscal_descricao', ''),
        natureza = j->>'natureza_juridica', porte = j->>'porte',
        capital = nullif(j->>'capital_social', '')::numeric, abertura = nullif(j->>'data_inicio_atividade', '')::date,
        simples = (j->>'opcao_pelo_simples')::boolean, simples_desde = nullif(j->>'data_opcao_pelo_simples', '')::date,
        simples_exclusao = nullif(j->>'data_exclusao_do_simples', '')::date,
        regime = v_reg->>'forma_de_tributacao', regime_ano = nullif(v_reg->>'ano', '')::int,
        socios = jsonb_array_length(coalesce(j->'qsa', '[]')),
        socios_exterior = (select count(*) from jsonb_array_elements(coalesce(j->'qsa', '[]')) q where q->>'pais' is not null and q->>'pais' <> 'BRASIL'),
        -- guarda o cadastro sem pessoas e sem contatos
        dados = (j - 'qsa' - 'email' - 'ddd_telefone_1' - 'ddd_telefone_2' - 'ddd_fax')
          || jsonb_build_object('qualificacoes', (select coalesce(jsonb_agg(q->>'qualificacao_socio'), '[]') from jsonb_array_elements(coalesce(j->'qsa', '[]')) q)),
        atualizado_em = now(), erro = null
      where cnpj = f.cnpj;
      n := n + 1;
    exception when others then
      update public.fiscal_empresas set erro = left(sqlerrm, 300) where cnpj = f.cnpj;
    end;
  end loop;
  return n;
end $$;
revoke execute on function public.fiscal_cadastro_atualizar(text) from public, anon, authenticated;
select cron.schedule('fiscal-cadastro-mensal', '0 9 2 * *', $job$ select public.fiscal_cadastro_atualizar() $job$);

-- Última resposta de cada serviço do lote, sem PDF
create or replace view public.receita_respostas with (security_invoker = true) as
select distinct on (x.empresa_id, r.v->>'servico', coalesce(r.v->>'dados_pedido', ''))
  x.empresa_id, r.v->>'servico' as servico, r.v->'dados_pedido' as pedido,
  (r.v->'dados') - 'PDFByteArrayBase64' - 'XMLStringBase64' as dados,
  coalesce(r.v->'dados' ? 'PDFByteArrayBase64', false) as tem_pdf,
  x.id as execucao_id, r.i as indice, x.created_at
from public.receita_execucoes x
cross join lateral jsonb_array_elements(x.resultado->'respostas') with ordinality as r(v, i)
where x.tipo = 'servico' and x.ambiente = 'producao' and (r.v->>'ok')::boolean
order by x.empresa_id, r.v->>'servico', coalesce(r.v->>'dados_pedido', ''), x.created_at desc;

create or replace function public.receita_resposta_pdf(p_execucao uuid, p_indice int)
returns text language sql stable security invoker set search_path = public as $$
  select x.resultado->'respostas'->(p_indice - 1)->'dados'->>'PDFByteArrayBase64'
  from public.receita_execucoes x where x.id = p_execucao
$$;
grant execute on function public.receita_resposta_pdf(uuid, int) to authenticated;

-- receita_pedir aceita também 'servico' (lote de leituras; ver LIBERADOS em lib/receita/servicos.ts).
-- A rotina refaz a situação fiscal quando a última que deu certo não tem o texto lido (resultado ? 'texto').

-- Dívidas do grupo (painel central da /receita, components/PainelDividas.tsx). Os lançamentos do levantamento de
-- 20/10/2026 (Receita da Brasico77, prefeitura de Tibau do Sul, FGTS) foram cadastrados direto no banco: não vão para o GitHub.
-- Na tela, o relatório de situação fiscal de hoje de cada empresa substitui o levantamento da Receita e da PGFN daquela empresa.
create table if not exists public.fiscal_dividas (
  id bigserial primary key,
  cnpj text not null references public.fiscal_empresas(cnpj),
  orgao text not null check (orgao in ('Receita Federal', 'PGFN', 'Prefeitura', 'FGTS')),
  categoria text not null,
  detalhe text not null default '',
  competencia text,
  vencimento date,
  principal numeric, multa numeric, juros numeric, total numeric,
  situacao text not null check (situacao in ('vencido', 'a_vencer', 'parcela_atraso', 'parcelado')),
  sensivel boolean not null default false,      -- dinheiro de terceiros: INSS descontado, IRRF, CSRF, FGTS
  fonte text not null,
  data_base date not null,
  origem text not null default 'levantamento',
  criado_em timestamptz not null default now(),
  arquivado_em timestamptz                      -- nada se apaga: pago ou corrigido = arquivado
);
alter table public.fiscal_dividas enable row level security;
drop policy if exists "ver dividas" on public.fiscal_dividas;
create policy "ver dividas" on public.fiscal_dividas for select using (public.receita_pode_ver(auth.uid()));
create index if not exists fiscal_dividas_cnpj on public.fiscal_dividas (cnpj) where arquivado_em is null;
