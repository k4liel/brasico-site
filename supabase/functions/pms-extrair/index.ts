// Lê o PMS dos hotéis (TOTVS Hospitalidade, "PMS SaaS") e grava ocupação e previsão.
// Chamada pelo banco (pms_pedir, via pg_net) com o segredo no cabeçalho x-segredo.
// Corpo: { "execucao": "<id em pms_execucoes>" }. Responde na hora e trabalha em segundo plano.
// Usuário e senha ficam no Vault (pms_usuario, pms_senha). Nada de token ou senha nos logs.
//
// Caminho (descoberto no código público do site, 07/11/2026):
//   1. POST id.totvshospitalidade.com/thexidentity-auth/api/signin {login, password, productType:"PMS"} -> token do usuário
//   2. GET  group01.../thexidentity/api/tenant/allowed/producttype/PMS -> empresas do usuário (acha o hotel pelo CNPJ)
//   3. POST .../signin/v2/tenant {tenantId, productType:"PMS"} -> token da empresa (traz o propertyId)
//   4. GET  group05.../pmsreport/api/reservationReport/propertydashboard -> painel do dia
//   5. GET  group05.../availability/api/Availability/{propertyId}/roomtypes?InitialDate=..&Period=30 (máximo 30) -> previsão
// Só números do hotel: listas de hóspedes do painel (checkInList/checkOutList) não são gravadas.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const AUTH = "https://id.totvshospitalidade.com/thexidentity-auth/api";
const IDENTIDADE = "https://group01.totvshospitalidade.com/thexidentity/api";
const RELATORIO = "https://group05.totvshospitalidade.com/pmsreport/api";
const DISPONIBILIDADE = "https://group05.totvshospitalidade.com/availability/api";
const PRODUTO = "PMS";
const TIMEOUT_MS = 45000;
const DIAS_PREVISAO = 60;
const UA = "Brasico/1.0 (leitura de ocupacao)";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// deno-lint-ignore no-explicit-any
type J = any;
class ErroPms extends Error {}

const num = (v: unknown) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const digitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const semAcento = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

