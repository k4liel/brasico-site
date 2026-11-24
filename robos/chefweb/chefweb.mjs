// Leitura diária do Chef Web (TOTVS) com login próprio (22/11/2026; supabase/chefweb_robo.sql).
// Roda dentro do robô do PMS na VPS (robos/pms-navegador/robo.mjs), que baixa este arquivo do GitHub a cada leitura:
// mudar aqui vale na próxima leitura, sem reiniciar nada.
// O que faz (só leitura; nunca clica em Salvar nem chama endpoints de gravação):
//   1. entra em chefwebcloud.chef.totvs.com.br com chefweb_usuario/chefweb_senha (Vault, via chefweb_robo_comecar);
//   2. Relatórios › Fiscal › Regras Fiscais: todas as regras (todas as lojas), página a página → totvs_regras_fiscais;
//   3. em cada loja (seletor do topo): a lista de produtos (Cadastros/ProdutoServico) e, de cada produto ativo, a tela
//      de cadastro (Edit?id=<código>) com NCM, CEST, ICMS, CFOP, CST, PIS/Cofins, IBS/CBS e cClassTrib → totvs_produtos_cadastro.
// Uma vez por dia (o banco decide); usuário e senha só na memória; nada de senha ou cookie no registro.

const BASE = "https://chefwebcloud.chef.totvs.com.br";
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// Campos da tela de cadastro que vão para o Brasico (o resto da tela é ignorado)
const CAMPOS = {
  texto_fiscal: "TextoFiscal", ncm: "CodNCM", cest: "CodCEST", imposto: "Imposto", tributo: "Tributo", cfop: "CFOPVendaID", cst: "CSTVenda",
  pis_cst: "CSTPIS", pis: "PIS", cofins_cst: "CSTCOFINS", cofins: "COFINS",
  ibscbs_cst: "Produto_CST_IBS_CBS_VI", cclasstrib: "Produto_ClassTribIBSCBS_VI", cbs: "PercentualCBS", ibs_uf: "PercentualIBSUF", ibs_mun: "PercentualIBSMun",
};
const EXTRAS = ["PerReducaoBCICMS", "CodigoBeneficioFiscal", "ReducaoIcmsEfetivo", "AliquotaIcmsEfetivo", "AliquotaICMSST", "PISTipoCalculo", "PISValor",
  "COFINSTipoCalculo", "COFINSValor", "CodigoCreditoPresumido", "CFOP", "CST", "ReducaoICMS", "TributoCompra", "IndicadorIncentivoFiscal", "CodigoGTIN",
  "UnidadeVenda", "Unidade", "IAT", "IPPT", "TipoItem"];

const entidades = (s) => String(s ?? "").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();
const atributo = (tag, nome) => { const m = tag.match(new RegExp(`\\s${nome}="([^"]*)"`, "i")); return m ? entidades(m[1]) : null; };

// Lê os valores dos campos do formulário (inputs, selects e textareas) do HTML da tela de cadastro
function campos(html) {
  const v = {};
  for (const tag of html.match(/<input\b[^>]*>/gi) ?? []) {
    const nome = atributo(tag, "name");
    if (!nome || nome in v) continue;
    const tipo = (atributo(tag, "type") || "").toLowerCase();
    v[nome] = tipo === "checkbox" ? (/\schecked/i.test(tag) ? "1" : "0") : (atributo(tag, "value") ?? "");
  }
  for (const m of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const nome = atributo(m[1], "name");
    if (!nome || (nome in v && v[nome] !== "")) continue;
    const sel = m[2].match(/<option\b[^>]*selected[^>]*>/i);
    v[nome] = sel ? (atributo(sel[0], "value") ?? "") : "";
  }
  for (const m of html.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi)) {
    const nome = atributo(m[1], "name");
    if (nome && !(nome in v)) v[nome] = entidades(m[2]);
  }
  return v;
}

