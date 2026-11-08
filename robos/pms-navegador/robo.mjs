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
import { createHash } from "node:crypto";

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
  if (!f) { await diagnostico(page, "sem-login"); throw new Error("a tela de login não apareceu"); }
  await f.locator('input:not([type="password"]):not([type="checkbox"]):not([type="hidden"])').first().fill(usuario);
  await f.locator('input[type="password"]').first().fill(senha);
  await espera(500);
  // Registra só o código de resposta do pedido de login (nunca o corpo)
  page.on("response", (r) => { if (/thexidentity-auth\/api\/signin/.test(r.url())) log(`[login] resposta ${r.status()} de ${new URL(r.url()).pathname}`); });
  log(`[login] navegador: ${await page.evaluate(() => navigator.userAgent)}`);
  const botao = f.getByRole("button", { name: /^\s*Entrar\s*$/i }).first();
  if (await botao.isDisabled().catch(() => false)) await f.locator('input[type="password"]').first().press("Enter");
  else await botao.click();
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
  await diagnostico(page, "login");
  throw new Error("o login não terminou em 60 s");
}

// Mostra no log onde a tela parou (endereços e começo do texto de cada quadro), sem senha nem dados de hóspede
async function diagnostico(page, etapa) {
  for (const f of page.frames()) {
    const tx = (await f.locator("body").innerText({ timeout: 2000 }).catch(() => "")).replace(/\s+/g, " ").slice(0, 300);
    const campos = await f.locator("input").evaluateAll((els) => els.map((e) => `${e.type}:${e.name || e.getAttribute("formcontrolname") || e.placeholder || ""}:${e.value ? "preenchido" : "vazio"}`)).catch(() => []);
    log(`[${etapa}] quadro ${f.url().slice(0, 80)} | campos ${campos.join(", ")} | texto: ${tx}`);
  }
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
    ...(erroDisp ? { aviso: erroDisp } : {}), _token: token };
}

