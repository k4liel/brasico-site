-- WhatsApp: proxy residencial fixo na Evolution (17/11/2026, depois do bloqueio de 16/11).
-- Com o proxy, o número conecta ao WhatsApp por um IP de casa no Brasil, e não pelo IP da VPS.
-- Trocar ou ligar o proxy NÃO pede QR code de novo: a Evolution reconecta com o mesmo login.
--
-- 1) Um sócio cadastra os dados do proxy no SQL Editor do Supabase (nunca no GitHub nem no chat):
--    select vault.create_secret('<endereço do proxy>', 'wa_proxy_host');
--    select vault.create_secret('<porta>',             'wa_proxy_porta');
--    select vault.create_secret('http',                'wa_proxy_protocolo');  -- ou socks5
--    select vault.create_secret('<usuário>',           'wa_proxy_usuario');
--    select vault.create_secret('<senha>',             'wa_proxy_senha');
-- 2) Liga:      select public.wa_proxy_aplicar();
--    Desliga:   select public.wa_proxy_aplicar(false);
-- Só roda no SQL Editor ou pelo Claude com acesso de administrador ao banco (sem execute para o site).

create or replace function public.wa_proxy_aplicar(p_ligar boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_url text := (select decrypted_secret from vault.decrypted_secrets where name = 'wa_evolution_url');
  v_chave text := (select decrypted_secret from vault.decrypted_secrets where name = 'wa_evolution_chave');
  v_corpo jsonb;
  r extensions.http_response;
  f extensions.http_response;
begin
  if v_url is null or v_chave is null then
    raise exception 'Falta wa_evolution_url ou wa_evolution_chave no Vault';
  end if;
  if p_ligar then
    select jsonb_build_object(
      'enabled', true,
      'host', max(decrypted_secret) filter (where name = 'wa_proxy_host'),
      'port', max(decrypted_secret) filter (where name = 'wa_proxy_porta'),
      'protocol', coalesce(max(decrypted_secret) filter (where name = 'wa_proxy_protocolo'), 'http'),
      'username', coalesce(max(decrypted_secret) filter (where name = 'wa_proxy_usuario'), ''),
      'password', coalesce(max(decrypted_secret) filter (where name = 'wa_proxy_senha'), ''))
    into v_corpo
    from vault.decrypted_secrets where name like 'wa\_proxy\_%';
    if v_corpo->>'host' is null or v_corpo->>'port' is null then
      raise exception 'Cadastre wa_proxy_host e wa_proxy_porta no Vault antes';
    end if;
  else
    v_corpo := jsonb_build_object('enabled', false, 'host', '', 'port', '', 'protocol', 'http', 'username', '', 'password', '');
  end if;

  r := extensions.http(('POST', rtrim(v_url, '/') || '/proxy/set/brasico',
         array[extensions.http_header('apikey', v_chave)], 'application/json', v_corpo::text)::extensions.http_request);
  f := extensions.http(('GET', rtrim(v_url, '/') || '/proxy/find/brasico',
         array[extensions.http_header('apikey', v_chave)], null, null)::extensions.http_request);

  -- devolve só o que não é segredo
  return jsonb_build_object(
    'gravou', r.status between 200 and 299,
    'status', r.status,
    'erro', case when r.status between 200 and 299 then null else left(r.content, 300) end,
    'ligado', (f.content::jsonb)->'enabled',
    'protocolo', (f.content::jsonb)->'protocol',
    'porta', (f.content::jsonb)->'port');
end $$;

revoke all on function public.wa_proxy_aplicar(boolean) from public, anon, authenticated;
