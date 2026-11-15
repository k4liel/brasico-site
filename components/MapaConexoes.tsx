"use client";

// Mapa das conexões da página Integrações (/integracoes). Três jeitos de ver, escolhidos no seletor do topo
// (15/11/2026, o dono gostou das três prévias e pediu as três):
//   Central  — o Brasico como núcleo e cada sistema num cartão com a barra de 24 h; curvas com fluxo
//   Fluxo    — de onde vem cada dado → Brasico → em que página ele aparece
//   Órbita   — cada ligação é a linha do tempo das últimas 24 h, um tracinho por hora
// Tudo vem dos mesmos dados do painel (lib/integracoes.ts). Sem neon: cores e fontes do Brasico, movimento curto,
// e nada se mexe para quem pediu menos movimento no aparelho. CSS no bloco "Integrações" de globals.css (ig-mc-*).
import { useEffect, useRef, useState } from "react";
import { estadoHora, type Estado, type Hora, type Integracao } from "@/lib/integracoes";

type Vista = "central" | "fluxo" | "orbita";
const VISTAS: [Vista, string][] = [["central", "Central"], ["fluxo", "Fluxo dos dados"], ["orbita", "Órbita 24 h"]];
const CHAVE = "brasico-ig-mapa";
const TEXTO_ESTADO: Record<Estado, string> = { ok: "Funcionando", atencao: "Atenção", erro: "Parada", pausa: "Pausada" };
const GRUPO_TITULO: Record<string, string> = { governo: "Governo", casas: "Sistemas das casas", comunicacao: "Comunicação e IA" };

// Nomes que cabem no mapa (o completo fica no rodapé e no detalhe)
const NOME: Record<string, string> = { claude: "Claude · resumo", cicchetti: "Cicchetti", certificados: "Certificados" };
const nome = (i: Integracao) => NOME[i.id] ?? i.nome;
const curta = (f: string, max = 30) => { const s = f.replace(/^última leitura /i, ""); return s.length > max ? `${s.slice(0, max - 1)}…` : s; };
const total = (i: Integracao) => (i.horas ? i.horas.reduce((s, [a, b]) => s + a + b, 0) : null);
const espessura = (n: number | null) => 1.2 + Math.min(3.6, Math.log2(1 + (n ?? 0)) / 1.7);
const ritmo = (n: number | null) => Math.max(1.2, 4.2 - Math.log2(1 + (n ?? 0)) / 2.2); // segundos: mais leituras, fluxo mais rápido
const corHora = (h: Hora) => { const e = estadoHora(h); return e === "vazio" ? "sem" : e; };
const anda = (i: Integracao) => i.estado === "ok" || i.estado === "atencao";
const sai = (i: Integracao) => i.id === "conector"; // o conector lê do Brasico; os outros trazem dados para ele
const mil = (n: number) => n.toLocaleString("pt-BR");

// Em que página do site aparece o que cada sistema traz
const PAGINAS = [
  { id: "fiscal", nome: "Fiscal", href: "/receita" },
  { id: "notas", nome: "Notas fiscais", href: "/notas" },
  { id: "precos", nome: "Índice de preços", href: "/precos" },
  { id: "rh", nome: "RH · eSocial", href: "/esocial" },
  { id: "escala", nome: "Escala", href: "/escala" },
  { id: "vendas", nome: "Faturamento", href: "/vendas" },
  { id: "hoteis", nome: "Hotéis", href: "/hoteis/filha-da-lua" },
  { id: "compras", nome: "Compras", href: "/compras" },
  { id: "whatsapp", nome: "WhatsApp", href: "/whatsapp" },
  { id: "projetos", nome: "Projetos", href: "/" },
  { id: "claude", nome: "Claude dos sócios", href: "/usuarios" },
];
const DESTINOS: Record<string, string[]> = {
  receita: ["fiscal"], esocial: ["rh"], notas: ["notas", "precos", "compras"], nfse: ["notas", "fiscal"],
  certificados: ["fiscal", "rh", "notas"], totvs: ["vendas"], cicchetti: ["claude"], pms: ["hoteis", "vendas"],
  rhid: ["escala", "rh"], whatsapp: ["whatsapp", "compras"], gemini: ["compras"], claude: ["whatsapp"], conector: ["projetos", "claude"],
};

