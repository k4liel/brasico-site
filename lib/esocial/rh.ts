// Área de RH da página eSocial: transforma os eventos lidos do governo em pessoas, situação,
// alertas, números do mês e linha do tempo. Só lê o que o contador já transmitiu; nada é enviado.
// Regras de prazo: MOS S-1.3 (admissão até o dia anterior ao início; desligamento em até 10 dias;
// folha fechada até o dia 15). Tabelas 01 (categorias), 18 (afastamento) e 19 (desligamento).

export type EmpresaRH = {
  id: string; nome: string; cnpj: string | null; leitura_automatica: boolean; limite_diario: number; historico_desde: string;
  cert_validade: string | null; cert_emissor: string | null; cert_atualizado_em: string | null;
};
export type EventoRH = {
  id_evento: string; empresa_id: string; tipo: string | null; cpf_trab: string | null; per_apur: string | null; situacao: string;
  nr_recibo: string | null; resumo: Record<string, string>; descoberto_em: string; baixado_em: string | null;
};
export type TrabalhadorRH = {
  empresa_id: string; cpf: string; nome: string; matricula: string; cargo: string; admissao: string | null; unidade: string;
  origem: string; ativo: boolean; consultado_ate: string | null; consultado_desde: string | null;
};
export type ExecucaoRH = {
  id: string; empresa_id: string; ambiente: number; tipo: string; parametros: Record<string, unknown>; origem: string; status: string;
  cd_resposta: number | null; desc_resposta: string; resultado: Record<string, unknown>; erro: string; created_at: string;
};

export type Situacao = "trabalhando" | "experiencia" | "afastado" | "ferias" | "saiu" | "aguardando";

export type Pessoa = {
  chave: string; empresa_id: string; cpf: string; nome: string; matricula: string; cargo: string; unidade: string; vinculo: string;
  dtAdm: string | null; dtDeslig: string | null; motivoSaida: string | null; fimContrato: string | null;
  afastamento: { desde: string; motivo: string; saude: boolean } | null;
  salario: string | null; situacao: Situacao; eventos: EventoRH[]; alertas: Alerta[];
  // Até onde o governo já foi lido para esta pessoa (datas de recepção dos eventos)
  leitura: { desde: string | null; ate: string | null; eventos: number };
};

export type Alerta = { nivel: "erro" | "atencao" | "info"; texto: string; detalhe: string; empresa_id: string; pessoa?: string; acao?: string };

const MOTIVO_SAIDA: Record<string, string> = {
  "01": "dispensado por justa causa", "02": "dispensado sem justa causa", "03": "contrato encerrado antes do fim pela empresa",
  "04": "saiu antes do fim do contrato", "05": "culpa recíproca", "06": "fim do contrato (ou da experiência)",
  "07": "pediu para sair", "08": "saiu por interesse próprio (CLT)", "10": "falecimento", "11": "transferido no grupo",
  "12": "transferido (consórcio)", "13": "transferido (sucessão)", "17": "rescisão indireta", "33": "acordo entre as partes",
  "38": "aposentadoria", "47": "encerramento da empresa",
};
const MOTIVO_AFAST: Record<string, string> = {
  "01": "acidente ou doença do trabalho", "03": "doença", "06": "aposentadoria por invalidez", "07": "acidente ou doença do trabalho",
  "15": "férias", "17": "licença-maternidade", "18": "licença-maternidade", "19": "aborto não criminoso", "20": "licença-maternidade",
  "21": "licença não remunerada", "22": "mandato eleitoral", "24": "mandato sindical", "29": "serviço militar",
};
const SAUDE = new Set(["01", "03", "07"]);
const VINCULO: Record<string, string> = {
  "101": "CLT", "102": "CLT (trabalhador rural)", "103": "Aprendiz", "105": "Contrato por prazo", "106": "Temporário",
  "111": "Intermitente", "701": "Autônomo", "721": "Diretor", "722": "Diretor", "723": "Sócio ou empresário",
  "741": "MEI", "761": "Dirigente de associação", "781": "Ministro religioso", "901": "Estagiário", "903": "Bolsista",
};

// "LAIF HOTELARIAS LTDA" → "LAIF HOTELARIAS"; "ASSOCIACAO GENESIS" → "ASSOCIAÇÃO GENESIS"
export const nomeCurto = (nome: string) =>
  nome.replace(/\s+(LTDA|EIRELI|ME|EPP|S\/?A)\.?$/i, "").replace(/\b(EMPREENDIMENTOS TURISTICOS)\b/i, "")
    .replace(/\bASSOCIACAO\b/, "ASSOCIAÇÃO").trim();
// Associação não é restaurante: referências do setor (rotatividade) não valem para ela
export const ehAssociacao = (nome: string) => /^ASSOCIA/i.test(nome);

export const nomeVinculo = (c?: string | null) => (c ? VINCULO[c] ?? `Categoria ${c}` : "");