function hojeFortaleza() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Fortaleza" }).format(new Date());
}
function somaDias(dia: string, n: number) {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function pedir(url: string, init: RequestInit & { token?: string } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const headers: Record<string, string> = { Accept: "application/json", "User-Agent": UA, "Accept-Language": "pt-BR" };
  if (init.body) headers["Content-Type"] = "application/json";
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  try {
    const r = await fetch(url, { ...init, headers, signal: ctl.signal });
    const texto = await r.text();
    let corpo: J = null;
    try { corpo = texto ? JSON.parse(texto) : null; } catch { /* resposta sem JSON */ }
    if (!r.ok) {
      const det = corpo?.details?.[0]?.message ?? corpo?.message ?? corpo?.title ?? "";
      throw new ErroPms(`HTTP ${r.status}${det ? ` (${String(det).slice(0, 150)})` : ""}`);
    }
    return corpo;
  } catch (e) {
    if (e instanceof ErroPms) throw e;
    throw new ErroPms(ctl.signal.aborted ? "tempo esgotado" : "falha de conexão");
  } finally {
    clearTimeout(t);
  }
}

async function entrar(usuario: string, senha: string) {
  const r = await pedir(`${AUTH}/signin`, {
    method: "POST",
    body: JSON.stringify({ login: usuario.trim(), password: senha, productType: PRODUTO }),
  }).catch((e) => { throw new ErroPms(`login recusado: ${e.message}`); });
  if (r?.twoFactorEnabled && !r?.authenticated && r?.token) {
    throw new ErroPms("o usuário do PMS está com a verificação em duas etapas ligada; o robô não consegue entrar");
  }
  if (!r?.token) throw new ErroPms("login sem token na resposta");
  return String(r.token);
}

async function entrarNaEmpresa(tokenUsuario: string, tenantId: string) {
  const r = await pedir(`${AUTH}/signin/v2/tenant`, {
    method: "POST", token: tokenUsuario, body: JSON.stringify({ tenantId, productType: PRODUTO }),
  });
  if (!r?.token) throw new ErroPms("troca de empresa sem token na resposta");
  let propertyId: number | null = null;
  try {
    const p = JSON.parse(atob(String(r.token).split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    propertyId = num(JSON.parse(atob(p.productMetadata ?? ""))?.propertyId);
  } catch { /* sem metadados: usa o property_id cadastrado */ }
  return { token: String(r.token), propertyId };
}

// Rodapé da disponibilidade: nome da linha -> campo da tabela
const RODAPE: Record<string, string> = {
  bloqueadas: "bloqueadas",
  disponiveis: "disponiveis",
  ocupacao: "ocupadas",
  "ocup. individuais": "individuais",
  "ocup. grupo": "grupo",
  "ocup. confirmada": "confirmadas",
  "ocup. a confirmar": "a_confirmar",
  tentativas: "tentativas",
};

async function previsao(token: string, propertyId: number, inicio: string) {
  const dias = new Map<string, J>();
  for (let desloc = 0; desloc < DIAS_PREVISAO; desloc += 30) {
    const ini = somaDias(inicio, desloc);
    const a = await pedir(`${DISPONIBILIDADE}/Availability/${propertyId}/roomtypes?InitialDate=${ini}T00:00:00&Period=30&culture=pt-BR`, { token });
    const tipos = new Map<number, string>((a?.roomTypeList ?? []).map((t: J) => [Number(t.id), String(t.name ?? "")]));
    const uhs = (a?.roomTypeList ?? []).reduce((s: number, t: J) => s + (num(t.total) ?? 0), 0) || null;
    for (const linha of a?.footerList ?? []) {
      const campo = RODAPE[semAcento(String(linha?.name ?? ""))];
      if (!campo) continue;
      for (const v of linha?.values ?? []) {
        const dia = String(v?.dateFormatted ?? "").slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || dia < inicio) continue;
        const d = dias.get(dia) ?? { dia, uhs, por_tipo: [] };
        d[campo] = num(v?.number);
        if (campo === "ocupadas") d.ocupacao = num(v?.percentage);
        dias.set(dia, d);
      }
    }
    for (const x of a?.availabilityList ?? []) {
      const dia = String(x?.day ?? x?.dateFormatted ?? "").slice(0, 10);
      const d = dias.get(dia);
      if (!d) continue;
      d.por_tipo.push({
        tipo: tipos.get(Number(x.roomTypeId)) ?? String(x.roomTypeId),
        total: num(x.roomTotal), ocupadas: num(x.occupiedRooms), disponiveis: num(x.availableRooms), bloqueadas: num(x.blockedQuantity),
      });
    }
  }
  return [...dias.values()].sort((a, b) => a.dia.localeCompare(b.dia));
}

async function processar(execucaoId: string) {
  const { data: ex } = await supabase.from("pms_execucoes").select("id,status").eq("id", execucaoId).maybeSingle();
  if (!ex || ex.status !== "na_fila") return;
  await supabase.from("pms_execucoes").update({ status: "rodando", inicio: new Date().toISOString() }).eq("id", ex.id);

  const passos: J[] = [];
  const hoteisRes: J[] = [];
  const fim = (status: string, erro = "") =>
    supabase.from("pms_execucoes").update({
      status, erro: erro.slice(0, 500), fim: new Date().toISOString(), resultado: { passos, hoteis: hoteisRes },
    }).eq("id", ex.id);

  try {
    const { data: c } = await supabase.rpc("pms_credenciais").maybeSingle<{ usuario: string; senha: string }>();
    if (!c?.usuario || !c?.senha) throw new ErroPms("faltam pms_usuario e pms_senha no Vault");

    const tokenUsuario = await entrar(c.usuario, c.senha);
    passos.push({ passo: "login", ok: true });

    const { data: hoteis } = await supabase.from("pms_hoteis").select("*").eq("ativa", true).order("ordem");
    if (!hoteis?.length) throw new ErroPms("nenhum hotel ativo em pms_hoteis");

    // Empresas liberadas para o usuário; o hotel é achado pelo CNPJ
    let empresas: J[] = [];
    if (hoteis.some((h: J) => !h.tenant_id)) {
      const lista = await pedir(`${IDENTIDADE}/tenant/allowed/producttype/${PRODUTO}`, { token: tokenUsuario });
      empresas = Array.isArray(lista) ? lista : lista?.items ?? [];
      passos.push({ passo: "empresas", ok: true, quantidade: empresas.length });
    }

    const hoje = hojeFortaleza();
    for (const h of hoteis) {
      const r: J = { hotel: h.id, ok: false };
      hoteisRes.push(r);
      try {
        let tenantId = h.tenant_id as string | null;
        if (!tenantId) {
          const e = empresas.find((x) => digitos(x.documentNumber) === digitos(h.cnpj));
          if (!e?.tenantId) throw new ErroPms(`o usuário do PMS não tem acesso ao CNPJ ${h.cnpj}`);
          tenantId = String(e.tenantId);
          await supabase.from("pms_hoteis").update({ tenant_id: tenantId, property_id: num(e.propertyId) ?? h.property_id }).eq("id", h.id);
        }
        const emp = await entrarNaEmpresa(tokenUsuario, tenantId);
        const propertyId = emp.propertyId ?? h.property_id;
        if (!propertyId) throw new ErroPms("hotel sem propertyId");

        const painel = await pedir(`${RELATORIO}/reservationReport/propertydashboard?culture=pt-BR`, { token: emp.token });
        const o = painel?.overview ?? {};
        r.nome_no_pms = o.propertyName ?? null;
        const prev = await previsao(emp.token, propertyId, hoje);
        const uhs = prev[0]?.uhs ?? null;

        const { error: e1 } = await supabase.from("pms_dias").upsert({
          hotel_id: h.id, dia: hoje, uhs,
          ocupadas: num(o.totalOccupiedRoom), livres: num(o.totalAvailableRoom), bloqueadas: num(o.totalBlockedRoom),
          ocupacao: num(o.occupationPercentage), ocupacao_prevista: num(o.predictedOccupationPercentage),
          checkins: num(o.totalCheckIn), checkouts: num(o.totalCheckOut),
          checkins_previstos: num(o.totalEstimatedCheckIn), checkouts_previstos: num(o.totalEstimatedCheckOut),
          walk_in: num(o.totalWalkIn), day_use: num(o.totalDayUse),
          painel: o, lido_em: new Date().toISOString(), execucao_id: ex.id,
        }, { onConflict: "hotel_id,dia" });
        if (e1) throw new Error(`gravação do painel: ${e1.message}`);

        if (prev.length) {
          const { error: e2 } = await supabase.from("pms_previsao").upsert(prev.map((d) => ({
            hotel_id: h.id, dia: d.dia, lido_dia: hoje, uhs: d.uhs,
            ocupadas: d.ocupadas ?? null, disponiveis: d.disponiveis ?? null, bloqueadas: d.bloqueadas ?? null,
            ocupacao: d.ocupacao ?? null, individuais: d.individuais ?? null, grupo: d.grupo ?? null,
            confirmadas: d.confirmadas ?? null, a_confirmar: d.a_confirmar ?? null, tentativas: d.tentativas ?? null,
            por_tipo: d.por_tipo, lido_em: new Date().toISOString(), execucao_id: ex.id,
          })), { onConflict: "hotel_id,dia,lido_dia" });
          if (e2) throw new Error(`gravação da previsão: ${e2.message}`);
        }
        Object.assign(r, { ok: true, property_id: propertyId, ocupacao: num(o.occupationPercentage), dias_previsao: prev.length });
      } catch (e) {
        r.erro = (e instanceof Error ? e.message : "erro").slice(0, 300);
      }
    }

    const okN = hoteisRes.filter((r) => r.ok).length;
    const status = okN === hoteisRes.length ? "ok" : okN ? "parcial" : "falha";
    await fim(status, hoteisRes.filter((r) => !r.ok).map((r) => `${r.hotel}: ${r.erro}`).join("; "));
    console.log(JSON.stringify({ integracao: "pms", status, correlation_id: ex.id, hoteis: hoteisRes }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "erro desconhecido";
    await fim("falha", msg);
    console.log(JSON.stringify({ integracao: "pms", status: "falha", correlation_id: ex.id, erro: msg }));
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Use POST", { status: 405 });
  const { data: ok } = await supabase.rpc("pms_conferir_segredo", { p_segredo: req.headers.get("x-segredo") ?? "" });
  if (!ok) return new Response("Sem permissão", { status: 401 });
  const corpo = await req.json().catch(() => ({}));
  const id = String(corpo.execucao ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Falta a execução", { status: 400 });
  EdgeRuntime.waitUntil(processar(id));
  return new Response(JSON.stringify({ recebido: id }), { headers: { "Content-Type": "application/json" } });
});
