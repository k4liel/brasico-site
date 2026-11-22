// Painel de integrações (/integracoes): regras que transformam o que o banco devolve (integracoes_painel,
// supabase/integracoes.sql) na situação de cada conexão — verde (funcionando), amarelo (pede atenção),
// vermelho (parada) ou cinza (pausada de propósito). Sem dependência do React: testado em tests/integracoes.test.ts.

export type Estado = "ok" | "atencao" | "erro" | "pausa";

export type Exec = {
  ultima: string | null; ultima_ok: string | null; ultima_falha: string | null;
  ok_24h: number; falha_24h: number; rodando: number; presos: number;
  ultimo_erro: string | null; ultimo_erro_em: string | null;
  horas?: Hora[];
};
// Atividade de uma hora: [leituras boas, falhas]; a lista vai da hora mais antiga (24 h atrás) para a mais nova
export type Hora = [number, number];
export type Painel = {
  agora: string;
  fontes: {
    rhid: Exec & { ultima_agora: string | null; ultima_apuracao: string | null; ultimo_cadastro: string | null; clientes: number };
    esocial: Exec & { empresas: { nome: string; ligada: boolean; limite: number; acessos_hoje: number | null; a_baixar: number }[] };
    receita: Exec & { ultimo_evento: string | null; empresas_producao: number; gasto_ciclo: number; orcamento_ciclo: number; cobradas_hoje: number; chamadas_erro_24h: number };
    notas: Exec & { empresas: number; bloqueadas: number; notas_7d: number; ultima_nota: string | null };
    nfse: Exec & { empresas: number; bloqueadas: number; notas_7d: number };
    cte?: Exec & { empresas: number; bloqueadas: number; ctes_7d: number };
    totvs: Exec & { unidades: { nome: string; ultimo_dia: string | null; ontem: string | null }[]; nfce_7d?: number; nfce_pendentes_7d?: number };
    cicchetti: { ultima: string | null; ultima_ok: string | null; ultima_falha: string | null; ok_24h: number; falha_24h: number; ultimo_erro: string | null; horas?: Hora[] };
    pms: Exec & { intervalo_min: number | null; hoteis: { nome: string; ultima_leitura: string | null }[] };
    whatsapp: { ultima_mensagem: string | null; mensagens_24h: number; grupos_24h: number; envios_24h: number; envios_falha_24h: number; horas?: Hora[] };
    gemini: Exec;
    claude: { ultimo_resumo: string | null; resumo_ontem: boolean };
    conector: { links: number; ultimo_uso: string | null };
    servidores?: { contratos: Contrato[]; evolution: EvolutionEstado | null };
  };
  certificados: { nome: string; cnpj: string; matriz: boolean; validade: string }[];
  agendas: { nome: string; horario: string; ativa: boolean; ultima: string | null; ultima_status: string | null; ultima_msg: string | null; rodadas_24h: number; falhas_24h: number }[];
  eventos: { fonte: string; status: string; quando: string; detalhe: string | null; erro: string | null }[];
};

// Servidores e contas pagas (supabase/integracoes_servidores.sql)
export type Contrato = {
  id: string; fornecedor: string; servico: string; valor: number; moeda: "BRL" | "USD"; periodo: "mês" | "ano";
  proxima_cobranca: string | null; renova_sozinho: boolean; observacao: string | null; conferido_em: string;
};
// Estado da Evolution (WhatsApp) lido a cada 5 min (wa_evolution_ler)
export type EvolutionEstado = {
  respondeu: boolean | null; vps_no_ar: boolean | null; http_status: number | null; evolution_ok_em: string | null;
  conexao: string | null; motivo_queda: string | null; caiu_em: string | null;
  proxy_ligado: boolean | null; proxy_local: string | null; lido_em: string | null; erro: string | null;
};

