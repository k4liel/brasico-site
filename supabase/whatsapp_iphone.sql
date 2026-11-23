-- WhatsApp pelo backup do iPhone (23/11/2026)
-- Depois do 2º bloqueio (19/11/2026) a Evolution não usa mais o número da Brasico. As conversas passam a vir do
-- backup do iPhone feito num computador (robos/whatsapp-iphone): o programa lê o arquivo de conversas do WhatsApp
-- normal e manda as mensagens para a mesma Edge Function whatsapp-webhook que a Evolution usava, no mesmo formato.
-- Nada se conecta ao WhatsApp. A chave do computador fica só nele (config.json fora do GitHub); o banco guarda o
-- hash SHA-256 dela no Vault (wa_iphone_segredo_hash).

create or replace function public.wa_conferir_segredo(p_segredo text)
returns boolean
language sql
stable security definer
set search_path to 'public', 'vault', 'extensions'
as $$
  select coalesce(p_segredo, '') <> ''
     and (
       exists (select 1 from vault.decrypted_secrets where name = 'wa_segredo' and decrypted_secret = p_segredo)
       or exists (
         select 1 from vault.decrypted_secrets
         where name = 'wa_iphone_segredo_hash'
           and decrypted_secret = encode(extensions.digest(p_segredo, 'sha256'), 'hex')
       )
     )
$$;

-- O hash é cadastrado uma vez (não é a chave):
-- select vault.create_secret('<sha256 da chave>', 'wa_iphone_segredo_hash', 'Hash da chave do envio do WhatsApp pelo iPhone');
