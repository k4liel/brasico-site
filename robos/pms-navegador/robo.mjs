// Robô do PMS dos hotéis (TOTVS Hospitalidade, "PMS SaaS") para a VPS. Autorizado pelo dono e pela TOTVS (08/11/2026).
// A cada hora: abre um Chromium novo (sessão nova, nada fica salvo), entra no PMS com o usuário do Vault,
// escolhe cada hotel, lê o painel do dia e a disponibilidade dos próximos 60 dias e grava no Supabase.
// O usuário e a senha vêm do banco a cada rodada (pms_robo_credenciais) e só ficam na memória.
// Guarda só números do hotel: listas de hóspedes e tokens nunca são gravados nem impressos.
//
// Variáveis: SUPABASE_URL, SUPABASE_ANON_KEY (públicas), PMS_ROBO_SEGREDO (Vault: pms_robo_segredo),
//            INTERVALO_MIN (padrão 60), UMA_VEZ=1 (roda uma vez e sai).
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readdirSync, rmSync } from "node:fs";

const BASE = "https://gestaopms.totvshospitalidade.com";
const DISPONIBILIDADE = "https://group05.totvshospitalidade.com/availability/api";
const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SEGREDO = process.env.PMS_ROBO_SEGREDO;
const INTERVALO_MIN = Number(process.env.INTERVALO_MIN || 60);
const DIAS_PREVISAO = 60;
const FALHAS = "/dados/falhas";