// ---------------------------------------------------------------------
// Datas (sempre texto AAAA-MM-DD; hoje em Brasília)
// ---------------------------------------------------------------------
export const hoje = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
export const diasEntre = (a: string, b: string) => Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 86400000);
export const somarDias = (d: string, n: number) => new Date(Date.parse(d.slice(0, 10)) + n * 86400000).toISOString().slice(0, 10);
export const dataBR = (d?: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "");
export const mesAnterior = (base = hoje(), n = 1) => {
  const [a, m] = base.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 - n, 1));
  return d.toISOString().slice(0, 7);
};
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export const nomeMes = (am: string) => `${MESES[Number(am.slice(5, 7)) - 1]}/${am.slice(0, 4)}`;

export function tempoDeCasa(desde: string, ate = hoje()) {
  const d = diasEntre(desde, ate);
  if (d < 31) return `${d} dia${d === 1 ? "" : "s"}`;
  const meses = Math.floor(d / 30.44);
  if (meses < 12) return `${meses} ${meses === 1 ? "mês" : "meses"}`;
  const anos = Math.floor(meses / 12), resto = meses % 12;
  return `${anos} ano${anos > 1 ? "s" : ""}${resto ? ` e ${resto} ${resto === 1 ? "mês" : "meses"}` : ""}`;
}

// Data do fato (não a do envio): admissão, desligamento, afastamento, alteração…
export function dataDoFato(e: EventoRH) {
  const r = e.resumo ?? {};
  return r.dtAdm || r.dtDeslig || r.dtIniAfast || r.dtTermAfast || r.dtAlteracao || r.dtAso || r.dtInicio || r.dtTerm
    || (e.per_apur && e.per_apur.length === 7 ? `${e.per_apur}-01` : "") || (r.recebido_em ?? e.baixado_em ?? e.descoberto_em).slice(0, 10);
}
const recebido = (e: EventoRH) => (e.resumo?.recebido_em ?? "").slice(0, 10) || null;

// Tira eventos excluídos (S-3000) e versões substituídas por retificação
function validos(eventos: EventoRH[]) {
  const baixados = eventos.filter((e) => e.situacao === "baixado" && e.tipo);
  const excluidos = new Set(baixados.filter((e) => e.tipo === "S-3000" && e.resumo?.nrRecEvt).map((e) => e.resumo.nrRecEvt));
  const retificados = new Set(baixados.filter((e) => e.resumo?.indRetif === "2" && e.resumo?.nrRecibo).map((e) => e.resumo.nrRecibo));
  return baixados.filter((e) => e.tipo !== "S-3000" && !(e.nr_recibo && (excluidos.has(e.nr_recibo) || retificados.has(e.nr_recibo))));
}

// ---------------------------------------------------------------------
// Pessoas
// ---------------------------------------------------------------------
export function montarPessoas(eventos: EventoRH[], trabalhadores: TrabalhadorRH[]): Pessoa[] {
  const porChave = new Map<string, EventoRH[]>();
  for (const e of validos(eventos)) {
    if (!e.cpf_trab) continue;
    const k = `${e.empresa_id}:${e.cpf_trab}`;
    porChave.set(k, [...(porChave.get(k) ?? []), e]);
  }
  for (const t of trabalhadores) if (t.ativo && !porChave.has(`${t.empresa_id}:${t.cpf}`)) porChave.set(`${t.empresa_id}:${t.cpf}`, []);

  const agora = hoje();
  return [...porChave.entries()].map(([chave, evs]) => {
    const [empresa_id, cpf] = chave.split(":");
    const t = trabalhadores.find((x) => x.empresa_id === empresa_id && x.cpf === cpf);
    evs.sort((a, b) => dataDoFato(a).localeCompare(dataDoFato(b)));
    const ultimo = (tipo: string) => [...evs].reverse().find((e) => e.tipo === tipo);
    const adm = ultimo("S-2200") ?? ultimo("S-2300");
    const saida = ultimo("S-2299") ?? ultimo("S-2399");
    const reintegrado = ultimo("S-2298");
    const comCargo = [...evs].reverse().find((e) => e.resumo?.nmCargo);
    const comSalario = [...evs].reverse().find((e) => e.resumo?.vrSalFx);
    const nome = [...evs].reverse().find((e) => e.resumo?.nome)?.resumo.nome || t?.nome || "";

    // Afastamento aberto: o último início sem término depois dele (ou com término no futuro)
    let afastamento: Pessoa["afastamento"] = null;
    for (const e of evs.filter((x) => x.tipo === "S-2230")) {
      const r = e.resumo;
      if (r.dtIniAfast) afastamento = { desde: r.dtIniAfast, motivo: r.codMotAfast ?? "", saude: SAUDE.has(r.codMotAfast ?? "") };
      if (r.dtTermAfast && afastamento && r.dtTermAfast >= afastamento.desde && r.dtTermAfast < agora) afastamento = null;
    }

    // Sem evento de admissão ainda, vale o cadastro da planilha (nome, cargo, admissão, unidade)
    const dtAdm = adm?.resumo.dtAdm || adm?.resumo.dtInicio || t?.admissao || null;
    const fimContrato = adm?.resumo.dtTerm || null;
    const saiu = !!saida && !(reintegrado && dataDoFato(reintegrado) > dataDoFato(saida));
    let situacao: Situacao = "aguardando";
    if (saiu) situacao = "saiu";
    else if (afastamento) situacao = afastamento.motivo === "15" ? "ferias" : "afastado";
    else if (fimContrato && fimContrato >= agora) situacao = "experiencia";
    else if (adm || t?.admissao) situacao = "trabalhando";

    const p: Pessoa = {
      chave, empresa_id, cpf, nome, matricula: adm?.resumo.matricula || t?.matricula || "",
      cargo: comCargo?.resumo.nmCargo || t?.cargo || "", unidade: t?.unidade ?? "", vinculo: nomeVinculo(adm?.resumo.codCateg),
      dtAdm, dtDeslig: saiu ? saida!.resumo.dtDeslig || saida!.resumo.dtTerm || null : null,
      motivoSaida: saiu ? MOTIVO_SAIDA[saida!.resumo.mtvDeslig ?? ""] ?? (saida!.resumo.mtvDeslig ? `motivo ${saida!.resumo.mtvDeslig}` : null) : null,
      fimContrato, afastamento, salario: comSalario?.resumo.vrSalFx ?? null, situacao, eventos: evs, alertas: [],
      leitura: { desde: t?.consultado_desde?.slice(0, 10) ?? null, ate: t?.consultado_ate?.slice(0, 10) ?? null, eventos: evs.length },
    };
    p.alertas = alertasDaPessoa(p);
    return p;
  }).sort((a, b) => (a.nome || "~").localeCompare(b.nome || "~", "pt-BR"));
}