type Props = {
  lista: Integracao[]; mov: boolean; novos: Set<string>; leituras: number;
  d: (id: string) => string; // classe de esmaecer/destacar
  alvo: (i: Integracao) => React.SVGProps<SVGGElement>;
  focarPagina: (p: string | null) => void;
};

export default function MapaConexoes({ lista, novos, onAbrir }: { lista: Integracao[]; novos: Set<string>; onAbrir: (id: string) => void }) {
  const [vista, setVista] = useState<Vista>("central");
  const [mov, setMov] = useState(false);
  const [foco, setFoco] = useState<string | null>(null);
  const [pagina, setPagina] = useState<string | null>(null);
  useEffect(() => {
    setMov(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    try { const v = localStorage.getItem(CHAVE); if (VISTAS.some(([x]) => x === v)) setVista(v as Vista); } catch { /* sem armazenamento */ }
  }, []);
  // No celular o mapa rola de lado: começa centrado no Brasico
  const rolar = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = rolar.current; if (el && el.scrollWidth > el.clientWidth) el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2; }, [vista]);
  const trocar = (v: Vista) => { setVista(v); setFoco(null); setPagina(null); try { localStorage.setItem(CHAVE, v); } catch { /* ok */ } };

  const daPagina = pagina ? lista.filter((i) => DESTINOS[i.id]?.includes(pagina)).map((i) => i.id) : null;
  const ligados = foco ? [foco] : daPagina;
  const d = (id: string) => `ig-mc-d ${ligados?.includes(id) ? "on" : ""}`;
  const alvo = (i: Integracao): React.SVGProps<SVGGElement> => ({
    tabIndex: 0, role: "button", "aria-label": `${i.nome}: ${TEXTO_ESTADO[i.estado]}. ${i.frase}. Abrir detalhes`,
    onMouseEnter: () => setFoco(i.id), onMouseLeave: () => setFoco(null), onFocus: () => setFoco(i.id), onBlur: () => setFoco(null),
    onClick: () => onAbrir(i.id),
    onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onAbrir(i.id); } },
  });
  // mesma conta do gráfico de atividade: leituras boas, sem as mensagens do WhatsApp
  const leituras = lista.filter((i) => i.id !== "whatsapp").reduce((s, i) => s + (i.horas ?? []).reduce((t, h) => t + h[0], 0), 0);
  const props: Props = { lista, mov, novos, leituras, d, alvo, focarPagina: setPagina };
  const sel = foco ? lista.find((i) => i.id === foco) : null;
  const pag = pagina ? PAGINAS.find((p) => p.id === pagina) : null;

  return (
    <div className={`ig-caixa ig-mc ig-entra ${ligados ? "com-foco" : ""}`} style={{ "--i": 1 } as React.CSSProperties}>
      <div className="ig-caixa-cabeca ig-mc-cabeca">
        <div><h2>Mapa das conexões</h2><span>{lista.length} sistemas · {mil(leituras)} leituras em 24 h</span></div>
        <div className="ig-segmento" role="group" aria-label="Jeito de ver o mapa">
          {VISTAS.map(([v, t]) => <button key={v} className={vista === v ? "on" : ""} onClick={() => trocar(v)} aria-pressed={vista === v}>{t}</button>)}
        </div>
      </div>
      <div className="ig-mc-palco">
        <div className="ig-mc-grade" aria-hidden="true" />
        <div className="ig-mc-rolar" ref={rolar}>
          {vista === "central" ? <Central {...props} /> : vista === "fluxo" ? <Fluxo {...props} /> : <Orbita {...props} />}
        </div>
      </div>
      <div className="ig-mc-rodape" aria-live="polite">
        {sel ? (
          <p className={`ig-mc-info ${sel.estado}`}>
            <i aria-hidden="true" /><b>{sel.nome}</b><span className="ig-mc-info-estado">{TEXTO_ESTADO[sel.estado]}</span>
            <span>{sel.frase}</span>
            {total(sel) != null && <span>{mil(total(sel)!)} {sel.horasRotulo ?? "leituras"} em 24 h</span>}
            <em>clique para ver o detalhe</em>
          </p>
        ) : pag ? (
          <p className="ig-mc-info pagina">
            <b>{pag.nome}</b><span>recebe de {lista.filter((i) => daPagina?.includes(i.id)).map((i) => i.nome).join(", ")}</span><em>clique para abrir</em>
          </p>
        ) : (
          <div className="ig-legenda">
            {(["ok", "atencao", "erro", "pausa"] as Estado[]).map((e) => <span key={e} className={e}><i />{TEXTO_ESTADO[e]}</span>)}
            <span className="ig-mc-dica">{vista === "orbita" ? "cada ligação: 24 h, do centro (há 24 h) até o sistema (agora)" : "linha mais grossa = mais leituras"}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// Ponto que anda por um caminho (começa já no meio do trajeto, para não ficar parado no canto)
function Pacote({ caminho, dur, atraso, volta, r = 2.6, className = "" }: { caminho: string; dur: number; atraso: number; volta?: boolean; r?: number; className?: string }) {
  return (
    <circle r={r} className={`ig-mc-pacote ${className}`}>
      <animateMotion dur={`${dur}s`} repeatCount="indefinite" begin={`${-(atraso % dur) - 0.2}s`}
        keyPoints={volta ? "1;0" : "0;1"} keyTimes="0;1" calcMode="spline" keySplines=".4 0 .6 1">
        <mpath href={`#${caminho}`} />
      </animateMotion>
    </circle>
  );
}

function Onda({ i, cx, cy }: { i: Integracao; cx: number; cy: number }) {
  return i.estado === "erro" || i.estado === "atencao" ? <circle cx={cx} cy={cy} r={7} className="ig-no-onda" /> : null;
}

// ---------- Central: núcleo, cartões e curvas ----------
function Central({ lista, mov, novos, leituras, d, alvo }: Props) {
  const W = 1160, H = 600, cx = W / 2, cy = H / 2, cw = 220, ch = 76;
  type Pos = { x: number; y: number; lado: "esq" | "dir" | "cima" | "baixo" };
  const pos: Record<string, Pos> = {};
  const coluna = (l: Integracao[], x: number, lado: Pos["lado"]) => {
    const topo = 52, fim = H - 12, passo = l.length > 1 ? (fim - topo - ch) / (l.length - 1) : 0;
    l.forEach((i, k) => { pos[i.id] = { x, y: l.length > 1 ? topo + k * passo : cy - ch / 2, lado }; });
  };
  const linha = (l: Integracao[], y: number, lado: Pos["lado"]) => {
    const gap = 24, larg = l.length * cw + (l.length - 1) * gap;
    l.forEach((i, k) => { pos[i.id] = { x: cx - larg / 2 + k * (cw + gap), y, lado }; });
  };
  const com = lista.filter((i) => i.grupo === "comunicacao"), meio = Math.ceil(com.length / 2);
  coluna(lista.filter((i) => i.grupo === "governo"), 16, "esq");
  coluna(lista.filter((i) => i.grupo === "casas"), W - 16 - cw, "dir");
  linha(com.slice(0, meio), 36, "cima");
  linha(com.slice(meio), H - 12 - ch, "baixo");

  const caminho = ({ x, y, lado }: Pos) => {
    if (lado === "esq" || lado === "dir") {
      const ax = lado === "esq" ? x + cw : x, ay = y + ch / 2, bx = cx + (lado === "esq" ? -62 : 62), by = cy + (ay - cy) * 0.3, mx = (ax + bx) / 2;
      return `M${ax} ${ay} C${mx} ${ay}, ${mx} ${by}, ${bx} ${by}`;
    }
    const ax = x + cw / 2, ay = lado === "cima" ? y + ch : y, bx = cx + (ax - cx) * 0.3, by = cy + (lado === "cima" ? -62 : 62), my = (ay + by) / 2;
    return `M${ax} ${ay} C${ax} ${my}, ${bx} ${my}, ${bx} ${by}`;
  };
  const xCom = com[0] ? pos[com[0].id].x : cx;

  return (
    <svg className="ig-mc-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Mapa das conexões: o Brasico no meio e cada sistema num cartão">
      <defs>
        <radialGradient id="ig-mc-brilho"><stop offset="0%" style={{ stopColor: "var(--gold)", stopOpacity: 0.2 }} /><stop offset="100%" style={{ stopColor: "var(--gold)", stopOpacity: 0 }} /></radialGradient>
      </defs>
      <circle cx={cx} cy={cy} r={170} fill="url(#ig-mc-brilho)" />
      <text x={16} y={36} className="ig-mc-grupo">GOVERNO</text>
      <text x={W - 16} y={36} textAnchor="end" className="ig-mc-grupo">SISTEMAS DAS CASAS</text>
      <text x={xCom} y={24} className="ig-mc-grupo">COMUNICAÇÃO E IA</text>

      {lista.map((i, k) => {
        const n = total(i), id = `ig-mc-c-${i.id}`;
        return (
          <g key={`e-${i.id}`} className={`ig-mc-elo ${i.estado} ${sai(i) ? "sai" : ""} ${d(i.id)}`}>
            <path d={caminho(pos[i.id])} className="ig-mc-trilho" strokeWidth={espessura(n) + 3} />
            <path id={id} d={caminho(pos[i.id])} className="ig-mc-fio" strokeWidth={espessura(n)} style={{ animationDuration: `${ritmo(n)}s` }} />
            {mov && anda(i) && <Pacote caminho={id} dur={2.6 + (k % 4) * 0.4} atraso={k * 0.37} volta={sai(i)} r={2.8} />}
          </g>
        );
      })}

      <g className="ig-mc-nucleo-g">
        {mov && (
          <g className="ig-mc-giro" style={{ transformOrigin: `${cx}px ${cy}px` }}>
            {Array.from({ length: 72 }, (_, k) => {
              const a = (k / 72) * Math.PI * 2, forte = k % 6 === 0, r1 = 86, r2 = forte ? 96 : 91;
              return <line key={k} x1={cx + r1 * Math.cos(a)} y1={cy + r1 * Math.sin(a)} x2={cx + r2 * Math.cos(a)} y2={cy + r2 * Math.sin(a)} className={forte ? "forte" : ""} />;
            })}
          </g>
        )}
        <circle cx={cx} cy={cy} r={74} className="ig-mc-nucleo" />
        <circle cx={cx} cy={cy} r={66} className="ig-mc-nucleo-linha" />
        <text x={cx} y={cy - 8} textAnchor="middle" className="ig-mc-marca">Brasico</text>
        <text x={cx} y={cy + 15} textAnchor="middle" className="ig-mc-sub">{mil(leituras)} leituras · 24 h</text>
        <text x={cx} y={cy + 33} textAnchor="middle" className="ig-mc-vivo">● ao vivo</text>
      </g>

      {lista.map((i) => {
        const { x, y } = pos[i.id], n = total(i);
        return (
          <g key={i.id} className={`ig-mc-no ${i.estado} ${novos.has(i.id) ? "novo" : ""} ${d(i.id)}`} {...alvo(i)}>
            <title>{`${i.nome}: ${TEXTO_ESTADO[i.estado]} · ${i.frase}`}</title>
            <rect x={x} y={y} width={cw} height={ch} rx={12} className="ig-mc-cartao" />
            <rect x={x} y={y + 14} width={3} height={ch - 28} rx={1.5} className="ig-mc-faixa" />
            <Onda i={i} cx={x + 20} cy={y + 22} />
            <circle cx={x + 20} cy={y + 22} r={4.5} className="ig-mc-ponto" />
            <text x={x + 32} y={y + 26} className="ig-mc-nome">{nome(i)}</text>
            {n != null && <text x={x + cw - 14} y={y + 26} textAnchor="end" className="ig-mc-num">{mil(n)}</text>}
            <text x={x + 16} y={y + 45} className={`ig-mc-frase ${i.estado}`}>{curta(i.frase, 34)}</text>
            {i.horas ? i.horas.map((h, k) => {
              const bw = (cw - 32) / 24;
              return <rect key={k} x={x + 16 + k * bw} y={y + 54} width={bw - 1.6} height={10} rx={1.5} className={`ig-mc-h ${corHora(h)}`} />;
            }) : <text x={x + 16} y={y + 64} className="ig-mc-frase">{i.numeros[0] ? curta(`${i.numeros[0].rotulo}: ${i.numeros[0].valor}`, 36) : ""}</text>}
          </g>
        );
      })}
    </svg>
  );
}

// ---------- Fluxo: de onde vem → Brasico → onde aparece ----------
function Fluxo({ lista, mov, novos, leituras, d, alvo, focarPagina }: Props) {
  const W = 1160, xa = 16, wa = 232, wc = 124, xc = W / 2 - wc / 2, wb = 196, xb = W - 16 - wb;
  const fy: Record<string, number> = {};
  const rotulos: { t: string; y: number }[] = [];
  let y = 44;
  for (const g of ["governo", "casas", "comunicacao"]) {
    const doGrupo = lista.filter((i) => i.grupo === g);
    if (!doGrupo.length) continue;
    rotulos.push({ t: GRUPO_TITULO[g].toUpperCase(), y: y + 10 }); y += 20;
    for (const i of doGrupo) { fy[i.id] = y; y += 36; }
    y += 12;
  }
  const H = y + 4, cTop = 40, cBot = H - 12;
  const paginas = PAGINAS.filter((p) => lista.some((i) => DESTINOS[i.id]?.includes(p.id)));
  const passo = (cBot - cTop - 28) / Math.max(1, paginas.length - 1);
  const py: Record<string, number> = Object.fromEntries(paginas.map((p, k) => [p.id, cTop + k * passo]));
  // onde cada fonte entra no núcleo: espaço proporcional ao volume
  const peso = (i: Integracao) => Math.log2(2 + (total(i) ?? 0));
  const soma = lista.reduce((s, i) => s + peso(i), 0);
  const entra: Record<string, number> = {};
  let acc = cTop + 70;
  for (const i of lista) { const h = (peso(i) / soma) * (cBot - cTop - 110); entra[i.id] = acc + h / 2; acc += h; }
  const curva = (x1: number, y1: number, x2: number, y2: number) => { const mx = (x1 + x2) / 2; return `M${x1} ${y1} C${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`; };

  return (
    <svg className="ig-mc-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Fluxo dos dados: de onde vem cada dado, o Brasico e as páginas onde ele aparece">
      <text x={xa} y={20} className="ig-mc-grupo">DE ONDE VEM</text>
      <text x={xc + wc / 2} y={20} textAnchor="middle" className="ig-mc-grupo">O BRASICO GUARDA</text>
      <text x={xb + wb} y={20} textAnchor="end" className="ig-mc-grupo">ONDE APARECE</text>
      {rotulos.map((r) => <text key={r.t} x={xa} y={r.y} className="ig-mc-grupo fraco">{r.t}</text>)}

      {lista.map((i, k) => {
        const n = total(i), id = `ig-mc-f-${i.id}`, ya = fy[i.id] + 14, yb = entra[i.id];
        const qtos = !mov || !anda(i) ? 0 : (n ?? 0) > 40 ? 3 : (n ?? 0) > 8 ? 2 : 1;
        return (
          <g key={`e-${i.id}`}>
            <g className={`ig-mc-elo fluxo ${i.estado} ${d(i.id)}`}>
              <path id={id} d={curva(xa + wa, ya, xc, yb)} className="ig-mc-faixa-fonte" strokeWidth={espessura(n) * 1.7} />
              {Array.from({ length: qtos }, (_, j) => <Pacote key={j} caminho={id} dur={ritmo(n) + 1} atraso={j * 1.6 + k * 0.21} volta={sai(i)} r={2.4} />)}
            </g>
            {(DESTINOS[i.id] ?? []).filter((p) => py[p] != null).map((p, j) => {
              const id2 = `ig-mc-f2-${i.id}-${p}`;
              return (
                <g key={p} className={`ig-mc-elo destino ${d(i.id)}`}>
                  <path id={id2} d={curva(xc + wc, yb, xb, py[p] + 14)} className="ig-mc-faixa-destino" strokeWidth={espessura(n) * 1.1} />
                  {mov && anda(i) && <Pacote caminho={id2} dur={3.2 + (k % 3) * 0.5} atraso={k * 0.5 + j} r={2} className="ouro" volta={sai(i)} />}
                </g>
              );
            })}
          </g>
        );
      })}

      {lista.map((i) => {
        const yy = fy[i.id], n = total(i);
        return (
          <g key={i.id} className={`ig-mc-no ${i.estado} ${novos.has(i.id) ? "novo" : ""} ${d(i.id)}`} {...alvo(i)}>
            <title>{`${i.nome}: ${TEXTO_ESTADO[i.estado]} · ${i.frase}`}</title>
            <rect x={xa} y={yy} width={wa} height={28} rx={8} className="ig-mc-cartao" />
            <Onda i={i} cx={xa + 14} cy={yy + 14} />
            <circle cx={xa + 14} cy={yy + 14} r={4} className="ig-mc-ponto" />
            <text x={xa + 26} y={yy + 18.5} className="ig-mc-nome menor">{nome(i)}</text>
            <text x={xa + wa - 10} y={yy + 18.5} textAnchor="end" className={`ig-mc-num ${i.estado}`}>{n != null ? `${mil(n)} / 24 h` : curta(i.frase, 14)}</text>
          </g>
        );
      })}

      <rect x={xc} y={cTop} width={wc} height={cBot - cTop} rx={18} className="ig-mc-nucleo" />
      {Array.from({ length: Math.floor((cBot - cTop - 110) / 14) }, (_, k) => (
        <line key={k} x1={xc + 16} x2={xc + wc - 16} y1={cTop + 70 + k * 14} y2={cTop + 70 + k * 14} className="ig-mc-nucleo-linha" />
      ))}
      {mov && <rect x={xc + 2} y={cTop} width={wc - 4} height={44} rx={14} className="ig-mc-varre-v" style={{ "--curso": `${cBot - cTop - 44}px` } as React.CSSProperties} />}
      <text x={xc + wc / 2} y={cTop + 30} textAnchor="middle" className="ig-mc-marca menor">Brasico</text>
      <text x={xc + wc / 2} y={cTop + 50} textAnchor="middle" className="ig-mc-sub">banco de dados</text>
      <text x={xc + wc / 2} y={cBot - 16} textAnchor="middle" className="ig-mc-vivo">● {mil(leituras)} / 24 h</text>

      {paginas.map((p) => {
        const fontes = lista.filter((i) => DESTINOS[i.id]?.includes(p.id));
        const ir = () => { window.location.href = p.href; };
        return (
          <g key={p.id} className={`ig-mc-no pagina ig-mc-d ${fontes.some((i) => d(i.id).includes(" on")) ? "on" : ""}`} tabIndex={0} role="link"
            aria-label={`${p.nome}: recebe de ${fontes.map((i) => i.nome).join(", ")}. Abrir`}
            onMouseEnter={() => focarPagina(p.id)} onMouseLeave={() => focarPagina(null)} onFocus={() => focarPagina(p.id)} onBlur={() => focarPagina(null)}
            onClick={ir} onKeyDown={(e) => { if (e.key === "Enter") ir(); }}>
            <rect x={xb} y={py[p.id]} width={wb} height={28} rx={8} className="ig-mc-cartao" />
            <text x={xb + 12} y={py[p.id] + 18.5} className="ig-mc-nome menor normal">{p.nome}</text>
            <text x={xb + wb - 10} y={py[p.id] + 18.5} textAnchor="end" className="ig-mc-num">{fontes.length} fonte{fontes.length === 1 ? "" : "s"}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ---------- Órbita: cada ligação é a linha do tempo de 24 h ----------
function Orbita({ lista, mov, novos, leituras, d, alvo }: Props) {
  const W = 1160, H = 660, cx = W / 2, cy = H / 2 + 6, R = 250, r0 = 62, r1 = R - 16;
  // ângulos: os grupos em sequência, com um respiro entre eles; o Governo centrado no alto
  const ordem = ["governo", "casas", "comunicacao"].map((g) => lista.filter((i) => i.grupo === g)).filter((l) => l.length);
  const folga = 24, passo = (360 - folga * ordem.length) / Math.max(1, lista.length);
  const ang: Record<string, number> = {};
  const setores: { g: string; a1: number; a2: number }[] = [];
  let a = -90 - ((ordem[0]?.length ?? 1) - 1) * passo / 2;
  for (const l of ordem) {
    const a1 = a;
    for (const i of l) { ang[i.id] = a; a += passo; }
    setores.push({ g: l[0].grupo, a1, a2: a - passo });
    a += folga;
  }
  const rad = (g: number) => (g * Math.PI) / 180;
  const ponto = (g: number, r: number) => [cx + r * Math.cos(rad(g)), cy + r * Math.sin(rad(g))] as const;
  const arco = (g1: number, g2: number, r: number) => { const [x1, y1] = ponto(g1, r), [x2, y2] = ponto(g2, r); return `M${x1} ${y1} A${r} ${r} 0 ${g2 - g1 > 180 ? 1 : 0} 1 ${x2} ${y2}`; };

  return (
    <svg className="ig-mc-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Órbita: cada ligação mostra as últimas 24 horas daquele sistema">
      <defs>
        <radialGradient id="ig-mc-brilho-o"><stop offset="0%" style={{ stopColor: "var(--gold)", stopOpacity: 0.14 }} /><stop offset="100%" style={{ stopColor: "var(--gold)", stopOpacity: 0 }} /></radialGradient>
        {setores.map((s) => <path key={s.g} id={`ig-mc-arco-${s.g}`} d={arco(s.a1, s.a2, R + 70)} fill="none" />)}
      </defs>
      <circle cx={cx} cy={cy} r={R + 30} fill="url(#ig-mc-brilho-o)" />
      {[R, R * 0.72, R * 0.44].map((r, k) => <circle key={k} cx={cx} cy={cy} r={r} className={`ig-mc-orbita ${k ? "fina" : ""}`} />)}
      {setores.map((s) => {
        const meio = (s.a1 + s.a2) / 2, emCima = Math.sin(rad(meio)) < -0.3;
        return (
          <g key={s.g}>
            <path d={arco(s.a1 - 6, s.a2 + 6, R + 50)} className="ig-mc-setor" />
            {emCima ? (
              <text className="ig-mc-grupo"><textPath href={`#ig-mc-arco-${s.g}`} startOffset="50%" textAnchor="middle">{GRUPO_TITULO[s.g].toUpperCase()}</textPath></text>
            ) : (
              <text x={Math.cos(rad(meio)) < 0 ? cx - R - 70 : cx + R + 70} y={cy + R + 36} textAnchor="middle" className="ig-mc-grupo">{GRUPO_TITULO[s.g].toUpperCase()}</text>
            )}
          </g>
        );
      })}
      {mov && (
        <g className="ig-mc-giro lento" style={{ transformOrigin: `${cx}px ${cy}px` }}>
          <path d={`M${cx} ${cy} L${cx + R} ${cy} A${R} ${R} 0 0 0 ${cx + R * Math.cos(-0.35)} ${cy + R * Math.sin(-0.35)} Z`} className="ig-mc-varre" />
          <line x1={cx} y1={cy} x2={cx + R} y2={cy} className="ig-mc-varre-linha" />
        </g>
      )}

      {lista.map((i, k) => {
        const g = ang[i.id], [x0, y0] = ponto(g, r0), [x1, y1] = ponto(g, r1), id = `ig-mc-o-${i.id}`, s = (r1 - r0) / 24;
        return (
          <g key={`e-${i.id}`} className={`ig-mc-elo ${i.estado} ${d(i.id)}`}>
            <path id={id} d={`M${x0} ${y0} L${x1} ${y1}`} className={i.horas ? "ig-mc-invisivel" : "ig-mc-raio"} />
            {i.horas?.map((h, j) => {
              const [ax, ay] = ponto(g, r0 + j * s + 1), [bx, by] = ponto(g, r0 + (j + 1) * s - 1.5);
              return <line key={j} x1={ax} y1={ay} x2={bx} y2={by} className={`ig-mc-h raio ${corHora(h)}`} />;
            })}
            {mov && anda(i) && <Pacote caminho={id} dur={2.4 + (k % 4) * 0.35} atraso={k * 0.41} volta={!sai(i)} r={2.4} />}
          </g>
        );
      })}

      <circle cx={cx} cy={cy} r={54} className="ig-mc-nucleo" />
      <text x={cx} y={cy - 2} textAnchor="middle" className="ig-mc-marca menor">Brasico</text>
      <text x={cx} y={cy + 17} textAnchor="middle" className="ig-mc-sub">{mil(leituras)} / 24 h</text>

      {lista.map((i) => {
        const g = ang[i.id], c = Math.cos(rad(g)), sn = Math.sin(rad(g)), [x, y] = ponto(g, R);
        const meio = Math.abs(c) < 0.2, anchor = meio ? "middle" : c > 0 ? "start" : "end";
        const lx = x + (meio ? 0 : c > 0 ? 28 : -28), ly = y + (meio ? (sn < 0 ? -32 : 40) : -2);
        const boas = i.horas ? i.horas.filter((h) => corHora(h) === "ok").length / 24 : null;
        const rr = 17, volta = 2 * Math.PI * rr;
        return (
          <g key={i.id} className={`ig-mc-no ${i.estado} ${novos.has(i.id) ? "novo" : ""} ${d(i.id)}`} {...alvo(i)}>
            <title>{`${i.nome}: ${TEXTO_ESTADO[i.estado]} · ${i.frase}`}</title>
            <circle cx={x} cy={y} r={26} className="ig-mc-alvo" />
            <Onda i={i} cx={x} cy={y} />
            {boas != null && <>
              <circle cx={x} cy={y} r={rr} className="ig-mc-anel" />
              <circle cx={x} cy={y} r={rr} className="ig-mc-anel-cheio" strokeDasharray={`${boas * volta} ${volta}`} transform={`rotate(-90 ${x} ${y})`} />
            </>}
            <circle cx={x} cy={y} r={11} className="ig-mc-bola" />
            <text x={lx} y={ly} textAnchor={anchor} className="ig-mc-nome">{nome(i)}</text>
            <text x={lx} y={ly + 16} textAnchor={anchor} className={`ig-mc-frase ${i.estado}`}>{curta(i.frase, 26)}</text>
          </g>
        );
      })}
    </svg>
  );
}
