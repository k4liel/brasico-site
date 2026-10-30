-- =====================================================================
-- Receita Federal: mapa fiscal, catálogo do SERPRO e rotina econômica (30/10/2026)
-- Depois de receita.sql, receita_custos.sql e receita_acervo.sql.
--  1) receita_servicos: todo o catálogo do Integra Contador que vale para o grupo, com o que já usamos,
--     o que o contrato já cobre e só falta programar, e o que o Brasico não faz (declarar é do contador).
--  2) fiscal_fontes: o mapa de acessos de toda a área fiscal (Receita, trabalhista, notas, estado,
--     prefeituras, certidões, bancos): o que temos, o que falta e onde conseguir.
--  3) receita_eventos + tipo 'eventos': "Eventos de atualização" do SERPRO (Monitorar, grátis), que dizem
--     o dia em que mudou algo na DCTFWeb, na Caixa Postal e nos pagamentos de cada empresa.
--  4) receita_rotinas + receita_rotina_passo (pg_cron): uma passada a cada 15 min das 7h às 9h45 de
--     Fortaleza; cada empresa faz no máximo um passo por vez e só gasta quando há novidade.
-- Fontes do catálogo: catálogo de serviços do Integra Contador (SERPRO) e o código aberto que o implementa;
-- `conferido` = já chamado em produção pelo Brasico com sucesso.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Catálogo do Integra Contador
-- ---------------------------------------------------------------------
create table if not exists public.receita_servicos (
  id_sistema text not null,
  id_servico text not null,
  endpoint text not null,            -- Consultar, Emitir, Declarar, Monitorar, Apoiar
  grupo text not null,               -- como aparece na página
  nome text not null,
  para_que text not null default '',
  aplica text not null default 'Todas',
  situacao text not null check (situacao in ('em_uso', 'pronto', 'nao_usar', 'nao_se_aplica')),
  rotina text not null default '',
  conferido boolean not null default false,
  ordem int not null default 0,
  primary key (id_sistema, id_servico)
);
alter table public.receita_servicos enable row level security;
drop policy if exists "ver servicos" on public.receita_servicos;
create policy "ver servicos" on public.receita_servicos for select using (public.receita_pode_ver(auth.uid()));

