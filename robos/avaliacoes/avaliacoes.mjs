// Leitura das avaliações (24/11/2026; supabase/avaliacoes.sql, página /avaliacoes).
// Roda dentro do robô do PMS na VPS: robos/chefweb/chefweb.mjs (baixado do GitHub a cada rodada do PMS) chama
// lerAvaliacoes, que liga uma VIGIA contínua (pedido do dono: "tem que atualizar em tempo real"): um laço em segundo plano,
// fora da rodada de 30 min do PMS, que a cada 1–2 min pergunta ao banco o que está na hora de ler
// (avaliacoes_robo_comecar: cada fonte a cada `intervalo_minutos` — Google 10, os outros 60) e lê com um navegador próprio.
// A vigia se renova sozinha a cada ~2 h (a próxima rodada do PMS liga a versão nova deste arquivo). Os leitores
// (extratores.js) são baixados de novo a cada 15 min. Só lê páginas públicas, sem login. Falha aqui nunca derruba o robô.
const GITHUB = "https://raw.githubusercontent.com/k4liel/brasico-site/main/robos/avaliacoes/extratores.js";
const PROPRIO = "https://raw.githubusercontent.com/k4liel/brasico-site/main/robos/avaliacoes/avaliacoes.mjs";
const LIMITE_MS = 8 * 60 * 1000;     // no máximo 8 min por passada
const VIDA_MS = 2 * 60 * 60 * 1000;  // a vigia dura ~2 h e é religada com o código novo
let extratoresCache = { texto: null, em: 0 };

async function extratores() {
  if (extratoresCache.texto && Date.now() - extratoresCache.em < 15 * 60 * 1000) return extratoresCache.texto;
  const r = await fetch(`${GITHUB}?v=${Math.floor(Date.now() / 300000)}`, { headers: { "User-Agent": "brasico-pms-robo" } });
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  extratoresCache = { texto: await r.text(), em: Date.now() };
  return extratoresCache.texto;
}

// Chamado a cada rodada do PMS: garante que a vigia está viva (uma só por processo) e volta na hora.
export async function lerAvaliacoes({ chromium, rpc, segredo, log }) {
  const v = globalThis.__vigiaAvaliacoes;
  if (v && Date.now() - v.batida < 20 * 60 * 1000 && Date.now() - v.desde < VIDA_MS) return;
  if (v) v.parar = true; // a antiga (parada ou velha) termina na próxima volta
  const vigia = { desde: Date.now(), batida: Date.now(), parar: false };
  globalThis.__vigiaAvaliacoes = vigia;
  log("[avaliacoes] vigia ligada (Google a cada 10 min, os outros a cada hora)");
  (async () => {
    while (!vigia.parar && Date.now() - vigia.desde < VIDA_MS + 30 * 60 * 1000) {
      vigia.batida = Date.now();
      try {
        let fn = passada;
        try {
          const r = await fetch(`${PROPRIO}?v=${Math.floor(Date.now() / 300000)}`, { headers: { "User-Agent": "brasico-pms-robo" } });
          if (r.ok) {
            const { writeFileSync } = await import("node:fs");
            const { pathToFileURL } = await import("node:url");
            writeFileSync("/tmp/avaliacoes-passada.mjs", await r.text());
            fn = (await import(`${pathToFileURL("/tmp/avaliacoes-passada.mjs").href}?v=${Date.now()}`)).passada || passada;
          }
        } catch {}
        await fn({ chromium, rpc, segredo, log });
      }
      catch (e) { log(`[avaliacoes] passada falhou: ${String(e?.message || e).slice(0, 200)}`); }
      await new Promise((r) => setTimeout(r, 60000 + Math.random() * 60000));
    }
    if (globalThis.__vigiaAvaliacoes === vigia) globalThis.__vigiaAvaliacoes = null;
    log("[avaliacoes] vigia encerrada (a próxima rodada do PMS liga a nova)");
  })();
}

