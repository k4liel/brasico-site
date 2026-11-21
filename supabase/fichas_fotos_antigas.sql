-- Fotos das fichas técnicas que vieram do projeto Fichas técnicas (20/11/2026).
-- O projeto (110ba821-…) foi excluído para sempre na Lixeira; as 154 fotos
-- continuam no bucket workspace-files, pasta <projeto>/fotos/, mas abriam só
-- para membros do projeto (is_member), que deixou de existir: as fotos sumiram
-- da página /fichas. Agora quem vê as fichas lê essa pasta, e as fichas apontam
-- para /api/fichas/foto/<arquivo>, que procura em fichas-fotos e depois aqui.

create policy "fichas fotos antigas ver" on storage.objects for select
  using (bucket_id = 'workspace-files'
         and name like '110ba821-787e-4535-a3f8-836884934e84/fotos/%'
         and public.fichas_pode(auth.uid()));

update public.fichas
   set foto = '/api/fichas/foto/' || split_part(foto, '/fotos/', 2)
 where foto like '%/api/arquivo/110ba821-787e-4535-a3f8-836884934e84/fotos/%';
