-- =====================================================================
-- Notas fiscais: rotina semanal (complementa supabase/notas.sql)
--  - Toda segunda às 6h (Fortaleza, 09h UTC): busca na SEFAZ de cada empresa com
--    notas_empresas.ativa ligada. A continuação e a ciência se encadeiam sozinhas.
--  - Segunda às 9h (12h UTC): nova rodada, que traz as notas completas depois da ciência
--    (a SEFAZ pede 1 hora entre consultas sem documento novo).
--  - Uma empresa com erro não impede as outras: o erro fica em ultimo_status.
-- =====================================================================

create or replace function public.notas_rodada()
returns void language plpgsql security definer set search_path = public as $$
declare e record;
begin
  for e in select cnpj from public.notas_empresas where ativa order by nome loop
    begin
      perform public.notas_pedir(e.cnpj, 'distribuicao', 'agenda', null);
    exception when others then
      update public.notas_empresas set ultimo_status = left('agenda: ' || sqlerrm, 200), atualizado_em = now() where cnpj = e.cnpj;
    end;
  end loop;
end $$;
revoke execute on function public.notas_rodada() from public, anon, authenticated;

select cron.unschedule('notas-segunda') where exists (select 1 from cron.job where jobname = 'notas-segunda');
select cron.schedule('notas-segunda', '0 9 * * 1', $job$ select public.notas_rodada() $job$);
select cron.unschedule('notas-segunda-completas') where exists (select 1 from cron.job where jobname = 'notas-segunda-completas');
select cron.schedule('notas-segunda-completas', '0 12 * * 1', $job$ select public.notas_rodada() $job$);
