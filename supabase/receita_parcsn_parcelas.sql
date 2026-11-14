-- =====================================================================
-- Rotina de declarações: parcelas em aberto do parcelamento do Simples (13/11/2026)
--  - Serviço PARCSN/PARCELASPARAGERAR162 (liberado em lib/receita/servicos.ts): lista as parcelas que ainda
--    podem ser emitidas, com o valor — são as que faltam pagar. Primeira leitura (LAIF, 13/11/2026):
--    parcelas de 05 a 11/2026, cerca de R$ 5.500 cada.
--  - Entra no lote junto com o detalhe do parcelamento (OBTERPARC164), a cada 7 dias, R$ 0,24.
--  - Aplica um remendo na função receita_lote_declaracoes (supabase/receita_rotina_declaracoes.sql).
-- =====================================================================
do $do$
declare
  def text := pg_get_functiondef('public.receita_lote_declaracoes'::regproc);
  velho text := $x$itens := itens || jsonb_build_array(jsonb_build_object('servico', 'PARCSN/OBTERPARC164', 'dados', jsonb_build_object('numeroParcelamento', r.numero)));$x$;
  novo text := $x$itens := itens || jsonb_build_array(jsonb_build_object('servico', 'PARCSN/OBTERPARC164', 'dados', jsonb_build_object('numeroParcelamento', r.numero)));
        if not itens @> '[{"servico": "PARCSN/PARCELASPARAGERAR162"}]' then
          itens := itens || jsonb_build_array(jsonb_build_object('servico', 'PARCSN/PARCELASPARAGERAR162'));
        end if;$x$;
begin
  if position('PARCELASPARAGERAR162' in def) > 0 then return; end if;
  if position(velho in def) = 0 then raise exception 'trecho do OBTERPARC164 não encontrado'; end if;
  execute replace(def, velho, novo);
end $do$;
