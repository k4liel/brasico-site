-- =====================================================================
-- WhatsApp: resumo automático diário (religado em 28/10/2026, a pedido do dono).
-- Todo dia às 7h de Fortaleza (10h UTC) a Edge Function whatsapp-resumo lê as
-- mensagens de ontem de todos os grupos acompanhados, pede um resumo curto ao
-- Claude (API da Anthropic, chave ANTHROPIC_API_KEY nas Edge Functions) e grava
-- um resumo só em wa_resumos_gerais, sem criado_por (= automático). Aparece em
-- Menu → WhatsApp → Resumos. Custo medido: ~US$ 0,10 por dia.
-- Se o resumo do dia já existe, a função não faz de novo. Para refazer um dia:
--   corpo {"dia": "2026-10-27", "refazer": true} (substitui o texto do mesmo resumo).
-- Os resumos pedidos ao Claude pelo conector (whatsapp_salvar_resumo) continuam.
-- =====================================================================

select cron.unschedule('whatsapp-resumo-diario') where exists (select 1 from cron.job where jobname = 'whatsapp-resumo-diario');
select cron.schedule('whatsapp-resumo-diario', '0 10 * * *', $job$
  select net.http_post(
    url := 'https://doajznzouxxqbqkvsclv.supabase.co/functions/v1/whatsapp-resumo',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-segredo', (select decrypted_secret from vault.decrypted_secrets where name = 'wa_segredo')),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000)
$job$);