const log = (...m) => console.log(new Date().toISOString(), ...m);
const semAcento = (s) => String(s ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const formataCnpj = (c) => String(c).replace(/\D/g, "").replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");

async function rpc(nome, corpo) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${nome}`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${nome}: HTTP ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}

// ---------- telas do PMS (o login e a escolha de empresa ficam num iframe de acesso.totvshospitalidade.com)
async function quadroCom(page, alvo, ms = 30000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    for (const f of page.frames()) {
      const loc = typeof alvo === "string" ? f.getByText(alvo).first() : f.locator(alvo.css).first();
      if (await loc.isVisible().catch(() => false)) return f;
    }
    await espera(700);
  }
  return null;
}

async function entrar(page, usuario, senha) {
  await page.goto(`${BASE}/auth/login`, { waitUntil: "domcontentloaded" });
  const f = await quadroCom(page, { css: 'input[type="password"]' }, 60000);
  if (!f) throw new Error("a tela de login não apareceu");
  await f.locator('input:not([type="password"]):not([type="checkbox"]):not([type="hidden"])').first().fill(usuario);
  await f.locator('input[type="password"]').first().fill(senha);
  await f.getByRole("button", { name: /^\s*Entrar\s*$/i }).first().click();
  // Depois do login: lista de empresas, ou direto o sistema
  const fim = Date.now() + 60000;
  while (Date.now() < fim) {
    if (await quadroCom(page, "Acessar", 1500)) return;
    const t = await page.locator("body").innerText().catch(() => "");
    if (/Você está no|Consulta Geral/i.test(t)) return;
    for (const fr of page.frames()) {
      const tx = await fr.locator("body").innerText({ timeout: 1000 }).catch(() => "");
      if (/Acesso não autorizado|senha inválida|usuário ou senha|verifique seus dados/i.test(tx)) throw new Error("login recusado pelo PMS (usuário ou senha)");
      if (/código de verificação|autenticação de dois fatores|two-factor/i.test(tx)) throw new Error("o PMS pediu verificação em duas etapas");
      if (/captcha/i.test(tx)) throw new Error("o PMS mostrou um CAPTCHA; o robô parou");
    }
    await espera(1000);
  }
  throw new Error("o login não terminou em 60 s");
}

async function escolherHotel(page, cnpj) {
  let f = await quadroCom(page, cnpj, 3000);
  if (!f) {
    await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
    await page.locator(".toolbar-profile-container").first().click({ timeout: 30000 }).catch(() => {});
    await espera(800);
    await page.evaluate(() => document.querySelector(".tenant-selection__action")?.click());
    f = await quadroCom(page, cnpj, 30000);
    if (!f) throw new Error("a lista de empresas não apareceu");
  }
  await f.locator("div", { hasText: cnpj }).filter({ has: f.getByText("Acessar", { exact: true }) }).last()
    .getByText("Acessar", { exact: true }).click({ timeout: 30000 });
  const fim = Date.now() + 60000;
  while (Date.now() < fim) {
    await espera(1000);
    if (!(await quadroCom(page, cnpj, 500))) {
      const t = await page.locator("body").innerText().catch(() => "");
      if (/PMS SaaS/.test(t) && !/Carregando/.test(t.slice(0, 30))) return;
    }
  }
  throw new Error("o PMS não abriu depois de escolher a empresa");
}

const RODAPE = {
  bloqueadas: "bloqueadas", disponiveis: "disponiveis", ocupacao: "ocupadas",
  "ocup. individuais": "individuais", "ocup. grupo": "grupo", "ocup. confirmada": "confirmadas",
  "ocup. a confirmar": "a_confirmar", tentativas: "tentativas",
};
function juntarDisponibilidade(respostas, inicio) {
  const dias = new Map();
  let uhs = null;
  for (const a of respostas) {
    const tipos = new Map((a?.roomTypeList ?? []).map((t) => [Number(t.id), String(t.name ?? "")]));
    uhs = (a?.roomTypeList ?? []).reduce((s, t) => s + (Number(t.total) || 0), 0) || uhs;
    for (const linha of a?.footerList ?? []) {
      const campo = RODAPE[semAcento(linha?.name)];
      if (!campo) continue;
      for (const v of linha?.values ?? []) {
        const dia = String(v?.dateFormatted ?? "").slice(0, 10);
        if (dia < inicio) continue;
        const d = dias.get(dia) ?? { dia, por_tipo: [] };
        d[campo] = v?.number ?? null;
        if (campo === "ocupadas") d.ocupacao = v?.percentage ?? null;
        dias.set(dia, d);
      }
    }
    for (const x of a?.availabilityList ?? []) {
      const d = dias.get(String(x?.day ?? "").slice(0, 10));
      if (d) d.por_tipo.push({ tipo: tipos.get(Number(x.roomTypeId)) ?? String(x.roomTypeId), total: x.roomTotal,
        ocupadas: x.occupiedRooms, disponiveis: x.availableRooms, bloqueadas: x.blockedQuantity });
    }
  }
  return { uhs, dias: [...dias.values()].sort((a, b) => a.dia.localeCompare(b.dia)) };
}

async function lerHotel(page, h, ctx) {
  // Painel: a resposta que o próprio PMS recebe ao abrir a Home (e o token dessa chamada, só na memória)
  const resp = page.waitForResponse((r) => /reservationReport\/propertydashboard/.test(r.url()) && r.ok(), { timeout: 90000 });
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  const r = await resp;
  const token = r.request().headers()["authorization"];
  const o = (await r.json())?.overview ?? {};
  const painel = {
    ocupacao: o.occupationPercentage, ocupacao_prevista: o.predictedOccupationPercentage,
    ocupadas: o.totalOccupiedRoom, livres: o.totalAvailableRoom, bloqueadas: o.totalBlockedRoom,
    checkins: o.totalCheckIn, checkouts: o.totalCheckOut,
    checkins_previstos: o.totalEstimatedCheckIn, checkouts_previstos: o.totalEstimatedCheckOut,
    walk_in: o.totalWalkIn, day_use: o.totalDayUse,
  };
  // Disponibilidade: mesma chamada que a grade do PMS faz, de 30 em 30 dias, de dentro da página
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Fortaleza" }).format(new Date());
  const respostas = [];
  let disponibilidade = null, erroDisp = null;
  try {
    if (!h.propriedade) throw new Error("hotel sem número de propriedade");
    for (let desloc = 0; desloc < DIAS_PREVISAO; desloc += 30) {
      const d = new Date(`${hoje}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + desloc);
      const url = `${DISPONIBILIDADE}/Availability/${h.propriedade}/roomtypes?InitialDate=${d.toISOString().slice(0, 10)}T00:00:00&Period=30&culture=pt-BR`;
      respostas.push(await page.evaluate(async ([u, t]) => {
        const x = await fetch(u, { headers: { Authorization: t, Accept: "application/json" } });
        if (!x.ok) throw new Error(`disponibilidade HTTP ${x.status}`);
        return x.json();
      }, [url, token]));
    }
    disponibilidade = juntarDisponibilidade(respostas, hoje);
  } catch (e) { erroDisp = e.message.split("\n")[0]; }
  return { hotel: h.id, ok: true, nome_no_pms: o.propertyName ?? null, propriedade: h.propriedade, painel, disponibilidade,
    ...(erroDisp ? { aviso: erroDisp } : {}) };
}

