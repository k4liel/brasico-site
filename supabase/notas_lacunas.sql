-- =====================================================================
-- Notas: quando outro sistema consulta a SEFAZ com o mesmo CNPJ (04/11/2026)
--  - A SEFAZ guarda um único "último NSU" por CNPJ, de quem quer que consulte. Se outro sistema
--    (contador, software do hotel…) consulta o mesmo CNPJ e anda na sequência, o NSU do Brasico fica
--    para trás e toda consulta volta 656 "Deve ser utilizado o ultNSU nas solicitações subsequentes".
--    Foi o que travou a filial 0002 da Brasico77 desde 28/10.
--  - Desde a NT 2014.002 v1.14 a rejeição 656 traz o ultNSU da última consulta feita para o CNPJ.
--    A rota /api/notas passa a adotar esse número (o Brasico segue dali) e guarda o trecho do meio em
--    notas_empresas.lacunas ([{de, ate}], NSUs de 15 dígitos). Esse trecho é buscado um documento por vez
--    (consNSU), até 30 por leitura, antes da distribuição normal. Nada fica para trás.
-- =====================================================================
alter table public.notas_empresas add column if not exists lacunas jsonb not null default '[]';

create or replace function public.notas_worker_pegar(p_segredo text, p_execucao uuid)
returns jsonb language plpgsql security definer set search_path = public, vault as $$
declare x public.notas_execucoes; e public.notas_empresas; c public.certificados; v_chaves jsonb;
begin
  perform public.notas_conferir_segredo(p_segredo);
  update public.notas_execucoes set status = 'rodando', inicio = now()
  where id = p_execucao and status = 'na_fila' returning * into x;
  if x.id is null then return null; end if;
  select * into e from public.notas_empresas where cnpj = x.empresa_cnpj;
  select * into c from public.certificados where cnpj = x.empresa_cnpj;
  if x.tipo = 'ciencia' then
    select coalesce(jsonb_agg(p.chave), '[]') into v_chaves from (select chave from public.notas_pendentes_ciencia(e.cnpj) limit 20) p;
  end if;
  return jsonb_build_object(
    'execucao', to_jsonb(x),
    'empresa', jsonb_build_object('cnpj', e.cnpj, 'nome', e.nome, 'ult_nsu', e.ult_nsu, 'lacunas', e.lacunas),
    'chaves', coalesce(v_chaves, '[]'),
    'certificado', (select decrypted_secret from vault.decrypted_secrets where name = c.cofre));
end $$;
revoke execute on function public.notas_worker_pegar(text, uuid) from public, authenticated;
grant execute on function public.notas_worker_pegar(text, uuid) to anon;

-- A rota grava o trecho que falta buscar (substitui a lista inteira)
create or replace function public.notas_worker_lacunas(p_segredo text, p_execucao uuid, p_lacunas jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare x public.notas_execucoes;
begin
  perform public.notas_conferir_segredo(p_segredo);
  select * into x from public.notas_execucoes where id = p_execucao and status = 'rodando';
  if x.id is null then return; end if;
  update public.notas_empresas set lacunas = coalesce(p_lacunas, '[]'), atualizado_em = now() where cnpj = x.empresa_cnpj;
end $$;
revoke execute on function public.notas_worker_lacunas(text, uuid, jsonb) from public, authenticated;
grant execute on function public.notas_worker_lacunas(text, uuid, jsonb) to anon;
