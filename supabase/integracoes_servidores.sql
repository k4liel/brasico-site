-- Integrações: servidores e contas pagas (17/11/2026, pedido do dono: "tem que aparecer a hostinger e iproyal
-- explicando e mostrando valores"). Dois cartões novos no painel /integracoes: Hostinger (VPS e domínio) e
-- IPRoyal (proxy residencial do WhatsApp). A função integracoes_painel (supabase/integracoes.sql) devolve
-- fontes.servidores = { contratos, evolution }.

-- 1) O que pagamos a cada fornecedor (valores pagos, informados pelo dono em 17/11/2026: VPS R$ 110,00 por mês,
--    proxy R$ 26,00 por mês; a API de cobrança da Hostinger mostra a renovação da VPS a R$ 108,99 e o domínio a
--    R$ 64,99 por ano). Ao renovar ou trocar de plano, atualize valor, proxima_cobranca e conferido_em.
--    Nada se apaga: contrato encerrado = ativo false.
create table if not exists public.integracoes_contratos (
  id text primary key,
  fornecedor text not null,
  servico text not null,
  valor numeric(12, 2) not null,
  moeda text not null default 'BRL' check (moeda in ('BRL', 'USD')),
  periodo text not null default 'mês' check (periodo in ('mês', 'ano')),
  proxima_cobranca date,
  renova_sozinho boolean not null default true,
  observacao text,
  fonte_do_valor text,
  conferido_em timestamptz not null default now(),
  ordem int not null default 0,
  ativo boolean not null default true
);
alter table public.integracoes_contratos enable row level security;
drop policy if exists "socios leem contratos" on public.integracoes_contratos;
create policy "socios leem contratos" on public.integracoes_contratos for select to authenticated
  using (coalesce(public.notas_pode_ver(auth.uid()), false));
drop trigger if exists acesso_guarda on public.integracoes_contratos;
create trigger acesso_guarda before insert or update or delete on public.integracoes_contratos
  for each row execute function public.acesso_guarda('integracoes');

insert into public.integracoes_contratos (id, fornecedor, servico, valor, moeda, periodo, proxima_cobranca, renova_sozinho, observacao, fonte_do_valor, ordem) values
  ('hostinger_vps', 'Hostinger', 'VPS KVM 2 (2 CPUs, 8 GB, 100 GB)', 110.00, 'BRL', 'mês', '2026-11-20', true,
   'Servidor onde rodam a Evolution (WhatsApp), o robô do PMS dos hotéis e a rotina de pausas do WhatsApp.',
   'Informado pelo dono (valor pago), 17/11/2026', 1),
  ('hostinger_dominio', 'Hostinger', 'Domínio brasico.com.br', 64.99, 'BRL', 'ano', '2027-09-23', true,
   'Endereço wa.brasico.com.br da Evolution.', 'API de cobrança da Hostinger, 17/11/2026', 2),
  ('iproyal_proxy', 'IPRoyal', 'Proxy residencial fixo (Static Residential), 1 IP no Brasil', 26.00, 'BRL', 'mês', '2026-12-17', true,
   'Comprado em 17/11/2026, plano de 30 dias, tráfego ilimitado. O WhatsApp da Brasico conecta por ele.',
   'Informado pelo dono (valor pago), 17/11/2026', 3)
on conflict (id) do nothing;

-- 2) Estado da Evolution (WhatsApp) lido a cada 5 min: conexão, proxy ligado e de onde o proxy sai.
--    Uma linha só (id = 1). Gravada pela agenda (sem usuário), lida pelo painel.
create table if not exists public.wa_evolution_estado (
  id int primary key default 1 check (id = 1),
  respondeu boolean,          -- a Evolution respondeu (HTTP 200)
  vps_no_ar boolean,          -- a VPS respondeu (o Caddy responde mesmo com a Evolution em pausa)
  http_status int,
  evolution_ok_em timestamptz, -- última vez que a Evolution respondeu
  conexao text,
  motivo_queda text,
  caiu_em timestamptz,
  proxy_ligado boolean,
  proxy_local text,
  proxy_local_em timestamptz,
  lido_em timestamptz,
  erro text
);
alter table public.wa_evolution_estado enable row level security;
drop policy if exists "socios leem estado da evolution" on public.wa_evolution_estado;
create policy "socios leem estado da evolution" on public.wa_evolution_estado for select to authenticated
  using (coalesce(public.notas_pode_ver(auth.uid()), false));
