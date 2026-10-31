// Lê o texto do relatório de situação fiscal da Receita (SITFIS, extraído do PDF em lib/receita/pdf.ts)
// e devolve o que importa na tela: certidão, seções do diagnóstico (Receita e PGFN) e a tabela de débitos.
// O PDF vem com uma palavra ou valor por linha; cada seção termina o título com "_____"; o cabeçalho se repete por página.
// "Pendência" = algo em aberto; "Exigibilidade Suspensa" = débito em parcelamento ou discussão (não impede a certidão).

export type Debito = { receita: string; periodo: string; vencimento: string; original: number; saldo: number; multa: number; juros: number; total: number; situacao: string };
export type Secao = { titulo: string; orgao: "Receita" | "PGFN"; suspensa: boolean; texto: string; debitos: Debito[] };
export type Sitfis = {
  emitido: string | null;
  certidao: { tipo: string; validade: string | null; vencida: boolean } | null;
  secoes: Secao[];
  debitos: Debito[];         // só os das seções de pendência
  totalDebitos: number;
  pgfnLimpo: boolean;
};

const valor = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));
const ehValor = (s: string) => /^-?[\d.]+,\d{2}$/.test(s);
const ehPA = (s: string) => /^\d{2}\/\d{4}$/.test(s) || /^\d{4}$/.test(s);
const ehData = (s: string) => /^\d{2}\/\d{2}\/\d{4}$/.test(s);
const iso = (d: string) => `${d.slice(6, 10)}-${d.slice(3, 5)}-${d.slice(0, 2)}`;
// Palavras que vêm em linhas soltas antes do título com "____"
const PREFIXOS = new Set(["Pendência", "-", "–", "com", "Parcelamento", "Inscrição", "Débito", "Processo"]);
const IGNORAR = /^(Dados Cadastrais|da Matriz|Administradores|Emitida|Certidão)/i;

function semCabecalhos(linhas: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < linhas.length; i++) {
    if (/^Página:/.test(linhas[i])) {
      let j = i + 1;
      while (j < linhas.length && !(linhas[j] === "CNPJ:" && /^\d{2}\.\d{3}\.\d{3} - /.test(linhas[j + 1] ?? ""))) j++;
      i = j < linhas.length ? j + 1 : j;
      continue;
    }
    out.push(linhas[i]);
  }
  return out;
}

export function lerSitfis(texto: string): Sitfis {
  const linhas = semCabecalhos(texto.split("\n").map((l) => l.trim()).filter(Boolean));
  const junto = linhas.join(" ");
  const r: Sitfis = { emitido: null, certidao: null, secoes: [], debitos: [], totalDebitos: 0, pgfnLimpo: false };

  const em = texto.match(/(\d{2}\/\d{2}\/\d{4}) \d{2}:\d{2}:\d{2}/);
  if (em) r.emitido = iso(em[1]);
  const cert = junto.match(/Certidão (Negativa|Positiva com Efeitos de Negativa|Positiva)\s*:?.*?Data de Validade:\s*(\d{2}\/\d{2}\/\d{4})/i);
  if (cert) {
    const validade = iso(cert[2]);
    r.certidao = { tipo: cert[1].replace(/\s+/g, " "), validade, vencida: validade < new Date().toISOString().slice(0, 10) };
  }

  // Seções: cada linha que termina com "_____" é um título (com as palavras soltas que vêm antes dela)
  let orgao: "Receita" | "PGFN" = "Receita";
  const titulos: { i: number; titulo: string; orgao: "Receita" | "PGFN" }[] = [];
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    if (/Diagnóstico Fiscal na Procuradoria/i.test(l)) { orgao = "PGFN"; continue; }
    if (/Diagnóstico Fiscal na Receita/i.test(l)) { orgao = "Receita"; continue; }
    const m = l.match(/^(.*?)\s*_{5,}\s*$/);
    if (!m || !m[1] || IGNORAR.test(m[1])) continue;
    const partes = [m[1]];
    for (let k = i - 1; k >= 0 && PREFIXOS.has(linhas[k]) && partes.length < 6; k--) partes.unshift(linhas[k]);
    titulos.push({ i, titulo: partes.join(" ").replace(/\s+[-–]\s+/g, " – ").replace(/\s+/g, " "), orgao });
  }
  titulos.forEach((t, k) => {
    const fim = k + 1 < titulos.length ? titulos[k + 1].i - (contaPrefixos(linhas, titulos[k + 1].i)) : linhas.length;
    const corpo = linhas.slice(t.i + 1, fim).filter((l) => !/^_{5,}|Final do Relatório|^Página:/.test(l));
    const suspensa = /Suspensa/i.test(t.titulo);
    const s: Secao = { titulo: t.titulo, orgao: t.orgao, suspensa, texto: limpar(corpo), debitos: [] };
    if (/Débito/i.test(t.titulo)) s.debitos = lerDebitos(corpo);
    r.secoes.push(s);
  });
  r.debitos = r.secoes.filter((s) => !s.suspensa).flatMap((s) => s.debitos);
  r.totalDebitos = r.debitos.reduce((x, d) => x + d.total, 0);
  r.pgfnLimpo = /Não foram detectadas\s+pendências\/exigibilidades suspensas/i.test(junto) || !r.secoes.some((s) => s.orgao === "PGFN");
  return r;
}

function contaPrefixos(linhas: string[], i: number) {
  let n = 0;
  for (let k = i - 1; k >= 0 && PREFIXOS.has(linhas[k]) && n < 5; k--) n++;
  return n;
}

// Texto corrido da seção, sem o "CNPJ: ..." do começo
const limpar = (corpo: string[]) => corpo.join(" ").replace(/CNPJ: [\d./-]+\s*/g, "").replace(/\s+/g, " ").trim();

function lerDebitos(corpo: string[]): Debito[] {
  const ini = corpo.findIndex((l) => l === "Situação");
  const t = corpo.slice(ini + 1).filter(Boolean);
  const marcas: number[] = [];
  // Período mensal ("09/2026"), anual ("2025") ou trimestral, que vem em duas linhas ("3º" + "TRIM/2025")
  const ehTrim = (s: string) => /^TRIM\/\d{4}$/i.test(s);
  // Linha completa tem 5 valores (original, saldo, multa, juros, total); a de débito suspenso ou "a analisar", só 2
  for (let i = 0; i < t.length - 3; i++) if ((ehPA(t[i]) || ehTrim(t[i])) && ehData(t[i + 1]) && ehValor(t[i + 2]) && ehValor(t[i + 3])) marcas.push(i);
  const out: Debito[] = [];
  let inicioDesc = 0;
  marcas.forEach((m) => {
    const trim = ehTrim(t[m]) && /^\dº$/.test(t[m - 1] ?? "");
    const cinco = ehValor(t[m + 4] ?? "") && ehValor(t[m + 5] ?? "") && ehValor(t[m + 6] ?? "");
    const fimValores = cinco ? m + 7 : m + 4;
    out.push({
      receita: t.slice(inicioDesc, trim ? m - 1 : m).join(" ").replace(/\s+/g, " "),
      periodo: trim ? `${t[m - 1]} ${t[m]}` : t[m], vencimento: iso(t[m + 1]),
      original: valor(t[m + 2]), saldo: valor(t[m + 3]),
      multa: cinco ? valor(t[m + 4]) : 0, juros: cinco ? valor(t[m + 5]) : 0, total: cinco ? valor(t[m + 6]) : valor(t[m + 3]),
      situacao: t[fimValores] ?? "",
    });
    inicioDesc = fimValores + 1;
  });
  return out;
}
