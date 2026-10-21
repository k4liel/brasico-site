// Eventos do eSocial (leiaute S-1.3): nome da tag → código S-xxxx, e o nome curto mostrado no site.
// Fica separado para a tela poder usar sem carregar o leitor de XML.
export const TIPOS: Record<string, string> = {
  evtInfoEmpregador: "S-1000", evtTabEstab: "S-1005", evtTabRubrica: "S-1010", evtTabLotacao: "S-1020",
  evtTabProcesso: "S-1070", evtRemun: "S-1200", evtRmnRPPS: "S-1202", evtBenPrRP: "S-1207", evtPgtos: "S-1210",
  evtAqProd: "S-1260", evtComProd: "S-1270", evtContratAvNP: "S-1270", evtInfoComplPer: "S-1280",
  evtReabreEvPer: "S-1298", evtFechaEvPer: "S-1299", evtAdmPrelim: "S-2190", evtAdmissao: "S-2200",
  evtAltCadastral: "S-2205", evtAltContratual: "S-2206", evtCAT: "S-2210", evtMonit: "S-2220", evtToxic: "S-2221",
  evtAfastTemp: "S-2230", evtExpRisco: "S-2240", evtReintegr: "S-2298", evtDeslig: "S-2299", evtTSVInicio: "S-2300",
  evtTSVAltContr: "S-2306", evtTSVTermino: "S-2399", evtCdBenefIn: "S-2400", evtCdBenefAlt: "S-2405",
  evtCdBenIn: "S-2410", evtCdBenAlt: "S-2416", evtReativBen: "S-2418", evtCdBenTerm: "S-2420", evtProcTrab: "S-2500",
  evtContProc: "S-2501", evtExclusao: "S-3000", evtExcProcTrab: "S-3500", evtBasesTrab: "S-5001", evtIrrfBenef: "S-5002",
  evtBasesFGTS: "S-5003", evtCS: "S-5011", evtIrrf: "S-5012", evtFGTS: "S-5013", evtTribProcTrab: "S-5501",
  evtFGTSProcTrab: "S-5503",
};

export const NOMES: Record<string, string> = {
  "S-1000": "Empresa", "S-1005": "Estabelecimento", "S-1010": "Rubrica", "S-1020": "Lotação", "S-1070": "Processo",
  "S-1200": "Remuneração", "S-1210": "Pagamentos", "S-1270": "Avulsos não portuários", "S-1280": "Informações complementares",
  "S-1298": "Reabertura do mês", "S-1299": "Fechamento do mês", "S-2190": "Admissão preliminar", "S-2200": "Admissão",
  "S-2205": "Alteração cadastral", "S-2206": "Alteração contratual", "S-2210": "Acidente de trabalho (CAT)",
  "S-2220": "Exame médico (ASO)", "S-2230": "Afastamento", "S-2240": "Condições ambientais", "S-2298": "Reintegração",
  "S-2299": "Desligamento", "S-2300": "Sem vínculo: início", "S-2306": "Sem vínculo: alteração", "S-2399": "Sem vínculo: término",
  "S-2500": "Processo trabalhista", "S-3000": "Exclusão", "S-5001": "Contribuições do trabalhador", "S-5002": "IRRF do trabalhador",
  "S-5003": "FGTS do trabalhador", "S-5011": "Contribuições da empresa", "S-5012": "IRRF da empresa", "S-5013": "FGTS da empresa",
};
