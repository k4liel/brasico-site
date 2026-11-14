// Painel de integrações (/integracoes): regras que transformam o que o banco devolve (integracoes_painel,
// supabase/integracoes.sql) na situação de cada conexão — verde (funcionando), amarelo (pede atenção),
// vermelho (parada) ou cinza (pausada de propósito). Sem dependência do React: testado em tests/integracoes.test.ts.

export type Estado = "ok" | "atencao" | "erro" | "pausa";

export type Exec = {
  ultima: string | null; ultima_ok: string | null; ultima_falha: string | null;
  ok_24h: number; falha_24h: number; rodando: number; presos: number;
  ultimo_erro: string | null; ultimo_erro_em: string | null;
};
export type Painel = {
  agora: string;
  fontes: {
    rhid: Exec & { ultima_agora: string | null; ultima_apuracao: string | null; ultimo_cadastro: string | null; clientes: number };
    esocial: Exec & { empresas: { nome: string; ligada: boolean; limite: number; acessos_hoje: number | null; a_baixar: number }[] };
    receita: Exec & { ultimo_evento: string | null; empresas_producao: number; gasto_ciclo: number; orcamento_ciclo: number; cobradas_hoje: number; chamadas_erro_24h: number };
    notas: Exec & { empresas: number; bloqueadas: number; notas_7d: number; ultima_nota: string | null };
    nfse: Exec & { empresas: number; bloqueadas: number; notas_7d: number };
    totvs: Exec & { unidades: { nome: string; ultimo_dia: string | null; ontem: string | null }[] };
    cicchetti: { ultima: string | null; ultima_ok: string | null; ultima_falha: string | null; ok_24h: number; falha_24h: number;
      ultimo_erro: string | null; ultima_coleta_itens: string | null; notas_sem_itens: number };
    pms: Exec & { intervalo_min: number | null; hoteis: { nome: string; ultima_leitura: string | null }[] };
    whatsapp: { ultima_mensagem: string | null; mensagens_24h: number; grupos_24h: number; envios_24h: number; envios_falha_24h: number };
    gemini: Exec;
    claude: { ultimo_resumo: string | null; resumo_ontem: boolean };
    conector: { links: number; ultimo_uso: string | null };
  };
  certificados: { nome: string; cnpj: string; matriz: boolean; validade: string }[];
  agendas: { nome: string; horario: string; ativa: boolean; ultima: string | null; ultima_status: string | null; ultima_msg: string | null; rodadas_24h: number; falhas_24h: number }[];
  eventos: { fonte: string; status: string; quando: string; detalhe: string | null; erro: string | null }[];
};

export type Grupo = "governo" | "casas" | "comunicacao";
export type Integracao = {
  id: string; nome: string; quem: string; grupo: Grupo; oQueFaz: string; pagina?: string;
  estado: Estado; frase: string;
  numeros: { rotulo: string; valor: string }[];
  linhas?: { nome: string; estado: Estado; texto: string }[];
  erro?: { texto: string; quando: string } | null;
};

export const GRUPOS: { id: Grupo; titulo: string; explica: string }[] = [
  { id: "governo", titulo: "Governo", explica: "Receita, eSocial, notas fiscais e os certificados que abrem essas portas." },
  { id: "casas", titulo: "Sistemas das casas", explica: "Caixa dos restaurantes, gestão do Cicchetti, PMS dos hotéis e relógios de ponto." },
  { id: "comunicacao", titulo: "Comunicação e inteligência", explica: "WhatsApp, as IAs que leem as compras e resumem o dia, e o conector do Claude." },
];

// ---------- tempo ----------
const fort = (iso: string) => new Date(new Date(iso).getTime() - 3 * 3600 * 1000); // Fortaleza (UTC−3)
export const horaFortaleza = (agora: string) => fort(agora).getUTCHours();
export const minutos = (iso: string | null, agora: string) =>
  iso ? (new Date(agora).getTime() - new Date(iso).getTime()) / 60000 : Infinity;

export function quando(iso: string | null, agora: string): string {
  if (!iso) return "nunca";
  const min = Math.round(minutos(iso, agora));
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const a = fort(agora), d = fort(iso);
  const hm = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  const dias = Math.round((Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate()) - Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) / 86400000);
  if (dias === 0) return `hoje às ${hm}`;
  if (dias === 1) return `ontem às ${hm}`;
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")} às ${hm}`;
}

