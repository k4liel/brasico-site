-- 04/11/2026: notas que chegaram só em resumo (sem itens) são buscadas uma a uma pela chave de acesso
-- (consChNFe da distribuição DF-e; execução tipo 'chave' em /api/notas, lib/notas/servicos.ts consultarChave).
-- A primeira leitura (29/10/2026) trouxe de uma vez notas com mais de 10 dias, já fora do prazo da ciência.
alter table public.notas_execucoes drop constraint if exists notas_execucoes_tipo_check;
alter table public.notas_execucoes add constraint notas_execucoes_tipo_check check (tipo in ('distribuicao', 'ciencia', 'chave'));
alter table public.notas add column if not exists chave_tentativas int not null default 0,
  add column if not exists chave_tentada_em timestamptz, add column if not exists chave_resposta text;

-- Notas canceladas pelo fornecedor (evento 110111) ficam marcadas como canceladas: nunca vêm completas
update public.notas n set situacao = 'cancelada', atualizado_em = now()
where n.situacao is distinct from 'cancelada' and exists (select 1 from public.notas_eventos e where e.chave = n.chave and e.tipo = '110111');

create or replace function public.notas_pendentes_chave(p_cnpj text)
returns table (chave text) language sql stable security definer set search_path = public as $$
  select n.chave from public.notas n
  where n.empresa_cnpj = p_cnpj and not n.completa and n.situacao is distinct from 'cancelada'
    and not exists (select 1 from public.notas_eventos e where e.chave = n.chave and e.tipo = '110111')
    and n.chave_tentativas < 5 and (n.chave_tentada_em is null or n.chave_tentada_em < now() - interval '6 hours')
  order by n.emissao desc limit 10
$$;

create or replace function public.notas_worker_tentou_chave(p_segredo text, p_chave text, p_resposta text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.notas_conferir_segredo(p_segredo);
  update public.notas set chave_tentativas = chave_tentativas + 1, chave_tentada_em = now(), chave_resposta = left(p_resposta, 300)
  where chave = p_chave;
end $$;
revoke execute on function public.notas_worker_tentou_chave(text, text, text) from public, authenticated;
grant execute on function public.notas_worker_tentou_chave(text, text, text) to anon;

-- notas_worker_pegar: no tipo 'chave', devolve as chaves de notas_pendentes_chave
-- (corpo completo: select pg_get_functiondef('notas_worker_pegar'::regproc))
