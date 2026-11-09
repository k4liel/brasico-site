// Motor de regras da escala planejada: confere a escala de cada pessoa com a lei e avisa o que sai do padrão.
// Regras do capítulo 16 do projeto RH Inteligente ("as regras que toda escala precisa respeitar") e da
// convenção de Pipa RN000194/2026 com o aditivo RN000207/2026 (projeto Leis, capítulo 03):
//   jornada até 10 h por dia · 11 h entre jornadas · intervalo de 30 min a 2 h acima de 6 h (15 min de 4 a 6 h)
//   · nunca 7 dias seguidos · horas e folgas da semana (44 h e 1 folga; 42 h e 2 folgas a partir de
//   16/12/2026; 40 h a partir de 16/12/2027 — EC 141/2026) · domingo de folga a cada 3 semanas (mulheres,
//   a cada 2) e domingo trabalhado sem folga na semana pago em dobro · feriado trabalhado com folga em até
//   60 dias depois (ou 30 antes) · férias sem período menor que 5 dias e sem começar nos 2 dias antes de
//   feriado ou folga · 12x36 só com acordo escrito.
// Tudo é calculado na tela, na hora em que a escala é montada; nada é gravado.

export type Codigo = "" | "T" | "F" | "FC" | "FE" | "AT" | "BH" | "LIC";
// posto: onde a pessoa fica no dia, nos grupos que revezam (ex.: Cozinha ou Produção na Cozinha do Sempre Vivo)
export type DiaPlano = { codigo: Codigo; entrada?: string | null; saida?: string | null; intervalo?: string | null; obs?: string; posto?: string | null };
export type Nivel = "erro" | "aviso" | "info";
export type Aviso = { chave: string; nome: string; nivel: Nivel; titulo: string; texto: string; lei: string; dias: string[]; regra: string };

export const CODIGOS: { codigo: Exclude<Codigo, "" | "T">; nome: string; curto: string; descanso: boolean }[] = [
  { codigo: "F", nome: "Folga", curto: "F", descanso: true },
  { codigo: "FC", nome: "Folga compensada (feriado)", curto: "FC", descanso: true },
  { codigo: "BH", nome: "Folga do banco de horas", curto: "BH", descanso: true },
  { codigo: "FE", nome: "Férias", curto: "FÉR", descanso: false },
  { codigo: "AT", nome: "Atestado", curto: "AT", descanso: false },
  { codigo: "LIC", nome: "Licença", curto: "LIC", descanso: false },
];