drop trigger if exists acesso_guarda on public.wa_evolution_estado;
create trigger acesso_guarda before insert or update or delete on public.wa_evolution_estado
  for each row execute function public.acesso_guarda('whatsapp');
insert into public.wa_evolution_estado (id) values (1) on conflict do nothing;

create or replace function public.wa_evolution_ler()
returns jsonb
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_url text := (select decrypted_secret from vault.decrypted_secrets where name = 'wa_evolution_url');
  v_chave text := (select decrypted_secret from vault.decrypted_secrets where name = 'wa_evolution_chave');
  v_host text := (select decrypted_secret from vault.decrypted_secrets where name = 'wa_proxy_host');
  i extensions.http_response;
  p extensions.http_response;
  j jsonb; pj jsonb; loc jsonb;
  v_local text; v_local_em timestamptz;
begin
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '10');
  begin
    i := extensions.http(('GET', rtrim(v_url, '/') || '/instance/fetchInstances?instanceName=brasico',
           array[extensions.http_header('apikey', v_chave)], null, null)::extensions.http_request);
    p := extensions.http(('GET', rtrim(v_url, '/') || '/proxy/find/brasico',
           array[extensions.http_header('apikey', v_chave)], null, null)::extensions.http_request);
  exception when others then
    perform extensions.http_reset_curlopt();
    update public.wa_evolution_estado set respondeu = false, vps_no_ar = false, http_status = null,
      erro = left(sqlerrm, 300), lido_em = now() where id = 1;
    return jsonb_build_object('respondeu', false, 'erro', left(sqlerrm, 300));
  end;

  j := case when i.status = 200 then (i.content::jsonb)->0 end;
  pj := case when p.status = 200 then p.content::jsonb end;

  -- de onde o proxy sai (cidade e provedor), relido no máximo uma vez por dia
  select proxy_local, proxy_local_em into v_local, v_local_em from public.wa_evolution_estado where id = 1;
  if coalesce((pj->>'enabled')::boolean, false) and v_host is not null
     and (v_local_em is null or v_local_em < now() - interval '1 day') then
    begin
      loc := (extensions.http_get('http://ip-api.com/json/' || v_host || '?fields=status,city,regionName,isp')).content::jsonb;
      if loc->>'status' = 'success' then
        v_local := concat_ws(' · ', loc->>'city', loc->>'isp'); v_local_em := now();
      end if;
    exception when others then null;
    end;
  end if;
  perform extensions.http_reset_curlopt();

  update public.wa_evolution_estado set
    respondeu = i.status = 200,
    vps_no_ar = true,
    http_status = i.status,
    evolution_ok_em = case when i.status = 200 then now() else evolution_ok_em end,
    conexao = case when i.status = 200 then j->>'connectionStatus' else conexao end,
    motivo_queda = case when i.status <> 200 then motivo_queda when j->>'connectionStatus' = 'open' then null else j->>'disconnectionReasonCode' end,
    caiu_em = case when i.status <> 200 then caiu_em when j->>'connectionStatus' = 'open' then null else (j->>'disconnectionAt')::timestamptz end,
    proxy_ligado = case when p.status = 200 then coalesce((pj->>'enabled')::boolean, false) else proxy_ligado end,
    proxy_local = v_local,
    proxy_local_em = v_local_em,
    lido_em = now(),
    erro = case when i.status = 200 then null else 'Evolution respondeu ' || i.status end
  where id = 1;
  return (select to_jsonb(e) from public.wa_evolution_estado e where id = 1);
end $$;
revoke all on function public.wa_evolution_ler() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'whatsapp-evolution-estado';
select cron.schedule('whatsapp-evolution-estado', '*/5 * * * *', $$select public.wa_evolution_ler()$$);
