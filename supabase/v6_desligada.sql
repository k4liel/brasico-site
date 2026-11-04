-- V6 Empreendimentos (Cicchetti Midway) e as sócias dela (Brasico81, N&Bpar, Portokon) foram
-- DESLIGADAS do grupo em 31/10/2026, a pedido do dono: todas as conexões com essas empresas acabaram.
-- Ficam separadas, só como histórico: fora dos números, cartões e alertas da operação.
-- Nada é apagado. Aplicado em 04/11/2026.

-- 1) Cadastro fiscal: marca de desligamento
alter table public.fiscal_empresas add column if not exists desligada_em date;
alter table public.fiscal_empresas add column if not exists desligada_motivo text;
comment on column public.fiscal_empresas.desligada_em is 'Empresa desligada do grupo (sem vínculo): fica só como histórico, fora da operação.';

update public.fiscal_empresas set desligada_em = date '2026-10-31',
  desligada_motivo = 'Desligada com o encerramento do Cicchetti Midway: o grupo encerrou todas as conexões com a V6 e as sócias dela.'
where raiz in ('58076145', '57602760', '57178958', '53802704');

update public.fiscal_empresas set papel = 'Cicchetti Midway (Natal) · desligada do grupo em 31/10/2026',
  observacao = 'Empresa do Cicchetti Midway. Desligada do grupo em 31/10/2026, quando o Midway encerrou: não há mais vínculo. Dados guardados só como histórico.'
where raiz = '58076145';
update public.fiscal_empresas set papel = 'Ex-sócia da V6 · desligada do grupo em 31/10/2026',
  observacao = 'Era a sociedade de participação que investia na V6 (Cicchetti Midway). Desligada do grupo em 31/10/2026. Dados guardados só como histórico.'
where raiz = '57602760';
update public.fiscal_empresas set papel = 'Ex-sócia da V6 (coinvestidora) · desligada em 31/10/2026',
  observacao = 'Coinvestidora da V6 (Cicchetti Midway), fora do controle do grupo. Sem vínculo desde 31/10/2026. Dados guardados só como histórico.'
where raiz in ('57178958', '53802704');

-- LAIF: o risco do Simples passa a citar a V6 e a Brasico81 só no passado
update public.fiscal_empresas set observacao = 'Risco de exclusão do Simples (LC 123, art. 3º, §4º, IV e V): o sócio único tem 10% da Brasico77 e administra a Brasico1010, no Lucro Presumido. Até 31/10/2026 administrava também a Brasico81 e a V6 (Cicchetti Midway), hoje desligadas do grupo: esse período ainda conta na análise. Levar ao contador.'
where cnpj = '50639716000101';

-- 2) Mapa de acessos: a prefeitura de Natal era só da V6
alter table public.fiscal_fontes drop constraint if exists fiscal_fontes_situacao_check;
alter table public.fiscal_fontes add constraint fiscal_fontes_situacao_check
  check (situacao = any (array['temos', 'pronto', 'falta', 'manual', 'futuro', 'desligada']));
update public.fiscal_fontes set situacao = 'desligada',
  o_que_da = 'Era o ISS e a certidão da V6 (Cicchetti Midway). Desligada do grupo em 31/10/2026: não acompanhar.', falta = ''
where id = 'pm_natal';

