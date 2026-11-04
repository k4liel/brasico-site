-- =====================================================================
-- Notas: confirmação da operação (evento 210200), só com autorização do dono (04/11/2026)
--  - Nota que chegou só em resumo depois dos 10 dias da ciência não sai completa sem manifestação.
--    A confirmação da operação vale até 180 dias depois da emissão e libera a nota completa.
--  - É uma declaração à SEFAZ de que a compra aconteceu: o Brasico só envia para as notas marcadas em
--    notas.confirmacao_autorizada_em (com quem autorizou em confirmacao_autorizada_por). Nunca sozinho.
--  - Execução tipo 'confirmacao' (lotes de 20; rota /api/notas, lib/notas/servicos.ts manifestar);
--    registrada, a nota completa sai pela chave (notas_pendentes_chave aceita 210200 também).
--  - Primeiro uso: 15 notas de 27/08 a 16/10/2026 (R$ 6.048,92), autorizadas pelo dono em 04/11/2026.
-- =====================================================================
alter table public.notas add column if not exists confirmacao_autorizada_em timestamptz,
  add column if not exists confirmacao_autorizada_por text;

alter table public.notas_execucoes drop constraint if exists notas_execucoes_tipo_check;
alter table public.notas_execucoes add constraint notas_execucoes_tipo_check
  check (tipo in ('distribuicao', 'ciencia', 'chave', 'confirmacao'));

create or replace function public.notas_pendentes_confirmacao(p_cnpj text)
returns table (chave text) language sql stable security definer set search_path = public as $$
  select n.chave from public.notas n
  where n.empresa_cnpj = p_cnpj and n.origem = 'sefaz' and not n.completa and n.situacao = 'autorizada'
    and n.confirmacao_autorizada_em is not null and length(n.chave) = 44
    and n.emissao > now() - interval '180 days'
    and not exists (select 1 from public.notas_eventos v where v.chave = n.chave and v.tipo = '210200' and v.sentido = 'enviado'
                    and (v.cstat in (135, 136, 573) or v.created_at > now() - interval '1 day'))
  order by n.emissao desc limit 20
$$;
revoke execute on function public.notas_pendentes_confirmacao(text) from public, anon, authenticated;

create or replace function public.notas_pendentes_chave(p_cnpj text)
returns table (chave text) language sql stable security definer set search_path = public as $$
  select n.chave from public.notas n
  where n.empresa_cnpj = p_cnpj and n.origem = 'sefaz' and not n.completa and n.situacao is distinct from 'cancelada'
    and not exists (select 1 from public.notas_eventos e where e.chave = n.chave and e.tipo = '110111')
    and exists (select 1 from public.notas_eventos e where e.chave = n.chave and e.tipo in ('210210', '210200')
                and e.sentido = 'enviado' and e.cstat in (135, 136, 573))
    and n.chave_tentativas < 5 and (n.chave_tentada_em is null or n.chave_tentada_em < now() - interval '6 hours')
  order by n.emissao desc limit 10
$$;
revoke execute on function public.notas_pendentes_chave(text) from public, anon, authenticated;

create or replace function public.notas_worker_pegar(p_segredo text, p_execucao uuid)
returns jsonb language plpgsql security definer set search_path = public, vault as $$
declare x public.notas_execucoes; e public.notas_empresas; c public.certificados; v_chaves jsonb;
begin
  perform public.notas_conferir_segredo(p_segredo);
  update public.notas_execucoes set status = 'rodando', inicio = now() where id = p_execucao and status = 'na_fila' returning * into x;
  if x.id is null then return null; end if;
  select * into e from public.notas_empresas where cnpj = x.empresa_cnpj;
  select * into c from public.certificados where cnpj = x.empresa_cnpj;
  if x.tipo = 'ciencia' then
    select coalesce(jsonb_agg(p.chave), '[]') into v_chaves from (select chave from public.notas_pendentes_ciencia(e.cnpj) limit 20) p;
  elsif x.tipo = 'confirmacao' then
    select coalesce(jsonb_agg(p.chave), '[]') into v_chaves from public.notas_pendentes_confirmacao(e.cnpj) p;
  elsif x.tipo = 'chave' then
    select coalesce(jsonb_agg(p.chave), '[]') into v_chaves from public.notas_pendentes_chave(e.cnpj) p;
  end if;
  return jsonb_build_object('execucao', to_jsonb(x),
    'empresa', jsonb_build_object('cnpj', e.cnpj, 'nome', e.nome, 'ult_nsu', e.ult_nsu, 'lacunas', e.lacunas),
    'chaves', coalesce(v_chaves, '[]'),
    'certificado', (select decrypted_secret from vault.decrypted_secrets where name = c.cofre));