export type Grupo = "governo" | "casas" | "comunicacao" | "servidores";
export type Integracao = {
  id: string; nome: string; quem: string; grupo: Grupo; oQueFaz: string; pagina?: string;
  estado: Estado; frase: string;
  numeros: { rotulo: string; valor: string }[];
  linhas?: { nome: string; estado: Estado; texto: string }[];
  erro?: { texto: string; quando: string } | null;
  horas?: Hora[]; // atividade das últimas 24 h (para as barras do cartão)
  horasRotulo?: string; // o que as barras contam ("leituras", "mensagens", "consultas")
};

export const GRUPOS: { id: Grupo; titulo: string; explica: string }[] = [
  { id: "governo", titulo: "Governo", explica: "Receita, eSocial, notas fiscais e os certificados que abrem essas portas." },
  { id: "casas", titulo: "Sistemas das casas", explica: "Caixa dos restaurantes, gestão do Cicchetti, PMS dos hotéis e relógios de ponto." },
  { id: "comunicacao", titulo: "Comunicação e inteligência", explica: "WhatsApp, as IAs que leem as compras e resumem o dia, e o conector do Claude." },
  { id: "servidores", titulo: "Servidores e contas pagas", explica: "Onde rodam o WhatsApp e o robô dos hotéis, o proxy do WhatsApp e quanto custa cada um." },
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

// Situação da Evolution. A rotina de pausas desliga a Evolution de propósito (o servidor responde, ela não):
// pausa = servidor no ar e Evolution calada há menos de 75 min, ou de madrugada (0h às 7h de Fortaleza).
export function situacaoEvolution(ev: EvolutionEstado | null, agora: string): "conectado" | "desconectado" | "pausa" | "sem_resposta" | "sem_dados" {
  if (!ev?.lido_em) return "sem_dados";
  if (ev.respondeu) return ev.conexao === "open" ? "conectado" : "desconectado";
  if (!ev.vps_no_ar) return "sem_resposta";
  return horaFortaleza(agora) < 7 || minutos(ev.evolution_ok_em, agora) <= 75 ? "pausa" : "sem_resposta";
}
export const valorContrato = (c: Contrato) =>
  `${Number(c.valor).toLocaleString("pt-BR", { style: "currency", currency: c.moeda })} por ${c.periodo}`;
// "Custo fixo: R$ 136,00 por mês + R$ 64,99 por ano" (soma por moeda e período)
export function totalContratos(lista: Contrato[]) {
  const soma = new Map<string, number>();
  for (const c of lista) soma.set(`${c.moeda}|${c.periodo}`, (soma.get(`${c.moeda}|${c.periodo}`) ?? 0) + Number(c.valor));
  const ordem = ["BRL|mês", "USD|mês", "BRL|ano", "USD|ano"];
  const partes = ordem.filter((k) => soma.has(k)).map((k) => {
    const [moeda, periodo] = k.split("|");
    return `${soma.get(k)!.toLocaleString("pt-BR", { style: "currency", currency: moeda })} por ${periodo}`;
  });
  return partes.length ? `Custo fixo: ${partes.join(" + ")}` : "";
}
export function proximaCobranca(c: Contrato, agora: string) {
  if (!c.proxima_cobranca) return c.renova_sozinho ? "renova sozinho" : "—";
  const [a, m, d] = c.proxima_cobranca.slice(0, 10).split("-");
  const hoje = fort(agora);
  const dias = Math.round((Date.UTC(+a, +m - 1, +d) - Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate())) / 86400000);
  const falta = dias === 0 ? "hoje" : dias === 1 ? "amanhã" : dias > 1 && dias <= 31 ? `em ${dias} dias` : "";
  return `${d}/${m}/${a}${falta ? ` (${falta})` : ""}${c.renova_sozinho ? "" : " · não renova"}`;
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

  // CT-e (fretes, Ambiente Nacional do CT-e): de hora em hora; sem CT-e novo a SEFAZ manda esperar 1 h (normal)
  if (f.cte) {
    const n = f.cte;
    let estado = frescor(n.ultima_ok, agora, 3 * 60, 8 * 60);
    const erro = erroAberto(n, agora);
    if (erro) estado = pior(estado, "atencao");
    lista.push({
      id: "cte", nome: "SEFAZ · CT-e", quem: "Ambiente Nacional do CT-e · distribuição", grupo: "governo", pagina: "/notas",
      oQueFaz: "Traz os conhecimentos de transporte (fretes) em que cada CNPJ do grupo aparece, ligados às NF-e transportadas.",
      estado, frase: `última leitura ${quando(n.ultima_ok, agora)}`, erro,
      numeros: [
        { rotulo: "CT-e em 7 dias", valor: String(n.ctes_7d) },
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
      oQueFaz: "Vendas, pagamentos, sangrias e fechamentos de cada dia, por unidade, e a NFC-e de cada venda.",
      estado, frase: `última leitura ${quando(t.ultima_ok, agora)}`, erro, linhas,
      numeros: [
        { rotulo: "Leituras em 24 h", valor: `${t.ok_24h} ok · ${t.falha_24h} falha` },
        ...(t.nfce_7d != null ? [{ rotulo: "NFC-e em 7 dias", valor: `${t.nfce_7d}${t.nfce_pendentes_7d ? ` · ${t.nfce_pendentes_7d} pendentes na SEFAZ` : ""}` }] : []),
      ],
    });
  }

  // Cicchetti Management (API externa): só quando o Claude consulta pelo conector. As notas de compra não vêm
  // mais daqui (vêm da SEFAZ; a agenda precos-coleta foi desligada em 13/11/2026), então não há frescor a cobrar.
  {
    const c = f.cicchetti;
    const ultimaFalhou = !!c.ultima_falha && (!c.ultima_ok || new Date(c.ultima_falha) > new Date(c.ultima_ok));
    const erro = ultimaFalhou && c.ultimo_erro ? { texto: c.ultimo_erro, quando: quando(c.ultima_falha, agora) } : null;
    lista.push({
      id: "cicchetti", nome: "Cicchetti Management", quem: "API externa (só leitura)", grupo: "casas", pagina: "/conectar",
      oQueFaz: "Vendas, CMV e colaboradores das unidades, consultados pelo Claude quando alguém pede.",
      estado: erro ? "atencao" : "ok", frase: `consulta quando o Claude pede · última ${quando(c.ultima, agora)}`, erro,
      numeros: [{ rotulo: "Consultas em 24 h", valor: `${c.ok_24h} ok · ${c.falha_24h} falha` }],
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

  // RHiD (ponto): a leitura "agora" roda a cada minuto, 24 h (desde 14/11/2026; antes parava da meia-noite às 6h)
  {
    const r = f.rhid;
    let estado: Estado; let frase: string;
    const m = minutos(r.ultima_agora, agora);
    estado = m <= 10 ? "ok" : m <= 60 ? "atencao" : "erro"; frase = `batidas lidas ${quando(r.ultima_agora, agora)}`;
    if (r.presos > 0 && estado !== "erro") { estado = pior(estado, "atencao"); frase += ` · ${r.presos} leitura${r.presos === 1 ? "" : "s"} presa${r.presos === 1 ? "" : "s"}`; }
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
    const ev = f.servidores?.evolution ?? null;
    const dia = h >= 8 && h <= 23;
    let estado = dia ? frescor(w.ultima_mensagem, agora, 3 * 60, 12 * 60) : frescor(w.ultima_mensagem, agora, 12 * 60, 24 * 60);
    if (w.envios_falha_24h) estado = pior(estado, "atencao");
    let frase = `última mensagem ${quando(w.ultima_mensagem, agora)}`;
    const conexao = situacaoEvolution(ev, agora);
    if (conexao === "desconectado") {
      estado = "erro";
      frase = `número desconectado do WhatsApp${ev?.caiu_em ? ` ${quando(ev.caiu_em, agora)}` : ""}${ev?.motivo_queda ? ` (código ${ev.motivo_queda})` : ""}`;
    } else if (conexao === "pausa") frase = `em pausa (rotina de usuário comum) · ${frase}`;
    lista.push({
      id: "whatsapp", nome: "WhatsApp", quem: "Evolution API · VPS da Hostinger", grupo: "comunicacao", pagina: "/whatsapp",
      oQueFaz: "Recebe as mensagens e mídias dos grupos da companhia (o pedido de compras sai daqui).",
      estado, frase,
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

  // Hostinger (VPS e domínio) e IPRoyal (proxy do WhatsApp): se está no ar e quanto custa
  if (f.servidores) {
    const { contratos, evolution: ev } = f.servidores;
    const c = (id: string) => contratos.find((x) => x.id === id);
    const conexao = situacaoEvolution(ev, agora);
    const lidoHa = minutos(ev?.lido_em ?? null, agora);

    const vps = c("hostinger_vps"), dominio = c("hostinger_dominio");
    if (vps) {
      const pmsMin = minutos(f.pms.ultima_ok, agora);
      let estado: Estado; let frase: string;
      if (lidoHa > 20) { estado = "atencao"; frase = `servidor sem conferir desde ${quando(ev?.lido_em ?? null, agora)}`; }
      else if (ev?.vps_no_ar === false) { estado = "erro"; frase = "o servidor não respondeu"; }
      else { estado = "ok"; frase = `servidor no ar · conferido ${quando(ev?.lido_em ?? null, agora)}`; }
      const evoEstado: Estado = conexao === "conectado" ? "ok" : conexao === "pausa" ? "pausa" : conexao === "desconectado" ? "erro" : "atencao";
      const evoTexto = conexao === "conectado" ? "conectada" : conexao === "pausa" ? "em pausa pela rotina" : conexao === "desconectado" ? "número desconectado" : "sem resposta";
      lista.push({
        id: "hostinger", nome: "Hostinger", quem: "VPS KVM 2 · domínio brasico.com.br", grupo: "servidores",
        oQueFaz: "Servidor alugado onde rodam a Evolution (o WhatsApp da Brasico), o robô do PMS dos hotéis e a rotina de pausas do WhatsApp. Também guarda o domínio brasico.com.br.",
        estado, frase,
        linhas: [
          { nome: "Evolution (WhatsApp)", estado: evoEstado, texto: evoTexto },
          { nome: "Robô do PMS dos hotéis", estado: pmsMin <= 90 ? "ok" : pmsMin <= 240 ? "atencao" : "erro", texto: `última rodada ${quando(f.pms.ultima_ok, agora)}` },
          { nome: "Rotina de pausas", estado: "ok", texto: "desliga o WhatsApp de madrugada e em 2 ou 3 pausas curtas por dia" },
        ],
        numeros: [
          { rotulo: "Servidor (VPS)", valor: valorContrato(vps) },
          { rotulo: "Próxima cobrança", valor: proximaCobranca(vps, agora) },
          ...(dominio ? [{ rotulo: "Domínio", valor: `${valorContrato(dominio)} · ${proximaCobranca(dominio, agora)}` }] : []),
        ],
      });
    }

    const proxy = c("iproyal_proxy");
    if (proxy) {
      let estado: Estado; let frase: string;
      if (lidoHa > 20) { estado = "atencao"; frase = `sem conferir desde ${quando(ev?.lido_em ?? null, agora)}`; }
      else if (ev?.proxy_ligado === false) { estado = "atencao"; frase = "proxy desligado: o WhatsApp sai pelo IP do servidor"; }
      else if (conexao === "desconectado") { estado = "erro"; frase = "WhatsApp desconectado (veja se o proxy venceu)"; }
      else if (conexao === "pausa") { estado = "pausa"; frase = "WhatsApp em pausa pela rotina · volta sozinho"; }
      else if (conexao !== "conectado") { estado = "atencao"; frase = `a Evolution não responde desde ${quando(ev?.evolution_ok_em ?? null, agora)}`; }
      else { estado = "ok"; frase = `WhatsApp conectado pelo proxy${ev?.proxy_local ? ` · ${ev.proxy_local}` : ""}`; }
      lista.push({
        id: "iproyal", nome: "IPRoyal", quem: "Proxy residencial · 1 IP fixo no Brasil", grupo: "servidores",
        oQueFaz: "O WhatsApp da Brasico conecta por um IP de internet de casa, no Brasil, e não pelo IP do servidor — assim não parece robô (proteção depois do bloqueio de 16/11/2026).",
        estado, frase,
        numeros: [
          { rotulo: "Custo", valor: valorContrato(proxy) },
          { rotulo: "Próxima cobrança", valor: proximaCobranca(proxy, agora) },
          { rotulo: "De onde o WhatsApp conecta", valor: ev?.proxy_local ?? "—" },
        ],
      });
    }
  }

  // Atividade por hora de cada fonte (o painel desenha uma barra de 24 h em cada cartão)
  const horas: Record<string, [Hora[] | undefined, string]> = {
    rhid: [f.rhid.horas, "leituras"], esocial: [f.esocial.horas, "leituras"], receita: [f.receita.horas, "leituras"],
    notas: [f.notas.horas, "leituras"], nfse: [f.nfse.horas, "leituras"], cte: [f.cte?.horas, "leituras"], totvs: [f.totvs.horas, "leituras"],
    cicchetti: [f.cicchetti.horas, "consultas"], pms: [f.pms.horas, "rodadas"], whatsapp: [f.whatsapp.horas, "mensagens"],
    gemini: [f.gemini.horas, "análises"],
  };
  for (const i of lista) if (horas[i.id]?.[0]?.length) { i.horas = horas[i.id][0]; i.horasRotulo = horas[i.id][1]; }
  return lista;
}

// Soma das leituras de todas as fontes, hora a hora (o gráfico de atividade do topo). WhatsApp fica de fora:
// mensagem recebida não é leitura.
export function atividadeGeral(lista: Integracao[]): Hora[] {
  const total: Hora[] = Array.from({ length: 24 }, () => [0, 0]);
  for (const i of lista) {
    if (!i.horas || i.id === "whatsapp") continue;
    i.horas.forEach(([ok, f], k) => { if (total[k]) { total[k][0] += ok; total[k][1] += f; } });
  }
  return total;
}

// Situação de uma hora na barra de 24 h: falha sem nenhuma leitura boa = vermelho; com as duas = amarelo; nada = vazio
export function estadoHora([ok, f]: Hora): Estado | "vazio" {
  if (f && !ok) return "erro";
  if (f) return "atencao";
  return ok ? "ok" : "vazio";
}

// Hora (de Fortaleza) da posição k da lista de 24, contando a partir de agora
export function horaDaPosicao(k: number, agora: string) {
  return (horaFortaleza(agora) - (23 - k) + 48) % 24;
}

const nomeEmpresa = (s: string) =>
  s.replace(/\b(LTDA|EMPREENDIMENTOS TURISTICOS|HOTELARIAS|ASSOCIACAO)\b/gi, "").replace(/\s+/g, " ").trim()
    .toLowerCase().replace(/(^|\s)\S/g, (x) => x.toUpperCase()) || s;

// ---------- agendas (pg_cron, horário em UTC) ----------
const FONTE_DA_AGENDA: [RegExp, string][] = [
  [/^rhid/, "RHiD"], [/^esocial/, "eSocial"], [/^receita|^fiscal/, "Receita Federal"], [/^notas/, "SEFAZ · NF-e"], [/^nfse/, "NFS-e"], [/^cte/, "SEFAZ · CT-e"], [/^nfce/, "TOTVS Chef Web"],
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
  rhid: "RHiD", esocial: "eSocial", receita: "Receita", notas: "NF-e", nfse: "NFS-e", cte: "CT-e", totvs: "TOTVS",
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