function alertasDaPessoa(p: Pessoa): Alerta[] {
  const a: Alerta[] = [];
  const agora = hoje();
  const quem = p.nome || "Funcionário sem nome";
  if (p.situacao === "experiencia" && p.fimContrato) {
    const d = diasEntre(agora, p.fimContrato);
    if (d <= 10) a.push({ nivel: d <= 3 ? "erro" : "atencao", empresa_id: p.empresa_id, pessoa: p.chave,
      texto: `Contrato de ${quem} acaba ${d === 0 ? "hoje" : `em ${d} dia${d === 1 ? "" : "s"}`} (${dataBR(p.fimContrato)})`,
      detalhe: "Decida se a pessoa fica e avise o contador antes da data." });
  }
  if (p.afastamento?.saude && diasEntre(p.afastamento.desde, agora) > 15) {
    a.push({ nivel: "atencao", empresa_id: p.empresa_id, pessoa: p.chave,
      texto: `${quem} está afastado por saúde há ${diasEntre(p.afastamento.desde, agora)} dias`,
      detalhe: "Passou de 15 dias: o pagamento passa a ser do INSS. Confirme com o contador." });
  }
  const adm = p.eventos.find((e) => e.tipo === "S-2200");
  if (adm && p.dtAdm && recebido(adm) && recebido(adm)! >= p.dtAdm && diasEntre(p.dtAdm, agora) <= 120) {
    a.push({ nivel: "atencao", empresa_id: p.empresa_id, pessoa: p.chave,
      texto: `Admissão de ${quem} foi informada depois do primeiro dia`,
      detalhe: `Começou em ${dataBR(p.dtAdm)} e o governo recebeu em ${dataBR(recebido(adm))}. O prazo é até o dia anterior: risco de multa.` });
  }
  const sai = p.eventos.find((e) => e.tipo === "S-2299");
  if (sai && p.dtDeslig && recebido(sai) && diasEntre(p.dtDeslig, recebido(sai)!) > 10 && diasEntre(p.dtDeslig, agora) <= 120) {
    a.push({ nivel: "atencao", empresa_id: p.empresa_id, pessoa: p.chave,
      texto: `Desligamento de ${quem} foi informado com ${diasEntre(p.dtDeslig, recebido(sai)!)} dias`,
      detalhe: "O prazo é de 10 dias depois da saída." });
  }
  if (sai?.resumo.mtvDeslig === "17") {
    a.push({ nivel: "erro", empresa_id: p.empresa_id, pessoa: p.chave, texto: `${quem} saiu por rescisão indireta`,
      detalhe: "A pessoa acusou a empresa de descumprir o contrato. Risco de processo trabalhista." });
  }
  return a;
}

// ---------------------------------------------------------------------
// Folha do mês (fechamento S-1299 e totais do governo S-5011 / S-5013)
// ---------------------------------------------------------------------
export type Folha = { empresa_id: string; competencia: string; fechada: string | null; consultada: boolean; inss: boolean; fgts: boolean };

