-- Histórico da escala (11/11/2026, pedido do dono: "para termos um controle", saber quem mudou o quê na escala
-- e no banco de compensas). Só os sócios veem. Nada se apaga.
--   · dias da escala: já ficavam em escala_planejada_historico (gravado por escala_gravar)
--   · compensas: escala_compensas_historico (gatilho a cada inclusão ou mudança: feriado trabalhado, saldo lançado,
--     cancelada, dada numa FC, devolvida)
--   · apelidos: escala_apelidos_historico (gatilho)
-- Leitura: escala_historico(de, ate, por) → itens (o mais novo primeiro) e a lista de quem mexeu no período.

create table if not exists public.escala_compensas_historico (
  id bigserial primary key,
  compensa_id bigint not null,
  cliente_id bigint not null,
  pessoa_id bigint not null,
  antes jsonb,
  depois jsonb not null,
  por uuid,
  em timestamptz not null default now()
);
create index if not exists escala_compensas_historico_em on public.escala_compensas_historico (em desc);
alter table public.escala_compensas_historico enable row level security;

create table if not exists public.escala_apelidos_historico (
  id bigserial primary key,
  cliente_id bigint not null,
  pessoa_id bigint not null,
  antes text,
  depois text,
  por uuid,
  em timestamptz not null default now()
);
create index if not exists escala_apelidos_historico_em on public.escala_apelidos_historico (em desc);
alter table public.escala_apelidos_historico enable row level security;

create index if not exists escala_planejada_historico_em on public.escala_planejada_historico (em desc);

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'escala_compensas_historico_sem_exclusao') then
    create trigger escala_compensas_historico_sem_exclusao before delete on public.escala_compensas_historico for each row execute function public.bloquear_exclusao();
    create trigger escala_compensas_historico_sem_truncate before truncate on public.escala_compensas_historico for each statement execute function public.bloquear_exclusao();
    create trigger escala_apelidos_historico_sem_exclusao before delete on public.escala_apelidos_historico for each row execute function public.bloquear_exclusao();
    create trigger escala_apelidos_historico_sem_truncate before truncate on public.escala_apelidos_historico for each statement execute function public.bloquear_exclusao();
  end if;
end $$;

-- Gatilhos que guardam cada mudança
create or replace function public.escala_compensas_registrar()
returns trigger language plpgsql security definer set search_path = public as $$
declare a jsonb; d jsonb;
begin
  d := to_jsonb(new) - 'criado_em' - 'atualizado_em' - 'criado_por' - 'atualizado_por';
  if tg_op = 'UPDATE' then
    a := to_jsonb(old) - 'criado_em' - 'atualizado_em' - 'criado_por' - 'atualizado_por';
    if a = d then return new; end if;
  end if;
  insert into public.escala_compensas_historico (compensa_id, cliente_id, pessoa_id, antes, depois, por)
  values (new.id, new.cliente_id, new.pessoa_id, a, d, coalesce(auth.uid(), new.atualizado_por, new.criado_por));
  return new;
end $$;
drop trigger if exists escala_compensas_historico on public.escala_compensas;
create trigger escala_compensas_historico after insert or update on public.escala_compensas
  for each row execute function public.escala_compensas_registrar();

create or replace function public.escala_apelidos_registrar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and old.apelido is not distinct from new.apelido then return new; end if;
  insert into public.escala_apelidos_historico (cliente_id, pessoa_id, antes, depois, por)
  values (new.cliente_id, new.pessoa_id, case when tg_op = 'UPDATE' then old.apelido end, new.apelido, coalesce(auth.uid(), new.atualizado_por));
  return new;
end $$;
drop trigger if exists escala_apelidos_historico on public.escala_apelidos;
create trigger escala_apelidos_historico after insert or update on public.escala_apelidos
  for each row execute function public.escala_apelidos_registrar();

revoke execute on function public.escala_compensas_registrar() from public, anon, authenticated;
revoke execute on function public.escala_apelidos_registrar() from public, anon, authenticated;

-- Leitura para a tela (só sócios). Datas no horário de Fortaleza; sem datas = últimos 30 dias.
create or replace function public.escala_historico(p_de date default null, p_ate date default null, p_por uuid default null, p_limite int default 1500)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_de timestamptz := ((coalesce(p_de, (now() at time zone 'America/Fortaleza')::date - 30))::timestamp) at time zone 'America/Fortaleza';
  v_ate timestamptz := ((coalesce(p_ate, (now() at time zone 'America/Fortaleza')::date) + 1)::timestamp) at time zone 'America/Fortaleza';
  v jsonb;
