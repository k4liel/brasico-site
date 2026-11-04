-- =====================================================================
-- NFS-e: cada CNPJ é lido por conta própria (04/11/2026; aplica depois de nfse_raiz.sql)
--  - O teste de 04/11 mostrou que a consulta com ?cnpjConsulta=<CNPJ> traz só as notas DAQUELE CNPJ,
--    numa fila (NSU) própria: a matriz não traz as notas das filiais. Com a leitura só pela matriz,
--    a filial 0002 da Brasico77 ficou sem nenhuma nota de serviço.
--  - Agora cada CNPJ de nfse_empresas tem a sua leitura, o seu ult_nsu e a sua espera de 1 hora.
--    O certificado continua o do próprio CNPJ ou o da matriz da raiz (nfse_certificado); o da raiz
--    serve para consultar qualquer CNPJ dela.
--  - A nota fica no CNPJ consultado (lib/nfse/documentos.ts): emitente = emitida, tomador = tomada,
--    senão intermediada. Nota entre duas empresas do grupo aparece nas duas.
-- =====================================================================

-- A "leitora" de um CNPJ passa a ser ele mesmo (nfse_pedir e nfse_rodada usam esta função)
create or replace function public.nfse_leitora(p_cnpj text)
returns text language sql stable security definer set search_path = public as $$
  select cnpj from public.nfse_empresas where cnpj = p_cnpj
$$;
revoke execute on function public.nfse_leitora(text) from public, anon, authenticated;

-- As filiais voltam para a leitura diária, começando do NSU 0 da fila delas
update public.nfse_empresas set ativa = true, atualizado_em = now()
where ativa = false and substr(cnpj, 9, 4) <> '0001' and ult_nsu = 0;
