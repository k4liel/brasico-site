-- Painel de integrações: WhatsApp pelo backup do iPhone (23/11/2026)
-- Desde 20/11/2026 a Evolution não usa mais o número da Brasico; as conversas chegam pelo backup do iPhone
-- (robos/whatsapp-iphone), em lotes. A hora da última conversa (enviada_em) não diz se o envio está em dia: o que
-- vale é quando o último lote chegou ao banco (recebida_em). integracoes_painel() passa a devolver também
-- whatsapp.ultimo_recebimento e whatsapp.recebidas_24h (regra em lib/integracoes.ts).

create index if not exists wa_mensagens_recebida_idx on public.wa_mensagens (recebida_em);

do $$
declare
  d text := pg_get_functiondef('public.integracoes_painel()'::regprocedure);
begin
  if position('ultimo_recebimento' in d) > 0 then return; end if;
  if (select count(*) from regexp_matches(d, '''mensagens_24h''', 'g')) <> 1 then
    raise exception 'integracoes_painel mudou: confira o bloco do WhatsApp antes de aplicar';
  end if;
  d := replace(d, '''mensagens_24h'',',
    '''ultimo_recebimento'', (select max(recebida_em) from public.wa_mensagens where recebida_em > now() - interval ''30 days''),
        ''recebidas_24h'', (select count(*) from public.wa_mensagens where recebida_em > now() - interval ''24 hours''),
        ''mensagens_24h'',');
  execute d;
end $$;