// ---------- reservas por quarto, UHs e bloqueios (para a página de Reservas e o Mapa) ----------
async function lerReservas(page, h, token) {
  const pid = h.propriedade;
  if (!pid) throw new Error("hotel sem número de propriedade");
  const get = (url) => page.evaluate(async ([u, t]) => {
    const r = await fetch(u, { headers: { Authorization: t, Accept: "application/json" } });
    if (!r.ok) throw new Error(`HTTP ${r.status} em ${new URL(u).pathname}`);
    return r.json();
  }, [url, token]);
  const lista = (j) => (Array.isArray(j) ? j : j?.items ?? []);

  const quartos = lista(await get(`https://group02.totvshospitalidade.com/pms/api/properties/${pid}/rooms?_expandables=ChildRoomIdList&culture=pt-BR`));
  const uhs = quartos.map((q) => ({ uh_id: q.id, numero: String(q.roomNumber ?? q.id), tipo_id: q.roomTypeId ?? q.roomType?.id ?? null,
    tipo: q.roomType?.name ?? q.roomTypeName ?? null, andar: q.floor ?? null, ativa: q.isActive !== false, fora_inventario: !!q.outOfInventory }));

  const motivos = new Map();
  try {
    for (const m of lista(await get(`https://group02.totvshospitalidade.com/pms/api/reason/${pid}/getallreason?culture=pt-BR`)))
      motivos.set(Number(m.id), m.reasonName ?? m.name ?? m.description ?? null);
  } catch { /* sem motivos: o bloqueio fica sem nome */ }

  // Todas as reservas, status por status (1 Confirmada, 2 Check-In, 3 Check-Out, 4 Pendente, 5 No-Show, 6 Cancelada; 0 e 7–9 por garantia)
  const linhas = [];
  for (const st of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    for (let pg = 1; pg <= 200; pg++) {
      const j = await get(`https://group03.totvshospitalidade.com/booking/api/booking/searchv2?page=${pg}&pageSize=100&order=&guestReservationItemStatusId=${st}&culture=pt-BR`);
      linhas.push(...(j?.items ?? []));
      if (!j?.hasNext) break;
    }
  }
  const porItem = new Map();
  for (const x of linhas) {
    const id = x.reservationItemId;
    if (id == null) continue;
    const e = porItem.get(id) ?? { item_id: id, codigo: x.reservationItemCode ?? null, grupo_codigo: x.reservationGroupCode ?? null,
      grupo_nome: x.groupName || null, uh_id: x.roomId || null, uh_numero: x.roomNumber || null, tipo_id: x.receivedRoomTypeId ?? null,
      tipo: x.receivedRoomTypeName ?? null, checkin: String(x.arrivalDate ?? "").slice(0, 10) || null, checkout: String(x.departureDate ?? "").slice(0, 10) || null,
      status_id: x.reservationItemStatusId ?? x.guestReservationItemStatusId ?? null, status: x.reservationItemStatusName ?? x.guestReservationItemStatusName ?? null,
      hospede: null, adultos: 0, criancas: 0, hospedes: 0, vip: false, fora_inventario: !!x.outOfInventory };
    e.hospedes++;
    e.adultos = Math.max(e.adultos, Number(x.adultsCount) || 0);
    e.criancas = Math.max(e.criancas, Number(x.childCount) || 0);
    if (x.guestIsVip) e.vip = true;
    if ((x.isMain || !e.hospede) && x.guestName && !x.guestIsIncognito) e.hospede = String(x.guestName).trim();
    porItem.set(id, e);
  }

  // Bloqueios de UH: vêm na disponibilidade (janelas de 30 dias), de 60 dias atrás a ~10 meses à frente
  const bloqueios = new Map();
  const hoje = new Date(Date.now() - 3 * 3600000);
  for (let d = -60; d <= 300; d += 30) {
    const ini = new Date(hoje.getTime() + d * 86400000).toISOString().slice(0, 10);
    try {
      const a = await get(`${DISPONIBILIDADE}/Availability/${pid}/roomtypes?InitialDate=${ini}T00:00:00&Period=30&culture=pt-BR`);
      for (const b of a?.roomsBlocked ?? []) {
        bloqueios.set(b.id, { bloqueio_id: b.id, uh_id: b.roomId || null, inicio: String(b.blockingStartDate ?? "").slice(0, 10) || null,
          fim: String(b.blockingEndDate ?? "").slice(0, 10) || null, motivo: motivos.get(Number(b.reasonId)) ?? null,
          comentario: b.comments ? String(b.comments).slice(0, 200) : null });
      }
    } catch { /* uma janela que falhou não impede as outras */ }
  }
  const dados = { uhs, estadias: [...porItem.values()], bloqueios: [...bloqueios.values()] };
  const g = await rpc("pms_robo_gravar_reservas", { p_segredo: SEGREDO, p_hotel: h.id, p_dados: dados });
  return { uhs: uhs.length, estadias: dados.estadias.length, bloqueios: dados.bloqueios.length, gravado: g };
}

// ---------- histórico (relatórios Metabase do PMS, mês a mês) ----------
const EBS = "https://ebs.totvshospitalidade.com/report";
const RELATORIOS = { kpi: 7408, reservas: 364, recebimentos: 9, transacoes: 4 }; // metabaseKey de cada relatório no menu do PMS
const LIMITE_NAVEGACOES = Number(process.env.LIMITE_HISTORICO || 150); // por hotel e rodada (carga do passado aos poucos)
const MESES_VAZIOS_PARA_PARAR = 6;

const ymd = (d) => d.toISOString().slice(0, 10);
const inicioMes = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const somaMes = (d, n) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
const fimMes = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));

// "01/10/2026", "30/10/2026 03:00:00" ou ISO -> "2026-10-01"
function dataDe(v) {
  if (v == null || v === "") return null;
  const s = String(v);
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return iso ? iso[1] : null;
}
function instanteDe(v) {
  if (v == null || v === "" || /não cancel/i.test(String(v))) return null;
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s;
  const d = dataDe(s);
  return d ? `${d}T${(s.match(/(\d{2}:\d{2}:\d{2})/) || [, "00:00:00"])[1]}-03:00` : null;
}
const numero = (v) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

// Acha a coluna pelo nome (sem acento, minúsculas)
function colunas(cols) {
  const nomes = cols.map((c) => semAcento(c.display_name ?? c.name));
  return (re) => nomes.findIndex((n) => re.test(n));
}