insert into public.receita_servicos (id_sistema, id_servico, endpoint, grupo, nome, para_que, aplica, situacao, rotina, conferido, ordem) values
('CAIXAPOSTAL','INNOVAMSG63','Monitorar','Caixa postal','Tem mensagem nova?','Indicador de mensagem nova na caixa postal do e-CAC.','Todas','em_uso','Todo dia, de manhã',true,10),
('CAIXAPOSTAL','MSGCONTRIBUINTE61','Consultar','Caixa postal','Lista de mensagens','Assunto, data de envio, relevância e data da ciência de cada mensagem.','Todas','em_uso','Só quando há mensagem nova',true,11),
('CAIXAPOSTAL','MSGDETALHAMENTO62','Consultar','Caixa postal','Texto da mensagem','O texto completo de uma mensagem (uma consulta por mensagem).','Todas','em_uso','Só das mensagens novas, até 5 por vez',true,12),
('DTE','CONSULTASITUACAODTE111','Consultar','Caixa postal','Adesão ao DTE','Se a empresa aderiu ao Domicílio Tributário Eletrônico (com DTE, a mensagem vale como intimação).','Todas','pronto','Uma vez, e de novo se mudar',false,13),
('EVENTOSATUALIZACAO','SOLICEVENTOSPJ132','Monitorar','Eventos de atualização','Pedir eventos','Pede à Receita o último dia em que mudou a DCTFWeb (E0301), a caixa postal (E0601) e os pagamentos (E0701).','Todas','em_uso','Todo dia, de manhã',true,20),
('EVENTOSATUALIZACAO','OBTEREVENTOSPJ134','Monitorar','Eventos de atualização','Ler eventos','Lê a resposta do pedido acima pelo protocolo.','Todas','em_uso','Todo dia, logo depois do pedido',true,21),
('SITFIS','SOLICITARPROTOCOLO91','Apoiar','Situação fiscal','Pedir o relatório','Pede à Receita o relatório de situação fiscal (grátis).','Todas','em_uso','Uma vez por semana',true,30),
('SITFIS','RELATORIOSITFIS92','Emitir','Situação fiscal','Relatório de situação fiscal','O PDF de pendências do e-CAC: débitos, declarações faltando, parcelamentos e dívida ativa (PGFN). Mostra se a certidão sairia negativa.','Todas','em_uso','Uma vez por semana',true,31),
('PAGTOWEB','PAGAMENTOS71','Consultar','Pagamentos','Pagamentos','DARF e DAS pagos, por data de arrecadação (até 100 por consulta).','Todas','em_uso','Só quando o evento de pagamentos muda',false,40),
('PAGTOWEB','CONTACONSDOCARRPG73','Consultar','Pagamentos','Quantos pagamentos há','Conta os documentos de arrecadação de um período.','Todas','pronto','Sob pedido',false,41),
('PAGTOWEB','COMPARRECADACAO72','Emitir','Pagamentos','Comprovante de arrecadação','O PDF do comprovante de um pagamento.','Todas','pronto','Sob pedido',false,42),
('SICALC','CONSULTAAPOIORECEITAS52','Apoiar','Guias (DARF)','Códigos de receita','Apoio: lista os códigos de receita aceitos pelo Sicalc (grátis).','Todas','pronto','Sob pedido',false,50),
('SICALC','CONSOLIDARGERARDARF51','Emitir','Guias (DARF)','DARF em PDF','Calcula multa e juros e emite o DARF em PDF.','Todas','pronto','Sob pedido',false,51),
('SICALC','GERARDARFCODBARRA53','Emitir','Guias (DARF)','DARF em código de barras','Mesmo cálculo, devolvendo só o código de barras.','Todas','pronto','Sob pedido',false,52),
('DCTFWEB','CONSRECIBO32','Consultar','DCTFWeb (INSS e retenções)','Recibo da declaração','Recibo da DCTFWeb de um mês: mostra se o contador entregou.','Brasico77, LAIF, Genesis','pronto','Quando o evento da DCTFWeb muda',false,60),
('DCTFWEB','CONSDECCOMPLETA33','Consultar','DCTFWeb (INSS e retenções)','Declaração completa','Débitos e créditos declarados no mês (INSS da folha e retenções).','Brasico77, LAIF, Genesis','pronto','Quando o evento da DCTFWeb muda',false,61),
('DCTFWEB','CONSXMLDECLARACAO38','Consultar','DCTFWeb (INSS e retenções)','XML da declaração','O arquivo oficial da declaração, para guardar.','Brasico77, LAIF, Genesis','pronto','Sob pedido',false,62),
('DCTFWEB','GERARGUIA31','Emitir','DCTFWeb (INSS e retenções)','Guia (DARF) da declaração','A guia de pagamento da DCTFWeb do mês.','Brasico77, LAIF, Genesis','pronto','Sob pedido',false,63),
('DCTFWEB','GERARGUIAANDAMENTO313','Emitir','DCTFWeb (INSS e retenções)','Guia da declaração em andamento','A guia de uma declaração ainda não transmitida.','Brasico77, LAIF, Genesis','pronto','Sob pedido',false,64),
('DCTFWEB','TRANSDECLARACAO310','Declarar','DCTFWeb (INSS e retenções)','Transmitir a declaração','Entrega a DCTFWeb. Quem declara é o contador.','Brasico77, LAIF, Genesis','nao_usar','Não usar',false,65),
('MIT','LISTAAPURACOES317','Consultar','MIT (IRPJ, CSLL, PIS, COFINS)','Apurações do ano ou mês','O MIT substitui a antiga DCTF desde jan/2025: lista o que foi apurado.','Brasico77 (Lucro Presumido)','pronto','Uma vez por mês',false,70),
('MIT','CONSAPURACAO316','Consultar','MIT (IRPJ, CSLL, PIS, COFINS)','Apuração do mês','Os débitos de IRPJ, CSLL, PIS e COFINS declarados num mês.','Brasico77 (Lucro Presumido)','pronto','Quando a lista mostra apuração nova',false,71),
('MIT','SITUACAOENC315','Apoiar','MIT (IRPJ, CSLL, PIS, COFINS)','Situação do encerramento','Se a apuração foi encerrada (grátis).','Brasico77 (Lucro Presumido)','pronto','Sob pedido',false,72),
('MIT','ENCAPURACAO314','Declarar','MIT (IRPJ, CSLL, PIS, COFINS)','Encerrar apuração','Encerra a apuração. Quem declara é o contador.','Brasico77 (Lucro Presumido)','nao_usar','Não usar',false,73),
('PGDASD','CONSDECLARACAO13','Consultar','Simples Nacional (PGDAS-D)','Declarações transmitidas','Lista as declarações mensais do Simples de um ano.','LAIF (Simples)','pronto','Uma vez por mês, depois do dia 20',false,80),
('PGDASD','CONSULTIMADECREC14','Consultar','Simples Nacional (PGDAS-D)','Última declaração e recibo','A declaração mais recente de um mês, em PDF.','LAIF (Simples)','pronto','Sob pedido',false,81),
('PGDASD','CONSDECREC15','Consultar','Simples Nacional (PGDAS-D)','Declaração de um número','Uma declaração específica e o recibo.','LAIF (Simples)','pronto','Sob pedido',false,82),
('PGDASD','CONSEXTRATO16','Consultar','Simples Nacional (PGDAS-D)','Extrato do DAS','Receita declarada, alíquota e valor de cada tributo dentro do DAS.','LAIF (Simples)','pronto','Uma vez por mês',false,83),
('PGDASD','GERARDAS12','Emitir','Simples Nacional (PGDAS-D)','Gerar DAS','A guia do mês, a partir da declaração transmitida.','LAIF (Simples)','pronto','Sob pedido',false,84),
('PGDASD','GERARDASCOBRANCA17','Emitir','Simples Nacional (PGDAS-D)','DAS de cobrança','DAS de um período que está em cobrança na Receita.','LAIF (Simples)','pronto','Sob pedido',false,85),
('PGDASD','GERARDASPROCESSO18','Emitir','Simples Nacional (PGDAS-D)','DAS de processo','DAS de um processo de cobrança.','LAIF (Simples)','pronto','Sob pedido',false,86),
('PGDASD','GERARDASAVULSO19','Emitir','Simples Nacional (PGDAS-D)','DAS avulso','DAS avulso de um período já declarado.','LAIF (Simples)','pronto','Sob pedido',false,87),
('PGDASD','TRANSDECLARACAO11','Declarar','Simples Nacional (PGDAS-D)','Transmitir a declaração','Entrega o PGDAS-D. Quem declara é o contador.','LAIF (Simples)','nao_usar','Não usar',false,88),
('DEFIS','CONSDECLARACAO142','Consultar','Simples Nacional (DEFIS anual)','Declarações DEFIS entregues','Lista das DEFIS transmitidas.','LAIF (Simples)','pronto','Uma vez por ano, em abril',false,90),
('DEFIS','CONSULTIMADECREC143','Consultar','Simples Nacional (DEFIS anual)','Última DEFIS e recibo','O PDF da última DEFIS de um ano.','LAIF (Simples)','pronto','Sob pedido',false,91),
('DEFIS','CONSDECREC144','Consultar','Simples Nacional (DEFIS anual)','DEFIS de um número','Uma DEFIS específica e o recibo.','LAIF (Simples)','pronto','Sob pedido',false,92),
('DEFIS','TRANSDECLARACAO141','Declarar','Simples Nacional (DEFIS anual)','Transmitir a DEFIS','Quem declara é o contador.','LAIF (Simples)','nao_usar','Não usar',false,93),
('REGIMEAPURACAO','CONSULTAROPCAOREGIME103','Consultar','Simples Nacional (regime de apuração)','Regime do ano','Se o Simples apura por caixa ou por competência no ano.','LAIF (Simples)','pronto','Uma vez por ano, em janeiro',false,95),
('REGIMEAPURACAO','CONSULTARANOSCALENDARIOS102','Consultar','Simples Nacional (regime de apuração)','Todas as opções','As opções de regime de todos os anos.','LAIF (Simples)','pronto','Sob pedido',false,96),
('REGIMEAPURACAO','CONSULTARRESOLUCAO104','Consultar','Simples Nacional (regime de apuração)','Resolução do regime de caixa','O documento da opção pelo regime de caixa.','LAIF (Simples)','pronto','Sob pedido',false,97),
('REGIMEAPURACAO','EFETUAROPCAOREGIME101','Declarar','Simples Nacional (regime de apuração)','Fazer a opção','Quem faz a opção é o contador.','LAIF (Simples)','nao_usar','Não usar',false,98),
('PARCSN','PEDIDOSPARC163','Consultar','Parcelamentos do Simples','Pedidos de parcelamento (PARCSN)','Os parcelamentos do Simples pedidos pela empresa e a situação de cada um.','LAIF (Simples)','pronto','Uma vez por semana enquanto houver atraso',false,100),
('PARCSN','OBTERPARC164','Consultar','Parcelamentos do Simples','Detalhe do parcelamento','Valor consolidado, parcelas pagas e em atraso.','LAIF (Simples)','pronto','Junto com o de cima',false,101),
('PARCSN','PARCELASPARAGERAR162','Consultar','Parcelamentos do Simples','Parcelas que podem ser emitidas','Quais parcelas já têm DAS disponível.','LAIF (Simples)','pronto','Sob pedido',false,102),
('PARCSN','DETPAGTOPARC165','Consultar','Parcelamentos do Simples','Pagamentos de uma parcela','Quando e quanto foi pago de uma parcela.','LAIF (Simples)','pronto','Sob pedido',false,103),
('PARCSN','GERARDAS161','Emitir','Parcelamentos do Simples','DAS da parcela','A guia de uma parcela do parcelamento.','LAIF (Simples)','pronto','Sob pedido',false,104),
('PARCSN-ESP','PEDIDOSPARC173','Consultar','Parcelamentos do Simples','Parcelamento especial (PARCSN-ESP)','Mesmos serviços do PARCSN, para o parcelamento especial (códigos 171 a 175).','LAIF (Simples)','pronto','Só se houver pedido',false,105),
('PERTSN','PEDIDOSPARC183','Consultar','Parcelamentos do Simples','Pert do Simples (PERTSN)','Mesmos serviços, para o Pert-SN (códigos 181 a 185).','LAIF (Simples)','pronto','Só se houver pedido',false,106),
('RELPSN','PEDIDOSPARC193','Consultar','Parcelamentos do Simples','Relp do Simples (RELPSN)','Mesmos serviços, para o Relp (códigos 191 a 195).','Brasico77, LAIF','pronto','Só se houver pedido',false,107),
('PROCURACOES','OBTERPROCURACAO41','Consultar','Procurações','Procurações eletrônicas','Quem tem procuração da empresa no e-CAC (o contador, por exemplo) e até quando.','Todas','pronto','Uma vez por trimestre',false,110),
('AUTENTICAPROCURADOR','ENVIOXMLASSINADO81','Apoiar','Procurações','Autenticar procurador','Só para quem consulta em nome de outra empresa. Cada empresa do grupo tem o próprio contrato.','—','nao_se_aplica','Não se aplica',false,111),
('PGMEI','*','—','MEI','PGMEI, CCMEI, DASN-SIMEI, PARCMEI, PERTMEI e RELPMEI','Serviços do microempreendedor individual.','Nenhuma empresa do grupo é MEI','nao_se_aplica','Não se aplica',false,120)
on conflict (id_sistema, id_servico) do update set endpoint = excluded.endpoint, grupo = excluded.grupo, nome = excluded.nome,
  para_que = excluded.para_que, aplica = excluded.aplica, situacao = excluded.situacao, rotina = excluded.rotina,
  conferido = public.receita_servicos.conferido or excluded.conferido, ordem = excluded.ordem;

