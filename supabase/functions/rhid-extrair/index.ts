// Copia do RHiD (ponto em nuvem da Control iD), somente leitura, de cada cliente que o login enxerga:
// tipo "cadastros": empresas, departamentos, relógios e pessoas; tipo "batidas": a apuração do ponto
// (semana e escala futura); tipo "agora": o dia de hoje de quem acabou de bater ou tem escala hoje.
// Chamada pelo banco (rhid_pedir, via pg_net) com o segredo no cabeçalho x-segredo.
// Corpo: { "execucao": "<id em rhid_execucoes>" }. Responde na hora e trabalha em segundo plano.
// E-mail e senha ficam no Vault (rhid_email, rhid_senha). Nada de segredo nos logs.
// Nunca copia senha do funcionário, crachá (RFID), código de barras, digitais nem foto.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const API = "https://www.rhid.com.br/v2/api.svc";
const TIMEOUT_MS = 60000;

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// deno-lint-ignore no-explicit-any
type J = any;

class ErroRhid extends Error {}

// Sem caracteres de controle: alguns textos do RHiD trazem \u0000, que o banco recusa
const txt = (v: unknown) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim();
const num = (v: unknown) => (v == null || v === "" || !isFinite(Number(v)) ? null : Number(v));
const digitos = (v: unknown) => txt(v).replace(/\D/g, "");

// Datas do .NET: "2026-06-01T08:00:00" ou "/Date(1780000000000-0300)/"
function quando(v: unknown) {
  const s = txt(v);
  if (!s) return null;
  const m = s.match(/\/Date\((-?\d+)/);
  const d = m ? new Date(Number(m[1])) : new Date(s);
  // O RHiD usa 01/01/2000 para "nunca" (relógio que nunca conectou)
  if (isNaN(d.getTime()) || d.getUTCFullYear() <= 2000) return null;
  return d.toISOString();
}
// Datas de cadastro (admissão) vêm como "2023-01-01" e podem ser antigas
const dia = (v: unknown) => txt(v).match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? quando(v)?.slice(0, 10) ?? null;

// API interna do site do RHiD (/v2/customerdb/<tabela>.svc/<ação>): aceita o mesmo token e as suas LISTAS
// funcionam (as da api.svc dão 500). É de onde vêm cargo, centro de custo, escalas e demissão.
const INTERNA = "https://www.rhid.com.br/v2/customerdb/";

async function pedir(caminho: string, init: RequestInit) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(caminho.startsWith("http") ? caminho : `${API}${caminho}`, { ...init, signal: ctl.signal });
    const corpo = await r.text();
    let p: J = null;
    try {
      p = corpo ? JSON.parse(corpo) : null;
    } catch {
      const trecho = corpo.replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ").trim().slice(0, 300);
      throw new ErroRhid(`${caminho}: ${r.ok ? "resposta que não é JSON" : `HTTP ${r.status}`}${trecho ? ` (${trecho})` : ""}`);
    }
    if (!r.ok) {
      const motivo = txt(p?.error ?? p?.message ?? p?.Message ?? (typeof p === "string" ? p : "")).slice(0, 160);
      throw new ErroRhid(`${caminho}: HTTP ${r.status}${motivo ? ` (${motivo})` : ""}`);
    }
    // Alguns endpoints devolvem o JSON serializado como texto
    if (typeof p === "string") {
      try {
        return JSON.parse(p);
      } catch {
        return p;
      }
    }
    return p;
  } catch (e) {
    if (e instanceof ErroRhid) throw e;
    throw new ErroRhid(ctl.signal.aborted ? `${caminho}: tempo esgotado` : `${caminho}: falha de conexão`);
  } finally {
    clearTimeout(t);
  }
}

type Login = { token: string; clientes: { id: number; dominio: string; nome: string }[] };