function normalizar(relatorio, j) {
  const cols = j?.data?.cols ?? [], rows = j?.data?.rows ?? [];
  const c = colunas(cols);
  if (relatorio === "kpi") {
    const i = { dia: c(/data refer/), cat: c(/categoria/), disp: c(/disponiveis/), bloq: c(/bloqueadas/), tot: c(/total uhs/), ocup: c(/ocupadas/), rec: c(/receita/) };
    return rows.map((r) => ({ dia: dataDe(r[i.dia]), categoria: r[i.cat], disponiveis: numero(r[i.disp]), bloqueadas: numero(r[i.bloq]),
      total: numero(r[i.tot]), ocupadas: numero(r[i.ocup]), receita: numero(r[i.rec]) })).filter((x) => x.dia);
  }
  if (relatorio === "reservas") {
    // A coluna do nome do hóspede ("Hóspede") nunca é lida
    const i = { canal: c(/channel name/), reserva: c(/^reserva$/), loc: c(/localizador/), criada: c(/data integra/), empresa: c(/^empresa$/),
      tarifa: c(/rateplan|tarifa/), uh: c(/uh cobrada|^uh$/), ci: c(/checkin/), co: c(/checkout/), valor: c(/total diarias/),
      status: c(/status/), canc: c(/cancelamento/) };
    return rows.map((r) => ({ reserva: r[i.reserva] != null ? String(r[i.reserva]) : null, canal: r[i.canal], localizador_canal: r[i.loc] != null ? String(r[i.loc]) : null,
      criada_em: instanteDe(r[i.criada]), empresa: r[i.empresa], tarifa: r[i.tarifa], uh: r[i.uh], checkin: dataDe(r[i.ci]), checkout: dataDe(r[i.co]),
      valor_diarias: numero(r[i.valor]), status: r[i.status], cancelada_em: instanteDe(r[i.canc]) })).filter((x) => x.reserva);
  }
  if (relatorio === "recebimentos") {
    const i = { grupo: c(/^grupo$/), tipo: c(/^tipo$/), dia: c(/^data$/), valor: c(/valor liquido/) };
    return rows.map((r) => ({ dia: dataDe(r[i.dia]), grupo: r[i.grupo], tipo: r[i.tipo], valor: numero(r[i.valor]) })).filter((x) => x.dia);
  }
  if (relatorio === "transacoes") {
    // Só os campos do lançamento e da reserva. Nunca: Hóspede, CPF/CNPJ, cliente, nome da conta, contato, e-mail, telefone.
    const i = { dia: c(/^datalancto$/), reserva: c(/^numreservapms$/), uh: c(/^uh$/), tipo_uh: c(/^tipouh$/), status: c(/^statusrsv$/),
      origem: c(/^origemrsv$/), segmento: c(/^segmentorsv$/), tarifa: c(/^rateplan$/), pernoites: c(/^pernoites$/), chegada: c(/^datachegada$/),
      partida: c(/^datapartida$/), conta: c(/^tipoconta$/), item: c(/^tipoitem$/), cod: c(/^codreduzido$/), desc: c(/^lactodescricao$/),
      valor: c(/^valor$/), obs: c(/^observacao$/), est: c(/^estornado$/) };
    const vistos = new Map();
    return rows.map((r) => {
      const x = { dia: dataDe(r[i.dia]), reserva: r[i.reserva] ?? null, uh: r[i.uh] ?? null, tipo_uh: r[i.tipo_uh] ?? null, status_reserva: r[i.status] ?? null,
        origem: r[i.origem] ?? null, segmento: r[i.segmento] ?? null, tarifa: r[i.tarifa] ?? null, pernoites: numero(r[i.pernoites]),
        chegada: dataDe(r[i.chegada]), partida: dataDe(r[i.partida]), conta_tipo: r[i.conta] ?? null, item_tipo: r[i.item] ?? null,
        codigo: r[i.cod] ?? null, descricao: r[i.desc] ?? null, valor: numero(r[i.valor]), estornado: /estornad/i.test(String(r[i.est] ?? "")),
        observacao: r[i.obs] && r[i.obs] !== "-" ? String(r[i.obs]).slice(0, 160) : null };
      x.grupo = grupoTransacao(x);
      const base = [x.dia, x.reserva, x.uh, x.conta_tipo, x.item_tipo, x.codigo, x.descricao, x.valor, x.estornado].join("|");
      const n = (vistos.get(base) ?? 0) + 1; vistos.set(base, n);
      x.chave = createHash("sha1").update(`${base}|${n}`).digest("hex");
      return x;
    }).filter((x) => x.dia && x.valor != null);
  }
  return [];
}