-- 3) Acervo fiscal: tira V6 e sócias da estrutura do grupo (todos os idiomas) e cria um capítulo à parte
create or replace function pg_temp.sem_v6(t text) returns text language sql immutable as $f$
  select regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    coalesce(t, ''),
    '[^\n]*<tr><td>(58\.076\.145|57\.602\.760|57\.178\.958|53\.802\.704)/0001-\d\d</td>[^\n]*\n', '', 'g'),
    '[^\n]*<div class="of-node"><span class="of-code">[A-Z]+</span><b>(V6 Empreendimentos|Brasico81 [^<]*)</b>[^\n]*\n', '', 'g'),
    '[^\n]*<tr><td>(V6|Brasico81)</td>[^\n]*\n', '', 'g'),
    '[^\n]*<div class="of-alert"><span class="of-stamp" data-st="regra">Midway</span>[^\n]*\n', '', 'g'),
    '[^\n]*<div class="of-field"><small>V6 Empreendimentos[^\n]*\n', '', 'g'),
    '[^\n]*<tr><td><b>Cicchetti Midway</b>[^\n]*\n', '', 'g'),
    'Natal · Midway Mall · V6', 'Natal · Midway Mall · V6 (desligada em 31/10/2026, só histórico)', 'g'),
    '\(desligada em 31/10/2026, só histórico\) \(desligada em 31/10/2026, só histórico\)', '(desligada em 31/10/2026, só histórico)', 'g')
$f$;

update public.receita_acervo set
  conteudo = pg_temp.sem_v6(conteudo),
  conteudo_en = nullif(pg_temp.sem_v6(conteudo_en), ''), conteudo_pl = nullif(pg_temp.sem_v6(conteudo_pl), ''),
  conteudo_fr = nullif(pg_temp.sem_v6(conteudo_fr), ''), conteudo_de = nullif(pg_temp.sem_v6(conteudo_de), '')
where substituido_por is null;

-- Textos em português que citavam a V6 e a Brasico81 como parte do grupo
update public.receita_acervo set conteudo = replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(conteudo,
  'administra Brasico81, Brasico1010 e V6, todas no Lucro Presumido. Só o Cicchetti Midway (V6) vendeu R$ 4,43 milhões em 12 meses na TOTVS.',
  'administra a Brasico1010, no Lucro Presumido. Até 31/10/2026 administrava também a Brasico81 e a V6 (Cicchetti Midway, R$ 4,43 milhões em 12 meses na TOTVS), hoje desligadas do grupo; esse período ainda conta na análise.'),
  'administra Brasico81, Brasico1010 e V6, todas no Lucro Presumido. A Lei Complementar 123',
  'administra a Brasico1010, no Lucro Presumido (até 31/10/2026 também a Brasico81 e a V6, hoje desligadas do grupo). A Lei Complementar 123'),
  'Só o Cicchetti Midway (V6) vendeu R$ 4,43 milhões em 12 meses. Levar ao contador com urgência.',
  'O Cicchetti Midway (V6) vendeu R$ 4,43 milhões nos 12 meses em que houve vínculo. Levar ao contador com urgência.'),
  'administra Brasico81, Brasico1010 e V6', 'administra a Brasico1010 (e, até 31/10/2026, a Brasico81 e a V6, hoje desligadas)'),
  'o mesmo que administra a Brasico81, a Brasico1010 e a V6.', 'o mesmo que administra a Brasico1010 (e administrava a Brasico81 e a V6 até o desligamento, em 31/10/2026).'),
  'sócia da FIF, do Hotel Filho do Vento, da Brasico81 e da Brasico1010', 'sócia da FIF, do Hotel Filho do Vento e da Brasico1010'),
  'Bresico64, FIF e Brasico81 estão no Lucro Presumido', 'Bresico64 e FIF estão no Lucro Presumido'),
  '13 raízes de CNPJ e 14 inscrições. Empresas e filiais já baixadas ficaram de fora.',
  '10 raízes de CNPJ e 11 inscrições. Empresas e filiais já baixadas ficaram de fora, e a V6 e as sócias dela, desligadas em 31/10/2026, estão no capítulo “Empresas desligadas”.'),
  '## As 14 inscrições ativas', '## As 11 inscrições ativas'),
  'O mapa completo das 14 inscrições ativas', 'O mapa completo das 11 inscrições ativas')
where substituido_por is null;
update public.receita_acervo set conteudo = regexp_replace(conteudo, '[^\n]*<li><s>Em que data a V6 deixa de operar o Midway\?</s>[^\n]*\n', '', 'g')
where substituido_por is null;
update public.receita_acervo set conteudo = replace(conteudo, 'info: Unidades | Tibau do Sul (Pipa) · Natal (Midway, encerrado em 31/10/2026)', 'info: Unidades | Tibau do Sul (Pipa) · Canguaretama (Filho do Vento)')
where substituido_por is null;

