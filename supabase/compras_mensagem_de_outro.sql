-- Pedido mandado no grupo COMPRAS por uma pessoa em nome de outra (09/11/2026: a Fernanda mandou a lista do Vitor).
-- Uma linha aqui faz a análise (Edge Function compras-analise) contar a mensagem para `pessoa_id` e não para quem enviou.
-- Nada se apaga: para desfazer, `removido_em`.
create table if not exists public.compras_mensagens_pessoa (
  mensagem_id text primary key, -- id da mensagem em wa_mensagens (grupo COMPRAS)
  pessoa_id uuid not null references public.operacao_pessoas(id),
  motivo text,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  removido_em timestamptz
);
alter table public.compras_mensagens_pessoa enable row level security;
create policy ver on public.compras_mensagens_pessoa for select
  using (coalesce(public.operacao_papel(auth.uid()), '') in ('socio', 'compras'));

-- Primeiro uso: o PDF "COMPRAS RESTAURANTE VITOR2" (Fernanda, 09/11/2026 15h33) é do Vitor (Filha da Lua · Salão)
insert into public.compras_mensagens_pessoa (mensagem_id, pessoa_id, motivo)
select '3AEFE4937F3276C59B49', id, 'lista do Vitor enviada pela Fernanda'
from public.operacao_pessoas where nome = 'Vitor' and unidade = 'filha_da_lua'
on conflict do nothing;
