-- =====================================================================
-- Mapa de acessos (fiscal_fontes) revisto em 05/11/2026, depois das notas fiscais e dos ajustes da Receita
--  - NF-e de compra: por CNPJ (matriz e filiais), com ciência automática, nota completa pela chave,
--    confirmação só com autorização do dono, lacunas de NSU e PDF (DANFE).
--  - NFS-e: ligada desde 04/11/2026 (emitidas e tomadas, Portal Nacional/ADN, cada CNPJ com a sua fila, PDF DANFSe).
--  - Nota avulsa (compra sem NF-e) e situação fiscal já lida do PDF.
--  - Parcelamentos comuns: o relatório da Receita mostra parcelas e valor em atraso e a página avisa o risco de rescisão.
-- =====================================================================
update public.fiscal_fontes set
  o_que_da = 'Relatório oficial de pendências na Receita e na PGFN: débitos (mensais e trimestrais), parcelamentos e parcelas em atraso, dívida ativa e prévia da certidão.',
  falta = '—', atualizado_em = now()
where id = 'rf_sitfis';

update public.fiscal_fontes set
  o_que_da = 'Parcelamentos simplificados (SIEFPAR) e transações na dívida ativa (PGFN): parcelas e valor em atraso, com aviso de risco de rescisão (3 parcelas em atraso).',
  como = 'Pelo relatório de situação fiscal (SITFIS); o Integra Contador não tem serviço de detalhe destes parcelamentos.',
  falta = 'Detalhe de cada parcela: e-CAC (Receita) e Regularize (PGFN), pelo contador.',
  atualizado_em = now()
where id = 'rf_parc_comum';

update public.fiscal_fontes set
  nome = 'NF-e de compra (produtos)',
  o_que_da = 'Todas as notas de fornecedores emitidas contra cada CNPJ (matriz e filiais), com itens, XML e PDF (DANFE). Nota que chega só em resumo recebe a ciência da operação sozinha e é buscada completa pela chave.',
  como = 'Distribuição de documentos do Ambiente Nacional (SEFAZ), com o certificado · leitura todo dia às 6h e 9h',
  falta = 'Confirmação da operação (210200) só nas notas que o dono autorizar, uma a uma.',
  atualizado_em = now()
where id = 'nf_compra';

update public.fiscal_fontes set
  nome = 'NFS-e (serviços emitidos e tomados)',
  situacao = 'temos',
  o_que_da = 'Notas de serviço emitidas (a favor) e tomadas (contra) por cada CNPJ, com ISS, retenções, cancelamentos e PDF (DANFSe).',
  como = 'Ambiente de Dados Nacional (ADN) do Portal Nacional, com o certificado; cada CNPJ tem a sua fila · leitura às 6h30 e 12h30',
  falta = 'Nota antiga de sistema municipal próprio pode faltar: as prefeituras mandam ao ADN desde 01/2026.',
  custo = 'Grátis', atualizado_em = now()
where id = 'nf_servico';

insert into public.fiscal_fontes (id, area, nome, o_que_da, situacao, como, falta, custo, prioridade, onde, ordem, atualizado_em)
values ('nf_avulsa', 'Notas fiscais', 'Nota avulsa (compra sem NF-e)',
  'Cupom, recibo ou compra sem nota eletrônica, lançada com foto, itens e valor.', 'temos',
  'Lançada à mão na página Notas (ou pela equipe em Compras).', '—', 'Grátis', 'média', 'Página Notas → Nota avulsa', 44, now())
on conflict (id) do update set o_que_da = excluded.o_que_da, situacao = excluded.situacao, como = excluded.como, atualizado_em = now();

update public.fiscal_fontes set
  o_que_da = 'Destaque de IBS e CBS nas notas (NF-e e NFS-e já guardadas com o XML) e apuração assistida a partir de 2027.',
  atualizado_em = now()
where id = 'rt_reforma';