export function montarFolhas(empresas: EmpresaRH[], eventos: EventoRH[], execucoes: ExecucaoRH[], competencias: string[]): Folha[] {
  const v = validos(eventos);
  return empresas.flatMap((emp) => competencias.map((c) => {
    const tem = (tipo: string) => v.find((e) => e.empresa_id === emp.id && e.tipo === tipo && e.per_apur === c);
    const pendente = eventos.some((e) => e.empresa_id === emp.id && e.tipo === "S-1299" && e.per_apur === c);
    const f = tem("S-1299");
    const consultada = pendente || execucoes.some((x) => x.empresa_id === emp.id && x.ambiente === 1 && x.tipo === "identificadores_empregador"
      && ["ok", "sem_dados"].includes(x.status) && x.parametros?.tpEvt === "S-1299" && x.parametros?.perApur === c);
    return { empresa_id: emp.id, competencia: c, fechada: f ? recebido(f) ?? f.baixado_em?.slice(0, 10) ?? "" : null,
      consultada, inss: !!tem("S-5011"), fgts: !!tem("S-5013") };
  }));
}

// ---------------------------------------------------------------------
// Alertas gerais (empresa) + das pessoas, os mais graves primeiro
// ---------------------------------------------------------------------
export function montarAlertas(empresas: EmpresaRH[], pessoas: Pessoa[], folhas: Folha[], execucoes: ExecucaoRH[]): Alerta[] {
  const a: Alerta[] = [];
  const agora = hoje();
  for (const e of empresas) {
    if (e.cert_validade) {
      const d = diasEntre(agora, e.cert_validade.slice(0, 10));
      if (d <= 30) a.push({ nivel: d <= 7 ? "erro" : "atencao", empresa_id: e.id, acao: "certificado",
        texto: d < 0 ? `O certificado da ${nomeCurto(e.nome)} venceu` : `O certificado da ${nomeCurto(e.nome)} vence em ${d} dia${d === 1 ? "" : "s"}`,
        detalhe: "Sem ele a leitura para. Renove na certificadora e envie o novo arquivo em Menu → Certificados digitais." });
    }
    if (!e.leitura_automatica) a.push({ nivel: "info", empresa_id: e.id, acao: "leitura",
      texto: `A leitura automática da ${nomeCurto(e.nome)} está desligada`, detalhe: "Ligue para os dados chegarem sozinhos todo dia." });
    // 407: o governo não aceita este certificado para ler os eventos dos funcionários (perfil/procuração)
    const trab = execucoes.filter((x) => x.empresa_id === e.id && x.ambiente === 1 && x.tipo === "identificadores_trabalhador").slice(0, 2);
    if (trab.length >= 1 && trab.every((x) => x.cd_resposta === 407)) a.push({ nivel: "erro", empresa_id: e.id, acao: "tecnico",
      texto: `O eSocial não deixa a ${nomeCurto(e.nome)} ler os dados dos funcionários com este certificado`,
      detalhe: "Resposta do governo: código 407, 'sem perfil de procuração ou não consta como representante legal'. Confira com o contador se o certificado é da mesma empresa que transmite o eSocial; pode ser preciso uma procuração eletrônica no e-CAC." });
    const ultimas = execucoes.filter((x) => x.empresa_id === e.id && x.ambiente === 1 && x.tipo !== "teste_conexao").slice(0, 4);
    if (ultimas.length >= 4 && ultimas.every((x) => x.status === "falha")) a.push({ nivel: "atencao", empresa_id: e.id, acao: "tecnico",
      texto: `As últimas leituras da ${nomeCurto(e.nome)} falharam`, detalhe: `Última resposta: ${ultimas[0].erro || ultimas[0].desc_resposta}`.slice(0, 160) });
  }
  const dia = Number(agora.slice(8, 10));
  for (const f of folhas) {
    if (f.competencia === mesAnterior() && dia > 15 && f.consultada && !f.fechada) {
      const emp = empresas.find((e) => e.id === f.empresa_id);
      a.push({ nivel: "erro", empresa_id: f.empresa_id, texto: `${emp ? nomeCurto(emp.nome) : "Empresa"}: folha de ${nomeMes(f.competencia)} não foi fechada`,
        detalhe: "O prazo era o dia 15. Sem o fechamento, as guias de INSS e FGTS não saem. Fale com o contador." });
    }
  }
  for (const p of pessoas) a.push(...p.alertas);
  const ordem = { erro: 0, atencao: 1, info: 2 };
  return a.sort((x, y) => ordem[x.nivel] - ordem[y.nivel]);
}

