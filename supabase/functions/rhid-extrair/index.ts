// Copia do RHiD (ponto em nuvem da Control iD) os cadastros de cada cliente que o login enxerga:
// empresas, departamentos, cargos, relógios e pessoas. Somente leitura.
// Chamada pelo banco (rhid_pedir, via pg_net) com o segredo no cabeçalho x-segredo.
// Corpo: { "execucao": "<id em rhid_execucoes>" }. Responde na hora e trabalha em segundo plano.
// E-mail e senha ficam no Vault (rhid_email, rhid_senha). Nada de segredo nos logs.
// Nunca copia senha do funcionário, crachá (RFID), código de barras, digitais nem foto.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const API = "https://www.rhid.com.br/v2/api.svc";
const TIMEOUT_MS = 60000;

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// deno-lint-ignore no-explicit-any
type J = any;

class ErroRhid extends Error {}

const txt = (v: unknown) => String(v ?? "").trim();
const num = (v: unknown) => (v == null || v === "" || !isFinite(Number(v)) ? null : Number(v));
const digitos = (v: unknown) => txt(v).replace(/\D/g, "");

// Datas do .NET: "2026-06-01T08:00:00" ou "/Date(1780000000000-0300)/"
function quando(v: unknown) {
  const s = txt(v);
  if (!s) return null;
  const m = s.match(/\/Date\((-?\d+)/);
  const d = m ? new Date(Number(m[1])) : new Date(s);
  if (isNaN(d.getTime()) || d.getUTCFullYear() < 1950) return null;
  return d.toISOString();
}
const dia = (v: unknown) => quando(v)?.slice(0, 10) ?? null;

async function pedir(caminho: string, init: RequestInit) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${API}${caminho}`, { ...init, signal: ctl.signal });
    const corpo = await r.text();
    let p: J = null;
    try {
      p = corpo ? JSON.parse(corpo) : null;
    } catch {
      if (!r.ok) throw new ErroRhid(`HTTP ${r.status}`);
      throw new ErroRhid(`${caminho}: resposta que não é JSON`);
    }
    if (!r.ok) throw new ErroRhid(`${caminho}: HTTP ${r.status}${p?.error ? ` (${txt(p.error).slice(0, 120)})` : ""}`);
    // Alguns endpoints devolvem o JSON serializado como texto
    if (typeof p === "string") {
      try {
        return JSON.parse(p);
      } catch {
        return p;
      }
    }
    return p;
  } catch (e) {
    if (e instanceof ErroRhid) throw e;
    throw new ErroRhid(ctl.signal.aborted ? `${caminho}: tempo esgotado` : `${caminho}: falha de conexão`);
  } finally {
    clearTimeout(t);
  }
}

type Login = { token: string; clientes: { id: number; dominio: string; nome: string }[] };

async function entrar(email: string, senha: string, dominio?: string): Promise<Login> {
  const body: Record<string, string> = { email, password: senha };
  if (dominio) body.domain = dominio;
  const p = await pedir("/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (p?.expiredPassword) throw new ErroRhid("a senha do usuário do RHiD venceu; troque no RHiD e no Vault");
  if (p?.customerBlocked) throw new ErroRhid("cliente bloqueado no RHiD");
  const clientes = (Array.isArray(p?.listCustomer) ? p.listCustomer : [])
    .map((c: J) => ({ id: Number(c?.id), dominio: txt(c?.domain), nome: txt(c?.name) }))
    .filter((c: { id: number }) => Number.isFinite(c.id));
  const token = txt(p?.accessToken);
  if (!token && !clientes.length) throw new ErroRhid(`login recusado${p?.error ? ` (${txt(p.error).slice(0, 120)})` : ""}`);
  return { token, clientes };
}

const lista = (p: J): J[] => (Array.isArray(p) ? p : Array.isArray(p?.records) ? p.records : []);

async function ler(token: string, caminho: string) {
  return lista(await pedir(caminho, { headers: { Authorization: `Bearer ${token}` } }));
}

async function gravar(tabela: string, linhas: Record<string, unknown>[]) {
  for (let i = 0; i < linhas.length; i += 500) {
    const { error } = await supabase.from(tabela).upsert(linhas.slice(i, i + 500), { onConflict: "cliente_id,id" });
    if (error) throw new Error(`gravação em ${tabela}: ${error.message}`);
  }
}

// Um cliente RHiD: lê os cadastros e grava
async function copiarCliente(cliente: number, token: string) {
  const agora = new Date().toISOString();
  const [empresas, departamentos, cargos, relogios, pessoas] = [
    await ler(token, "/company"),
    await ler(token, "/department"),
    await ler(token, "/personroles"),
    await ler(token, "/device"),
    await ler(token, "/person"),
  ];
  const base = (x: J) => ({ cliente_id: cliente, id: Number(x?.id), atualizado_em: agora });
  const valido = (x: { id: number }) => Number.isFinite(x.id);

  await gravar("rhid_empresas", empresas.map((x) => ({
    ...base(x), cnpj: digitos(x.cnpj), nome: txt(x.name), fantasia: txt(x.tradingName),
    cidade: txt(x.city), uf: txt(x.state), pessoas: num(x.numPersons),
  })).filter(valido));
  await gravar("rhid_departamentos", departamentos.map((x) => ({
    ...base(x), nome: txt(x.name), empresa_id: num(x.idCompany),
  })).filter(valido));
  await gravar("rhid_cargos", cargos.map((x) => ({
    ...base(x), nome: txt(x.name), empresa_id: num(x.idCompany), departamento_id: num(x.idDepartment),
  })).filter(valido));
  await gravar("rhid_relogios", relogios.map((x) => ({
    ...base(x), nome: txt(x.name), serial: txt(x.serial), modelo: txt(x.model), versao: txt(x.version),
    situacao: txt(x.status), empresa_id: num(x.linkedCompanyId), pessoas: num(x.numberOfPeople),
    ultima_conexao: quando(x.lastConnectionDate), ultima_sincronizacao: quando(x.lastSyncDate),
  })).filter(valido));
  const linhasPessoas = pessoas.map((x) => ({
    ...base(x), nome: txt(x.name), nome_social: txt(x.socialName), cpf: digitos(x.cpf), pis: digitos(x.pis),
    matricula: txt(x.registration), empresa_id: num(x.idCompany), departamento_id: num(x.idDepartment),
    situacao: num(x.status), admissao: dia(x.admissionDate), presente: true,
  })).filter(valido);
  await gravar("rhid_pessoas", linhasPessoas);
  // Quem não veio nesta cópia fica marcado, sem apagar
  if (linhasPessoas.length) {
    const { error } = await supabase.from("rhid_pessoas").update({ presente: false })
      .eq("cliente_id", cliente).lt("atualizado_em", agora).eq("presente", true);
    if (error) throw new Error(`marcar ausentes: ${error.message}`);
  }
  return { empresas: empresas.length, departamentos: departamentos.length, cargos: cargos.length, relogios: relogios.length, pessoas: linhasPessoas.length };
}

async function processar(execucaoId: string) {
  const { data: ex } = await supabase.from("rhid_execucoes").select("id,status").eq("id", execucaoId).maybeSingle();
  if (!ex || ex.status !== "na_fila") return;
  await supabase.from("rhid_execucoes").update({ status: "rodando", inicio: new Date().toISOString() }).eq("id", ex.id);

  const resumo: Record<string, unknown> = {};
  const fim = (status: string, erro = "") =>
    supabase.from("rhid_execucoes").update({ status, erro: erro.slice(0, 500), fim: new Date().toISOString(), resumo }).eq("id", ex.id);

  try {
    const { data: c } = await supabase.rpc("rhid_credenciais").maybeSingle<{ email: string; senha: string }>();
    if (!c?.email || !c?.senha) throw new ErroRhid("faltam o e-mail e a senha do RHiD no Vault (rhid_email, rhid_senha)");

    const primeiro = await entrar(c.email, c.senha);
    let clientes = primeiro.clientes;
    if (!clientes.length) clientes = [{ id: 0, dominio: "", nome: "RHiD" }];
    const { error } = await supabase.from("rhid_clientes").upsert(
      clientes.map((x) => ({ id: x.id, dominio: x.dominio, nome: x.nome, atualizado_em: new Date().toISOString() })),
      { onConflict: "id", ignoreDuplicates: false },
    );
    if (error) throw new Error(`gravação de clientes: ${error.message}`);
    const { data: ativos } = await supabase.from("rhid_clientes").select("id").eq("ativo", true);
    const ligados = new Set((ativos ?? []).map((x: { id: number }) => Number(x.id)));

    const falhas: string[] = [];
    for (const cl of clientes) {
      if (!ligados.has(cl.id)) continue;
      try {
        // Com um cliente só, o token do primeiro login já serve; com vários, entra de novo no domínio de cada um
        const token = clientes.length === 1 && primeiro.token ? primeiro.token : (await entrar(c.email, c.senha, cl.dominio)).token;
        if (!token) throw new ErroRhid("login sem token");
        resumo[cl.nome || String(cl.id)] = await copiarCliente(cl.id, token);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "erro desconhecido";
        falhas.push(`${cl.nome || cl.id}: ${msg}`);
        resumo[cl.nome || String(cl.id)] = { erro: msg };
      }
    }
    await fim(falhas.length === clientes.length ? "falha" : "ok", falhas.join("; "));
    console.log(JSON.stringify({ integracao: "rhid", correlation_id: ex.id, clientes: clientes.length, falhas: falhas.length }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "erro desconhecido";
    await fim("falha", msg);
    console.log(JSON.stringify({ integracao: "rhid", correlation_id: ex.id, status: "falha", erro: msg }));
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Use POST", { status: 405 });
  const { data: ok } = await supabase.rpc("rhid_conferir_segredo", { p_segredo: req.headers.get("x-segredo") ?? "" });
  if (!ok) return new Response("Sem permissão", { status: 401 });
  const corpo = await req.json().catch(() => ({}));
  const id = String(corpo.execucao ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Falta a execução", { status: 400 });
  EdgeRuntime.waitUntil(processar(id));
  return new Response(JSON.stringify({ recebido: id }), { headers: { "Content-Type": "application/json" } });
});