-- ---------------------------------------------------------------------
-- 2) Mapa de acessos da área fiscal
-- ---------------------------------------------------------------------
create table if not exists public.fiscal_fontes (
  id text primary key,
  area text not null,
  nome text not null,
  o_que_da text not null default '',
  situacao text not null check (situacao in ('temos', 'pronto', 'falta', 'manual', 'futuro')),
  como text not null default '',        -- como o Brasico chega (ou chegaria) ao dado
  falta text not null default '',       -- o que falta fazer e onde conseguir
  custo text not null default '',
  prioridade text not null default 'média' check (prioridade in ('alta', 'média', 'baixa')),
  onde text not null default '',        -- link dentro do Brasico
  ordem int not null default 0,
  atualizado_em timestamptz not null default now()
);
alter table public.fiscal_fontes enable row level security;
drop policy if exists "ver fontes" on public.fiscal_fontes;
create policy "ver fontes" on public.fiscal_fontes for select using (public.receita_pode_ver(auth.uid()));

insert into public.fiscal_fontes (id, area, nome, o_que_da, situacao, como, falta, custo, prioridade, onde, ordem) values
('rf_caixa','Receita Federal','Caixa postal do e-CAC','Intimações, avisos de parcelamento, Cadin, malha e comunicados de cada empresa, com a data da ciência automática.','temos','SERPRO Integra Contador (contrato de cada empresa)','—','Aviso grátis; R$ 0,24 por lista ou texto','alta','/receita#caixa',10),
('rf_eventos','Receita Federal','Eventos de atualização','O dia em que mudou a caixa postal, os pagamentos e a DCTFWeb de cada empresa. Decide quando vale gastar uma consulta.','temos','SERPRO Integra Contador (Monitorar)','—','Grátis','alta','/receita#rotinas',11),
('rf_sitfis','Receita Federal','Situação fiscal (SITFIS)','Relatório oficial de pendências na Receita e na PGFN: débitos, declarações faltando, parcelamentos, prévia da certidão.','temos','SERPRO Integra Contador','Ler o PDF e transformar em lista de pendências (próxima etapa).','R$ 0,32 por relatório','alta','/receita#situacao',12),
('rf_pagamentos','Receita Federal','Pagamentos (DARF e DAS)','Cada imposto federal pago, com código, competência e valor.','temos','SERPRO Integra Contador','Comprovante em PDF (serviço 72) quando precisar.','R$ 0,24 por consulta','média','/receita#pagamentos',13),
('rf_dctfweb','Receita Federal','DCTFWeb','Se o contador entregou a declaração do mês (INSS da folha e retenções) e a guia gerada.','pronto','SERPRO Integra Contador (já coberto pelo contrato)','Programar a leitura do recibo e da declaração completa (serviços 32 e 33).','R$ 0,24 por consulta','alta','/receita#servicos',14),
('rf_mit','Receita Federal','MIT (antiga DCTF)','IRPJ, CSLL, PIS e COFINS apurados no mês pela Brasico77 (Lucro Presumido).','pronto','SERPRO Integra Contador','Programar a leitura das apurações (316 e 317).','R$ 0,24 por consulta','alta','/receita#servicos',15),
('rf_simples','Receita Federal','Simples Nacional (PGDAS-D, DAS, DEFIS)','Declarações mensais e anuais da LAIF, extrato do DAS e regime de apuração.','pronto','SERPRO Integra Contador','Programar a leitura mensal (13, 16) e anual (142, 103).','R$ 0,24 por consulta','alta','/receita#servicos',16),
('rf_parcsn','Receita Federal','Parcelamentos do Simples','Parcelas pagas e em atraso do PARCSN da LAIF.','pronto','SERPRO Integra Contador','Programar a leitura semanal enquanto houver atraso (163 e 164).','R$ 0,24 por consulta','alta','/receita#servicos',17),
('rf_parc_comum','Receita Federal','Parcelamentos comuns da Receita e da PGFN','Parcelamentos simplificados da Brasico77 e transações na dívida ativa.','falta','Sem serviço no Integra Contador para estes parcelamentos; a SITFIS mostra o resumo.','Acompanhar pela SITFIS. Detalhe: e-CAC (Receita) e Regularize (PGFN), pelo contador.','—','alta','/receita#dividas',18),
('rf_darf','Receita Federal','Emitir DARF com multa e juros','Guia atualizada de um débito federal.','pronto','SERPRO Integra Contador (Sicalc)','Programar a emissão sob pedido (51).','R$ 0,32 por guia','média','/receita#servicos',19),
('rf_procuracoes','Receita Federal','Procurações eletrônicas e DTE','Quem tem procuração de cada empresa no e-CAC e se a empresa aderiu ao DTE.','pronto','SERPRO Integra Contador','Programar uma leitura por trimestre (41 e 111).','R$ 0,24 por consulta','média','/receita#servicos',20),
('rf_cnd','Receita Federal','Certidão federal (CND)','Certidão conjunta Receita e PGFN, válida por 180 dias.','falta','API "Consulta CND" do SERPRO (contrato à parte) ou revendedor (Infosimples).','Decidir entre contratar a API de CND do SERPRO ou um revendedor. A SITFIS já mostra se sairia negativa.','Preço do SERPRO não publicado; revendedor cerca de R$ 0,20','alta','',21),
('rf_sped','Receita Federal','SPED (ECD, ECF, EFD-Contribuições)','Escriturações anuais contábil e fiscal e de PIS e COFINS.','manual','Não há API de leitura: o contador entrega pelo programa da Receita.','Pedir ao contador os arquivos e recibos e guardar no Brasico (bucket privado).','—','média','',22),
('rf_reinf','Receita Federal','EFD-Reinf','Retenções sobre serviços tomados e pagamentos.','manual','Só quem envia usa o webservice; o resultado aparece na DCTFWeb.','Ler pela DCTFWeb quando ela for programada.','—','baixa','',23),
('tr_esocial','Trabalhista','eSocial','Eventos que o contador transmite: admissões, folha, férias, afastamentos, desligamentos.','temos','Webservice oficial do governo com o certificado de cada empresa','—','Grátis (10 acessos por dia por empresa)','alta','/esocial',30),
('tr_ponto','Trabalhista','Ponto (RHiD)','Batidas, escala, faltas, atrasos e banco de horas.','temos','API do RHiD','—','Grátis','alta','/esocial#ponto',31),
('tr_fgts','Trabalhista','FGTS Digital','Guias do FGTS e débitos em aberto.','falta','Sem API pública encontrada.','Conferir no portal do FGTS Digital (contador) ou por revendedor; estimar pelo eSocial.','Revendedor por consulta','alta','',32),
('tr_det','Trabalhista','DET (Domicílio Eletrônico Trabalhista)','Caixa postal da fiscalização do trabalho; a ciência corre mesmo sem abrir.','manual','Sem API pública encontrada.','Lembrete semanal para alguém abrir com o certificado ou gov.br.','Grátis','alta','',33),
('tr_cndt_crf','Trabalhista','CNDT (TST) e CRF (FGTS)','Certidões trabalhista e de regularidade do FGTS.','falta','Sites públicos com captcha.','Contratar revendedor (Infosimples ou Direct Data). O Brasico não resolve captcha.','R$ 0,20 a R$ 0,36 por consulta','média','',34),
('nf_compra','Notas fiscais','NF-e de compra','Todas as notas de fornecedores emitidas contra cada CNPJ, com XML e PDF.','temos','Distribuição de documentos do Ambiente Nacional, com o certificado','—','Grátis','alta','/notas',40),
('nf_venda','Notas fiscais','NFC-e de venda (cupom)','Cupons fiscais emitidos pelo caixa.','falta','Não há distribuição para o emitente baixar as próprias NFC-e; as vendas já vêm da TOTVS.','Pedir à TOTVS a exportação dos XML (ou um endpoint) para conferir nota × venda.','—','média','/vendas',41),
('nf_servico','Notas fiscais','NFS-e tomada (serviços)','Notas de contador, manutenção, marketing etc. Geram crédito na reforma.','falta','API do Ambiente de Dados Nacional (ADN) com o certificado.','Programar a leitura (mesmo desenho das NF-e). Confirmar se Tibau do Sul manda as notas ao ADN.','Grátis','média','',42),
('nf_cte','Notas fiscais','CT-e (frete)','Notas de transporte.','futuro','Distribuição do CT-e, mesma lógica da NF-e.','Depois das NFS-e.','Grátis','baixa','',43),
('rn_uvt','Estado do RN','SEFAZ-RN / UVT (extrato, débitos, DAE, DIEF)','Situação estadual de cada inscrição, guias e parcelamentos de ICMS.','manual','Sem API: só no portal com login ou certificado.','O contador acompanha; o Brasico lembra todo mês e guarda os PDFs.','—','alta','',50),
('rn_cnd','Estado do RN','Certidão estadual','Certidão negativa do RN por inscrição.','falta','Site público com captcha.','Revendedor (Infosimples).','Cerca de R$ 0,20 por consulta','alta','',51),
('rn_dte','Estado do RN','DT-e RN','Caixa postal estadual (opcional).','manual','Sem API.','Confirmar se as empresas aderiram; se sim, lembrete semanal.','Grátis','média','',52),
('pm_tibau','Prefeituras','Tibau do Sul (SIAT / Tinus)','ISS, NFS-e, DAM, alvará, certidão e confissões de dívida da Brasico77.','manual','Portal da prefeitura com login.','Checklist mensal por inscrição; guardar os extratos. Conferir a possível duplicidade de ISS entre as duas inscrições (ver Dívidas).','—','alta','/receita#dividas',60),
('pm_natal','Prefeituras','Natal (SEMUT)','ISS e certidão do Cicchetti Midway (V6).','manual','Portal da prefeitura; certidão por revendedor.','Encerrar junto com a saída do Midway.','Por consulta','média','',61),
('pm_cangua','Prefeituras','Canguaretama','ISS, alvará e certidão do Hotel Filho do Vento.','manual','Portal da prefeitura.','Sem certificado no Brasico; confirmar quem cuida.','—','baixa','',62),
('gs_totvs','Vendas e compras','Vendas (TOTVS Chef Web)','Faturamento de cada unidade e dia.','temos','API da TOTVS','—','Grátis','alta','/vendas',70),
('gs_cicchetti','Vendas e compras','Cicchetti Management (CMV)','Notas de compra lançadas e custo das mercadorias.','temos','API do Cicchetti Management','—','Grátis','média','/notas',71),
('bc_bancos','Bancos','Extratos e conciliação','Saídas e entradas de cada conta para conferir guias pagas.','futuro','Open Finance ou API de cada banco.','Fase 4 do roteiro (2º semestre de 2027).','R$ 0 a R$ 540 por mês','média','',80),
('rt_reforma','Reforma tributária','IBS e CBS','Destaque de IBS e CBS nas notas e apuração assistida a partir de 2027.','futuro','Campos novos das NF-e (já guardadas) e futura apuração da Receita.','Acompanhar as notas técnicas e a decisão do Simples (LAIF).','—','média','/receita#reforma',90)
on conflict (id) do update set area = excluded.area, nome = excluded.nome, o_que_da = excluded.o_que_da, situacao = excluded.situacao,
  como = excluded.como, falta = excluded.falta, custo = excluded.custo, prioridade = excluded.prioridade, onde = excluded.onde,
  ordem = excluded.ordem, atualizado_em = now();

