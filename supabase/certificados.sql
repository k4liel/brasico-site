-- =====================================================================
-- Certificados digitais (e-CNPJ A1): um por CNPJ completo, matriz e filiais
--  - Matriz (final 0001): cofre esocial_cert_<raiz>, como antes. É o certificado
--    que o eSocial e a Receita Federal usam (colunas cert_* de esocial_empresas).
--  - Filial: cofre cert_<cnpj>. Fica guardada à parte e nunca substitui a matriz
--    nem altera esocial_empresas.
--  - Enviar de novo o mesmo CNPJ troca só aquele certificado (renovação).
-- Página: Menu → Certificados digitais (components/Certificados.tsx).
-- =====================================================================

create table if not exists public.certificados (
  cnpj text primary key check (cnpj ~ '^[A-Z0-9]{12}[0-9]{2}$'),
  raiz text not null generated always as (left(cnpj, 8)) stored,
  matriz boolean not null generated always as (substr(cnpj, 9, 4) = '0001') stored,
  nome text not null,
  titular text,
  emissor text,
  validade timestamptz not null,
  cofre text not null,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references auth.users(id)
);
create index if not exists certificados_raiz on public.certificados (raiz);

alter table public.certificados enable row level security;
drop policy if exists "ver certificados" on public.certificados;
create policy "ver certificados" on public.certificados for select using (public.esocial_pode_ver(auth.uid()));
revoke all on public.certificados from public, anon, authenticated;
grant select on public.certificados to authenticated;

-- Exclusões bloqueadas, como no resto do Brasico
drop trigger if exists certificados_sem_exclusao on public.certificados;
create trigger certificados_sem_exclusao before delete on public.certificados for each row execute function public.bloquear_exclusao();
drop trigger if exists certificados_sem_truncate on public.certificados;
create trigger certificados_sem_truncate before truncate on public.certificados for each statement execute function public.bloquear_exclusao();

-- Os certificados de matriz que já estavam guardados
insert into public.certificados (cnpj, nome, titular, emissor, validade, cofre, atualizado_em, atualizado_por)
select e.cert_cnpj, e.nome, e.cert_titular, e.cert_emissor, e.cert_validade, 'esocial_cert_' || e.id,
  coalesce(e.cert_atualizado_em, now()), e.cert_atualizado_por
from public.esocial_empresas e
where e.cert_cnpj is not null and e.cert_validade is not null
on conflict (cnpj) do nothing;

create or replace function public.esocial_guardar_certificado(p_raiz text, p_nome text, p_cnpj text, p_titular text,
  p_emissor text, p_validade timestamptz, p_pem text)
returns jsonb language plpgsql security definer set search_path = public, vault as $$
declare v_matriz boolean; v_nome text; v_id uuid;
begin
  if not public.esocial_pode_ver(auth.uid()) then raise exception 'Sem acesso ao eSocial' using errcode = '42501'; end if;
  if p_raiz !~ '^[A-Z0-9]{8}$' or p_cnpj !~ '^[A-Z0-9]{12}[0-9]{2}$' or left(p_cnpj, 8) <> p_raiz then
    raise exception 'O certificado não traz um CNPJ válido.';
  end if;
  if p_validade <= now() then raise exception 'Este certificado já venceu.'; end if;
  if coalesce(p_pem, '') not like '%BEGIN CERTIFICATE%' or p_pem not like '%PRIVATE KEY%' then
    raise exception 'Certificado incompleto (falta o certificado ou a chave).';
  end if;

  v_matriz := substr(p_cnpj, 9, 4) = '0001';
  -- Matriz no lugar de sempre (usado pelo eSocial e pela Receita); filial num lugar só dela
  v_nome := case when v_matriz then 'esocial_cert_' || p_raiz else 'cert_' || p_cnpj end;

  select id into v_id from vault.secrets where name = v_nome;
  if v_id is null then perform vault.create_secret(p_pem, v_nome);
  else perform vault.update_secret(v_id, p_pem); end if;

  insert into public.certificados (cnpj, nome, titular, emissor, validade, cofre, atualizado_em, atualizado_por)
  values (p_cnpj, p_nome, p_titular, p_emissor, p_validade, v_nome, now(), auth.uid())
  on conflict (cnpj) do update set nome = excluded.nome, titular = excluded.titular, emissor = excluded.emissor,
    validade = excluded.validade, cofre = excluded.cofre, atualizado_em = now(), atualizado_por = auth.uid();

  if v_matriz then
    insert into public.esocial_empresas (id, nome, cnpj, cert_titular, cert_cnpj, cert_emissor, cert_validade, cert_atualizado_em, cert_atualizado_por)
    values (p_raiz, p_nome, p_cnpj, p_titular, p_cnpj, p_emissor, p_validade, now(), auth.uid())
    on conflict (id) do update set cnpj = coalesce(public.esocial_empresas.cnpj, excluded.cnpj),
      cert_titular = excluded.cert_titular, cert_cnpj = excluded.cert_cnpj, cert_emissor = excluded.cert_emissor,
      cert_validade = excluded.cert_validade, cert_atualizado_em = now(), cert_atualizado_por = auth.uid();
  end if;
  return jsonb_build_object('empresa', p_raiz, 'nome', p_nome, 'cnpj', p_cnpj, 'matriz', v_matriz, 'validade', p_validade);
end $$;
revoke execute on function public.esocial_guardar_certificado(text, text, text, text, text, timestamptz, text) from public, anon;
grant execute on function public.esocial_guardar_certificado(text, text, text, text, text, timestamptz, text) to authenticated;