async function entrar(email: string, senha: string, dominio?: string): Promise<Login> {
  const body: Record<string, string> = { email, password: senha };
  if (dominio) body.domain = dominio;
  const p = await pedir("/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (p?.expiredPassword) throw new ErroRhid("a senha do usuário do RHiD venceu; troque no RHiD e no Vault");
  if (p?.customerBlocked) throw new ErroRhid("cliente bloqueado no RHiD");
  const clientes = (Array.isArray(p?.listCustomer) ? p.listCustomer : [])
    .map((c: J) => ({ id: Number(c?.id), dominio: txt(c?.domain), nome: txt(c?.name) }))
    .filter((c: { id: number }) => Number.isFinite(c.id));
  const token = txt(p?.accessToken);
  if (!token && !clientes.length) throw new ErroRhid(`login recusado${p?.error ? ` (${txt(p.error).slice(0, 120)})` : ""}`);
  return { token, clientes };
}

const lista = (p: J): J[] => (Array.isArray(p) ? p : Array.isArray(p?.records) ? p.records : []);
const ids = (v: unknown) => (Array.isArray(v) ? v : []).map(Number).filter((n) => Number.isFinite(n) && n > 0);

// Sem start/length na URL: com eles a API do RHiD responde 500 (out/2026)
async function ler(token: string, caminho: string) {
  return lista(await pedir(caminho, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }));
}