// ---------------------------------------------------------------------
// Números do topo
// ---------------------------------------------------------------------
export function montarNumeros(pessoas: Pessoa[], empresas: EmpresaRH[]) {
  const agora = hoje();
  const mes = agora.slice(0, 7);
  const ano = agora.slice(0, 4);
  const ativos = pessoas.filter((p) => ["trabalhando", "experiencia", "afastado", "ferias"].includes(p.situacao));
  const entraram = pessoas.filter((p) => p.dtAdm?.startsWith(mes)).length;
  const sairam = pessoas.filter((p) => p.dtDeslig?.startsWith(mes)).length;
  const ferias = pessoas.filter((p) => p.situacao === "ferias").length;
  const afastados = pessoas.filter((p) => p.situacao === "afastado").length;
  const saidasAno = pessoas.filter((p) => p.dtDeslig?.startsWith(ano));
  const cedo = saidasAno.filter((p) => p.dtAdm && p.dtDeslig && diasEntre(p.dtAdm, p.dtDeslig) < 90);
  const pediram = cedo.filter((p) => p.motivoSaida === "pediu para sair").length;

  // Rotatividade só com 12 meses de eventos lidos do governo (o cadastro da planilha não traz as saídas)
  const desde = empresas.map((e) => e.historico_desde).sort()[0] ?? agora;
  const mesesLidos = Math.max(0, Math.floor(diasEntre(desde, agora) / 30.44));
  const temSaidasLidas = pessoas.some((p) => p.eventos.some((e) => e.tipo === "S-2299" || e.tipo === "S-2399"));
  let rotatividade: number | null = null;
  if (mesesLidos >= 12 && ativos.length && temSaidasLidas) {
    const inicio = somarDias(agora, -365);
    const e12 = pessoas.filter((p) => p.dtAdm && p.dtAdm >= inicio).length;
    const s12 = pessoas.filter((p) => p.dtDeslig && p.dtDeslig >= inicio).length;
    rotatividade = Math.round((((e12 + s12) / 2) / ativos.length) * 100);
  }
  return { ativos: ativos.length, entraram, sairam, ferias, afastados, saidasAno: saidasAno.length, cedo: cedo.length, pediram, rotatividade, mesesLidos };
}

// ---------------------------------------------------------------------
// Linha do tempo de uma pessoa
// ---------------------------------------------------------------------
export type ItemLinha = { data: string; frase: string; tecnico: string; futuro?: boolean; tipo: "contrato" | "ausencia" | "exame" | "saida" | "outro"; ok?: boolean };

export function linhaDoTempo(p: Pessoa): ItemLinha[] {
  const itens: ItemLinha[] = [];
  const agora = hoje();
  if (p.situacao === "experiencia" && p.fimContrato) itens.push({ data: p.fimContrato, futuro: true, tipo: "contrato",
    frase: "Contrato de experiência (ou por prazo) acaba", tecnico: "data informada na admissão" });
  for (const e of p.eventos) {
    const r = e.resumo ?? {};
    const rec = recebido(e);
    const informado = rec ? `informado em ${dataBR(rec)}` : "";
    const base = { data: dataDoFato(e), tecnico: [e.tipo, informado].filter(Boolean).join(" · ") };
    switch (e.tipo) {
      case "S-2200": {
        const noPrazo = !!(rec && p.dtAdm && rec < p.dtAdm);
        itens.push({ ...base, tipo: "contrato", ok: noPrazo, frase: `Entrou na empresa${r.nmCargo ? ` como ${r.nmCargo}` : ""}${r.dtTerm ? " (contrato com data para acabar)" : ""}`,
          tecnico: `${base.tecnico}${rec ? (noPrazo ? " · no prazo ✓" : " · fora do prazo ✕") : ""}` });
        break;
      }
      case "S-2190": itens.push({ ...base, tipo: "contrato", frase: "Registro preliminar da admissão" }); break;
      case "S-2205": itens.push({ ...base, tipo: "outro", frase: "Dados pessoais atualizados" }); break;
      case "S-2206": itens.push({ ...base, tipo: "contrato", frase: r.nmCargo ? `Contrato alterado: cargo ${r.nmCargo}` : "Contrato alterado (cargo, salário ou jornada)" }); break;
      case "S-2230": {
        const motivo = MOTIVO_AFAST[r.codMotAfast ?? ""] ?? "afastamento";
        if (r.dtIniAfast) itens.push({ ...base, data: r.dtIniAfast, tipo: "ausencia",
          frase: r.codMotAfast === "15" ? `Saiu de férias${r.dtTermAfast ? ` até ${dataBR(r.dtTermAfast)}` : ""}` : `Afastado: ${motivo}` });
        if (r.dtTermAfast && !r.dtIniAfast) itens.push({ ...base, data: r.dtTermAfast, tipo: "ausencia", frase: "Voltou ao trabalho" });
        break;
      }
      case "S-2220": itens.push({ ...base, tipo: "exame", frase: "Fez o exame médico do trabalho (ASO)" }); break;
      case "S-2210": itens.push({ ...base, tipo: "exame", frase: "Acidente de trabalho comunicado (CAT)" }); break;
      case "S-2240": itens.push({ ...base, tipo: "exame", frase: "Condições do ambiente de trabalho informadas" }); break;
      case "S-2298": itens.push({ ...base, tipo: "contrato", frase: "Reintegrado à empresa" }); break;
      case "S-2299": case "S-2399": {
        const prazo = rec && p.dtDeslig ? diasEntre(p.dtDeslig, rec) <= 10 : undefined;
        itens.push({ ...base, tipo: "saida", ok: prazo, frase: `Saiu da empresa${p.motivoSaida ? `: ${p.motivoSaida}` : ""}`,
          tecnico: `${base.tecnico}${prazo === undefined ? "" : prazo ? " · no prazo ✓" : " · fora do prazo ✕"}` });
        break;
      }
      case "S-2300": itens.push({ ...base, tipo: "contrato", frase: "Começou sem vínculo CLT (estágio, autônomo…)" }); break;
      case "S-1200": itens.push({ ...base, tipo: "outro", frase: `Folha de ${e.per_apur ? nomeMes(e.per_apur) : "um mês"}` }); break;
      case "S-1210": itens.push({ ...base, tipo: "outro", frase: "Pagamento registrado" }); break;
      default: itens.push({ ...base, tipo: "outro", frase: e.tipo ?? "Evento" });
    }
    if (r.indRetif === "2") itens[itens.length - 1].frase += " (corrigido pelo contador)";
  }
  return itens.sort((a, b) => b.data.localeCompare(a.data)).map((i) => ({ ...i, futuro: i.futuro || i.data > agora }));
}