// onde: "vps" (robô do PMS; só Booking) ou "pc" (computador do escritório, robos/avaliacoes/pc.mjs: Google, TripAdvisor, Expedia)
export async function passada({ chromium, rpc, segredo, log, onde = "vps", maximo = 4 }) {
  const c = await rpc("avaliacoes_robo_comecar", { p_segredo: segredo, p_max: maximo, p_onde: onde });
  if (!c?.fazer) return;
  const exec = c.execucao;
  const inicio = Date.now();
  let browser, erroGeral = null;
  try {
    const codigo = await extratores();
    browser = await chromium.launch({ headless: process.env.JANELA !== "1" });
    for (const f of c.fontes) {
      if (Date.now() - inicio > LIMITE_MS) { log(`[avaliacoes] tempo da rodada acabou antes de ${f.id}`); break; }
      // Google, TripAdvisor e Expedia respondem ao servidor com verificação de robô: o banco não manda mais essas fontes
      // (avaliacoes_fontes.robo = false; vão pela API oficial). Não contornamos verificação de robô.
      const nav = browser;
      // um contexto novo por fonte (sessão limpa, como um visitante)
      const ctx = await nav.newContext({ locale: "pt-BR", timezoneId: "America/Fortaleza", viewport: { width: 1366, height: 900 } });
      const page = await ctx.newPage();
      // roda um leitor na página; se a página recarregar no meio (Booking faz isso), espera e tenta de novo uma vez
      const rodar = async (fn, opcoes) => {
        for (let t = 0; ; t++) {
          try {
            await page.waitForLoadState("load", { timeout: 30000 }).catch(() => {});
            await page.evaluate(codigo);
            return await page.evaluate(([nome, op]) => globalThis.__avaliacoes[nome](op), [fn, opcoes]);
          } catch (e) {
            if (t >= 1 || !/context was destroyed|navigation/i.test(String(e?.message))) throw e;
            await page.waitForTimeout(4000);
          }
        }
      };
      try {
        const conhecidos = f.conhecidos || [];
        let resultado;
        if (f.leitor === "google_busca") {
          await page.goto(f.url, { waitUntil: "domcontentloaded", timeout: 60000 });
          await recusarCookies(page);
          resultado = await rodar("google_busca", { max: f.primeira ? 300 : 40, conhecidos });
        } else if (f.leitor === "google_viagens") {
          await page.goto(f.url, { waitUntil: "domcontentloaded", timeout: 60000 });
          await recusarCookies(page);
          const link = await rodar("google_viagens_link");
          await page.goto(link, { waitUntil: "domcontentloaded", timeout: 60000 });
          // ordenar por "Mais recentes" (só clique de verdade funciona no Google Viagens)
          try {
            await page.locator("span.k5TI0").first().waitFor({ timeout: 20000 });
            await page.locator('[role="option"]:visible', { hasText: /^Mais recentes$/ }).first().click({ timeout: 8000 });
            await page.waitForTimeout(2500);
          } catch (e) { log(`[avaliacoes] ${f.id}: não ordenou por mais recentes (${String(e?.message || e).slice(0, 80)})`); }
          resultado = await rodar("google_viagens", { max: f.primeira ? 400 : 40, conhecidos });
        } else if (f.leitor === "tripadvisor") {
          // abre a primeira página; as seguintes o leitor baixa de dentro dela (para quando acha uma já guardada)
          await page.goto(f.url, { waitUntil: "domcontentloaded", timeout: 60000 });
          await page.waitForTimeout(2500 + Math.random() * 2000);
          resultado = await rodar("tripadvisor", { paginas: f.primeira ? 150 : 3, conhecidos });
          if (!resultado.itens.length) throw new Error(`TripAdvisor não mostrou avaliações (título: ${await page.title()})`);
        } else if (f.leitor === "booking") {
          await page.goto(f.url, { waitUntil: "domcontentloaded", timeout: 60000 });
          resultado = await rodar("booking", { paginas: f.primeira ? 10 : 2, conhecidos });
        } else if (f.leitor === "expedia") {
          // a Expedia só mostra a página do hotel com datas
          const d = new Date(Date.now() + 30 * 864e5), d2 = new Date(Date.now() + 31 * 864e5);
          const ymd = (x) => x.toISOString().slice(0, 10);
          await page.goto(`${f.url}?chkin=${ymd(d)}&chkout=${ymd(d2)}`, { waitUntil: "domcontentloaded", timeout: 60000 });
          resultado = await rodar("expedia", { max: f.primeira ? 100 : 30 });
        } else throw new Error(`leitor desconhecido: ${f.leitor}`);
        const g = await rpc("avaliacoes_gravar", { p_segredo: segredo, p_fonte: f.id, p_resumo: resultado.resumo || {}, p_itens: resultado.itens || [], p_execucao: exec });
        log(`[avaliacoes] ${f.id}: ${g?.lidas ?? 0} lidas, ${g?.novas ?? 0} novas (nota ${resultado.resumo?.nota ?? "?"}, total ${resultado.resumo?.total ?? "?"})`);
      } catch (e) {
        // o que a página mostrou de fato (bloqueio, aviso de cookies, outro idioma…), para saber o porquê
        let tela = "";
        try { tela = ` | ${page.url().slice(0, 120)} | ${(await page.evaluate(() => document.body?.innerText || "")).replace(/\s+/g, " ").slice(0, 220)}`; } catch {}
        const msg = (String(e?.message || e).split("\n")[0] + tela).slice(0, 500);
        log(`[avaliacoes] ${f.id} falhou: ${msg}`);
        await rpc("avaliacoes_gravar", { p_segredo: segredo, p_fonte: f.id, p_resumo: {}, p_itens: [], p_erro: msg, p_execucao: exec }).catch(() => {});
      } finally {
        await ctx.close().catch(() => {});
      }
      await new Promise((r) => setTimeout(r, 3000 + Math.random() * 4000));
    }
  } catch (e) {
    erroGeral = String(e?.message || e).slice(0, 400);
    log(`[avaliacoes] falhou: ${erroGeral}`);
  } finally {
    await browser?.close().catch(() => {});
    await rpc("avaliacoes_robo_fim", { p_segredo: segredo, p_execucao: exec, p_erro: erroGeral }).catch(() => {});
  }
}

// Aviso de cookies do Google (aparece em servidores fora do Brasil): "Rejeitar tudo"
async function recusarCookies(page) {
  try {
    const b = page.locator('button:has-text("Rejeitar tudo"), button:has-text("Reject all")').first();
    if (await b.isVisible({ timeout: 2500 })) { await b.click(); await page.waitForTimeout(1500); }
  } catch {}
}