insert into public.receita_acervo (id, secao, ordem, titulo, conteudo, origem, copiado_em)
select gen_random_uuid(), 'empresas', 16, '01 · Empresas desligadas', $md$**01 · EMPRESAS DESLIGADAS**

# Empresas desligadas do grupo

*A V6 Empreendimentos, empresa do Cicchetti Midway, e as três sócias dela foram desligadas do grupo em 31/10/2026, quando o Midway encerrou todas as atividades no shopping. Não há mais vínculo nem conexão com essas empresas: elas ficam aqui só como histórico e não entram nos números, alertas nem rotinas do Brasico.*

:::html
<div class="of-alerts">
  <div class="of-alert"><span class="of-stamp" data-st="ref">Desligadas</span><b>Sem vínculo desde 31/10/2026</b><span>Nenhuma rotina do Brasico consulta essas empresas. As vendas do Cicchetti Midway (TOTVS, 23/07/2025 a 31/10/2026) e as notas de compra do Cicchetti Management ficam guardadas como arquivo, sem atualização.</span></div>
</div>
:::

## As quatro inscrições desligadas

:::html
<div class="of-wrap"><table class="of-table">
<thead><tr><th>CNPJ</th><th>Empresa</th><th>Papel até 31/10/2026</th><th>Município</th><th>Abertura</th><th class="num">Capital</th><th>Regime (ECF)</th></tr></thead>
<tbody>
<tr><td>58.076.145/0001-56</td><td><b>V6 Empreendimentos</b> · CICCHETTI MIDWAY</td><td>Operava o restaurante no Midway Mall</td><td>Natal</td><td>12/11/2024</td><td class="num">R$ 3.500.000</td><td>Lucro Presumido</td></tr>
<tr><td>57.602.760/0001-96</td><td><b>Brasico81 Participação e Investimento Societário</b></td><td>Sócia da V6</td><td>Natal</td><td>08/10/2024</td><td class="num">R$ 450.000</td><td>Lucro Presumido</td></tr>
<tr><td>57.178.958/0001-94</td><td><b>N&amp;Bpar Investimentos</b></td><td>Sócia da V6 (coinvestidora)</td><td>Natal</td><td>06/09/2024</td><td class="num">R$ 700.000</td><td>Lucro Presumido</td></tr>
<tr><td>53.802.704/0001-44</td><td><b>Portokon Empreendimentos Imobiliários</b></td><td>Sócia da V6 (coinvestidora)</td><td>Natal</td><td>05/02/2024</td><td class="num">R$ 9.175.270</td><td>Lucro Presumido</td></tr>
</tbody></table></div>
<p class="of-src">Dados do cadastro oficial da Receita (BrasilAPI, 26/10/2026), guardados como estavam no desligamento.</p>
:::

## O que ainda importa para o grupo

:::html
<div class="of-alerts">
  <div class="of-alert urg"><span class="of-stamp" data-st="urg">Simples</span><b>O período com a V6 ainda conta na análise da LAIF</b><span>Até 31/10/2026 o sócio da LAIF administrava a Brasico81 e a V6, no Lucro Presumido, e o Cicchetti Midway vendeu R$ 4,43 milhões em 12 meses. Para a regra da LC 123 (art. 3º, §4º, IV e V), esse período continua valendo. Levar ao contador.</span></div>
  <div class="of-alert"><span class="of-stamp" data-st="regra">Cadastro</span><b>Conferir a saída nos contratos</b><span>No cadastro de 26/10/2026 a Bresico64 ainda aparecia como sócia da Brasico81. Confirmar com o contador que a saída do grupo foi registrada na Junta Comercial.</span></div>
</div>
:::$md$, 'Brasico', now()
where not exists (select 1 from public.receita_acervo where titulo = '01 · Empresas desligadas' and substituido_por is null);