// Classificação do Brasico para cada lançamento
function grupoTransacao(x) {
  const t = semAcento(`${x.item_tipo ?? ""}`), d = semAcento(`${x.descricao ?? ""}`);
  if (/payment|pagamento/.test(t)) return "Pagamento";
  if (/tax|taxa/.test(t) || /taxa de servico|(^|[^a-z])iss([^a-z]|$)|taxa de turismo|taxa municipal/.test(d)) return "Taxa";
  if (/daily|diaria/.test(t) || /^diaria|^hospedagem|diferenca de diaria/.test(d)) return "Diária";
  if (/point of sale/.test(t) || /restaurante|(^|[^a-z])bar([^a-z]|$)|a&b|aliment|bebida|frigobar|(^|[^a-z])menu([^a-z]|$)|room service/.test(d)) return "Consumo";
  if (/massagem|tratamento|(^|[^a-z])spa([^a-z]|$)|facial|ayurveda|detox|shiatsu|facelift|reflexolog|drenagem/.test(d)) return "Spa";
  return "Serviço";
}

async function lerMetabase(pagina, permissao, ini, fim) {
  await pagina.goto(`${EBS}/MetabaseReport?auth=${permissao}&StartDate=${ini}&EndDate=${fim}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await pagina.waitForURL(/metabase\.totvshospitalidade\.com\/embed\/question\//, { timeout: 30000 });
  const tok = new URL(pagina.url()).pathname.split("/").pop();
  return pagina.evaluate(async (t) => {
    let ultimo = "";
    for (let i = 0; i < 3; i++) {
      const ctl = new AbortController();
      const relogio = setTimeout(() => ctl.abort(), 45000);
      try {
        const r = await fetch(`/api/embed/card/${t}/query`, { signal: ctl.signal });
        const j = await r.json().catch(() => null);
        if (j?.data?.rows) return j;
        ultimo = `HTTP ${r.status} ${j?.error ?? j?.status ?? ""}`.trim();
      } catch (e) { ultimo = ctl.signal.aborted ? "tempo esgotado (45 s)" : String(e); }
      finally { clearTimeout(relogio); }
      await new Promise((ok) => setTimeout(ok, 3000));
    }
    throw new Error(`o relatório não respondeu: ${ultimo}`);
  }, tok);
}

// Decide os meses a ler: os recentes e futuros sempre que estiverem velhos; o passado aos poucos até achar o começo do hotel
function mesesParaLer(h, relatorio, lidos, agora) {
  const atual = inicioMes(agora);
  const meus = new Map(lidos.filter((x) => x.hotel === h.id && x.relatorio === relatorio).map((x) => [x.mes, x]));
  const velho = (mes, horas) => { const x = meus.get(ymd(mes)); return !x || agora - new Date(x.lido_em) > horas * 3600000; };
  const fila = [];
  // Só o passado e o mês atual: KPIs e recebimentos do futuro vêm zerados, e as reservas são filtradas pela data
  // em que foram feitas (as com chegada no futuro entram pelo mês em que foram criadas)
  const futuros = 0;
  for (let n = -1; n <= futuros; n++) {
    const m = somaMes(atual, n);
    if (velho(m, n <= 3 ? 1 : 24)) fila.push(ymd(m));
  }
  // Passado: meses ainda não lidos (ou lidos antes do fim do mês + 7 dias), do mais novo para o mais velho
  if (!h.historico_completo?.[relatorio]) {
    for (let n = -2; n >= -180; n--) {
      const m = somaMes(atual, n);
      const x = meus.get(ymd(m));
      const fechou = new Date(fimMes(m).getTime() + 8 * 86400000);
      if (!x || new Date(x.lido_em) < fechou) fila.push(ymd(m));
    }
  }
  return fila;
}

async function historico(page, ctx, h, token, lidos) {
  const resumo = { kpi: 0, reservas: 0, recebimentos: 0, erros: [] };
  const menu = await page.evaluate(async (t) => (await fetch("https://ebs.totvshospitalidade.com/report/api/MenuReports?culture=pt-BR",
    { headers: { Authorization: t, Accept: "application/json" } })).json(), token);
  const atual = ymd(inicioMes(new Date()));
  // Um estado por relatório. A permissão de abrir vale uma abertura só, e o PMS devolve a mesma por ~30 s se pedida de novo:
  // por isso os três relatórios andam intercalados (enquanto um espera permissão nova, os outros seguem).
  const estados = [];
  for (const [relatorio, chave] of Object.entries(RELATORIOS)) {
    const item = menu.find((m) => m.metabaseKey === chave);
    if (!item) { resumo.erros.push(`${relatorio}: relatório não está no menu`); continue; }
    estados.push({ relatorio, id: item.reportParameterUId, usadas: new Set(), fila: mesesParaLer(h, relatorio, lidos, new Date()), vazios: 0, parado: false });
  }
  const pedirPermissao = async (id) => (await page.evaluate(async ([i, t]) => (await fetch(`https://ebs.totvshospitalidade.com/report/api/FiltersReport/${i}?culture=pt-BR`,
    { headers: { Authorization: t, Accept: "application/json" } })).json(), [id, token]))?.permissionToken;
  let navegacoes = 0, semPermissaoSeguidas = 0;
  while (navegacoes < LIMITE_NAVEGACOES && resumo.erros.length <= 15) {
    const ativos = estados.filter((e) => !e.parado && e.fila.length);
    if (!ativos.length) break;
    let andou = false;
    for (const e of ativos) {
      if (navegacoes >= LIMITE_NAVEGACOES) break;
      const mes = e.fila[0];
      const passado = mes < atual;
      if (passado && e.vazios >= MESES_VAZIOS_PARA_PARAR) { e.parado = true; continue; } // passou do começo do hotel
      const permissao = await pedirPermissao(e.id).catch(() => null);
      if (!permissao || e.usadas.has(permissao)) continue; // ainda a mesma: tenta outro relatório
      e.usadas.add(permissao);
      e.fila.shift();
      andou = true;
      const t0 = Date.now();
      // Uma aba nova por abertura
      const pagina = await ctx.newPage();
      try {
        const j = await lerMetabase(pagina, permissao, mes, ymd(fimMes(new Date(`${mes}T00:00:00Z`))));
        navegacoes++;
        const linhas = normalizar(e.relatorio, j);
        const temMovimento = e.relatorio === "kpi" ? linhas.some((x) => (x.ocupadas || 0) > 0 || (x.receita || 0) !== 0) : linhas.length > 0;
        if (passado) e.vazios = temMovimento ? 0 : e.vazios + 1;
        if (e.relatorio === "transacoes") {
          await rpc("pms_robo_gravar_transacoes", { p_segredo: SEGREDO, p_hotel: h.id, p_mes: mes, p_linhas: linhas });
          // O relatório devolve no máximo 2000 linhas: perto disso, relê o mês em quinzenas (a chave de cada lançamento é a mesma)
          if ((j?.data?.rows ?? []).length >= 1900) {
            const fimM = ymd(fimMes(new Date(`${mes}T00:00:00Z`)));
            for (const [a, b] of [[mes, `${mes.slice(0, 8)}15`], [`${mes.slice(0, 8)}16`, fimM]]) {
              let p = null;
              for (let k = 0; k < 40 && !p; k++) { const q = await pedirPermissao(e.id).catch(() => null); if (q && !e.usadas.has(q)) p = q; else await espera(1500); }
              if (!p) { resumo.erros.push(`transacoes ${mes}: sem permissão para a quinzena`); break; }
              e.usadas.add(p);
              const pg = await ctx.newPage();
              try {
                const jq = await lerMetabase(pg, p, a, b);
                navegacoes++;
                const lq = normalizar("transacoes", jq);
                if ((jq?.data?.rows ?? []).length >= 2000) log(`  ${h.id} transacoes ${a}..${b}: 2000 linhas mesmo na quinzena — pode faltar lançamento`);
                await rpc("pms_robo_gravar_transacoes", { p_segredo: SEGREDO, p_hotel: h.id, p_mes: mes, p_linhas: lq });
                log(`  ${h.id} transacoes ${a}..${b}: ${lq.length} linhas (quinzena)`);
              } finally { await pg.close().catch(() => {}); }
            }
          }
        } else {
          await rpc("pms_robo_gravar_mes", { p_segredo: SEGREDO, p_hotel: h.id, p_relatorio: e.relatorio, p_mes: mes, p_linhas: linhas });
        }
        resumo[e.relatorio]++;
        log(`  ${h.id} ${e.relatorio} ${mes.slice(0, 7)}: ${linhas.length} linhas em ${Math.round((Date.now() - t0) / 1000)} s`);
      } catch (err) {
        navegacoes++;
        const msg = err.message.split("\n")[0];
        resumo.erros.push(`${e.relatorio} ${mes}: ${msg}`);
        log(`  ${h.id} ${e.relatorio} ${mes.slice(0, 7)}: falhou em ${Math.round((Date.now() - t0) / 1000)} s: ${msg}`);
      } finally {
        await pagina.close().catch(() => {});
      }
      await espera(800 + Math.random() * 2500); // pausa variável entre aberturas
    }
    if (!andou) {
      if (++semPermissaoSeguidas > 60) { resumo.erros.push("o PMS parou de dar permissões novas"); break; }
      await espera(1500 + Math.random() * 1500);
    } else semPermissaoSeguidas = 0;
  }
  for (const e of estados) {
    if (e.vazios >= MESES_VAZIOS_PARA_PARAR) {
      await rpc("pms_robo_historico_completo", { p_segredo: SEGREDO, p_hotel: h.id, p_relatorio: e.relatorio }).catch(() => {});
    }
  }
  return resumo;
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
  let browser;
  try {
    browser = await chromium.launch({ headless: process.env.JANELA !== "1", channel: process.env.CANAL || undefined });
  } catch (e) {
    log(`o navegador não abriu: ${e.message.split("\n")[0]}`);
    return;
  }
  try {
    const cred = (await rpc("pms_robo_credenciais", { p_segredo: SEGREDO }))?.[0];
    if (!cred?.usuario || !cred?.senha) throw new Error("faltam pms_usuario e pms_senha no Vault");
    const ctx = await browser.newContext({ locale: "pt-BR", timezoneId: "America/Fortaleza", viewport: { width: 1366, height: 900 } });
    const page = await ctx.newPage();
    try {
      await entrar(page, cred.usuario, cred.senha);
      log("login ok");
    } catch (e) { await guardarFalha(page, "login"); throw e; }
    const lidos = (await rpc("pms_robo_meses_lidos", { p_segredo: SEGREDO }).catch(() => [])) ?? [];
    for (const h of cred.hoteis ?? []) {
      try {
        await escolherHotel(page, formataCnpj(h.cnpj));
        const r = await lerHotel(page, h, ctx);
        const token = r._token; delete r._token;
        leitura.hoteis.push(r);
        try {
          const rs = await lerReservas(page, h, token);
          r.reservas = { uhs: rs.uhs, estadias: rs.estadias, bloqueios: rs.bloqueios };
          log(`${h.id}: reservas · ${rs.uhs} UHs · ${rs.estadias} estadias · ${rs.bloqueios} bloqueios`);
        } catch (e) { log(`${h.id}: reservas falharam: ${e.message.split("\n")[0]}`); }
        try {
          const hist = await historico(page, ctx, h, token, lidos);
          r.historico = hist;
          log(`${h.id}: histórico · kpi ${hist.kpi} meses · reservas ${hist.reservas} · recebimentos ${hist.recebimentos}` +
            (hist.erros.length ? ` · ${hist.erros.length} erro(s): ${hist.erros.slice(0, 3).join(" | ")}` : ""));
        } catch (e) { log(`${h.id}: histórico falhou: ${e.message.split("\n")[0]}`); }
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
  // Intervalo variável entre as rodadas (75% a 125% do intervalo; com 60 min, entre 45 e 75 min)
  const proxima = INTERVALO_MIN * 60000 * (0.75 + Math.random() * 0.5);
  log(`próxima rodada em ${Math.round(proxima / 60000)} min`);
  await espera(proxima);
} while (true);
