-- =====================================================================
-- Envio de fotos pelo Claude para o bucket privado workspace-files (<projeto>/fotos/).
-- A Edge Function fotos-enviar confere o segredo fotos_segredo do Vault por esta função.
-- Para usar: cadastre um segredo novo (no SQL Editor ou pelo Claude, nunca no GitHub nem no chat):
--   select vault.update_secret((select id from vault.secrets where name = 'fotos_segredo'), '<segredo>');
-- Depois de enviar, troque para um valor aleatório e a função fica desligada:
--   select vault.update_secret((select id from vault.secrets where name = 'fotos_segredo'), gen_random_uuid()::text || gen_random_uuid()::text);
-- =====================================================================

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'fotos_segredo') then
    perform vault.create_secret(gen_random_uuid()::text || gen_random_uuid()::text, 'fotos_segredo');
  end if;
end $$;

create or replace function public.fotos_segredo_ok(p_segredo text)
returns boolean language sql stable security definer set search_path = public, vault as $$
  select coalesce(length(p_segredo) >= 32 and p_segredo = (select decrypted_secret from vault.decrypted_secrets where name = 'fotos_segredo'), false)
$$;
revoke execute on function public.fotos_segredo_ok(text) from public, anon, authenticated;
grant execute on function public.fotos_segredo_ok(text) to service_role;
