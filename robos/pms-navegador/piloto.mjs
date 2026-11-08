// Piloto: lê o painel do PMS da TOTVS Hospitalidade num Chrome real (o Chrome instalado no Windows),
// aberto pelo Playwright com um perfil só do Brasico. O login é sempre manual (a pessoa digita na janela).
// O robô não faz chamadas por conta própria: abre as telas e lê as respostas que o próprio PMS recebe.
// Guarda só números do hotel (painel e disponibilidade); listas de hóspedes e tokens nunca são gravados.
// Sem truques de disfarce: nada de plugin "stealth", User-Agent trocado ou CAPTCHA resolvido por robô.
// Se o PMS pedir login, a janela espera a pessoa (ou, com --sem-espera, sai avisando).
//
// Uso:  npm run ler                 (abre o Chrome; se precisar, espere o login)
//       npm run ler:agenda          (não espera login: sai com código 2 se a sessão caiu)
//       node piloto.mjs --hoteis=filha-da-lua
import { chromium } from "playwright";
import { mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const BASE = "https://gestaopms.totvshospitalidade.com";
const PASTA = join(process.env.LOCALAPPDATA ?? ".", "Brasico");
const PERFIL = process.env.PMS_PERFIL ?? join(PASTA, "pms-perfil");
const LEITURAS = join(PASTA, "pms-leituras.jsonl");
const ESPERA_LOGIN_MIN = 10;

const HOTEIS = [
  { id: "filha-da-lua", cnpj: "24.021.962/0001-95", nome: /FILHA DA LUA/i, propriedade: 475 },
  { id: "sempre-vivo", cnpj: "50.639.716/0001-01", nome: /LAIF/i, propriedade: 1504 },
  { id: "filho-do-vento", cnpj: "39.988.182/0001-96", nome: /FILHO DO VENTO/i, propriedade: 1490 },
];

const args = process.argv.slice(2);
const semEspera = args.includes("--sem-espera");
const escolha = (args.find((a) => a.startsWith("--hoteis=")) ?? "--hoteis=filha-da-lua,sempre-vivo").split("=")[1].split(",");
const alvo = HOTEIS.filter((h) => escolha.includes(h.id));

const log = (...m) => console.log(new Date().toLocaleTimeString("pt-BR"), ...m);
const semAcento = (s) => String(s ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

// Rodapé da grade de disponibilidade: nome da linha -> campo
const RODAPE = {
  bloqueadas: "bloqueadas", disponiveis: "disponiveis", ocupacao: "ocupadas",
  "ocup. individuais": "individuais", "ocup. grupo": "grupo", "ocup. confirmada": "confirmadas",
  "ocup. a confirmar": "a_confirmar", tentativas: "tentativas",
};
function lerDisponibilidade(a) {
  const dias = new Map();
  for (const linha of a?.footerList ?? []) {
    const campo = RODAPE[semAcento(linha?.name)];
    if (!campo) continue;
    for (const v of linha?.values ?? []) {
      const dia = String(v?.dateFormatted ?? "").slice(0, 10);
      const d = dias.get(dia) ?? { dia };
      d[campo] = v?.number ?? null;
      if (campo === "ocupadas") d.ocupacao = v?.percentage ?? null;
      dias.set(dia, d);
    }
  }
  const uhs = (a?.roomTypeList ?? []).reduce((s, t) => s + (Number(t.total) || 0), 0) || null;
  return { uhs, dias: [...dias.values()].sort((x, y) => x.dia.localeCompare(y.dia)) };
}

const naTelaDeLogin = (url) => /\/auth\/login|acesso\.totvshospitalidade\.com|\/signin/i.test(url);

// O login e a escolha de empresa ficam num quadro (iframe) de acesso.totvshospitalidade.com: procura em todos
async function textoDeTudo(page) {
  const partes = await Promise.all(page.frames().map((f) => f.locator("body").innerText({ timeout: 3000 }).catch(() => "")));
  return partes.join("\n");
}
async function quadroComTexto(page, texto) {
  for (const f of page.frames()) {
    if (await f.getByText(texto).first().isVisible().catch(() => false)) return f;
  }
  return null;
}

async function esperarSessao(page) {
  const inicio = Date.now();
  let avisou = false;
  while (Date.now() - inicio < ESPERA_LOGIN_MIN * 60000) {
    const texto = await textoDeTudo(page);
    const naEscolha = /Empresas/.test(texto) && /Acessar/.test(texto);
    const logado = naEscolha || /Você está no|Consulta Geral/i.test(texto);
    if (logado) return true;
    const pedeLogin = /Esqueceu a senha|Entrar com Microsoft/i.test(texto);
    if (pedeLogin) {
      if (semEspera) return false;
      if (!avisou) { log(`O PMS pediu login. Entre na janela do Chrome (espero até ${ESPERA_LOGIN_MIN} min).`); avisou = true; }
    }
    await page.waitForTimeout(2000);
  }
  return false;
}

async function hotelAtual(page) {
  const t = await page.locator("body").innerText().catch(() => "");
  return t.match(/Você está no\s+(.+)/i)?.[1]?.trim() ?? null;
}

async function trocarPara(page, h) {
  let quadro = await quadroComTexto(page, h.cnpj);
  if (!quadro) {
    await page.goto(`${BASE}/dashboard`);
    await page.locator(".toolbar-profile-container").first().click({ timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(800);
    // O botão "Trocar" fica com tamanho zero na tela: o clique vai direto nele
    await page.evaluate(() => document.querySelector(".tenant-selection__action")?.click());
    for (let i = 0; i < 30 && !quadro; i++) { await page.waitForTimeout(1000); quadro = await quadroComTexto(page, h.cnpj); }
    if (!quadro) throw new Error("a lista de empresas não apareceu");
  }
  const acessar = quadro.locator("div", { hasText: h.cnpj }).filter({ has: quadro.getByText("Acessar", { exact: true }) }).last()
    .getByText("Acessar", { exact: true });
  await acessar.click({ timeout: 30000 });
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(1000);
    const t = await page.locator("body").innerText().catch(() => "");
    if (/Você está no|Consulta Geral|Painel|Reservas/i.test(t) && !(await quadroComTexto(page, h.cnpj))) return;
  }
  throw new Error("o PMS não abriu depois de escolher a empresa");
}

async function lerHotel(page, h) {
  // 1. Painel do dia: a resposta que o próprio PMS recebe ao abrir a Home
  const respPainel = page.waitForResponse((r) => /reservationReport\/propertydashboard/.test(r.url()) && r.ok(), { timeout: 60000 });
  await page.goto(`${BASE}/dashboard`);
  const painel = (await (await respPainel).json())?.overview ?? {};
  await page.getByText("Você está no").first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
  const nomeTela = await hotelAtual(page);

  // Conferência com a tela: números do cartão Acomodações
  const texto = await page.locator("body").innerText();
  const m = texto.match(/OCUPADAS\s+(\d+)\s+LIVRES\s+(\d+)\s+BLOQUEADAS\s+(\d+)/i);
  const tela = m ? { ocupadas: +m[1], livres: +m[2], bloqueadas: +m[3] } : null;
  const confere = tela ? tela.ocupadas === painel.totalOccupiedRoom && tela.livres === painel.totalAvailableRoom
    && tela.bloqueadas === painel.totalBlockedRoom : null;

  // 2. Disponibilidade: a resposta que o PMS recebe ao abrir a grade
  let disponibilidade = null, periodo = null, propriedade = null;
  try {
    const respDisp = page.waitForResponse((r) => /Availability\/\d+\/roomtypes/.test(r.url()) && r.ok(), { timeout: 60000 });
    await page.goto(`${BASE}/availability-grid`);
    const r = await respDisp;
    const u = new URL(r.url());
    propriedade = Number(u.pathname.match(/Availability\/(\d+)\//)?.[1]) || null;
    periodo = Number(u.searchParams.get("Period")) || null;
    disponibilidade = lerDisponibilidade(await r.json());
  } catch (e) {
    log(`  disponibilidade não lida: ${e.message.split("\n")[0]}`);
  }

  const pertence = h.nome.test(String(painel.propertyName ?? "")) && h.nome.test(String(nomeTela ?? ""))
    && (!h.propriedade || !propriedade || propriedade === h.propriedade);
  return {
    hotel: h.id, nome_no_pms: painel.propertyName ?? null, nome_na_tela: nomeTela, propriedade, pertence,
    painel: {
      ocupacao: painel.occupationPercentage, ocupacao_prevista: painel.predictedOccupationPercentage,
      ocupadas: painel.totalOccupiedRoom, livres: painel.totalAvailableRoom, bloqueadas: painel.totalBlockedRoom,
      checkins: painel.totalCheckIn, checkouts: painel.totalCheckOut,
      checkins_previstos: painel.totalEstimatedCheckIn, checkouts_previstos: painel.totalEstimatedCheckOut,
      walk_in: painel.totalWalkIn, day_use: painel.totalDayUse,
    },
    tela, confere_com_tela: confere,
    disponibilidade: disponibilidade && { periodo_dias: periodo, uhs: disponibilidade.uhs, dias: disponibilidade.dias },
  };
}

async function main() {
  mkdirSync(PASTA, { recursive: true });
  log(`Perfil do Chrome: ${PERFIL}`);
  const ctx = await chromium.launchPersistentContext(PERFIL, { channel: "chrome", headless: false, viewport: null });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const execucao = { em: new Date().toISOString(), modo: semEspera ? "agenda" : "manual", hoteis: [] };
  let codigo = 0;
  try {
    await page.goto(`${BASE}/dashboard`);
    await page.waitForTimeout(4000);
    const precisouLogin = naTelaDeLogin(page.url());
    execucao.sessao_reaproveitada = !precisouLogin;
    log(precisouLogin ? "Sessão não ficou salva: precisa de login." : "Sessão do perfil reaproveitada (sem login).");
    if (!(await esperarSessao(page))) {
      execucao.erro = "precisa de login manual";
      log("Sem sessão. Rode `npm run ler` e entre na janela do Chrome.");
      codigo = 2;
      return;
    }
    for (const h of alvo) {
      log(`Hotel: ${h.id}`);
      try {
        const atual = (await quadroComTexto(page, "Acessar")) ? null : await hotelAtual(page);
        if (!atual || !h.nome.test(atual)) await trocarPara(page, h);
        const r = await lerHotel(page, h);
        execucao.hoteis.push(r);
        const p = r.painel;
        log(`  ${r.nome_no_pms} · ocupação ${p.ocupacao}% · ocupadas ${p.ocupadas} · livres ${p.livres} · bloqueadas ${p.bloqueadas}` +
          ` · check-in ${p.checkins}/${p.checkins_previstos} · check-out ${p.checkouts}/${p.checkouts_previstos}`);
        log(`  confere com a tela: ${r.confere_com_tela === null ? "não deu para ler a tela" : r.confere_com_tela ? "sim" : "NÃO"}` +
          ` · hotel certo: ${r.pertence ? "sim" : "NÃO"} · disponibilidade: ${r.disponibilidade ? `${r.disponibilidade.dias.length} dias (pedido de ${r.disponibilidade.periodo_dias})` : "não lida"}`);
      } catch (e) {
        execucao.hoteis.push({ hotel: h.id, erro: e.message.split("\n")[0] });
        log(`  falhou: ${e.message.split("\n")[0]}`);
        codigo = 1;
      }
    }
  } finally {
    appendFileSync(LEITURAS, JSON.stringify(execucao) + "\n");
    log(`Leitura guardada em ${LEITURAS}`);
    await ctx.close();
    process.exitCode = codigo;
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
