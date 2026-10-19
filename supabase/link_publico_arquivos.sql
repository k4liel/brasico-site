-- =====================================================================
-- Brasico — documentos no link público
-- Com o link público ativo, os PDFs e capas do projeto (bucket privado
-- workspace-files, pasta <projeto>/...) abrem para quem tem o link, pela rota
-- /api/publico/<código>/<projeto>/<pasta>/<arquivo>. Desativou o link,
-- os arquivos fecham na hora. Projetos sem link continuam só para a equipe.
-- =====================================================================

-- Qual projeto um código de link abre (nada, se o link estiver desligado)
create or replace function public.projeto_publico(p_slug text)
returns uuid language sql stable security definer set search_path = public as $$
  select w.id from public.workspaces w
  where length(coalesce(p_slug, '')) >= 32 and w.public_slug = p_slug and w.is_public and w.removido_em is null;
$$;
revoke execute on function public.projeto_publico(text) from public;
grant execute on function public.projeto_publico(text) to anon, authenticated;

-- Leitura sem login só dos arquivos de projetos com link público ativo
drop policy if exists "link publico le arquivos" on storage.objects;
create policy "link publico le arquivos" on storage.objects for select to anon
using (
  bucket_id = 'workspace-files'
  and exists (
    select 1 from public.workspaces w
    where w.id::text = (storage.foldername(name))[1] and w.is_public and w.removido_em is null
  )
);