begin
  if not public.rhid_pode_ver(auth.uid()) then
    raise exception 'Só os sócios veem o histórico da escala.' using errcode = '42501';
  end if;
  with tudo as (
    select 'escala'::text tipo, h.id, h.em, h.por, h.cliente_id, h.pessoa_id, h.dia, h.antes, h.depois
      from public.escala_planejada_historico h where h.em >= v_de and h.em < v_ate
    union all
    select 'compensa', h.id, h.em, h.por, h.cliente_id, h.pessoa_id, null, h.antes, h.depois
      from public.escala_compensas_historico h where h.em >= v_de and h.em < v_ate
    union all
    select 'apelido', h.id, h.em, h.por, h.cliente_id, h.pessoa_id, null, to_jsonb(h.antes), to_jsonb(h.depois)
      from public.escala_apelidos_historico h where h.em >= v_de and h.em < v_ate
  ),
  quem as (
    select t.por, coalesce(max(o.nome), max(nullif(pr.display_name, '')), max(split_part(pr.email, '@', 1)), 'Sistema') nome,
           count(*) n, bool_or(public.rhid_pode_ver(t.por)) socio
      from tudo t
      left join public.operacao_pessoas o on o.user_id = t.por
      left join public.profiles pr on pr.id = t.por
     group by t.por
  ),
  itens as (
    select t.*, q.nome quem,
           coalesce(nullif(ap.apelido, ''), rp.nome, ex.nome, 'Pessoa ' || t.pessoa_id) pessoa,
           g.local, g.setor
      from tudo t
      join quem q on q.por is not distinct from t.por
      left join public.rhid_pessoas rp on t.cliente_id <> 0 and rp.cliente_id = t.cliente_id and rp.id = t.pessoa_id
      left join public.escala_extras ex on t.cliente_id = 0 and ex.id = t.pessoa_id
      left join public.escala_apelidos ap on ap.cliente_id = t.cliente_id and ap.pessoa_id = t.pessoa_id
      left join public.escala_membros m on m.cliente_id = t.cliente_id and m.pessoa_id = t.pessoa_id
      left join public.escala_grupos g on g.id = m.grupo_id
     where p_por is null or t.por is not distinct from p_por
     order by t.em desc, t.id desc
     limit greatest(1, least(coalesce(p_limite, 1500), 5000))
  )
  select jsonb_build_object(
    'de', (v_de at time zone 'America/Fortaleza')::date,
    'ate', ((v_ate at time zone 'America/Fortaleza')::date - 1),
    'usuarios', coalesce((select jsonb_agg(jsonb_build_object('id', por, 'nome', nome, 'n', n, 'socio', socio) order by n desc) from quem), '[]'),
    'itens', coalesce((select jsonb_agg(jsonb_build_object(
        'tipo', tipo, 'id', id, 'em', em, 'por', por, 'quem', quem, 'cliente_id', cliente_id, 'pessoa_id', pessoa_id,
        'pessoa', pessoa, 'local', local, 'setor', setor, 'dia', dia, 'antes', antes, 'depois', depois) order by em desc, id desc) from itens), '[]')
  ) into v;
  return v;
end $$;
revoke execute on function public.escala_historico(date, date, uuid, int) from public, anon;
grant execute on function public.escala_historico(date, date, uuid, int) to authenticated;

-- Maurício (Sempre Vivo, já pede compras): monta a escala da casa Sempre Vivo inteira e gerencia as compensas,
-- igual à Carol (11/11/2026, pedido do dono). Continua com o papel de compras.
insert into public.escala_lideres_locais (pessoa_id, local)
select o.id, 'Sempre Vivo' from public.operacao_pessoas o
 where o.nome = 'Maurício' and o.unidade = 'sempre_vivo' and o.ativo
on conflict (pessoa_id, local) do update set arquivado_em = null;
update public.operacao_pessoas set gerencia_compensas = true where nome = 'Maurício' and unidade = 'sempre_vivo';

-- As compensas de antes do histórico (11/11/2026): uma linha de criação (quem lançou, quando) e, se mudou depois,
-- uma da última mudança (quem e quando). Marcadas com "retroativo": não se sabe o caminho do meio.
with base as (
  select c.*, (to_jsonb(c) - 'criado_em' - 'atualizado_em' - 'criado_por' - 'atualizado_por') atual,
         (to_jsonb(c) - 'criado_em' - 'atualizado_em' - 'criado_por' - 'atualizado_por')
           || jsonb_build_object('situacao', case when c.motivo = 'não trabalhou' then 'cancelada' else 'aberta' end, 'usada_dia', null,
                                 'motivo', replace(c.motivo, ' (cancelado)', '')) inicio
    from public.escala_compensas c
   where not exists (select 1 from public.escala_compensas_historico h where h.compensa_id = c.id)
)
insert into public.escala_compensas_historico (compensa_id, cliente_id, pessoa_id, antes, depois, por, em)
select id, cliente_id, pessoa_id, null, inicio || '{"retroativo": true}', criado_por, criado_em from base
union all
select id, cliente_id, pessoa_id, inicio, atual || '{"retroativo": true}', atualizado_por, atualizado_em from base where atual <> inicio;