const diasAte = (iso: string, agora: string) => Math.floor((new Date(iso).getTime() - new Date(agora).getTime()) / 86400000);
const dataCurta = (iso: string) => { const d = fort(iso); return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };
const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pior = (...e: Estado[]): Estado => (e.includes("erro") ? "erro" : e.includes("atencao") ? "atencao" : e.every((x) => x === "pausa") && e.length ? "pausa" : "ok");

// "Última falha" só aparece quando é mais nova que a última leitura boa (senão já se resolveu)
function erroAberto(x: { ultima_falha: string | null; ultima_ok: string | null; ultimo_erro: string | null; ultimo_erro_em?: string | null }, agora: string) {
  if (!x.ultima_falha || !x.ultimo_erro) return null;
  if (x.ultima_ok && new Date(x.ultima_ok) > new Date(x.ultima_falha)) return null;
  return { texto: x.ultimo_erro, quando: quando(x.ultimo_erro_em ?? x.ultima_falha, agora) };
}

// Frescor: até `bom` minutos = ok, até `limite` = atenção, depois = parado
function frescor(iso: string | null, agora: string, bom: number, limite: number): Estado {
  const m = minutos(iso, agora);
  return m <= bom ? "ok" : m <= limite ? "atencao" : "erro";
}

// ---------- regras de cada integração ----------
export function montarIntegracoes(p: Painel): Integracao[] {
  const { agora, fontes: f } = p;
  const h = horaFortaleza(agora);
  const diaDoMes = fort(agora).getUTCDate();
  const lista: Integracao[] = [];

  // Receita Federal (SERPRO Integra Contador): rotina das 7h às 9h45 + consultas na hora
  {
    const r = f.receita;
    let estado = frescor(r.ultima_ok, agora, 30 * 60, 54 * 60);
    const uso = r.orcamento_ciclo > 0 ? r.gasto_ciclo / r.orcamento_ciclo : 0;
    let frase = `última leitura ${quando(r.ultima_ok, agora)}`;
    if (uso >= 0.9) { estado = pior(estado, "atencao"); frase = `gasto do ciclo em ${Math.round(uso * 100)}% do teto`; }
    const erro = erroAberto(r, agora);
    if (erro) estado = pior(estado, "atencao");
    lista.push({
      id: "receita", nome: "Receita Federal", quem: "SERPRO · Integra Contador", grupo: "governo", pagina: "/receita",
      oQueFaz: "Caixa postal, situação fiscal, pagamentos, declarações e parcelamentos das empresas.",
      estado, frase, erro,
      numeros: [
        { rotulo: "Gasto no ciclo", valor: `${reais(r.gasto_ciclo)} de ${reais(r.orcamento_ciclo)}` },
        { rotulo: "Cobradas hoje", valor: String(r.cobradas_hoje) },
        { rotulo: "Leituras em 24 h", valor: `${r.ok_24h} ok · ${r.falha_24h} falha` },
      ],
    });
  }

  // eSocial: do dia 1 ao 7 o governo não deixa consultar
  {
    const e = f.esocial;
    const pausa = diaDoMes <= 7;
    let estado: Estado = pausa ? "pausa" : frescor(e.ultima_ok, agora, 26 * 60, 50 * 60);
    const erro = erroAberto(e, agora);
    if (erro && !pausa) estado = pior(estado, "atencao");
    lista.push({
      id: "esocial", nome: "eSocial", quem: "Governo federal · webservice de consulta", grupo: "governo", pagina: "/esocial#dados",
      oQueFaz: "Baixa os eventos de admissão, salário, férias, afastamento e desligamento que o contador transmite.",
      estado, frase: pausa ? "pausa do governo (dias 1 a 7 do mês)" : `última resposta ${quando(e.ultima_ok, agora)}`, erro,
      numeros: [{ rotulo: "Leituras em 24 h", valor: `${e.ok_24h} ok · ${e.falha_24h} falha` }],
      linhas: e.empresas.map((x) => ({
        nome: nomeEmpresa(x.nome),
        estado: !x.ligada ? "pausa" : "ok",
        texto: !x.ligada ? "leitura automática desligada" : `${x.acessos_hoje ?? 0} de ${x.limite} acessos hoje${x.a_baixar ? ` · ${x.a_baixar} a baixar` : ""}`,
      })),
    });
  }

  // SEFAZ (NF-e de compra): leitura diária às 6h; sem nota nova a SEFAZ manda esperar 1 h (normal)
  {
    const n = f.notas;
    let estado = frescor(n.ultima_ok, agora, 26 * 60, 50 * 60);
    const erro = erroAberto(n, agora);
    if (erro) estado = pior(estado, "atencao");
    lista.push({
      id: "notas", nome: "SEFAZ · NF-e", quem: "Ambiente Nacional · distribuição de documentos", grupo: "governo", pagina: "/notas",
      oQueFaz: "Traz as notas fiscais de compra (produtos) recebidas pelas empresas, com os itens.",
      estado, frase: `última leitura ${quando(n.ultima_ok, agora)}`, erro,
      numeros: [
        { rotulo: "Notas em 7 dias", valor: String(n.notas_7d) },
        { rotulo: "CNPJs lidos", valor: `${n.empresas}${n.bloqueadas ? ` · ${n.bloqueadas} esperando 1 h` : ""}` },
        { rotulo: "Leituras em 24 h", valor: `${n.ok_24h} ok · ${n.falha_24h} falha` },
      ],
    });
  }

  // NFS-e (Portal Nacional / ADN): 6h30 e 12h30
  {
    const n = f.nfse;
    let estado = frescor(n.ultima_ok, agora, 26 * 60, 50 * 60);
    const erro = erroAberto(n, agora);
    if (erro) estado = pior(estado, "atencao");
    lista.push({
      id: "nfse", nome: "NFS-e", quem: "Portal Nacional · Ambiente de Dados Nacional", grupo: "governo", pagina: "/notas",
      oQueFaz: "Notas de serviço emitidas e tomadas por cada CNPJ do grupo.",
      estado, frase: `última leitura ${quando(n.ultima_ok, agora)}`, erro,
      numeros: [
        { rotulo: "Notas em 7 dias", valor: String(n.notas_7d) },
        { rotulo: "CNPJs lidos", valor: `${n.empresas}${n.bloqueadas ? ` · ${n.bloqueadas} esperando 1 h` : ""}` },
        { rotulo: "Leituras em 24 h", valor: `${n.ok_24h} ok · ${n.falha_24h} falha` },
      ],
    });
  }

  // Certificados digitais (e-CNPJ A1): sem eles, eSocial, Receita e notas param
  {
    const cs = p.certificados;
    const linhas = cs.map((c) => {
      const d = diasAte(c.validade, agora);
      const estado: Estado = d < 0 ? "erro" : d <= 30 ? "atencao" : "ok";
      const texto = d < 0 ? `venceu em ${dataCurta(c.validade)}` : d <= 30 ? `vence em ${d} dia${d === 1 ? "" : "s"} (${dataCurta(c.validade)})` : `válido até ${dataCurta(c.validade)}`;
      return { nome: `${nomeEmpresa(c.nome)} · ${c.matriz ? "matriz" : `filial ${c.cnpj.slice(8, 12)}`}`, estado, texto };
    });
    const estado = linhas.length ? pior(...linhas.map((l) => l.estado)) : "erro";
    const primeiro = linhas.find((l) => l.estado !== "ok");
    lista.push({
      id: "certificados", nome: "Certificados digitais", quem: "e-CNPJ A1 de cada empresa", grupo: "governo", pagina: "/certificados",
      oQueFaz: "A chave que abre eSocial, Receita, NF-e e NFS-e. Vencido, a leitura daquela empresa para.",
      estado, frase: primeiro ? `${primeiro.nome}: ${primeiro.texto}` : `${linhas.length} certificados em dia`,
      numeros: [], linhas,
    });
  }

  // TOTVS Chef Web (caixa dos restaurantes): ontem chega entre 4h30 e o meio-dia
  {
    const t = f.totvs;
    const linhas = t.unidades.map((u) => {
      const veio = u.ontem && u.ontem !== "falha";
      const estado: Estado = veio ? (u.ontem === "revisar" ? "atencao" : "ok") : h >= 13 ? "erro" : "atencao";
      const texto = veio
        ? u.ontem === "sem_movimento" ? "ontem sem movimento" : u.ontem === "revisar" ? "ontem chegou, com diferença a revisar" : "ontem já chegou"
        : h >= 13 ? `ontem não chegou · último dia ${u.ultimo_dia ? dataCurta(u.ultimo_dia + "T15:00:00Z") : "nenhum"}` : "ontem ainda não chegou (tenta até o meio-dia)";
      return { nome: u.nome, estado, texto };
    });
    let estado = pior(frescor(t.ultima_ok, agora, 30 * 60, 54 * 60), ...linhas.map((l) => l.estado));
    const erro = erroAberto(t, agora);
    if (erro) estado = pior(estado, "atencao");
    lista.push({
      id: "totvs", nome: "TOTVS Chef Web", quem: "Caixa dos restaurantes", grupo: "casas", pagina: "/vendas",
      oQueFaz: "Vendas, pagamentos, sangrias e fechamentos de cada dia, por unidade.",
      estado, frase: `última leitura ${quando(t.ultima_ok, agora)}`, erro, linhas,
      numeros: [{ rotulo: "Leituras em 24 h", valor: `${t.ok_24h} ok · ${t.falha_24h} falha` }],
    });
  }

  // Cicchetti Management (API externa): lista de notas a cada 6 h, itens até 25 notas por minuto
  {
    const c = f.cicchetti;
    let estado = frescor(c.ultima_ok, agora, 13 * 60, 48 * 60);
    let frase = `última consulta ${quando(c.ultima_ok, agora)}`;
    const itensParados = c.notas_sem_itens > 20 && minutos(c.ultima_coleta_itens, agora) > 3 * 24 * 60;
    if (itensParados) { estado = pior(estado, "atencao"); frase = `itens das notas parados desde ${c.ultima_coleta_itens ? dataCurta(c.ultima_coleta_itens) : "o começo"}`; }
    const erro = c.falha_24h && c.ultimo_erro ? { texto: c.ultimo_erro, quando: quando(c.ultima_falha, agora) } : null;
    if (erro) estado = pior(estado, "atencao");
    lista.push({
      id: "cicchetti", nome: "Cicchetti Management", quem: "API externa (só leitura)", grupo: "casas", pagina: "/notas",
      oQueFaz: "Notas de compra com os itens (índice de preços), vendas e colaboradores das unidades.",
      estado, frase, erro,
      numeros: [
        { rotulo: "Consultas em 24 h", valor: `${c.ok_24h} ok · ${c.falha_24h} falha` },
        { rotulo: "Notas esperando os itens", valor: String(c.notas_sem_itens) },
        { rotulo: "Últimos itens lidos", valor: quando(c.ultima_coleta_itens, agora) },
      ],
    });
  }

  // PMS dos hotéis (robô com navegador na VPS): uma rodada a cada ~30 min
  {
    const m = f.pms;
    const iv = m.intervalo_min ?? 30;
    const linhas = m.hoteis.map((x) => ({ nome: x.nome.replace(/\s*\(.*\)\s*/, "").replace(/ - .*$/, ""), estado: frescor(x.ultima_leitura, agora, iv * 2.5, 180), texto: `lido ${quando(x.ultima_leitura, agora)}` }));
    let estado = pior(frescor(m.ultima_ok, agora, iv * 2.5, 180), ...linhas.map((l) => l.estado));
    const erro = erroAberto(m, agora);
    if (erro) estado = pior(estado, "atencao");
    lista.push({
      id: "pms", nome: "PMS dos hotéis", quem: "TOTVS Hospitalidade · robô na VPS", grupo: "casas", pagina: "/hoteis/filha-da-lua",
      oQueFaz: "Ocupação, reservas, mapa, hóspedes, transações e relatórios do Filha da Lua e do Sempre Vivo.",
      estado, frase: `última rodada ${quando(m.ultima_ok, agora)} · a cada ~${iv} min`, erro, linhas,
      numeros: [{ rotulo: "Rodadas em 24 h", valor: `${m.ok_24h} ok · ${m.falha_24h} falha` }],
    });
  }

  // RHiD (ponto): a leitura "agora" roda a cada minuto das 6h à meia-noite
  {
    const r = f.rhid;
    let estado: Estado; let frase: string;
    const m = minutos(r.ultima_agora, agora);
    if (h < 6) { estado = m < 8 * 60 ? "pausa" : "atencao"; frase = `parado à noite, volta às 6h · último ${quando(r.ultima_agora, agora)}`; }
    else { estado = m <= 10 ? "ok" : m <= 60 ? "atencao" : "erro"; frase = `batidas lidas ${quando(r.ultima_agora, agora)}`; }
    if (r.presos > 0 && estado !== "erro") { estado = pior(estado === "pausa" ? "ok" : estado, "atencao"); frase += ` · ${r.presos} leitura${r.presos === 1 ? "" : "s"} presa${r.presos === 1 ? "" : "s"}`; }
    const erro = erroAberto(r, agora);
    lista.push({
      id: "rhid", nome: "RHiD", quem: "Control iD · relógios de ponto", grupo: "casas", pagina: "/escala",
      oQueFaz: "Batidas de ponto, escala, justificativas e banco de horas da equipe.",
      estado, frase, erro,
      numeros: [
        { rotulo: "Leituras em 24 h", valor: `${r.ok_24h} ok · ${r.falha_24h} falha` },
        { rotulo: "Apuração do ponto", valor: quando(r.ultima_apuracao, agora) },
        { rotulo: "Cadastros", valor: quando(r.ultimo_cadastro, agora) },
      ],
    });
  }

  // WhatsApp (Evolution API na VPS): mensagens dos grupos chegam pelo webhook
  {
    const w = f.whatsapp;
    const dia = h >= 8 && h <= 23;
    let estado = dia ? frescor(w.ultima_mensagem, agora, 3 * 60, 12 * 60) : frescor(w.ultima_mensagem, agora, 12 * 60, 24 * 60);
    if (w.envios_falha_24h) estado = pior(estado, "atencao");
    lista.push({
      id: "whatsapp", nome: "WhatsApp", quem: "Evolution API · VPS da Hostinger", grupo: "comunicacao", pagina: "/whatsapp",
      oQueFaz: "Recebe as mensagens e mídias dos grupos da companhia (o pedido de compras sai daqui).",
      estado, frase: `última mensagem ${quando(w.ultima_mensagem, agora)}`,
      numeros: [
        { rotulo: "Mensagens em 24 h", valor: String(w.mensagens_24h) },
        { rotulo: "Grupos com conversa", valor: String(w.grupos_24h) },
        { rotulo: "Envios pelo site", valor: w.envios_24h ? `${w.envios_24h}${w.envios_falha_24h ? ` · ${w.envios_falha_24h} falha` : ""}` : "nenhum" },
      ],
    });
  }

  // Gemini (leitura do grupo COMPRAS): só roda quando alguém pede no grupo
  {
    const g = f.gemini;
    const erro = erroAberto(g, agora);
    const parado = minutos(g.ultima, agora) > 8 * 24 * 60;
    const estado: Estado = erro ? "atencao" : parado ? "pausa" : "ok";
    lista.push({
      id: "gemini", nome: "Gemini", quem: "Google AI Studio · plano grátis", grupo: "comunicacao", pagina: "/compras",
      oQueFaz: "Lê os pedidos do grupo COMPRAS e monta a lista sugerida de cada pessoa, com o revisor.",
      estado, frase: g.rodando ? `${g.rodando} análise${g.rodando === 1 ? "" : "s"} em andamento` : `última análise ${quando(g.ultima_ok, agora)}`, erro,
      numeros: [{ rotulo: "Análises em 24 h", valor: `${g.ok_24h} ok · ${g.falha_24h} falha` }],
    });
  }

  // Claude (resumo diário do WhatsApp, 7h)
  {
    const c = f.claude;
    const estado: Estado = c.resumo_ontem ? "ok" : minutos(c.ultimo_resumo, agora) > 48 * 60 ? "erro" : h >= 8 ? "atencao" : "ok";
    lista.push({
      id: "claude", nome: "Claude · resumo do dia", quem: "API da Anthropic", grupo: "comunicacao", pagina: "/whatsapp",
      oQueFaz: "Todo dia às 7h resume as conversas de ontem de todos os grupos, em 5 idiomas.",
      estado, frase: c.resumo_ontem ? `resumo de ontem pronto · ${quando(c.ultimo_resumo, agora)}` : h >= 8 ? "resumo de ontem não saiu" : "resumo de ontem sai às 7h",
      numeros: [],
    });
  }

  // Conector do Claude (MCP): como o Claude de cada sócio lê e edita o Brasico
  {
    const c = f.conector;
    lista.push({
      id: "conector", nome: "Conector Brasico", quem: "MCP · Claude dos sócios", grupo: "comunicacao", pagina: "/conectar",
      oQueFaz: "Por onde o Claude de cada sócio cria e edita projetos e consulta os dados.",
      estado: c.links ? "ok" : "pausa", frase: `último uso ${quando(c.ultimo_uso, agora)}`,
      numeros: [{ rotulo: "Links ativos", valor: String(c.links) }],
    });
  }

  return lista;
}