// Lista da API interna ({data: [...]}); vazia (e o erro anotado) se o RHiD recusar
async function lerInterno(token: string, caminho: string, erros: string[]) {
  try {
    const p = await pedir(`${INTERNA}${caminho}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    if (p?.error) throw new ErroRhid(`${caminho}: ${txt(p.error).slice(0, 120)}`);
    return Array.isArray(p) ? p : Array.isArray(p?.data) ? p.data : [];
  } catch (e) {
    erros.push(e instanceof Error ? e.message.slice(0, 120) : "erro desconhecido");
    return [] as J[];
  }
}

// Um registro pelo id; null se o RHiD não devolver
async function lerUm(token: string, caminho: string, erros: string[]) {
  try {
    const p = await pedir(caminho, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    return p && typeof p === "object" && !Array.isArray(p) ? p : null;
  } catch (e) {
    erros.push(e instanceof Error ? e.message.slice(0, 120) : "erro desconhecido");
    return null;
  }
}

async function gravar(tabela: string, linhas: Record<string, unknown>[]) {
  for (let i = 0; i < linhas.length; i += 500) {
    const { error } = await supabase.from(tabela).upsert(linhas.slice(i, i + 500), { onConflict: "cliente_id,id" });
    if (error) throw new Error(`gravação em ${tabela}: ${error.message}`);
  }
}

// Escala vigente da ficha completa: o vínculo pessoa×escala que cobre hoje (senão a "atual" do RHiD)
function escalaVigente(ficha: J, hoje: string) {
  const vinculos = (Array.isArray(ficha?.personShifts) ? ficha.personShifts : [])
    .map((v: J) => ({ id: num(v?.idShift), desde: dia(v?.start), ate: dia(v?.end) }))
    .filter((v: { id: number | null }) => v.id);
  const atual = vinculos.find((v: { desde: string | null; ate: string | null }) => (!v.desde || v.desde <= hoje) && (!v.ate || v.ate >= hoje))
    ?? vinculos.sort((a: J, b: J) => String(b.desde).localeCompare(String(a.desde)))[0];
  return { escala_id: atual?.id ?? num(ficha?.idShiftAtual), escala_desde: atual?.desde ?? null };
}

// Justificativas (atestados, afastamentos, férias, abonos, banco): lista por POST, em páginas de 500.
// Guarda o período, o tipo, o texto e se há arquivo; o arquivo em si nunca se copia.
async function copiarJustificativas(cliente: number, token: string, desde: string, ate: string) {
  const agora = new Date().toISOString();
  let total = 0;
  for (let page = 0; page < 40; page++) {
    const corpo = { ini: desde, fim: ate, page, maxSize: 500, companies: [], departments: [], costcenters: [], personroles: [], people: [], shifts: [], justificationTypes: [] };
    const p = await pedir(`${INTERNA}justification.svc/list`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(corpo),
    });
    if (p?.error) throw new ErroRhid(`justificativas: ${txt(p.error).slice(0, 120)}`);
    const lista: J[] = Array.isArray(p?.data) ? p.data : [];
    const linhas = lista.map((x) => ({
      cliente_id: cliente, id: Number(x?.id), pessoa_id: num(x?.idPerson), tipo_id: num(x?.idJustificationType),
      texto: txt(x?.justificativa).slice(0, 200), descricao: txt(x?.description).slice(0, 300),
      inicio: quando(x?.inicio), fim: quando(x?.fim), minutos_diurno: num(x?.minutesDiurno), minutos_noturno: num(x?.minutesNoturno),
      aprovacao: num(x?.approvalStatus), tem_arquivo: !!x?.hasFile, inserido_em: quando(x?.insertedIn), atualizado_em: agora,
    })).filter((l) => Number.isFinite(l.id) && l.inicio);
    await gravar("rhid_justificativas", linhas);
    total += linhas.length;
    if (lista.length < 500 || total >= Number(p?.recordsFiltered ?? 0)) break;
  }
  return total;
}

// Um cliente RHiD. As listas vêm da API interna do site (as da api.svc dão 500, out/2026); se uma lista
// falhar, a cópia cai para o jeito antigo: parte das pessoas e lê cada empresa e departamento pelo id.
// Relógios continuam pela api.svc (a lista interna é negada a este usuário).
async function copiarCliente(cliente: number, token: string, inicio: number) {
  const agora = new Date().toISOString();
  const hoje = diaFortaleza();
  const erros: string[] = [];
  const base = (x: J) => ({ cliente_id: cliente, id: Number(x?.id), atualizado_em: agora });
  const valido = (x: { id: number }) => Number.isFinite(x.id);

  let pessoas = await lerInterno(token, "person.svc/a", erros);
  if (!pessoas.length) pessoas = await ler(token, "/person");
  const cargos = await lerInterno(token, "personrole.svc/a", erros);
  const centros = await lerInterno(token, "costcenter.svc/a", erros);
  const escalas = await lerInterno(token, "shift.svc/a", erros);
  const justificativas = await lerInterno(token, "justificationtype.svc/a", erros);

  let empresas = await lerInterno(token, "company.svc/a", erros);
  if (!empresas.length) {
    for (const id of [...new Set(pessoas.map((x) => Number(x?.idCompany)).filter((n) => n > 0))]) {
      const x = await lerUm(token, `/company/${id}`, erros);
      if (x) empresas.push(x);
    }
  }
  let departamentos = await lerInterno(token, "department.svc/a", erros);
  if (!departamentos.length) {
    for (const id of [...new Set(pessoas.map((x) => Number(x?.idDepartment)).filter((n) => n > 0))]) {
      const x = await lerUm(token, `/department/${id}`, erros);
      if (x) departamentos.push(x);
    }
  }

  // Escala vigente: só na ficha completa, uma chamada por pessoa ativa (dentro do tempo da execução)
  const escalaDe = new Map<number, { escala_id: number | null; escala_desde: string | null }>();
  for (const p of pessoas.filter((x) => num(x?.status) === 1)) {
    if (Date.now() - inicio > ORCAMENTO_MS) { erros.push("faltou tempo para a escala de todos"); break; }
    const ficha = await lerUm(token, `${INTERNA}person.svc/a/${Number(p.id)}`, erros);
    if (ficha) escalaDe.set(Number(p.id), escalaVigente(ficha, hoje));
  }
  const idsRelogios = [...new Set([...pessoas.flatMap((x) => ids(x?.linkedDeviceIds)), ...empresas.flatMap((x) => ids(x?.linkedDeviceIds))])];
  const relogios = [];
  for (const id of idsRelogios) {
    const x = await lerUm(token, `/device/${id}`, erros);
    if (x) relogios.push(x);
  }
  // As pessoas não trazem os relógios: procura pelos ids em sequência até 3 ids seguidos sem relógio
  if (!idsRelogios.length) {
    for (let id = 1, vazios = 0; id <= 50 && vazios < 3; id++) {
      const x = await lerUm(token, `/device/${id}`, []);
      if (x && Number(x.id) === id) {
        relogios.push(x);
        vazios = 0;
      } else vazios++;
    }
  }

  await gravar("rhid_empresas", empresas.map((x) => ({
    ...base(x), cnpj: digitos(x.cnpj), nome: txt(x.name), fantasia: txt(x.tradingName),
    cidade: txt(x.city), uf: txt(x.state), pessoas: num(x.numPersons),
  })).filter(valido));
  await gravar("rhid_departamentos", departamentos.map((x) => ({
    ...base(x), nome: txt(x.name), empresa_id: num(x.idCompany),
  })).filter(valido));
  await gravar("rhid_cargos", cargos.map((x) => ({
    ...base(x), nome: txt(x.name), empresa_id: num(x.idCompany), departamento_id: num(x.idDepartment),
  })).filter(valido));
  await gravar("rhid_centros_custo", centros.map((x) => ({
    ...base(x), nome: txt(x.name), empresa_id: num(x.idCompany), pessoas: num(x.numPersons),
  })).filter(valido));
  await gravar("rhid_escalas", escalas.map((x) => ({
    ...base(x), nome: txt(x.name), tipo: txt(x.CycleTypeDescription), ciclo: num(x.cycles),
    horario: txt(x.strHorarioContratualSimples).slice(0, 300), cor: txt(x.color), pessoas: num(x.numPersons),
    dias: (Array.isArray(x.horarioContratual) ? x.horarioContratual : []).map((h: J) => ({
      dia: num(h?.day), horas: (Array.isArray(h?.entradaSaida) ? h.entradaSaida : []).map(txt).filter(Boolean), minutos: num(h?.durationMinutes),
    })),
  })).filter(valido));
  await gravar("rhid_justificativa_tipos", justificativas.map((x) => ({
    ...base(x), nome: txt(x.name), abreviacao: txt(x.abreviation), tipo: num(x.type), abona_falta: x.abonarDiaFalta == null ? null : !!x.abonarDiaFalta,
  })).filter(valido));
  await gravar("rhid_relogios", relogios.map((x) => ({
    ...base(x), nome: txt(x.name), serial: txt(x.serial), modelo: txt(x.model), versao: txt(x.version),
    situacao: txt(x.status), empresa_id: num(x.linkedCompanyId), pessoas: num(x.numberOfPeople),
    ultima_conexao: quando(x.lastConnectionDate), ultima_sincronizacao: quando(x.lastSyncDate),
  })).filter(valido));
  const linhasPessoas = pessoas.map((x) => ({
    ...base(x), nome: txt(x.name), nome_social: txt(x.socialName), cpf: digitos(x.cpf), pis: digitos(x.pis),
    matricula: txt(x.registration), empresa_id: num(x.idCompany), departamento_id: num(x.idDepartment),
    situacao: num(x.status), admissao: dia(x.admissionDate), presente: true,
    cargo_id: num(x.idPersonRole), centro_custo_id: num(x.idCostCenter), demissao: dia(x.dismissalDate),
    numero_folha: txt(x.numFolha).slice(0, 40), ...(escalaDe.get(Number(x.id)) ?? {}),
  })).filter(valido);
  await gravar("rhid_pessoas", linhasPessoas);
  // Quem não veio nesta cópia fica marcado, sem apagar
  if (linhasPessoas.length) {
    const { error } = await supabase.from("rhid_pessoas").update({ presente: false })
      .eq("cliente_id", cliente).lt("atualizado_em", agora).eq("presente", true);
    if (error) throw new Error(`marcar ausentes: ${error.message}`);
  }
  // Justificativas dos últimos 13 meses e dos próximos 4 (férias já marcadas)
  let lancadas = 0;
  try {
    lancadas = await copiarJustificativas(cliente, token, somarDias(hoje, -400), somarDias(hoje, 120));
  } catch (e) {
    erros.push(e instanceof Error ? e.message.slice(0, 120) : "erro desconhecido");
  }
  const contagem = {
    empresas: empresas.length, departamentos: departamentos.length, relogios: relogios.length, pessoas: linhasPessoas.length,
    cargos: cargos.length, centros_custo: centros.length, escalas: escalas.length, escalas_vigentes: escalaDe.size,
    tipos_justificativa: justificativas.length, justificativas: lancadas,
  };
  return erros.length ? { ...contagem, nao_lidos: erros.length, exemplo_erro: erros[0] } : contagem;
}

// ---------------------------------------------------------------------
// Ponto: apuração do dia de cada pessoa (batidas, horas, extras, atrasos, faltas, banco de horas).
// O AFD dos relógios é recusado (403) para este usuário; a apuração traz as batidas e as contas do RHiD.
// Uma chamada por pessoa e período (até 90 dias). Cada execução trabalha até ORCAMENTO_MS e para;
// a agenda chama de novo e continua de onde parou (apuracao_em e historico_ate em rhid_pessoas).
// ---------------------------------------------------------------------
const ORCAMENTO_MS = 110_000;
const RECENTES = 7; // dias refeitos a cada leitura (justificativas e ajustes mudam a apuração)
const FUTUROS = 34; // dias à frente: a escala prevista das próximas 5 semanas (a apuração traz o horário contratual)
const HISTORICO_DIAS = 365; // até onde o histórico volta
const REFAZER_MS = 2 * 3600_000; // a apuração recente de uma pessoa vale por 2 horas

const diaFortaleza = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const somarDias = (d: string, n: number) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 86400_000).toISOString().slice(0, 10);
const inteiro = (v: unknown) => Math.round(Number(v) || 0);
const hhmm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

// Um dia da apuração no formato do Brasico (minutos; batidas com hora, entrada/saída e origem)
function diaDaApuracao(cliente: number, pessoa: number, x: J, agora: string) {
  const d = dia(x?.date) ?? dia(x?.dateTimeInicio);
  if (!d) return null;
  // A lista traz também as marcações PREVISTAS da escala (classificação "F"): não são batidas
  const batidas = (Array.isArray(x?.listAfdtManutencao) ? x.listAfdtManutencao : [])
    .filter((b: J) => !b?.oculto && txt(b?._typeClassification) !== "F")
    .map((b: J) => {
      const iso = txt(b?.dateTime).match(/T(\d{2}:\d{2})/)?.[1];
      return {
        hora: iso ?? (Number.isFinite(Number(b?.hora)) ? hhmm(inteiro(b.hora)) : ""),
        tipo: txt(b?._typeEntradaSaida),
        origem: txt(b?._typeRegister),
        classificacao: txt(b?._typeClassification),
        justificada: b?.idJustification != null,
      };
    })
    .filter((b: { hora: string }) => b.hora);
  return {
    cliente_id: cliente, pessoa_id: pessoa, dia: d,
    horario: txt(x?.strHorarioContratualSimples).slice(0, 120),
    folga: !!x?.folga, feriado: Number(x?.isHoliday) > 0 || !!x?.holiday,
    falta: !!x?.faltaDiaInteiro, justificado: x?.idJustification != null, pendencia: !!x?.possuiPendencias,
    minutos_trabalhados: inteiro(x?.totalHorasTrabalhadas), minutos_extra: inteiro(x?.horasExtrasCalculadas),
    minutos_extra_noturna: inteiro(x?.extraNoturna), minutos_atraso: inteiro(x?.atrasoEntrada),
    minutos_saida_antecipada: inteiro(x?.saidaAntecipada), minutos_falta: inteiro(x?.horasApenasFalta),
    minutos_abono: inteiro(x?.minutosAbono),
    saldo_banco: x?.saldoBancoFinalDia == null ? null : inteiro(x.saldoBancoFinalDia),
    alerta: txt(x?.toolTipAlert).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300),
    batidas, atualizado_em: agora,
  };
}

async function apurar(token: string, cliente: number, pessoa: number, ini: string, fim: string) {
  const q = new URLSearchParams({ dataIni: ini, dataFinal: fim, idPerson: String(pessoa) });
  const p = await pedir(`/apuracao_ponto?${q}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  const agora = new Date().toISOString();
  const linhas = (Array.isArray(p) ? p : []).map((x: J) => diaDaApuracao(cliente, pessoa, x, agora)).filter(Boolean);
  // Um dia pode vir em mais de uma página: fica o último
  const unicos = [...new Map(linhas.map((l: J) => [l.dia, l])).values()];
  if (unicos.length) {
    const { error } = await supabase.from("rhid_dias").upsert(unicos, { onConflict: "cliente_id,pessoa_id,dia" });
    if (error) throw new Error(`gravação da apuração: ${error.message}`);
  }
  return unicos.length;
}

// Fase "recentes": os últimos dias de quem está desatualizado. Fase "historico": uma janela de 90 dias
// para trás por pessoa, até a admissão ou 1 ano. Todos os clientes passam pela 1ª fase antes da 2ª.
async function copiarPonto(cliente: number, token: string, inicio: number, fase: "recentes" | "historico") {
  const hoje = diaFortaleza();
  const { data: pessoas } = await supabase.from("rhid_pessoas")
    .select("id,admissao,apuracao_em,historico_ate,historico_fim")
    .eq("cliente_id", cliente).eq("situacao", 1).eq("presente", true)
    .order("apuracao_em", { ascending: true, nullsFirst: true });
  const r = { pessoas: 0, dias: 0, justificativas: 0, faltou_tempo: false, erros: 0, exemplo_erro: "" };
  const falhou = (e: unknown) => {
    r.erros++;
    if (!r.exemplo_erro) r.exemplo_erro = e instanceof Error ? e.message.slice(0, 160) : "erro desconhecido";
  };
  // Justificativas recentes mudam a apuração (atestado lançado hoje vale para ontem): relê 45 dias para trás,
  // mas só quando alguém vai ser apurado e a última leitura delas tem mais de 1 hora
  const vaiApurar = (pessoas ?? []).some((p) => !p.apuracao_em || Date.now() - new Date(p.apuracao_em).getTime() >= REFAZER_MS);
  if (fase === "recentes" && vaiApurar) {
    const { data: cl } = await supabase.from("rhid_clientes").select("justificativas_em").eq("id", cliente).maybeSingle();
    if (!cl?.justificativas_em || Date.now() - new Date(cl.justificativas_em).getTime() > 3600_000) {
      try {
        r.justificativas = await copiarJustificativas(cliente, token, somarDias(hoje, -45), somarDias(hoje, 120));
        await supabase.from("rhid_clientes").update({ justificativas_em: new Date().toISOString() }).eq("id", cliente);
      } catch (e) { falhou(e); }
    }
  }
  for (const p of fase === "recentes" ? pessoas ?? [] : []) {
    if (Date.now() - inicio > ORCAMENTO_MS) { r.faltou_tempo = true; break; }
    if (p.apuracao_em && Date.now() - new Date(p.apuracao_em).getTime() < REFAZER_MS) continue;
    try {
      r.dias += await apurar(token, cliente, Number(p.id), somarDias(hoje, -(RECENTES - 1)), somarDias(hoje, FUTUROS));
      await supabase.from("rhid_pessoas").update({ apuracao_em: new Date().toISOString() }).eq("cliente_id", cliente).eq("id", p.id);
      r.pessoas++;
    } catch (e) { falhou(e); }
  }
  for (const p of fase === "historico" ? pessoas ?? [] : []) {
    if (Date.now() - inicio > ORCAMENTO_MS) { r.faltou_tempo = true; break; }
    if (p.historico_fim) continue;
    const limite = [somarDias(hoje, -HISTORICO_DIAS), p.admissao ?? ""].sort().at(-1)!;
    const fim = p.historico_ate ? somarDias(p.historico_ate, -1) : somarDias(hoje, -RECENTES);
    if (fim < limite) {
      await supabase.from("rhid_pessoas").update({ historico_fim: true }).eq("cliente_id", cliente).eq("id", p.id);
      continue;
    }
    const ini = [somarDias(fim, -89), limite].sort().at(-1)!;
    try {
      r.dias += await apurar(token, cliente, Number(p.id), ini, fim);
      await supabase.from("rhid_pessoas").update({ historico_ate: ini, historico_fim: ini <= limite })
        .eq("cliente_id", cliente).eq("id", p.id);
      r.pessoas++;
    } catch (e) { falhou(e); }
  }
  return r;
}

// Tipo "agora" (a cada 10 min, de dia): o dia de hoje de quem acabou de bater e de quem tem escala hoje.
// 1. As 10 últimas batidas da empresa (util.svc/ultimasmarcacoes, uma chamada): quem bateu e a batida ainda
//    não está no dia guardado é apurado de novo (ontem e hoje: a batida da madrugada é do turno de ontem).
// 2. De hora em hora, quem tem escala hoje e não foi conferido na última hora (hoje_em).
// Não mexe em apuracao_em: a semana e a escala futura continuam com o tipo "batidas".
async function copiarAgora(cliente: number, token: string, inicio: number) {
  const hoje = diaFortaleza();
  const ontem = somarDias(hoje, -1);
  const r = { ultimas: 0, pessoas: 0, dias: 0, faltou_tempo: false, erros: 0, exemplo_erro: "" };
  const falhou = (e: unknown) => {
    r.erros++;
    if (!r.exemplo_erro) r.exemplo_erro = e instanceof Error ? e.message.slice(0, 160) : "erro desconhecido";
  };
  let ultimas: J[] = [];
  try {
    const p = await pedir("https://www.rhid.com.br/v2/util.svc/ultimasmarcacoes", { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    ultimas = Array.isArray(p) ? p : [];
  } catch (e) { falhou(e); }
  r.ultimas = ultimas.length;
  // "30/10/2026 - 12:38:00" → dia e hora de cada batida recente
  const recentes = new Map<number, string[]>();
  for (const x of ultimas) {
    const m = txt(x?.data).match(/^(\d{2})\/(\d{2})\/(\d{4})\D+(\d{2}):(\d{2})/);
    const id = Number(x?.id);
    if (!m || !Number.isFinite(id) || `${m[3]}-${m[2]}-${m[1]}` < ontem) continue;
    recentes.set(id, [...(recentes.get(id) ?? []), `${m[4]}:${m[5]}`]);
  }

  const { data: pessoas } = await supabase.from("rhid_pessoas").select("id,hoje_em")
    .eq("cliente_id", cliente).eq("situacao", 1).eq("presente", true);
  const { data: dias } = await supabase.from("rhid_dias").select("pessoa_id,dia,horario,folga,batidas")
    .eq("cliente_id", cliente).in("dia", [ontem, hoje]);
  const batidasDe = new Map<number, Set<string>>();
  for (const d of dias ?? []) {
    const s = batidasDe.get(Number(d.pessoa_id)) ?? new Set<string>();
    for (const b of (d.batidas ?? []) as { hora: string }[]) s.add(b.hora);
    batidasDe.set(Number(d.pessoa_id), s);
  }
  const ativos = new Map((pessoas ?? []).map((p) => [Number(p.id), p.hoje_em as string | null]));
  const alvo = new Map<number, string>(); // pessoa → primeiro dia a apurar
  for (const [id, hs] of recentes) {
    if (ativos.has(id) && hs.some((h) => !batidasDe.get(id)?.has(h))) alvo.set(id, ontem);
  }
  for (const d of dias ?? []) {
    const id = Number(d.pessoa_id);
    if (d.dia !== hoje || !d.horario || d.folga || !ativos.has(id) || alvo.has(id)) continue;
    const visto = ativos.get(id);
    if (!visto || Date.now() - new Date(visto).getTime() > 3600_000) alvo.set(id, hoje);
  }
  for (const [id, desde] of alvo) {
    if (Date.now() - inicio > ORCAMENTO_MS) { r.faltou_tempo = true; break; }
    try {
      r.dias += await apurar(token, cliente, id, desde, hoje);
      await supabase.from("rhid_pessoas").update({ hoje_em: new Date().toISOString() }).eq("cliente_id", cliente).eq("id", id);
      r.pessoas++;
    } catch (e) { falhou(e); }
  }
  return r;
}

async function processar(execucaoId: string) {
  const { data: ex } = await supabase.from("rhid_execucoes").select("id,status,tipo").eq("id", execucaoId).maybeSingle();
  if (!ex || ex.status !== "na_fila") return;
  await supabase.from("rhid_execucoes").update({ status: "rodando", inicio: new Date().toISOString() }).eq("id", ex.id);

  const resumo: Record<string, unknown> = {};
  const fim = (status: string, erro = "") =>
    supabase.from("rhid_execucoes").update({ status, erro: erro.slice(0, 500), fim: new Date().toISOString(), resumo }).eq("id", ex.id);

  try {
    const { data: c } = await supabase.rpc("rhid_credenciais").maybeSingle<{ email: string; senha: string }>();
    if (!c?.email || !c?.senha) throw new ErroRhid("faltam o e-mail e a senha do RHiD no Vault (rhid_email, rhid_senha)");

    const primeiro = await entrar(c.email, c.senha);
    let clientes = primeiro.clientes;
    if (!clientes.length) clientes = [{ id: 0, dominio: "", nome: "RHiD" }];
    const { error } = await supabase.from("rhid_clientes").upsert(
      clientes.map((x) => ({ id: x.id, dominio: x.dominio, nome: x.nome, atualizado_em: new Date().toISOString() })),
      { onConflict: "id", ignoreDuplicates: false },
    );
    if (error) throw new Error(`gravação de clientes: ${error.message}`);
    const { data: ativos } = await supabase.from("rhid_clientes").select("id").eq("ativo", true);
    const ligados = new Set((ativos ?? []).map((x: { id: number }) => Number(x.id)));

    const inicio = Date.now();
    const falhas: string[] = [];
    const tokens = new Map<number, string>();
    const fases = ex.tipo === "batidas" ? ["recentes", "historico"] as const : ex.tipo === "agora" ? ["agora"] as const : ["cadastros"] as const;
    for (const fase of fases) {
      for (const cl of clientes) {
        if (!ligados.has(cl.id)) continue;
        const nome = fase === "historico" ? `${cl.nome || cl.id} (histórico)` : cl.nome || String(cl.id);
        try {
          // Com um cliente só, o token do primeiro login já serve; com vários, entra de novo no domínio de cada um
          let token = tokens.get(cl.id) ?? "";
          if (!token) {
            token = clientes.length === 1 && primeiro.token ? primeiro.token : (await entrar(c.email, c.senha, cl.dominio)).token;
            if (!token) throw new ErroRhid("login sem token");
            tokens.set(cl.id, token);
          }
          resumo[nome] = fase === "cadastros" ? await copiarCliente(cl.id, token, inicio)
            : fase === "agora" ? await copiarAgora(cl.id, token, inicio)
            : await copiarPonto(cl.id, token, inicio, fase);
        } catch (e) {
          const msg = e instanceof Error ? e.message : "erro desconhecido";
          falhas.push(`${nome}: ${msg}`);
          resumo[nome] = { erro: msg };
        }
      }
    }
    await fim(falhas.length && falhas.length >= Object.keys(resumo).length ? "falha" : "ok", falhas.join("; "));
    console.log(JSON.stringify({ integracao: "rhid", correlation_id: ex.id, clientes: clientes.length, falhas: falhas.length }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "erro desconhecido";
    await fim("falha", msg);
    console.log(JSON.stringify({ integracao: "rhid", correlation_id: ex.id, status: "falha", erro: msg }));
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Use POST", { status: 405 });
  const { data: ok } = await supabase.rpc("rhid_conferir_segredo", { p_segredo: req.headers.get("x-segredo") ?? "" });
  if (!ok) return new Response("Sem permissão", { status: 401 });
  const corpo = await req.json().catch(() => ({}));
  const id = String(corpo.execucao ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Falta a execução", { status: 400 });
  EdgeRuntime.waitUntil(processar(id));
  return new Response(JSON.stringify({ recebido: id }), { headers: { "Content-Type": "application/json" } });
});
