// Eventos do eSocial (leiaute S-1.3): nome da tag → código S-xxxx e um resumo para a tela.
// O XML completo do evento e do recibo fica guardado; o resumo só traz o que ajuda a achar o evento.
import { lerXml, primeiroElemento, texto, type Element } from "./mensagens";
import { NOMES, TIPOS } from "./nomes";

export type EventoLido = {
  tipo: string | null;
  cpf_trab: string | null;
  per_apur: string | null;
  resumo: Record<string, string>;
};

// Campos que, se existirem no evento, vão para o resumo (o primeiro que aparecer)
const CAMPOS = [
  "cpfTrab", "nmTrab", "matricula", "codCateg", "dtAdm", "dtInicio", "dtDeslig", "dtTerm", "mtvDeslig", "dtIniAfast",
  "codMotAfast", "dtTermAfast", "dtAso", "resAso", "dtAlteracao", "nmCargo", "codCBO", "vrSalFx", "undSalFixo",
  "perApur", "indApuracao", "tpEvento", "nrRecEvt", "nrRecArqBase", "indRetif", "nrRecibo", "dtAcid", "tpAcid",
];

export function lerEvento(xmlEvento: string): EventoLido {
  const raiz = lerXml(xmlEvento).documentElement as unknown as Element | null;
  const evt = primeiroElemento(raiz);
  const nome = evt?.localName ?? "";
  const resumo: Record<string, string> = {};
  for (const c of CAMPOS) {
    const v = texto(evt, c);
    if (v) resumo[c] = v.slice(0, 120);
  }
  const tipo = TIPOS[nome] ?? null;
  if (tipo) resumo.descricao = NOMES[tipo] ?? tipo;
  if (resumo.nmTrab) resumo.nome = resumo.nmTrab;
  const cpf = resumo.cpfTrab && /^\d{11}$/.test(resumo.cpfTrab) ? resumo.cpfTrab : null;
  return { tipo, cpf_trab: cpf, per_apur: resumo.perApur ?? null, resumo };
}

export function lerRecibo(xmlRecibo: string | null) {
  if (!xmlRecibo) return { nrRecibo: null, dhRecepcao: null };
  const raiz = lerXml(xmlRecibo).documentElement as unknown as Element | null;
  return { nrRecibo: texto(raiz, "nrRecibo"), dhRecepcao: texto(raiz, "dhRecepcao") };
}
