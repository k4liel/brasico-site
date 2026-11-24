// Leitura das avaliações (24/11/2026; supabase/avaliacoes.sql, página /avaliacoes).
// Roda dentro do robô do PMS na VPS: robos/chefweb/chefweb.mjs (baixado do GitHub a cada rodada) baixa este arquivo e o
// robos/avaliacoes/extratores.js também a cada rodada, então mudar a leitura não exige reiniciar o robô.
// O banco decide o que ler (avaliacoes_robo_comecar: cada fonte a cada `intervalo_horas`, no máximo 4 por rodada).
// Só lê páginas públicas, sem login. Uma falha aqui nunca derruba o robô do PMS.
const GITHUB = "https://api.github.com/repos/k4liel/brasico-site/contents/robos/avaliacoes/extratores.js?ref=main";
const LIMITE_MS = 8 * 60 * 1000; // no máximo 8 min por rodada

export async function lerAvaliacoes({ chromium, rpc, segredo, log }) {
  const c = await rpc("avaliacoes_robo_comecar", { p_segredo: segredo, p_max: 4 });
  if (!c?.fazer) return;
  const exec = c.execucao;
  const inicio = Date.now();
  let browser, erroGeral = null;
  try {
    const r = await fetch(GITHUB, { headers: { Accept: "application/vnd.github.raw", "User-Agent": "brasico-pms-robo" } });
    if (!r.ok) throw new Error(`GitHub ${r.status}`);
    const extratores = await r.text();
    browser = await chromium.launch({ headless: process.env.JANELA !== "1" });
    for (const f of c.fontes) {
      if (Date.now() - inicio > LIMITE_MS) { log(`[avaliacoes] tempo da rodada acabou antes de ${f.id}`); break; }
      // um contexto novo por fonte (sessão limpa, como um visitante)
      const ctx = await browser.newContext({ locale: "pt-BR", timezoneId: "America/Fortaleza", viewport: { width: 1366, height: 900 } });
      const page = await ctx.newPage();
      const rodar = async (fn, opcoes) => {
        await page.evaluate(extratores);
        return page.evaluate(([nome, op]) => globalThis.__avaliacoes[nome](op), [fn, opcoes]);
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
        const msg = String(e?.message || e).slice(0, 400);
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