async function entrar(page, usuario, senha, log) {
  await page.goto(`${BASE}/Login/`, { waitUntil: "domcontentloaded" });
  await page.locator('input[name="UserName"]:visible').first().fill(usuario);
  await page.locator('input[type="password"]:visible').first().fill(senha);
  await page.locator("#btnLogin:visible").first().click();
  // Alguns usuários passam por uma segunda tela (perfil/código do funcionário): segue com o padrão
  for (let i = 0; i < 40; i++) {
    if (await page.locator("#drop-lojas").count()) break;
    const entrarPerfil = page.locator("#btnEntrar:visible");
    if (await entrarPerfil.count()) await entrarPerfil.first().click().catch(() => {});
    await espera(750);
  }
  if (!(await page.locator("#drop-lojas").count())) {
    const aviso = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 160);
    throw new Error(`login não passou (${aviso})`);
  }
  log("[chefweb] login ok");
}

// Lê todas as páginas de uma grade DevExpress (as telas do Chef Web) e devolve as linhas (texto de cada célula)
async function lerGrade(page, nome) {
  return page.evaluate(async (nomeGrade) => {
    const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
    let g = null;
    for (let i = 0; i < 40 && !g; i++) { g = window.ASPxClientControl?.GetControlCollection().GetByName(nomeGrade); if (!g) await esperar(500); }
    if (!g) throw new Error(`grade ${nomeGrade} não apareceu`);
    const ler = () => [...document.querySelectorAll(`#${nomeGrade}_DXMainTable tr`)].filter((r) => r.id && r.id.includes("DXDataRow"))
      .map((r) => [...r.cells].map((c) => c.innerText.trim()));
    let linhas = ler();
    const paginas = g.GetPageCount();
    for (let p = 1; p < paginas; p++) {
      g.GotoPage(p);
      await esperar(250);
      for (let k = 0; k < 120 && g.InCallback(); k++) await esperar(250);
      await esperar(200);
      linhas = linhas.concat(ler());
    }
    return { paginas, linhas };
  }, nome);
}