const nomeEmpresa = (s: string) =>
  s.replace(/\b(LTDA|EMPREENDIMENTOS TURISTICOS|HOTELARIAS|ASSOCIACAO)\b/gi, "").replace(/\s+/g, " ").trim()
    .toLowerCase().replace(/(^|\s)\S/g, (x) => x.toUpperCase()) || s;

// ---------- agendas (pg_cron, horário em UTC) ----------
const FONTE_DA_AGENDA: [RegExp, string][] = [
  [/^rhid/, "RHiD"], [/^esocial/, "eSocial"], [/^receita|^fiscal/, "Receita Federal"], [/^notas/, "SEFAZ · NF-e"], [/^nfse/, "NFS-e"],
  [/^totvs/, "TOTVS Chef Web"], [/^precos/, "Cicchetti Management"], [/^pms/, "PMS dos hotéis"], [/^whatsapp/, "WhatsApp"],
  [/^compras/, "Compras"],
];
export const fonteDaAgenda = (nome: string) => FONTE_DA_AGENDA.find(([r]) => r.test(nome))?.[1] ?? "Outras";

// Traduz o cron (UTC) para português no horário de Fortaleza. Se não souber, devolve o original.
export function horarioLegivel(cron: string): string {
  const s = cron.trim();
  const seg = s.match(/^(\d+) seconds?$/);
  if (seg) return `a cada ${seg[1]} s`;
  const p = s.split(/\s+/);
  if (p.length !== 5) return s;
  const [mi, ho, dm, , dw] = p;
  const horas = (campo: string): number[] | null => {
    if (campo === "*") return null;
    const out: number[] = [];
    for (const parte of campo.split(",")) {
      const r = parte.match(/^(\d+)-(\d+)$/);
      if (r) for (let i = +r[1]; i <= +r[2]; i++) out.push(i);
      else if (/^\d+$/.test(parte)) out.push(+parte);
      else return null;
    }
    return out.map((x) => (x + 21) % 24);
  };
  const hs = horas(ho);
  if (ho !== "*" && !hs) return s;
  const faixa = (l: number[]) => {
    const o = [...l].sort((a, b) => a - b);
    if (o.length > 2 && o.every((x, i) => i === 0 || x === o[i - 1] + 1)) return `das ${o[0]}h às ${o.at(-1)}h59`;
    return o.map((x) => `${x}h`).join(", ");
  };
  const dia = dm !== "*" ? ` no dia ${dm}` : dw !== "*" ? " em dias da semana marcados" : "";
  if (mi === "*") return `a cada minuto${hs ? ` ${faixa(hs)}` : ""}${dia}`;
  const cada = mi.match(/^\*\/(\d+)$/);
  if (cada) return `a cada ${cada[1]} min${hs ? ` ${faixa(hs)}` : ""}${dia}`;
  if (/^[\d,]+$/.test(mi)) {
    const ms = mi.split(",").map(Number);
    if (!hs) return ms.length === 1 ? `de hora em hora (min ${ms[0]})${dia}` : `${ms.length}× por hora${dia}`;
    const lista = hs.sort((a, b) => a - b).flatMap((x) => ms.map((m) => `${x}h${String(m).padStart(2, "0")}`));
    return `${dm !== "*" ? "todo mês" : "todo dia"} às ${lista.join(", ")}${dia}`;
  }
  return s;
}

export function estadoAgenda(a: Painel["agendas"][number]): Estado {
  if (!a.ativa) return "pausa";
  if (a.ultima_status === "failed") return "erro";
  if (a.falhas_24h > 0) return "atencao";
  return "ok";
}

// Nome amigável da fonte de cada evento da linha do tempo
export const NOME_FONTE: Record<string, string> = {
  rhid: "RHiD", esocial: "eSocial", receita: "Receita", notas: "NF-e", nfse: "NFS-e", totvs: "TOTVS",
  pms: "PMS", gemini: "Gemini", cicchetti: "Cicchetti",
};
export function estadoEvento(status: string): Estado {
  if (status === "falha") return "erro";
  if (["rodando", "na_fila", "pendente", "no_lote"].includes(status)) return "pausa";
  if (status === "parcial") return "atencao";
  return "ok";
}
export const STATUS_TEXTO: Record<string, string> = {
  ok: "ok", sem_dados: "sem novidade", sem_movimento: "sem movimento", parcial: "parcial", pulada: "pulada", sem_pedido: "sem pedido",
  falha: "falha", rodando: "rodando", na_fila: "na fila", pendente: "na fila", no_lote: "no lote",
};