-- ---------------------------------------------------------------------
-- 3) Eventos de atualização
-- ---------------------------------------------------------------------
create table if not exists public.receita_eventos (
  empresa_id text not null,
  evento text not null,              -- E0301 DCTFWeb · E0601 Caixa Postal · E0701 Pagamentos
  atualizado_em date,                -- último dia em que mudou (null = sem mudança registrada)
  bruto text,
  lido_em timestamptz not null default now(),
  primary key (empresa_id, evento)
);
alter table public.receita_eventos enable row level security;
drop policy if exists "ver eventos" on public.receita_eventos;
create policy "ver eventos" on public.receita_eventos for select using (public.receita_pode_ver(auth.uid()));

-- ---------------------------------------------------------------------
-- 4) Rotinas
-- ---------------------------------------------------------------------
create table if not exists public.receita_rotinas (
  id text primary key,
  nome text not null,
  o_que_faz text not null,
  quando text not null,
  custo_mes_empresa text not null,   -- estimativa por empresa
  ligada boolean not null default true,
  ordem int not null default 0,
  ultima_vez timestamptz
);
alter table public.receita_rotinas enable row level security;
drop policy if exists "ver rotinas" on public.receita_rotinas;
create policy "ver rotinas" on public.receita_rotinas for select using (public.receita_pode_ver(auth.uid()));