export async function lerChefWeb({ chromium, rpc, segredo, log, forcar = false }) {
  // Avaliações (24/11/2026): o robô do PMS só chama este arquivo depois de cada rodada; daqui sai também a leitura das
  // avaliações (robos/avaliacoes/avaliacoes.mjs, baixado do GitHub na hora). Falha lá não atrapalha o Chef Web.
  try {
    const r = await fetch("https://api.github.com/repos/k4liel/brasico-site/contents/robos/avaliacoes/avaliacoes.mjs?ref=main",
      { headers: { Accept: "application/vnd.github.raw", "User-Agent": "brasico-pms-robo" } });
    if (!r.ok) throw new Error(`GitHub ${r.status}`);
    const { writeFileSync } = await import("node:fs");
    const { pathToFileURL } = await import("node:url");
    writeFileSync("/tmp/avaliacoes.mjs", await r.text());
    const m = await import(`${pathToFileURL("/tmp/avaliacoes.mjs").href}?v=${Date.now()}`);
    await m.lerAvaliacoes({ chromium, rpc, segredo, log });
  } catch (e) { log(`[avaliacoes] não rodou: ${String(e?.message || e).slice(0, 200)}`); }

  const c = await rpc("chefweb_robo_comecar", { p_segredo: segredo, p_forcar: forcar });
  if (!c?.fazer) { if (c?.motivo && c.motivo !== "já leu hoje") log(`[chefweb] não leu: ${c.motivo}`); return; }
  const exec = c.execucao;
  const gravar = (tipo, dados) => rpc("chefweb_robo_gravar", { p_segredo: segredo, p_execucao: exec, p_tipo: tipo, p_dados: dados });
  const resumo = { lojas: {} };
  let browser;
  try {
    browser = await chromium.launch({ headless: process.env.JANELA !== "1" });
    const ctx = await browser.newContext({ locale: "pt-BR", timezoneId: "America/Fortaleza", viewport: { width: 1366, height: 900 } });
    const page = await ctx.newPage();
    // O Chef Web às vezes abre janelas próprias: fecha as que não forem a principal
    ctx.on("page", (p) => { if (p !== page) p.close().catch(() => {}); });
    await entrar(page, c.usuario, c.senha, log);

    // 2. Regras fiscais (todas as lojas no mesmo relatório)
    try {
      await page.goto(`${BASE}/Relatorios/RelatorioRegraFiscal/`, { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: /Filtrar/i }).first().click();
      await espera(2500);
      const { paginas, linhas } = await lerGrade(page, "mygrid");
      const texto = linhas.filter((l) => l.length >= 30).map((l) => l.join("|")).join("\n");
      const g = await gravar("regras", { texto });
      resumo.regras = g?.gravados ?? 0;
      log(`[chefweb] regras fiscais: ${linhas.length} linhas em ${paginas} páginas, ${resumo.regras} gravadas`);
    } catch (e) { resumo.erro_regras = e.message.split("\n")[0]; log(`[chefweb] regras falharam: ${resumo.erro_regras}`); }

    // 3. Produtos de cada loja
    await page.goto(`${BASE}/Cadastros/ProdutoServico`, { waitUntil: "domcontentloaded" });
    const lojas = await page.locator("#drop-lojas option").evaluateAll((os) => os.map((o) => ({ valor: o.value, nome: o.textContent.trim() })));
    for (const loja of lojas) {
      const codigoLoja = Number((loja.nome.match(/-\s*(\d+)\s*$/) || [])[1]);
      if (!codigoLoja) continue;
      try {
        const atual = await page.locator("#drop-lojas").inputValue();
        if (atual !== loja.valor) {
          await Promise.all([page.waitForLoadState("domcontentloaded").catch(() => {}), page.selectOption("#drop-lojas", loja.valor)]);
          await espera(3000);
        }
        await page.goto(`${BASE}/Cadastros/ProdutoServico`, { waitUntil: "domcontentloaded" });
        const confirmada = await page.locator("#drop-lojas").inputValue();
        if (confirmada !== loja.valor) throw new Error("não consegui trocar de loja");
        const { linhas } = await lerGrade(page, "dataGrid");
        const ativos = linhas.filter((l) => /ATIVO/i.test(l[6] ?? "") && !/INATIVO/i.test(l[6] ?? "") && /^\d+$/.test(l[0] ?? ""));
        log(`[chefweb] ${loja.nome}: ${linhas.length} produtos, ${ativos.length} ativos`);
        let lote = [];
        let lidos = 0, falhas = 0;
        for (const l of ativos) {
          try {
            const r = await page.request.get(`${BASE}/Cadastros/ProdutoServico/Edit?id=${l[0]}&_=${Date.now()}`, { timeout: 60000 });
            if (!r.ok()) throw new Error(`HTTP ${r.status()}`);
            const v = campos(await r.text());
            if (String(v.CodigoProduto ?? "") !== l[0]) throw new Error("tela de outro produto");
            const p = { codigo: l[0], nome: v.NomeProduto || l[1], grupo: l[2], subgrupo: l[3], preco: l[5], situacao: l[6] };
            for (const [k, nomeCampo] of Object.entries(CAMPOS)) p[k] = v[nomeCampo] ?? "";
            p.campos = Object.fromEntries([...Object.values(CAMPOS), ...EXTRAS].filter((n) => n in v).map((n) => [n, v[n]]));
            lote.push(p);
            lidos++;
          } catch { falhas++; }
          if (lote.length >= 40) { await gravar("produtos", { loja_codigo: codigoLoja, loja_nome: loja.nome, produtos: lote }); lote = []; }
          await espera(150);
        }
        if (lote.length) await gravar("produtos", { loja_codigo: codigoLoja, loja_nome: loja.nome, produtos: lote });
        resumo.lojas[codigoLoja] = { produtos: linhas.length, ativos: ativos.length, lidos, falhas };
        log(`[chefweb] ${loja.nome}: ${lidos} cadastros lidos${falhas ? `, ${falhas} falharam` : ""}`);
      } catch (e) {
        resumo.lojas[codigoLoja] = { erro: e.message.split("\n")[0] };
        log(`[chefweb] ${loja.nome}: falhou: ${resumo.lojas[codigoLoja].erro}`);
      }
    }
    await ctx.close();
    const algumErro = resumo.erro_regras || Object.values(resumo.lojas).some((x) => x.erro);
    await gravar("fim", { status: algumErro ? "parcial" : "ok", resumo });
  } catch (e) {
    const erro = e.message.split("\n")[0];
    log(`[chefweb] leitura falhou: ${erro}`);
    await gravar("fim", { status: "falha", resumo, erro }).catch(() => {});
  } finally {
    await browser?.close().catch(() => {});
  }
}
