-- =====================================================================
-- Notas fiscais · página nova (migration notas_pagina_nova)
--  - notas_meses: resumo por mês e empresa (CNPJ destinatário) para os totais da lista
--  - notas_indice_precos: a aba Índice de preços mostra os capítulos do projeto Índice de Preços
--    (recalculados todo dia às 6h por precos_publicar) ou recalculados na hora (p_ao_vivo)
-- O PDF (DANFE) de cada nota é montado na hora do XML oficial: rota /api/notas/danfe/<chave> (lib/notas/danfe.ts).
-- =====================================================================

create or replace view public.notas_meses with (security_invoker = true) as
select to_char(n.emissao at time zone 'America/Fortaleza', 'YYYY-MM') mes, n.empresa_cnpj,
  count(*) notas, count(*) filter (where n.situacao = 'cancelada') canceladas, count(*) filter (where not n.completa) so_resumo,
  coalesce(sum(n.valor) filter (where n.situacao <> 'cancelada'), 0) valor
from public.notas n where n.emissao is not null
group by 1, 2;
grant select on public.notas_meses to authenticated;

create or replace function public.notas_indice_precos(p_ao_vivo boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ws uuid := 'b65dc4e3-d23e-4079-ae83-fd9b1cf9bf90';  -- projeto Índice de Preços
begin
  if not (public.notas_pode_ver(auth.uid()) or exists (select 1 from public.cicchetti_acesso where user_id = auth.uid())) then
    raise exception 'Sem acesso ao índice de preços' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'css', (select doc_css from public.workspaces where id = v_ws),
    'ao_vivo', p_ao_vivo,
    'atualizado_em', case when p_ao_vivo then now() else (select max(updated_at) from public.notes where workspace_id = v_ws and archived_at is null) end,
    'capitulos', case when p_ao_vivo
      then (select jsonb_agg(jsonb_build_object('numero', numero, 'titulo', titulo, 'conteudo', conteudo) order by numero)
            from public.precos_capitulos('pt', 200) where numero > 0)
      else (select jsonb_agg(jsonb_build_object('numero', split_part(title, ' · ', 1)::int, 'titulo', title, 'conteudo', content) order by title)
            from public.notes where workspace_id = v_ws and archived_at is null and split_part(title, ' · ', 1) <> '00')
    end);
end $$;
revoke execute on function public.notas_indice_precos(boolean) from public, anon;
grant execute on function public.notas_indice_precos(boolean) to authenticated;
