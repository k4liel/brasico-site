// Leitores das avaliações (24/11/2026; supabase/avaliacoes.sql). Rodam DENTRO da página do site, num navegador de verdade:
// o robô do PMS na VPS injeta este arquivo (robos/avaliacoes/avaliacoes.mjs) e o Claude usa o mesmo arquivo no navegador do
// app para a carga inicial. Cada leitor devolve { resumo: {nota, total, distribuicao, posicao}, itens: [...] }.
// Só lê o que o site mostra a qualquer visitante (sem login). Nunca clica em nada que grave (responder, reagir, avaliar).
(() => {
  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
  const limpa = (t) => (t || "").replace(/ /g, " ").replace(/[ \t]+\n/g, "\n").trim() || null;
  const hoje = () => new Date();
  const iso = (d) => (d && !isNaN(d) ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : null);
  const MESES = { jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5, jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11,
    janeiro: 0, fevereiro: 1, "março": 2, marco: 2, abril: 3, maio: 4, junho: 5, julho: 6, agosto: 7, setembro: 8, outubro: 9, novembro: 10, dezembro: 11 };
  const numero = (t) => { const m = String(t || "").match(/\d+(?:[.,]\d+)?/); return m ? Number(m[0].replace(",", ".")) : null; };
  const inteiro = (t) => { const m = String(t || "").match(/\d[\d.]*/); return m ? Number(m[0].replace(/\./g, "")) : null; };
  // código estável quando o site não dá id: autor + data + começo do texto
  const codigo = (...p) => { const s = p.map((x) => x || "").join("|"); let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return "h" + (h >>> 0).toString(36) + s.length.toString(36); };

  // "uma hora atrás", "3 semanas atrás", "um mês atrás", "há 2 anos" → data aproximada
  function relativa(t) {
    const m = String(t || "").toLowerCase().match(/(um|uma|\d+)\s+(minuto|hora|dia|semana|m[eê]s|meses|ano)/);
    if (!m) return null;
    const n = /^\d/.test(m[1]) ? Number(m[1]) : 1;
    const d = hoje(); const u = m[2];
    if (u.startsWith("minuto") || u.startsWith("hora")) return iso(d);
    if (u.startsWith("dia")) d.setDate(d.getDate() - n);
    else if (u.startsWith("semana")) d.setDate(d.getDate() - 7 * n);
    else if (u.startsWith("m")) d.setMonth(d.getMonth() - n);
    else if (u.startsWith("ano")) d.setFullYear(d.getFullYear() - n);
    return iso(d);
  }
  // "18 de setembro de 2026", "9 de nov.", "9 de nov. de 2025", "(jun. de 2026)" (só mês e ano → dia 1)
  function dataPt(t) {
    const s = String(t || "").toLowerCase();
    const m = s.match(/(\d{1,2})\s+de\s+([a-zç]+)\.?(?:\s+de\s+(\d{4}))?/);
    if (!m) {
      const mm = s.match(/([a-zç]+)\.?\s+de\s+(\d{4})/);
      return mm && MESES[mm[1]] !== undefined ? iso(new Date(Number(mm[2]), MESES[mm[1]], 1)) : null;
    }
    if (MESES[m[2]] === undefined) return null;
    let ano = m[3] ? Number(m[3]) : hoje().getFullYear();
    let d = new Date(ano, MESES[m[2]], Number(m[1]));
    if (!m[3] && d > hoje()) d = new Date(ano - 1, MESES[m[2]], Number(m[1]));
    return iso(d);
  }
  const clicarTexto = (txt, raiz = document) => {
    const e = [...raiz.querySelectorAll("*")].find((x) => x.childElementCount === 0 && x.textContent.trim() === txt);
    if (!e) return false;
    let c = e;
    for (let i = 0; i < 5 && c; i++) { if (c.getAttribute("role") || c.tagName === "BUTTON" || c.tagName === "A" || c.getAttribute("jsaction")) break; c = c.parentElement; }
    (c || e).click();
    return true;
  };

  // ---------- Google (restaurantes): caixa "Ver todos os comentários do Google" da Busca ----------
  async function google_busca({ max = 40, conhecidos = [] } = {}) {
    const visto = new Set(conhecidos);
    for (let i = 0; i < 20 && !/coment[áa]rios do Google/i.test(document.body.innerText); i++) await dormir(500);
    const resumo = {};
    const cab = document.body.innerText.match(/(\d,\d)\s*\n?\s*([\d.]+)\s+(?:avalia[çc][õo]es|coment[áa]rios) no Google/);
    if (cab) { resumo.nota = numero(cab[1]); resumo.total = inteiro(cab[2]); }
    const link = [...document.querySelectorAll("a")].find((e) => /Ver todos os coment[áa]rios do Google/i.test(e.innerText));
    if (!link) throw new Error("não achei a caixa de comentários do Google na busca");
    link.click();
    for (let i = 0; i < 20 && !document.querySelector("div.bwb7ce"); i++) await dormir(500);
    if (clicarTexto("Mais recentes")) await dormir(3000);
    const tot = document.body.innerText.match(/(\d,\d)\s*\n?\s*([\d.]+)\s+avalia[çc][õo]es\n/);
    if (tot) { resumo.nota = numero(tot[1]); resumo.total = inteiro(tot[2]); }
    let parado = 0, ult = 0;
    while (parado < 4) {
      const ids = [...document.querySelectorAll("div.bwb7ce")].map((e) => e.getAttribute("data-id"));
      if (ids.length >= max || ids.some((id) => visto.has(id))) break;
      const lista = document.querySelector("div.OG9A1");
      lista?.lastElementChild?.scrollIntoView();
      document.querySelectorAll("div").forEach((d) => { if (d.scrollHeight > d.clientHeight + 20 && /(auto|scroll)/.test(getComputedStyle(d).overflowY) && d.contains(lista)) d.scrollTop = d.scrollHeight; });
      await dormir(1600);
      const n = document.querySelectorAll("div.bwb7ce").length;
      if (n === ult) parado++; else { parado = 0; ult = n; }
    }
    document.querySelectorAll('div.bwb7ce [role=button][aria-label^="Leia mais"]').forEach((b) => { try { b.click(); } catch {} });
    await dormir(700);
    const itens = [...document.querySelectorAll("div.bwb7ce")].slice(0, max).map((c) => {
      const id = c.getAttribute("data-id");
      const linhas = c.innerText.split("\n").map((l) => l.trim()).filter(Boolean);
      const iDono = linhas.findIndex((l) => /\(propriet[áa]rio\)$/.test(l));
      const parte = iDono >= 0 ? linhas.slice(0, iDono) : linhas;
      const dataTxt = parte.find((l) => /atr[áa]s$|^h[áa] /.test(l)) || null;
      const estrelas = [...c.querySelectorAll("path")].filter((p) => (p.getAttribute("fill") || "").toLowerCase() === "#fabb05").length;
      // texto: o maior trecho com texto próprio antes da resposta do dono
      const dono = iDono >= 0 ? [...c.querySelectorAll("*")].find((e) => e.childElementCount <= 1 && /\(propriet[áa]rio\)$/.test(e.textContent.trim())) : null;
      let texto = null;
      for (const e of c.querySelectorAll("div,span")) {
        if (dono && (dono.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
        const proprio = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();
        if (proprio.length > (texto?.length || 0) && proprio.length > 15 && !/avalia[çc][õo]es|Local Guide/.test(proprio)) texto = e.innerText.replace(/\s*…\s*Mais$/, "");
      }
      let resposta = null, resposta_data = null;
      if (iDono >= 0) { resposta_data = linhas[iDono + 1] || null; resposta = limpa(linhas.slice(iDono + 2).join("\n")); }
      const meta = parte.find((l) => /\|| R\$|^(Almo[çc]o|Jantar|Caf[ée] da manh[ãa]|Refei[çc][ãa]o|Delivery|Para viagem)/.test(l)) || null;
      return { id, autor: c.querySelector("[aria-label]")?.getAttribute("aria-label") || parte[0] || null, autor_info: parte[1] || null,
        nota: estrelas || null, data: relativa(dataTxt), aproximada: true, data_texto: dataTxt, texto: limpa(texto), resposta, resposta_data,
        detalhes: meta ? { tipo: meta } : null };
    });
    return { resumo, itens };
  }

  // ---------- Google (hotéis): primeiro passo, na Busca, o link para a aba Avaliações do Google Viagens ----------
  async function google_viagens_link() {
    for (let i = 0; i < 20; i++) {
      const a = [...document.querySelectorAll("a[href*='/travel/']")].find((e) => /avalia[çc][õo]es/i.test(e.innerText));
      if (a) return a.href;
      await dormir(500);
    }
    throw new Error("não achei o link das avaliações do hotel no Google");
  }
  // ---------- Google (hotéis): aba Avaliações do Google Viagens (guarda só as do Google) ----------
  async function google_viagens({ max = 40, conhecidos = [] } = {}) {
    const visto = new Set(conhecidos);
    for (let i = 0; i < 24 && !document.querySelector("span.k5TI0"); i++) await dormir(500);
    const resumo = {};
    const r = document.body.innerText.match(/Resumo de avalia[çc][õo]es do Google\n(\d,\d)\n([\d.]+) avalia/);
    if (r) { resumo.nota = numero(r[1]); resumo.total = inteiro(r[2]); }
    // "Mais recentes": no Google Viagens só um clique de verdade funciona (o robô clica antes, pelo Playwright)
    const lerItens = () => [...document.querySelectorAll("div.Svr5cf")].map((c) => {
      const autor = c.querySelector("a.DHIhE")?.textContent.trim() || null;
      const contrib = (c.querySelector("a.DHIhE")?.getAttribute("href") || "").match(/contrib\/(\d+)/)?.[1] || null;
      const quando = c.querySelector("span.iUtr1")?.textContent.replace(/\s+/g, " ").trim() || "";
      const site = /no\s+Google/.test(quando) ? "google" : /Tripadvisor/i.test(quando) ? "tripadvisor" : "outro";
      const dataTxt = quando.replace(/\s+no\s+\S+\s*$/, "").trim(); // "um ano atrás no Google" → "um ano atrás" (antes cortava em "um a")
      const completo = c.querySelector(".OlkcBc.eLNT1d .K7oBsc") || c.querySelector(".K7oBsc");
      const texto = limpa(completo?.innerText.replace(/\s*Ler mais$/, ""));
      const resp = [...c.querySelectorAll("*")].find((e) => e.childElementCount <= 2 && /^Resposta do propriet[áa]rio/.test(e.textContent.trim()));
      return { site, id: contrib ? `${contrib}-${codigo(dataTxt, (texto || "").slice(0, 60))}` : codigo(autor, dataTxt, texto),
        autor, nota: numero(c.querySelector(".GDWaad")?.textContent), data: relativa(dataTxt), aproximada: true, data_texto: dataTxt,
        perfil: c.querySelector(".ThUm5b")?.textContent.trim() || null, texto,
        resposta: resp ? limpa(resp.parentElement?.innerText.replace(/^Resposta do propriet[áa]rio\s*/, "")) : null };
    });
    let parado = 0, ult = 0;
    while (parado < 4) {
      const lidos = lerItens().filter((x) => x.site === "google");
      if (lidos.length >= max || lidos.some((x) => visto.has(x.id))) break;
      // quem rola é o <body> (window.scrollTo não carrega mais)
      document.body.scrollTop = document.body.scrollHeight;
      [...document.querySelectorAll("div.Svr5cf")].pop()?.scrollIntoView({ block: "end" });
      await dormir(1800);
      const n = document.querySelectorAll("div.Svr5cf").length;
      if (n === ult) parado++; else { parado = 0; ult = n; }
    }
    return { resumo, itens: lerItens().filter((x) => x.site === "google").slice(0, max).map(({ site, ...x }) => x) };
  }

  // ---------- TripAdvisor: a página aberta e, pelas mesmas regras, as seguintes (10 avaliações por página, -or10-, -or20-…),
  // baixadas com fetch dentro da própria página (o HTML já vem com as avaliações) ----------
  async function tripadvisor({ paginas = 1, conhecidos = [] } = {}) {
    for (let k = 1; k <= 8; k++) { window.scrollTo(0, (document.body.scrollHeight * k) / 8); await dormir(500); }
    for (let i = 0; i < 20 && !document.querySelector('[data-test-target="HR_CC_CARD"], [data-automation="reviewCard"]'); i++) await dormir(500);
    const visto = new Set(conhecidos);
    const r = lerTripadvisor(document, document.body.innerText);
    const base = location.href.replace(/-Reviews-or\d+-/, "-Reviews-").split("#")[0];
    for (let p = 1; p < paginas; p++) {
      if (!r.itens.length || r.itens.some((x) => visto.has(x.id))) break;
      await dormir(1200 + Math.random() * 1500);
      const resp = await fetch(base.replace(/-Reviews-/, `-Reviews-or${p * 10}-`), { credentials: "include" });
      if (!resp.ok) break;
      const doc = new DOMParser().parseFromString(await resp.text(), "text/html");
      const r2 = lerTripadvisor(doc, doc.body?.textContent || "");
      const novos = r2.itens.filter((x) => !r.itens.some((y) => y.id === x.id));
      if (!novos.length) break;
      r.itens.push(...novos);
    }
    return r;
  }
  function lerTripadvisor(raiz, t) {
    const resumo = {};
    const nota = t.match(/(\d,\d)\s*\n?\s*\d,\d de 5 c[íi]rculos/) || t.match(/(\d,\d)\s*de 5 c[íi]rculos/);
    if (nota) resumo.nota = numero(nota[1]);
    const total = t.match(/\(([\d.]+) avalia[çc][õo]es\)/) || t.match(/Todas as avalia[çc][õo]es \(([\d.]+)\)/);
    if (total) resumo.total = inteiro(total[1]);
    const pos = t.match(/N[ºo°]\s*\d+ de [\d.]+ [^\n]+/);
    if (pos) resumo.posicao = pos[0].trim();
    const cards = [...raiz.querySelectorAll('[data-test-target="HR_CC_CARD"], [data-automation="reviewCard"]')];
    const itens = cards.map((c) => {
      const link = [...c.querySelectorAll("a[href*='ShowUserReviews']")].map((a) => a.getAttribute("href"))[0] || null;
      const id = link?.match(/-r(\d+)-/)?.[1] || null;
      // no HTML baixado não há innerText com quebras: monta as linhas pelos blocos de texto
      const linhas = (c.innerText !== undefined && raiz === document ? c.innerText.split("\n")
        : [...c.querySelectorAll("*")].filter((e) => e.childElementCount === 0 || [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
            .map((e) => [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" "))).map((l) => l.trim()).filter(Boolean);
      const bolhas = [...c.querySelectorAll("svg title, [aria-label]")].map((e) => e.textContent || e.getAttribute("aria-label")).find((x) => /de 5 c[íi]rculos/.test(x || ""));
      const feita = linhas.find((l) => /fez uma avalia[çc][ãa]o|escreveu uma avalia[çc][ãa]o/i.test(l)) || null;
      const iEst = linhas.findIndex((l) => /^Data da (estadia|visita|hospedagem):?$/i.test(l));
      const iTipo = linhas.findIndex((l) => /^Tipo de viagem:?$/i.test(l));
      const iResp = linhas.findIndex((l) => /^Resposta de /i.test(l));
      const corpo = c.querySelector('[data-test-target="review-body"], [data-automation="reviewText"]');
      const perfil = [...c.querySelectorAll("a[href^='/Profile/']")].map((a) => a.textContent.trim()).find(Boolean);
      return { id, autor: perfil || linhas[0] || null, autor_info: linhas.find((l) => /contribui[çc]/.test(l)) || null,
        nota: numero(bolhas), titulo: c.querySelector('[data-test-target="review-title"]')?.innerText.trim() || null,
        texto: limpa((corpo?.innerText ?? corpo?.textContent)?.replace(/\s*Leia mais$/, "")), data: dataPt(feita), aproximada: !/\(\d{1,2} de /.test(feita || ""), data_texto: feita,
        estadia: iEst >= 0 ? linhas[iEst + 1] : null, perfil: iTipo >= 0 ? linhas[iTipo + 1] : null,
        resposta: iResp >= 0 ? limpa(linhas.slice(iResp + 1).join("\n").replace(/\n?Leia mais$/, "")) : null,
        resposta_data: iResp >= 0 ? linhas[iResp] : null,
        link: link ? new URL(link, location.origin).href : null };
    }).filter((x) => x.id);
    return { resumo, itens };
  }

  // ---------- Booking: janela "Ler todas as avaliações", Mais recentes primeiro ----------
  async function booking({ paginas = 2, conhecidos = [] } = {}) {
    const visto = new Set(conhecidos);
    const txt = (el, t) => { const e = el.querySelector(`[data-testid="${t}"]`); return e ? e.innerText.trim() : null; };
    const resumo = {};
    for (let i = 0; i < 20 && !document.querySelector('[data-testid="review-score-component"]'); i++) await dormir(500);
    const sc = document.querySelector('[data-testid="review-score-component"]')?.innerText || "";
    const m = sc.match(/(\d+,\d)[\s\S]*?([\d.]+) avalia/);
    if (m) { resumo.nota = numero(m[1]); resumo.total = inteiro(m[2]); }
    let s = document.querySelector('select[data-testid="reviews-sorter-component"]');
    if (!s) {
      const b = [...document.querySelectorAll("button,a")].find((e) => /ler todas as avalia|read all reviews/i.test(e.innerText));
      if (b) { b.click(); await dormir(3500); }
      s = document.querySelector('select[data-testid="reviews-sorter-component"]');
    }
    if (s) {
      const op = [...s.options].find((o) => /recentes|newest/i.test(o.text));
      if (op && s.value !== op.value) {
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, op.value);
        s.dispatchEvent(new Event("change", { bubbles: true }));
        await dormir(3500);
      }
    }
    const itens = [];
    for (let p = 0; p < paginas; p++) {
      let parar = false;
      for (const c of document.querySelectorAll('[data-testid="review-card"]')) {
        const av = (txt(c, "review-avatar") || "").split("\n");
        const dataTxt = txt(c, "review-date");
        const titulo = txt(c, "review-title");
        const positivo = txt(c, "review-positive-text"), negativo = txt(c, "review-negative-text");
        const resp = [...c.querySelectorAll("*")].find((e) => /^Resposta d[aoe]/i.test(e.innerText || "") && e.childElementCount < 4);
        const id = codigo(av[0], dataTxt, titulo, (positivo || negativo || "").slice(0, 60));
        if (visto.has(id)) parar = true;
        itens.push({ id, autor: av[0] || null, pais: av[1] || null, nota: numero((txt(c, "review-score") || "").split("\n").pop()),
          titulo, positivo, negativo, texto: [positivo, negativo].filter(Boolean).join("\n\n") || null,
          data: dataPt(dataTxt), aproximada: false, data_texto: dataTxt, quarto: txt(c, "review-room-name"),
          estadia: [txt(c, "review-num-nights")?.replace(/\s*·\s*$/, ""), txt(c, "review-stay-date")].filter(Boolean).join(" · ") || null,
          perfil: txt(c, "review-traveler-type"), resposta: resp ? limpa(resp.innerText.replace(/^Resposta d[aoe][^\n]*\n?/i, "")) : null });
      }
      if (parar) break;
      const prox = document.querySelector('button[aria-label="Página seguinte"],button[aria-label="Next page"]');
      if (!prox || prox.disabled) break;
      prox.click(); await dormir(3000);
    }
    return { resumo, itens };
  }

  // ---------- Expedia: janela das avaliações (todas, "More reviews") ----------
  async function expedia({ max = 60 } = {}) {
    // a página da Expedia demora a montar: espera o botão até 30 s, descendo um pouco a página
    for (let i = 0; i < 60 && !document.querySelector('[data-stid="reviews-link"]'); i++) { if (i % 6 === 5) window.scrollBy(0, 400); await dormir(500); }
    window.scrollTo(0, 0);
    const resumo = {};
    if (!document.querySelector("[role=dialog] article")) {
      const b = document.querySelector('[data-stid="reviews-link"]') || [...document.querySelectorAll("button")].find((e) => /^\d+ reviews$/i.test(e.innerText.trim()));
      if (!b) throw new Error("não achei o botão das avaliações na Expedia");
      b.click();
    }
    for (let i = 0; i < 40 && !document.querySelector("[role=dialog] article"); i++) await dormir(500);
    const dlg = document.querySelector("[role=dialog]");
    if (!dlg?.querySelector("article")) throw new Error("a janela das avaliações da Expedia não abriu");
    const t = dlg.innerText;
    const n = t.match(/rated (\d+(?:\.\d)?) out of 10/); if (n) resumo.nota = Number(n[1]);
    const tt = t.match(/([\d,]+) verified reviews/); if (tt) resumo.total = Number(tt[1].replace(/,/g, ""));
    // ordem: mais recentes
    const ord = [...dlg.querySelectorAll("button")].find((e) => /Most relevant/.test(e.innerText));
    if (ord) { ord.click(); await dormir(1000); const op = [...document.querySelectorAll("[role=option],[role=menuitemradio],li,button")].find((e) => /^Newest to oldest|^Most recent/i.test(e.innerText.trim())); if (op) { op.click(); await dormir(2500); } }
    for (let i = 0; i < 20 && dlg.querySelectorAll("article").length < max; i++) {
      const mais = [...dlg.querySelectorAll("button")].find((e) => e.innerText.trim() === "More reviews");
      if (!mais) break;
      mais.click(); await dormir(2000);
    }
    const vistos = new Set();
    const itens = [...dlg.querySelectorAll("article")].filter((a) => !a.id || (!vistos.has(a.id) && vistos.add(a.id))).slice(0, max).map((a) => {
      const h3 = a.querySelector("h3")?.innerText || "";
      const cab = [...a.querySelectorAll("h4 ~ div, h4 + div")].map((e) => e.innerText.trim());
      const dataTxt = [...a.querySelectorAll("div")].map((e) => e.innerText.trim()).find((x) => /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(x)) || null;
      const linhas = a.innerText.split("\n").map((l) => l.trim()).filter(Boolean);
      const iResp = linhas.findIndex((l) => /^Response from /i.test(l));
      const corpo = a.querySelector('[style*="peek-lines"] div') || null;
      const dt = dataTxt ? new Date(dataTxt) : null;
      return { id: a.id || codigo(a.querySelector("h4")?.innerText, dataTxt), autor: a.querySelector("h4")?.innerText.trim() || null,
        nota: numero(h3), titulo: h3.replace(/^\d+\/10\s*/, "") || null, perfil: cab.find((x) => /^Traveled/.test(x)) || null,
        data: dt && !isNaN(dt) ? iso(dt) : null, aproximada: false, data_texto: dataTxt,
        texto: limpa(corpo?.innerText), estadia: linhas.find((l) => /^Stayed /.test(l)) || null,
        detalhes: (() => { const g = linhas.find((l) => /^Liked: /.test(l)); return g ? { gostou: g.replace(/^Liked: /, "") } : null; })(),
        resposta: iResp >= 0 ? limpa(linhas.slice(iResp + 1).filter((l) => !/^(See more|See less)$/.test(l)).join("\n")) : null,
        resposta_data: iResp >= 0 ? linhas[iResp] : null };
    });
    return { resumo, itens };
  }

  globalThis.__avaliacoes = { google_busca, google_viagens_link, google_viagens, tripadvisor, booking, expedia, relativa, dataPt };
})();