insert into public.receita_rotinas (id, nome, o_que_faz, quando, custo_mes_empresa, ordem) values
('eventos','Eventos de atualização','Pergunta à Receita em que dia mudaram a caixa postal, os pagamentos e a DCTFWeb.','Todo dia, 7h','Grátis',1),
('caixa_postal','Caixa postal','Pergunta se há mensagem nova (grátis). Só se houver, baixa a lista e o texto das novas.','Todo dia, 7h15','R$ 0 a R$ 3 (depende das mensagens)',2),
('pagamentos','Pagamentos','Busca os pagamentos dos últimos 90 dias só quando o evento de pagamentos mudou desde a última busca.','Quando muda','R$ 0,24 a R$ 1',3),
('situacao_fiscal','Situação fiscal','Gera o relatório de pendências uma vez por semana.','A cada 7 dias','Cerca de R$ 1,40',4)
on conflict (id) do update set nome = excluded.nome, o_que_faz = excluded.o_que_faz, quando = excluded.quando,
  custo_mes_empresa = excluded.custo_mes_empresa, ordem = excluded.ordem;

-- Liga e desliga uma rotina pelo site
create or replace function public.receita_rotina_ligar(p_id text, p_ligada boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.receita_pode_ver(auth.uid()) then raise exception 'Sem acesso à Receita' using errcode = '42501'; end if;
  update public.receita_rotinas set ligada = p_ligada where id = p_id;
  if not found then raise exception 'Rotina desconhecida.'; end if;
end $$;
revoke execute on function public.receita_rotina_ligar(text, boolean) from public, anon;
grant execute on function public.receita_rotina_ligar(text, boolean) to authenticated;

update public.receita_acervo set secao = 'capa' where titulo ~ '^00\s';

-- ---------------------------------------------------------------------
-- receita_pedir aceita 'eventos' (grátis: fora do limite do dia e do teto); receita_worker_concluir guarda os eventos
-- ---------------------------------------------------------------------
create or replace function public.receita_pedir(p_empresa text, p_ambiente text, p_tipo text, p_parametros jsonb,
  p_origem text, p_user uuid)
returns uuid language plpgsql security definer set search_path = public, vault as $$
declare
  e public.esocial_empresas;
  r public.receita_empresas;
  v_id uuid;
  v_usadas int;
  v_gasto numeric;
begin
  select * into e from public.esocial_empresas where id = p_empresa;
  if e.id is null then raise exception 'Empresa "%" não encontrada.', p_empresa; end if;
  insert into public.receita_empresas (id) values (e.id) on conflict do nothing;
  select * into r from public.receita_empresas where id = e.id;

  if p_ambiente not in ('demonstracao', 'producao') then
    raise exception 'Ambiente inválido (demonstracao ou producao).';
  end if;
  if p_tipo not in ('caixa_postal', 'situacao_fiscal', 'pagamentos', 'eventos') then
    raise exception 'Tipo de pedido desconhecido: %', p_tipo;
  end if;

  if p_ambiente = 'producao' then
    if not r.producao_ligada then
      raise exception 'A Receita em produção ainda não foi ligada para %. Por enquanto só a demonstração.', e.nome;
    end if;
    if e.cert_validade is null or e.cert_validade <= now() then
      raise exception 'O certificado da empresa % venceu ou não existe. Envie o novo pela tela do eSocial.', e.nome;
    end if;
    if not exists (select 1 from vault.secrets where name = 'receita_serpro_' || e.id) then
      raise exception 'Faltam as chaves do contrato do SERPRO para %.', e.nome;
    end if;
    if exists (select 1 from public.receita_execucoes where empresa_id = e.id and ambiente = p_ambiente
               and status in ('na_fila', 'rodando') and created_at > now() - interval '5 minutes') then
      raise exception 'Já há um pedido à Receita em andamento para esta empresa; tente em instantes.';
    end if;
    if p_tipo <> 'eventos' then
    select count(*) into v_usadas from public.receita_chamadas
    where empresa_id = e.id and ambiente = 'producao' and cobrada
      and (created_at at time zone 'America/Sao_Paulo')::date = (now() at time zone 'America/Sao_Paulo')::date;
    if v_usadas >= r.limite_diario_cobradas then
      raise exception 'Limite de % chamadas cobradas por dia já foi usado para %.', r.limite_diario_cobradas, e.nome;
    end if;
    -- Teto de gasto do ciclo de faturamento do contrato (dia 21 ao dia 20)
    select coalesce(sum(custo), 0) into v_gasto from public.receita_chamadas
    where empresa_id = e.id and ambiente = 'producao' and cobrada
      and created_at >= public.receita_ciclo_inicio()::timestamp at time zone 'America/Sao_Paulo';
    if v_gasto >= r.orcamento_ciclo then
      raise exception 'O teto de R$ % do ciclo (dia 21 ao dia 20) já foi atingido para %. Para continuar, aumente o teto em Gastos.',
        replace(to_char(r.orcamento_ciclo, 'FM9990.00'), '.', ','), e.nome;
    end if;
    end if;
  end if;

  insert into public.receita_execucoes (empresa_id, ambiente, tipo, parametros, origem, pedido_por)
  values (e.id, p_ambiente, p_tipo, coalesce(p_parametros, '{}'), coalesce(p_origem, 'site'), p_user) returning id into v_id;

  perform net.http_post(
    url := 'https://brasico.vercel.app/api/receita',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-segredo', (select decrypted_secret from vault.decrypted_secrets where name = 'receita_segredo')),
    body := jsonb_build_object('execucao', v_id),
    timeout_milliseconds := 30000);
  return v_id;
end $$;
revoke execute on function public.receita_pedir(text, text, text, jsonb, text, uuid) from public, anon, authenticated;

create or replace function public.receita_worker_concluir(p_segredo text, p_execucao uuid, p_status text,
  p_resultado jsonb, p_erro text, p_chamadas jsonb, p_mensagens jsonb, p_relatorios jsonb, p_pagamentos jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  x public.receita_execucoes;
  c jsonb; m jsonb; p jsonb; r jsonb;
  v_cat text; v_cobrada boolean; v_no_mes int;
begin
  perform public.receita_conferir_segredo(p_segredo);
  update public.receita_execucoes set status = p_status, resultado = coalesce(p_resultado, '{}'),
    erro = left(coalesce(p_erro, ''), 1000), fim = now()
  where id = p_execucao and status = 'rodando' returning * into x;
  if x.id is null then return; end if;

  for c in select * from jsonb_array_elements(coalesce(p_chamadas, '[]')) loop
    v_cat := case c->>'endpoint' when 'Consultar' then 'consulta' when 'Emitir' then 'emissao'
                                 when 'Declarar' then 'declaracao' else 'gratis' end;
    v_cobrada := x.ambiente = 'producao' and v_cat <> 'gratis' and (c->>'http_status')::int in (200, 202, 403);
    if v_cobrada then
      select count(*) + 1 into v_no_mes from public.receita_chamadas
      -- a faixa de preço é do contrato da própria empresa, no ciclo de faturamento (dia 21 ao dia 20)
      where ambiente = 'producao' and cobrada and categoria = v_cat and empresa_id = x.empresa_id
        and created_at >= public.receita_ciclo_inicio()::timestamp at time zone 'America/Sao_Paulo';
    end if;
    insert into public.receita_chamadas (execucao_id, empresa_id, ambiente, endpoint, id_sistema, id_servico,
      http_status, codigo, categoria, cobrada, custo, duracao_ms)
    values (x.id, x.empresa_id, x.ambiente, c->>'endpoint', coalesce(c->>'id_sistema', ''), coalesce(c->>'id_servico', ''),
      (c->>'http_status')::int, left(coalesce(c->>'codigo', ''), 200), v_cat, v_cobrada,
      case when v_cobrada then public.receita_preco(v_cat, v_no_mes) else 0 end, (c->>'duracao_ms')::int);
  end loop;

  -- Eventos de atualização: guarda o último dia em que cada sistema mudou para a empresa
  if x.tipo = 'eventos' then
    for r in select * from jsonb_array_elements(coalesce(p_resultado->'eventos', '[]')) loop
      insert into public.receita_eventos as t (empresa_id, evento, atualizado_em, bruto, lido_em)
      values (x.empresa_id, r->>'evento', nullif(r->>'data', '')::date, r->>'bruto', now())
      on conflict (empresa_id, evento) do update set atualizado_em = excluded.atualizado_em, bruto = excluded.bruto, lido_em = now();
    end loop;
  end if;

  for m in select * from jsonb_array_elements(coalesce(p_mensagens, '[]')) loop
    insert into public.receita_mensagens as t (ambiente, empresa_id, isn, assunto, remetente, enviada_em, relevancia,
      lida_na_receita, ciencia_em, corpo, detalhe, detalhada_em)
    values (x.ambiente, x.empresa_id, m->>'isn', coalesce(m->>'assunto', ''), coalesce(m->>'remetente', ''),
      public.receita_data(m->>'enviada_em'), coalesce(m->>'relevancia', ''), coalesce((m->>'lida')::boolean, false),
      public.receita_data(m->>'ciencia_em'), m->>'corpo', m->'detalhe', case when m ? 'corpo' then now() end)
    on conflict (ambiente, empresa_id, isn) do update set
      assunto = case when excluded.assunto <> '' then excluded.assunto else t.assunto end,
      remetente = case when excluded.remetente <> '' then excluded.remetente else t.remetente end,
      enviada_em = coalesce(excluded.enviada_em, t.enviada_em),
      relevancia = case when excluded.relevancia <> '' then excluded.relevancia else t.relevancia end,
      lida_na_receita = excluded.lida_na_receita or t.lida_na_receita,
      ciencia_em = coalesce(excluded.ciencia_em, t.ciencia_em),
      corpo = coalesce(excluded.corpo, t.corpo),
      detalhe = coalesce(excluded.detalhe, t.detalhe),
      detalhada_em = coalesce(excluded.detalhada_em, t.detalhada_em);
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_relatorios, '[]')) loop
    insert into public.receita_relatorios (ambiente, empresa_id, tipo, pdf_base64, tamanho, execucao_id)
    values (x.ambiente, x.empresa_id, coalesce(r->>'tipo', 'situacao_fiscal'), r->>'pdf_base64',
      length(r->>'pdf_base64') * 3 / 4, x.id);
  end loop;

  for p in select * from jsonb_array_elements(coalesce(p_pagamentos, '[]')) loop
    insert into public.receita_pagamentos as t (ambiente, empresa_id, numero_documento, tipo_documento, codigo_receita,
      descricao_receita, periodo_apuracao, data_arrecadacao, data_vencimento, valor_total, dados)
    values (x.ambiente, x.empresa_id, p->>'numero_documento', coalesce(p->>'tipo_documento', ''),
      coalesce(p->>'codigo_receita', ''), coalesce(p->>'descricao_receita', ''), public.receita_data(p->>'periodo_apuracao'),
      public.receita_data(p->>'data_arrecadacao'), public.receita_data(p->>'data_vencimento'),
      (p->>'valor_total')::numeric, coalesce(p->'dados', '{}'))
    on conflict (ambiente, empresa_id, numero_documento) do update set
      tipo_documento = excluded.tipo_documento, codigo_receita = excluded.codigo_receita,
      descricao_receita = excluded.descricao_receita, periodo_apuracao = excluded.periodo_apuracao,
      data_arrecadacao = excluded.data_arrecadacao, data_vencimento = excluded.data_vencimento,
      valor_total = excluded.valor_total, dados = excluded.dados, atualizado_em = now();
  end loop;