async function guardarFalha(page, nome) {
  try {
    mkdirSync(FALHAS, { recursive: true });
    const velhas = readdirSync(FALHAS).sort();
    for (const v of velhas.slice(0, Math.max(0, velhas.length - 9))) rmSync(`${FALHAS}/${v}`);
    writeFileSync(`${FALHAS}/${new Date().toISOString().replace(/[:.]/g, "-")}-${nome}.png`, await page.screenshot());
  } catch { /* sem tela */ }
}

async function rodada() {
  const leitura = { inicio: new Date().toISOString(), hoteis: [] };
  // CANAL=chrome usa o Chrome instalado (teste no Windows); na VPS vale o Chromium da imagem
  const browser = await chromium.launch({ headless: process.env.JANELA !== "1", channel: process.env.CANAL || undefined });
  try {
    const cred = (await rpc("pms_robo_credenciais", { p_segredo: SEGREDO }))?.[0];
    if (!cred?.usuario || !cred?.senha) throw new Error("faltam pms_usuario e pms_senha no Vault");
    const ctx = await browser.newContext({ locale: "pt-BR", timezoneId: "America/Fortaleza", viewport: { width: 1366, height: 900 } });
    const page = await ctx.newPage();
    try {
      await entrar(page, cred.usuario, cred.senha);
      log("login ok");
    } catch (e) { await guardarFalha(page, "login"); throw e; }
    for (const h of cred.hoteis ?? []) {
      try {
        await escolherHotel(page, formataCnpj(h.cnpj));
        const r = await lerHotel(page, h, ctx);
        leitura.hoteis.push(r);
        log(`${h.id}: ${r.nome_no_pms} · ocupação ${r.painel.ocupacao}% · ocupadas ${r.painel.ocupadas} · livres ${r.painel.livres}` +
          ` · bloqueadas ${r.painel.bloqueadas} · previsão ${r.disponibilidade?.dias.length ?? 0} dias${r.aviso ? ` · aviso: ${r.aviso}` : ""}`);
      } catch (e) {
        const msg = e.message.split("\n")[0];
        leitura.hoteis.push({ hotel: h.id, ok: false, erro: msg });
        log(`${h.id}: falhou: ${msg}`);
        await guardarFalha(page, h.id);
      }
    }
    await ctx.close();
  } catch (e) {
    leitura.erro = e.message.split("\n")[0];
    log(`rodada falhou: ${leitura.erro}`);
  } finally {
    await browser.close();
    leitura.fim = new Date().toISOString();
  }
  try {
    const g = await rpc("pms_robo_gravar", { p_segredo: SEGREDO, p_leitura: leitura });
    log(`gravado: ${JSON.stringify(g)}`);
  } catch (e) { log(`não gravou: ${e.message}`); }
}

if (!SUPABASE_URL || !ANON || !SEGREDO) { console.error("Faltam SUPABASE_URL, SUPABASE_ANON_KEY ou PMS_ROBO_SEGREDO"); process.exit(1); }
log(`robô do PMS ligado (a cada ${INTERVALO_MIN} min)`);
do {
  await rodada();
  if (process.env.UMA_VEZ) break;
  await espera(INTERVALO_MIN * 60000);
} while (true);