// ---------------------------------------------------------------------
// Primeiros passos (marcados sozinhos pelos dados)
// ---------------------------------------------------------------------
export type Passo = { id: string; texto: string; feito: boolean; acao: string };

// ---------------------------------------------------------------------
// Andamento da leitura do governo, por empresa (o que já foi lido, o que falta, acessos de hoje, próxima leitura)
// ---------------------------------------------------------------------
export type Leitura = {
  empresa_id: string; nome: string;
  pessoas: number; lidas: number; lidoDesde: string | null; lidoAte: string | null; metaDesde: string;
  esperandoDownload: number; eventosBaixados: number;
  usadosHoje: number; limite: number; hojeOk: number; hojeErros: number; hojeVazios: number;
  proxima: string; ligada: boolean; semCertificado: boolean;
  ultima: { quando: string; texto: string; ok: boolean } | null;
};

const DESCRICAO_PEDIDO: Record<string, string> = {
  identificadores_trabalhador: "consulta de um funcionário", identificadores_empregador: "consulta do fechamento da folha",
  identificadores_tabela: "consulta de estabelecimentos", download_id: "download de eventos", download_recibo: "download de eventos",
  teste_conexao: "teste de conexão",
};

export function montarLeitura(empresas: EmpresaRH[], trabalhadores: TrabalhadorRH[], eventos: EventoRH[], execucoes: ExecucaoRH[]): Leitura[] {
  const agora = new Date();
  const brt = new Date(agora.getTime() - 3 * 3600 * 1000); // hora de Brasília (UTC-3)
  const h = brt.getUTCHours(), m = brt.getUTCMinutes(), diaMes = brt.getUTCDate();
  const hojeStr = brt.toISOString().slice(0, 10);
  return empresas.map((e) => {
    const trs = trabalhadores.filter((t) => t.empresa_id === e.id && t.ativo);
    const exs = execucoes.filter((x) => x.empresa_id === e.id && x.ambiente === 1 && x.tipo !== "teste_conexao");
    const hoje = exs.filter((x) => new Date(new Date(x.created_at).getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10) === hojeStr
      && !(x.status === "falha" && x.cd_resposta == null && x.erro.startsWith("conexão:")));
    const usados = hoje.length;
    const sobra = e.limite_diario - usados;
    let proxima: string;
    if (!e.leitura_automatica) proxima = "leitura automática desligada";
    else if (!e.cert_validade) proxima = "sem certificado";
    else if (diaMes <= 7) proxima = "dia 8 às 8h (o governo não libera do dia 1 ao 7)";
    else if (sobra <= 0) proxima = `amanhã às 8h (os ${e.limite_diario} acessos de hoje acabaram)`;
    else if (h < 8) proxima = "hoje às 8h";
    else if (h >= 20) proxima = "amanhã às 8h";
    else {
      const prox = (Math.floor(m / 15) + 1) * 15;
      proxima = prox >= 60 ? `hoje às ${String(h + 1).padStart(2, "0")}:00` : `hoje às ${String(h).padStart(2, "0")}:${String(prox).padStart(2, "0")}`;
    }
    const ult = exs[0];
    const desc = ult ? DESCRICAO_PEDIDO[ult.tipo] ?? ult.tipo : "";
    const ultima = ult ? {
      quando: ult.created_at,
      ok: ult.status === "ok" || ult.status === "sem_dados",
      texto: ult.status === "ok" ? `${desc}: ok${ult.resultado?.total != null ? ` (${ult.resultado.total} encontrados)` : ult.resultado?.baixados != null ? ` (${ult.resultado.baixados} baixados)` : ""}`
        : ult.status === "sem_dados" ? `${desc}: nada encontrado`
        : ["na_fila", "rodando"].includes(ult.status) ? `${desc}: em andamento`
        : `${desc}: falhou (${(ult.erro || ult.desc_resposta || "sem detalhe").replace(/^O servidor do eSocial devolveu uma página de erro \(HTTP 500\).*/, "erro no servidor do governo").slice(0, 90)})`,
    } : null;
    return {
      empresa_id: e.id, nome: e.nome,
      pessoas: trs.length, lidas: trs.filter((t) => t.consultado_ate).length,
      lidoDesde: trs.map((t) => t.consultado_desde).filter(Boolean).sort()[0]?.slice(0, 10) ?? null,
      lidoAte: trs.map((t) => t.consultado_ate).filter(Boolean).sort().reverse()[0]?.slice(0, 10) ?? null,
      metaDesde: e.historico_desde,
      esperandoDownload: eventos.filter((v) => v.empresa_id === e.id && v.situacao === "pendente" && v.id_evento.length === 36).length,
      eventosBaixados: eventos.filter((v) => v.empresa_id === e.id && v.situacao === "baixado").length,
      usadosHoje: usados, limite: e.limite_diario,
      hojeOk: hoje.filter((x) => x.status === "ok").length,
      hojeErros: hoje.filter((x) => x.status === "falha").length,
      hojeVazios: hoje.filter((x) => x.status === "sem_dados").length,
      proxima, ligada: e.leitura_automatica, semCertificado: !e.cert_validade, ultima,
    };
  });
}