end $$;
revoke execute on function public.receita_worker_concluir(text, uuid, text, jsonb, text, jsonb, jsonb, jsonb, jsonb) from public, authenticated;
grant execute on function public.receita_worker_concluir(text, uuid, text, jsonb, text, jsonb, jsonb, jsonb, jsonb) to anon;

-- ---------------------------------------------------------------------
-- Rotina econômica: um passo por empresa a cada passada (pg_cron a cada 15 min, 7h–9h45 de Fortaleza).
-- Ordem: eventos (grátis) → caixa postal (aviso grátis; paga só se houver mensagem nova)
--        → pagamentos (só se o evento de pagamentos mudou desde a última busca)
--        → situação fiscal (a cada 7 dias).
-- Falha conta como tentativa do dia: não insiste no mesmo dia. Passou do teto ou do limite, o
-- receita_pedir recusa e a rotina segue para a próxima empresa.
-- ---------------------------------------------------------------------
create or replace function public.receita_rotina_passo()
returns int language plpgsql security definer set search_path = public as $$
declare
  e record;
  v_ini timestamptz := (now() at time zone 'America/Sao_Paulo')::date::timestamp at time zone 'America/Sao_Paulo';
  v_feitos int := 0;
  v_tipo text;
  v_par jsonb;
  ult record;
  ligada jsonb := coalesce((select jsonb_object_agg(id, ligada) from public.receita_rotinas), '{}');
