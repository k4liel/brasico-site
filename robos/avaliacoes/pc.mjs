// Leitor das avaliações no computador do escritório (25/11/2026, pedido do dono: "resolva o que falta, use outros métodos").
// Do servidor (VPS), Google, TripAdvisor e Expedia respondem com verificação de robô; daqui (conexão de casa, Edge do
// Windows) as páginas abrem como para qualquer pessoa. O Agendador do Windows roda este arquivo a cada 10 min
// (instalar_agenda_pc.ps1): uma passada e sai. O banco decide o que ler (avaliacoes_robo_comecar com p_onde = 'pc':
// Google a cada 10 min, os outros a cada hora). A lógica fica em avaliacoes.mjs (baixado do GitHub a cada vez).
// Só lê páginas públicas, sem login, no ritmo de uma pessoa olhando. Nada de segredo aqui: a chave fica em config.json,
// na pasta %LOCALAPPDATA%\brasico-avaliacoes (fora do GitHub), e o banco guarda só o hash (avaliacoes_chaves).
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const PASTA = process.env.BRASICO_AV_PASTA || join(process.env.LOCALAPPDATA || ".", "brasico-avaliacoes");
const cfg = JSON.parse(readFileSync(join(PASTA, "config.json"), "utf8")); // { supabase_url, anon, chave }
const REGISTRO = join(PASTA, "rodadas.log");
const log = (m) => { const l = `${new Date().toISOString()} ${m}`; console.log(l); try { appendFileSync(REGISTRO, l + "\n"); } catch {} };

async function rpc(nome, corpo) {
  const r = await fetch(`${cfg.supabase_url}/rest/v1/rpc/${nome}`, {
    method: "POST", headers: { apikey: cfg.anon, Authorization: `Bearer ${cfg.anon}`, "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${nome}: HTTP ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}

// Edge instalado no Windows, com janela fora da tela (não atrapalha quem usa o computador)
const { chromium: pw } = await import(pathToFileURL(join(PASTA, "node_modules", "playwright-core", "index.mjs")).href);
const chromium = {
  launch: (o = {}) => pw.launch({ ...o, channel: "msedge", headless: false, args: ["--window-position=-2400,0", "--window-size=1366,900"] }),
};

try {
  const r = await fetch(`https://raw.githubusercontent.com/k4liel/brasico-site/main/robos/avaliacoes/avaliacoes.mjs?v=${Math.floor(Date.now() / 300000)}`);
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  const arquivo = join(PASTA, "avaliacoes.mjs");
  writeFileSync(arquivo, await r.text());
  const m = await import(`${pathToFileURL(arquivo).href}?v=${Date.now()}`);
  await m.passada({ chromium, rpc, segredo: cfg.chave, log, onde: "pc", maximo: 6 });
} catch (e) {
  log(`[avaliacoes] falhou: ${String(e?.message || e).slice(0, 300)}`);
  process.exitCode = 1;
}