export function montarPassos(empresas: EmpresaRH[], trabalhadores: TrabalhadorRH[], execucoes: ExecucaoRH[]): Passo[] {
  const seisMeses = somarDias(hoje(), -180);
  return [
    { id: "certificado", texto: "Envie o certificado digital de cada empresa", feito: empresas.length > 0 && empresas.every((e) => !!e.cert_validade), acao: "Enviar certificado" },
    { id: "teste", texto: "Teste a conexão com o governo", feito: execucoes.some((x) => x.tipo === "teste_conexao" && x.status === "ok"), acao: "Testar agora" },
    { id: "leitura", texto: "Ligue a leitura automática", feito: empresas.length > 0 && empresas.every((e) => e.leitura_automatica), acao: "Ligar" },
    { id: "cpfs", texto: "Adicione os CPFs da equipe (o governo entrega os dados de cada pessoa pelo CPF)",
      feito: empresas.length > 0 && empresas.every((e) => trabalhadores.some((t) => t.empresa_id === e.id)), acao: "Adicionar CPFs" },
    { id: "historico", texto: "Escolha desde quando ler o histórico (sugestão: a admissão do funcionário mais antigo)",
      feito: empresas.length > 0 && empresas.every((e) => e.historico_desde <= seisMeses), acao: "Escolher data" },
  ];
}

// ---------------------------------------------------------------------
// Calendário do mês (obrigações do empregador; datas do MOS S-1.3, DCTFWeb e FGTS Digital)
// ---------------------------------------------------------------------
export type ItemCalendario = { dia: number; data: string; titulo: string; detalhe: string; estado: "feito" | "pendente" | "atrasado" | "futuro" | "info"; quem: "contador" | "governo" | "empresa" };