const DIA = 86400000;
const somar = (d: string, n: number) => new Date(Date.parse(d) + n * DIA).toISOString().slice(0, 10);
const dow = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();
const br = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
export const minutos = (hm?: string | null) => {
  const m = hm?.match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
export const horasTxt = (min: number) => `${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, "0")}`;
const relogio = (min: number) => `${String(Math.floor((min % 1440) / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

// Entrada e saída em minutos desde o começo do dia (saída depois da meia-noite passa de 1440), intervalo e jornada
export function jornada(d: DiaPlano | undefined) {
  if (!d || d.codigo !== "T") return null;
  const a = minutos(d.entrada), b0 = minutos(d.saida);
  if (a == null || b0 == null) return null;
  const b = b0 <= a ? b0 + 1440 : b0;
  let intervalo: number | null = null;
  const iv = d.intervalo?.match(/^(\d{2}:\d{2})-(\d{2}:\d{2})$/);
  if (iv) {
    const i1 = minutos(iv[1])!, i2 = minutos(iv[2])!;
    intervalo = i2 >= i1 ? i2 - i1 : i2 + 1440 - i1;
  }
  const bruto = b - a;
  // Sem intervalo informado: acima de 6 h conta 1 h (o que a CLT pede), para a soma da semana
  const liquido = bruto - (intervalo ?? (bruto > 360 ? 60 : bruto > 240 ? 15 : 0));
  return { inicio: a, fim: b, bruto, intervalo, liquido };
}

// Limites da semana pela data da segunda-feira (EC 141/2026, art. 6º)
export function limitesDaSemana(segunda: string) {
  if (segunda >= "2027-12-13") return { horas: 40 * 60, folgas: 2, base: "EC 141/2026, art. 6º, II (40 h e 2 folgas desde 16/12/2027)" };
  if (segunda >= "2026-12-14") return { horas: 42 * 60, folgas: 2, base: "EC 141/2026, art. 6º, I (42 h e 2 folgas desde 16/12/2026)" };
  return { horas: 44 * 60, folgas: 1, base: "CF, art. 7º, XIII e XV" };
}

const segundaDe = (d: string) => somar(d, -((dow(d) + 6) % 7));

// Confere a escala de uma pessoa nos dias carregados e devolve os avisos
export function avaliar(chave: string, nome: string, plano: Map<string, DiaPlano>, feriados: Set<string>): Aviso[] {
  const avisos: Aviso[] = [];
  const add = (nivel: Nivel, regra: string, titulo: string, texto: string, lei: string, dias: string[]) =>
    avisos.push({ chave, nome, nivel, regra, titulo, texto, lei, dias });
  const dias = [...plano.keys()].filter((d) => plano.get(d)!.codigo !== "").sort();
  if (!dias.length) return avisos;
  const trab = (d: string) => plano.get(d)?.codigo === "T";
  const temPlano = (d: string) => (plano.get(d)?.codigo ?? "") !== "";

  for (const d of dias) {
    const j = jornada(plano.get(d));
    if (!j) continue;
    // Jornada do dia (12x36: plantão de até 12 h com o dia antes e o depois livres)
    const livre = (x: string) => ["F", "FC", "BH"].includes(plano.get(x)?.codigo ?? "");
    const plantao = j.liquido > 600 && j.liquido <= 720 && livre(somar(d, -1)) && livre(somar(d, 1));
    if (plantao) add("info", "12x36", "Plantão 12x36", `${br(d)}: ${horasTxt(j.liquido)} de trabalho com folga antes e depois. Só vale com acordo escrito com a pessoa.`, "CLT, art. 59-A; CCT 34ª", [d]);
    else if (j.liquido > 600) add("erro", "jornada", "Mais de 10 h no dia", `${br(d)}: ${horasTxt(j.liquido)} de trabalho. O máximo é 8 h mais 2 extras.`, "CLT, art. 59; CCT 28ª", [d]);
    // Intervalo
    if (j.bruto > 360) {
      if (j.intervalo == null) add("aviso", "intervalo", "Sem intervalo", `${br(d)}: jornada de ${horasTxt(j.bruto)} sem intervalo marcado. Acima de 6 h, o intervalo é de 30 min a 2 h.`, "CLT, art. 71; CCT 29ª", [d]);
      else if (j.intervalo < 30) add("erro", "intervalo", "Intervalo curto", `${br(d)}: intervalo de ${j.intervalo} min. Acima de 6 h de jornada, o mínimo é 30 min.`, "CLT, art. 71; CCT 29ª", [d]);
      else if (j.intervalo > 120) add("aviso", "intervalo", "Intervalo longo", `${br(d)}: intervalo de ${horasTxt(j.intervalo)}. Acima de 2 h, a CCT manda pagar 5% do piso por mês.`, "CCT 29ª", [d]);
    } else if (j.bruto > 240 && (j.intervalo ?? 0) < 15) {
      add("aviso", "intervalo", "Intervalo de 15 min", `${br(d)}: jornada de ${horasTxt(j.bruto)} pede 15 min de intervalo.`, "CLT, art. 71, § 1º; CCT 29ª", [d]);
    }
    // 11 h entre jornadas
    const prox = jornada(plano.get(somar(d, 1)));
    if (prox) {
      const descanso = 1440 + prox.inicio - j.fim;
      if (descanso < 660) add("erro", "interjornada", "Menos de 11 h de descanso", `Sai ${br(d)} às ${relogio(j.fim)} e volta ${br(somar(d, 1))} às ${plano.get(somar(d, 1))!.entrada}: só ${horasTxt(Math.max(0, descanso))} de descanso. O mínimo é 11 h.`, "CLT, art. 66", [d, somar(d, 1)]);
    }
    // Feriado trabalhado: folga compensada em até 60 dias depois (ou 30 antes)
    if (feriados.has(d)) {
      const compensa = Array.from({ length: 91 }, (_, i) => somar(d, i - 30)).some((x) => plano.get(x)?.codigo === "FC");
      if (!compensa) add("aviso", "feriado", "Feriado trabalhado", `${br(d)} é feriado e está na escala. Dê uma folga compensada (FC) em até 60 dias, ou ele é pago em dobro.`, "Lei 605/1949, art. 9º; Súmula 146 do TST; CCT 33ª", [d]);
    }
  }

  // Nunca 7 dias seguidos
  let seguidos: string[] = [];
  for (let d = dias[0]; d <= dias[dias.length - 1]; d = somar(d, 1)) {
    if (trab(d)) {
      seguidos.push(d);
      if (seguidos.length === 7) add("erro", "seguidos", "7 dias seguidos", `De ${br(seguidos[0])} a ${br(d)} sem folga. A folga tem de vir até o 7º dia, senão o dia é pago em dobro.`, "OJ 410 da SDI-1 do TST; CLT, art. 67", [...seguidos]);
    } else seguidos = [];
  }

  // Semanas completas (segunda a domingo): horas e folgas
  const semanas = [...new Set(dias.map(segundaDe))];
  for (const seg of semanas) {
    const ds = Array.from({ length: 7 }, (_, i) => somar(seg, i));
    if (!ds.every(temPlano)) continue;
    const lim = limitesDaSemana(seg);
    const horas = ds.reduce((t, d) => t + (jornada(plano.get(d))?.liquido ?? 0), 0);
    const folgas = ds.filter((d) => !trab(d)).length;
    if (folgas < lim.folgas) add("erro", "folga-semana", folgas ? "Falta folga na semana" : "Semana sem folga", `Semana de ${br(seg)}: ${folgas} folga${folgas === 1 ? "" : "s"}. O mínimo é ${lim.folgas}.`, `CLT, art. 67; ${lim.base}`, ds.filter(trab));
    if (horas > lim.horas) add("aviso", "horas-semana", "Horas da semana", `Semana de ${br(seg)}: ${horasTxt(horas)} planejadas, acima de ${horasTxt(lim.horas)}. O que passar vira hora extra (60%) ou banco de horas.`, `${lim.base}; CCT 27ª e 28ª`, ds.filter(trab));
    // Domingo trabalhado sem outra folga na mesma semana: pago em dobro
    const dom = ds[6];
    if (trab(dom) && folgas === 0) add("aviso", "domingo-dobro", "Domingo em dobro", `Domingo ${br(dom)} trabalhado sem folga na semana: é pago em dobro.`, "CCT 30ª; Lei 605/1949", [dom]);
  }

  // Domingos de folga: homens, 1 a cada 3 semanas; mulheres, 1 a cada 2 (o RHiD não diz o sexo: avisa os dois)
  const domingos = dias.filter((d) => dow(d) === 0).sort();
  let corrida: string[] = [];
  for (const d of domingos) {
    if (corrida.length && somar(corrida[corrida.length - 1], 7) !== d) corrida = [];
    if (trab(d)) {
      corrida.push(d);
      if (corrida.length === 3) add("erro", "domingo", "3 domingos seguidos", `Domingos ${corrida.map(br).join(", ")} trabalhados. A folga no domingo tem de vir pelo menos a cada 3 semanas.`, "CCT 30ª (aditivo RN000207/2026); CLT, art. 67", [...corrida]);
      else if (corrida.length === 2) add("aviso", "domingo", "2 domingos seguidos", `Domingos ${corrida.map(br).join(" e ")} trabalhados. Se for mulher, a folga no domingo é a cada 2 semanas.`, "CLT, art. 386; CCT 30ª", [...corrida]);
    } else corrida = [];
  }

  // Férias: nenhum período menor que 5 dias; não começar nos 2 dias antes de feriado ou folga
  for (let i = 0; i < dias.length; i++) {
    const d = dias[i];
    if (plano.get(d)?.codigo !== "FE" || plano.get(somar(d, -1))?.codigo === "FE") continue;
    const bloco = [d];
    while (plano.get(somar(bloco[bloco.length - 1], 1))?.codigo === "FE") bloco.push(somar(bloco[bloco.length - 1], 1));
    const fim = somar(bloco[bloco.length - 1], 1);
    if (bloco.length < 5 && plano.get(fim) !== undefined) add("aviso", "ferias", "Férias curtas", `Férias de ${bloco.length} dia${bloco.length === 1 ? "" : "s"} (${br(d)}). Nenhum período pode ter menos de 5 dias.`, "CLT, art. 134, § 1º", bloco);
    const perto = [somar(d, 1), somar(d, 2)].find((x) => feriados.has(x) || ["F", "FC", "BH"].includes(plano.get(x)?.codigo ?? ""));
    if (perto) add("erro", "ferias-inicio", "Início das férias", `Férias começam em ${br(d)}, nos 2 dias antes de ${feriados.has(perto) ? "um feriado" : "uma folga"} (${br(perto)}).`, "CLT, art. 134, § 3º", [d]);
  }
  return avisos;
}

// Mudança na escala com menos de 7 dias: a regra da casa pede aceite registrado da pessoa
export const ANTECEDENCIA = { dias: 7, lei: "CLT, art. 468; regra da casa (RH Inteligente, cap. 16)" };