end $$;
revoke execute on function public.notas_worker_pegar(text, uuid) from public, authenticated;
grant execute on function public.notas_worker_pegar(text, uuid) to anon;

-- Encadeamento: depois da confirmação registrada, a nota completa sai pela chave (igual à ciência)
create or replace function public.notas_worker_concluir(p_segredo text, p_execucao uuid, p_status text, p_cstat integer, p_erro text,
  p_resultado jsonb, p_notas jsonb, p_eventos jsonb, p_ult_nsu text, p_max_nsu text, p_bloquear_ate timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare x public.notas_execucoes; e public.notas_empresas; r jsonb;
begin
  perform public.notas_conferir_segredo(p_segredo);
  select * into x from public.notas_execucoes where id = p_execucao;
  if x.id is null or x.status <> 'rodando' then return null; end if;
  r := public.notas_gravar(x.empresa_cnpj, p_notas, p_eventos);

  update public.notas_empresas set
    ult_nsu = case when p_ult_nsu ~ '^\d{15}$' and p_ult_nsu > ult_nsu then p_ult_nsu else ult_nsu end,
    max_nsu = coalesce(p_max_nsu, max_nsu),
    bloqueado_ate = case when x.tipo = 'distribuicao' then p_bloquear_ate
                         when x.tipo = 'chave' and p_cstat = 656 then p_bloquear_ate else bloqueado_ate end,
    ultima_consulta = case when x.tipo = 'distribuicao' then now() else ultima_consulta end,
    ultimo_status = left(coalesce(nullif(p_erro, ''), p_status), 200),
    atualizado_em = now()
  where cnpj = x.empresa_cnpj returning * into e;

  update public.notas_execucoes set status = p_status, cstat = p_cstat, erro = nullif(p_erro, ''), fim = now(),
    resultado = x.resultado || coalesce(p_resultado, '{}')
  where id = x.id;

  if (select count(*) from public.notas_execucoes where empresa_cnpj = x.empresa_cnpj and origem = 'encadeada'
      and created_at > now() - interval '1 day') < 30 then
    if x.tipo = 'distribuicao' and p_status <> 'falha' and coalesce((p_resultado->>'continua')::boolean, false) then
      perform public.notas_pedir(x.empresa_cnpj, 'distribuicao', 'encadeada', null);
    elsif x.tipo = 'distribuicao' and e.ciencia and exists (select 1 from public.notas_pendentes_ciencia(x.empresa_cnpj)) then
      perform public.notas_pedir(x.empresa_cnpj, 'ciencia', 'encadeada', null);
    elsif x.tipo = 'ciencia' and p_status = 'ok' and coalesce((p_resultado->>'pedidas')::int, 0) >= 20
      and exists (select 1 from public.notas_pendentes_ciencia(x.empresa_cnpj)) then
      perform public.notas_pedir(x.empresa_cnpj, 'ciencia', 'encadeada', null);
    elsif x.tipo in ('ciencia', 'confirmacao') and coalesce((p_resultado->>'registradas')::int, 0) > 0
      and (e.bloqueado_ate is null or e.bloqueado_ate < now())
      and exists (select 1 from public.notas_pendentes_chave(x.empresa_cnpj)) then
      perform public.notas_pedir(x.empresa_cnpj, 'chave', 'encadeada', null);
    end if;
  end if;
  return r;
end $$;
revoke execute on function public.notas_worker_concluir(text, uuid, text, integer, text, jsonb, jsonb, jsonb, text, text, timestamptz) from public, authenticated;
grant execute on function public.notas_worker_concluir(text, uuid, text, integer, text, jsonb, jsonb, jsonb, text, text, timestamptz) to anon;