begin
  for e in
    select r.id from public.receita_empresas r join public.esocial_empresas s on s.id = r.id
    where r.producao_ligada order by r.id
  loop
    v_tipo := null; v_par := '{}';
    -- Um pedido por vez por empresa
    if exists (select 1 from public.receita_execucoes where empresa_id = e.id and status in ('na_fila', 'rodando')
               and created_at > now() - interval '10 minutes') then
      continue;
    end if;

    -- 1) Eventos de atualização (grátis). Se ficaram protocolos para ler, lê na passada seguinte (até 3 por dia).
    if coalesce((ligada->>'eventos')::boolean, false) then
      select * into ult from public.receita_execucoes
      where empresa_id = e.id and ambiente = 'producao' and tipo = 'eventos' and created_at >= v_ini
      order by created_at desc limit 1;
      if ult.id is null then
        v_tipo := 'eventos';
      elsif ult.status = 'ok' and ult.resultado ? 'pendentes'
            and (select count(*) from public.receita_execucoes where empresa_id = e.id and tipo = 'eventos' and created_at >= v_ini) < 3 then
        v_tipo := 'eventos'; v_par := jsonb_build_object('pendentes', ult.resultado->'pendentes');
      end if;
    end if;

    -- 2) Caixa postal: uma vez por dia (o aviso de mensagem nova é grátis)
    if v_tipo is null and coalesce((ligada->>'caixa_postal')::boolean, false)
       and not exists (select 1 from public.receita_execucoes where empresa_id = e.id and ambiente = 'producao'
                       and tipo = 'caixa_postal' and created_at >= v_ini) then
      v_tipo := 'caixa_postal';
    end if;

    -- 3) Pagamentos: só quando a Receita registrou mudança depois da última busca que deu certo
    if v_tipo is null and coalesce((ligada->>'pagamentos')::boolean, false)
       and exists (
         select 1 from public.receita_eventos ev
         where ev.empresa_id = e.id and ev.evento = 'E0701' and ev.atualizado_em is not null
           and ev.atualizado_em >= coalesce((
             select max((x.created_at at time zone 'America/Sao_Paulo')::date) from public.receita_execucoes x
             where x.empresa_id = e.id and x.ambiente = 'producao' and x.tipo = 'pagamentos' and x.status in ('ok', 'sem_dados')), '2000-01-01'::date))
       and not exists (select 1 from public.receita_execucoes where empresa_id = e.id and ambiente = 'producao'
                       and tipo = 'pagamentos' and created_at >= v_ini) then
      v_tipo := 'pagamentos';
    end if;

    -- 4) Situação fiscal: a cada 7 dias
    if v_tipo is null and coalesce((ligada->>'situacao_fiscal')::boolean, false)
       and not exists (select 1 from public.receita_execucoes where empresa_id = e.id and ambiente = 'producao'
                       and tipo = 'situacao_fiscal' and (status = 'ok' and created_at > now() - interval '7 days' or created_at >= v_ini)) then
      v_tipo := 'situacao_fiscal';
    end if;

    if v_tipo is null then continue; end if;
    begin
      perform public.receita_pedir(e.id, 'producao', v_tipo, v_par, 'rotina', null);
      update public.receita_rotinas set ultima_vez = now() where id = v_tipo;
      v_feitos := v_feitos + 1;
    exception when others then
      raise notice 'Receita, rotina de %: %', e.id, sqlerrm;
    end;
  end loop;
  return v_feitos;
end $$;
revoke execute on function public.receita_rotina_passo() from public, anon, authenticated;

do $do$ begin
  if exists (select 1 from cron.job where jobname = 'receita-rotina') then perform cron.unschedule('receita-rotina'); end if;
end $do$;
-- 7h a 9h45 de Fortaleza (UTC−3) = 10h a 12h45 UTC
select cron.schedule('receita-rotina', '*/15 10-12 * * *', $job$ select public.receita_rotina_passo() $job$);