export function montarCalendario(folhas: Folha[], empresas: EmpresaRH[], base = hoje()): ItemCalendario[] {
  const mes = base.slice(0, 7);
  const diaHoje = Number(base.slice(8, 10));
  const comp = mesAnterior(base);
  const doMes = folhas.filter((f) => f.competencia === comp);
  const fechadas = doMes.filter((f) => f.fechada != null).length;
  const consultadas = doMes.filter((f) => f.consultada).length;
  const nomes = (lista: Folha[]) => lista.map((f) => empresas.find((e) => e.id === f.empresa_id)?.nome ?? f.empresa_id).join(", ");
  const estadoPrazo = (dia: number, ok: boolean, sabe: boolean): ItemCalendario["estado"] =>
    ok ? "feito" : diaHoje < dia ? (sabe ? "pendente" : "futuro") : sabe ? "atrasado" : "futuro";
  const d = (n: number) => `${mes}-${String(n).padStart(2, "0")}`;
  const faltando = doMes.filter((f) => f.fechada == null && f.consultada);   // lidas e sem fechamento
  const naoLidas = doMes.filter((f) => f.fechada == null && !f.consultada);  // ainda não consultadas no governo
  const detalheFechamento = !doMes.length ? "Sem empresas."
    : fechadas === doMes.length ? `Fechada ${doMes.length === 1 ? "na empresa" : `nas ${doMes.length} empresas`}.`
    : [faltando.length ? `Falta: ${nomes(faltando)}.` : "", naoLidas.length ? `Ainda não lemos: ${nomes(naoLidas)}.` : ""].filter(Boolean).join(" ");
  const itens: ItemCalendario[] = [
    { dia: 5, data: d(5), quem: "empresa", titulo: "Pagamento dos salários", detalhe: "Até o 5º dia útil do mês (CLT, art. 459). Confira no extrato.", estado: diaHoje <= 7 ? "pendente" : "info" },
    { dia: 7, data: d(7), quem: "governo", titulo: "Leitura do eSocial liberada", detalhe: "Do dia 1 ao 7 o governo não aceita consultas. A leitura automática volta no dia 8.", estado: diaHoje <= 7 ? "pendente" : "feito" },
    { dia: 15, data: d(15), quem: "contador", titulo: `Fechar a folha de ${nomeMes(comp)} no eSocial`,
      detalhe: detalheFechamento,
      estado: faltando.length ? estadoPrazo(15, false, true) : fechadas === doMes.length && doMes.length > 0 ? "feito" : estadoPrazo(15, false, false) },
    { dia: 15, data: d(15), quem: "contador", titulo: "DCTFWeb (declaração do INSS)", detalhe: "Gerada depois do fechamento da folha. Confirme com o contador o prazo em vigor.", estado: "info" },
    { dia: 20, data: d(20), quem: "empresa", titulo: "Pagar INSS (DARF) e FGTS Digital", detalhe: "As guias saem do fechamento da folha. O FGTS declarado é cobrado automaticamente se não for pago.", estado: diaHoje <= 20 ? "pendente" : "info" },
  ];
  return itens.sort((a, b) => a.dia - b.dia);
}

// ---------------------------------------------------------------------
// Admissões e saídas (cadastro + eventos) e ausências (S-2230), para as seções do RH
// ---------------------------------------------------------------------
export type Movimentacao = { tipo: "entrada" | "saida"; quando: string; texto: string; pessoa: Pessoa; prazo?: { ok: boolean } };

export function montarMovimentacoes(pessoas: Pessoa[], meses = 6): Movimentacao[] {
  const desde = somarDias(hoje(), -Math.round(meses * 30.44));
  const m: Movimentacao[] = [];
  for (const p of pessoas) {
    if (p.dtAdm && p.dtAdm >= desde) {
      const adm = p.eventos.find((e) => e.tipo === "S-2200");
      const rec = adm ? (adm.resumo?.recebido_em ?? "").slice(0, 10) : "";
      m.push({ tipo: "entrada", quando: p.dtAdm, pessoa: p, texto: `Entrou${p.cargo ? ` como ${p.cargo.toLowerCase()}` : ""}${p.vinculo ? ` (${p.vinculo})` : ""}`,
        prazo: rec ? { ok: rec < p.dtAdm } : undefined });
    }
    if (p.dtDeslig && p.dtDeslig >= desde) {
      const sai = p.eventos.find((e) => e.tipo === "S-2299" || e.tipo === "S-2399");
      const rec = sai ? (sai.resumo?.recebido_em ?? "").slice(0, 10) : "";
      m.push({ tipo: "saida", quando: p.dtDeslig, pessoa: p, texto: `Saiu${p.motivoSaida ? `: ${p.motivoSaida}` : ""}${p.dtAdm ? ` · ${tempoDeCasa(p.dtAdm, p.dtDeslig)} de casa` : ""}`,
        prazo: rec ? { ok: diasEntre(p.dtDeslig, rec) <= 10 } : undefined });
    }
  }
  return m.sort((a, b) => b.quando.localeCompare(a.quando));
}

export type Ausencia = { pessoa: Pessoa; inicio: string; fim: string | null; texto: string };

export function montarAusencias(pessoas: Pessoa[]): Ausencia[] {
  const a: Ausencia[] = [];
  for (const p of pessoas) {
    for (const e of p.eventos) {
      if (e.tipo !== "S-2230" || !e.resumo?.dtIniAfast) continue;
      const motivo = MOTIVO_AFAST[e.resumo.codMotAfast ?? ""] ?? "afastamento";
      a.push({ pessoa: p, inicio: e.resumo.dtIniAfast, fim: e.resumo.dtTermAfast || null, texto: motivo.charAt(0).toUpperCase() + motivo.slice(1) });
    }
  }
  return a.sort((x, y) => y.inicio.localeCompare(x.inicio));
}

export const ROTULO_SITUACAO: Record<Situacao, string> = {
  trabalhando: "Trabalhando", experiencia: "Em experiência", afastado: "Afastado", ferias: "De férias", saiu: "Saiu", aguardando: "Aguardando leitura",
};

export const cpfVisivel = (cpf: string, ver: boolean) =>
  ver ? `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}` : `•••.${cpf.slice(3, 6)}.•••-••`;
