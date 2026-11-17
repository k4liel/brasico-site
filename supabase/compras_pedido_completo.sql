-- Compras: o pedido completo do grupo na aba Listas (17/11/2026, pedido do dono: "não dá pra ver o pedido completo que
-- foi feito no grupo; se for arquivo, mostrar todos os itens do arquivo").
-- 1. compras_itens.pedido_item = o texto do item como veio no grupo ("6 uni de pimentão"), gravado pela análise.
-- 2. compras_pedido_mensagens(semana, pessoa) = todas as mensagens que contam para a pessoa na semana (texto e arquivo).
-- 3. Quem pode ver uma lista (sócio, setor de compras ou a própria pessoa) lê os arquivos dessas mensagens no bucket
--    whatsapp (política "compras leem anexos do pedido"); a rota /api/compras/anexo abre o arquivo e lê planilhas.

alter table public.compras_itens add column if not exists pedido_item text;

create or replace function public.compras_auto_gravar(p_pessoa uuid, p_semana uuid, p_listas jsonb, p_pedido_texto text, p_modo text default 'substituir')
returns jsonb language plpgsql security definer set search_path = public as $function$
declare lst jsonb; i jsonb; v_lista uuid; k int; n_listas int := 0; n_itens int := 0;
begin
  if (select status from public.compras_semanas where id = p_semana) <> 'aberta' then raise exception 'A semana já foi fechada.'; end if;
  if p_modo = 'substituir' then
    if exists (select 1 from public.compras_listas l where l.semana_id = p_semana and l.pessoa_id = p_pessoa
               and public.compras_lista_ativa(l.status) and public.compras_lista_tocada(l.id)) then
      raise exception 'A pessoa já começou a revisar esta lista.';
    end if;
    update public.compras_listas set status = 'substituida', substituida_em = now()
    where semana_id = p_semana and pessoa_id = p_pessoa and status in ('aguardando', 'em_revisao');
  end if;
  for lst in select * from jsonb_array_elements(coalesce(p_listas, '[]')) loop
    if jsonb_array_length(coalesce(lst->'itens', '[]')) = 0 then continue; end if;
    insert into public.compras_listas (semana_id, pessoa_id, titulo, status, pedido_texto, pedido_em, analisada_em)
    values (p_semana, p_pessoa, nullif(trim(lst->>'titulo'), ''), 'em_revisao',
            coalesce(nullif(trim(lst->>'pedido'), ''), nullif(p_pedido_texto, '')), now(), now())
    returning id into v_lista;
    n_listas := n_listas + 1; k := 0;
    for i in select * from jsonb_array_elements(lst->'itens') loop
      k := k + 1; n_itens := n_itens + 1;
      insert into public.compras_itens (lista_id, ordem, nome, fornecedor, unidade, qtd_pedida, qtd_sugerida, motivo, qtd, preco,
                                        media_4s, projecao, base, produto_nota, confianca, pedido_item)
      values (v_lista, k, coalesce(nullif(trim(i->>'nome'), ''), 'Item ' || k), nullif(trim(i->>'fornecedor'), ''), nullif(trim(i->>'unidade'), ''),
        (i->>'qtd_pedida')::numeric, (i->>'qtd_sugerida')::numeric, nullif(trim(i->>'motivo'), ''),
        coalesce((i->>'qtd_sugerida')::numeric, (i->>'qtd_pedida')::numeric), (i->>'preco')::numeric,
        (i->>'media_4s')::numeric, (i->>'projecao')::numeric, nullif(trim(i->>'base'), ''), nullif(trim(i->>'produto_nota'), ''),
        case when i->>'confianca' in ('alta', 'media', 'baixa') then i->>'confianca' end,
        nullif(trim(i->>'pedido_item'), ''));
    end loop;
  end loop;
  if n_listas = 0 then raise exception 'A análise não trouxe nenhum item.'; end if;
  if coalesce((select aumento_pct from public.compras_semanas where id = p_semana), 0) <> 0 then
    perform public.compras_recalcular_semana(p_semana);
  end if;
  return jsonb_build_object('listas', n_listas, 'itens', n_itens);
end $function$;

-- Quem pode ver o pedido de uma pessoa: sócio, setor de compras ou a própria pessoa
create or replace function public.compras_pode_ver_pessoa(p_pessoa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.operacao_papel(auth.uid()), '') in ('socio', 'compras')
      or exists (select 1 from public.operacao_pessoas o where o.id = p_pessoa and o.user_id = auth.uid())
$$;

create or replace function public.compras_pedido_mensagens(p_semana uuid, p_pessoa uuid)
returns table (id text, enviada_em timestamptz, autor text, tipo text, texto text, midia text, midia_nome text, midia_mime text)
language plpgsql stable security definer set search_path = public as $$
declare v_de timestamptz; v_ate timestamptz;
begin
  if not public.compras_pode_ver_pessoa(p_pessoa) then raise exception 'Sem acesso.' using errcode = '42501'; end if;
  select j.de, j.ate into v_de, v_ate from public.compras_semanas s, public.compras_janela(s.inicio) j where s.id = p_semana;
  return query
    select m.id, m.enviada_em, m.autor_nome, m.tipo, m.texto, nullif(m.midia, ''), nullif(m.midia_nome, ''), nullif(m.midia_mime, '')
    from public.compras_mensagens_da_pessoa(p_pessoa, v_de, v_ate) x
    join public.wa_mensagens m on m.id = x.id and m.grupo_id = '120363040261291910@g.us'
    order by m.enviada_em;
end $$;
revoke all on function public.compras_pedido_mensagens(uuid, uuid) from public, anon;
grant execute on function public.compras_pedido_mensagens(uuid, uuid) to authenticated;

-- Arquivo do bucket whatsapp que é de um pedido de compras que o usuário pode ver (dos últimos 60 dias)
create or replace function public.compras_pode_ver_midia(p_nome text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.wa_mensagens m
    join public.operacao_pessoas o on o.ativo and o.papel = 'solicitante'
    left join public.compras_mensagens_pessoa x on x.mensagem_id = m.id and x.removido_em is null
    where m.grupo_id = '120363040261291910@g.us' and m.midia = p_nome and m.enviada_em > now() - interval '60 days'
      and (case when x.mensagem_id is not null then x.pessoa_id = o.id and not x.ignorada
                else public.compras_nome(m.autor_nome) = public.compras_nome(o.wa_nome) end)
      and public.compras_pode_ver_pessoa(o.id))
$$;

drop policy if exists "compras leem anexos do pedido" on storage.objects;
create policy "compras leem anexos do pedido" on storage.objects for select to authenticated
  using (bucket_id = 'whatsapp' and public.compras_pode_ver_midia(name));

-- O arquivo de uma mensagem do pedido (caminho no bucket, nome e tipo), só para quem pode ver aquele pedido
create or replace function public.compras_anexo(p_mensagem text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare m record;
begin
  select w.midia, w.midia_nome, w.midia_mime into m from public.wa_mensagens w
  where w.id = p_mensagem and w.grupo_id = '120363040261291910@g.us' and coalesce(w.midia, '') <> '' limit 1;
  if m.midia is null or not public.compras_pode_ver_midia(m.midia) then return null; end if;
  return jsonb_build_object('midia', m.midia, 'nome', m.midia_nome, 'mime', m.midia_mime);
end $$;
revoke all on function public.compras_anexo(text) from public, anon;
grant execute on function public.compras_anexo(text) to authenticated;
