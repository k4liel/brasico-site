"use client";

// Faixa de abas dos capítulos (modo página). Com "grupos" ligado no projeto,
// os capítulos que começam com o mesmo nome antes do " · " viram uma aba só
// na faixa de cima (ex.: "Sempre Vivo"), e dentro dela aparece uma segunda
// faixa com cada capítulo (ex.: "Seg 28/12", "Ter 29/12").
type Cap = { id: string; titulo: string };
type Grupo = { nome: string; caps: { cap: Cap; nome: string }[] };

export const semNumero = (t: string) => t.replace(/^\s*\d+\s*[·.\-–—]\s*/, "");
export const numeroDe = (t: string) => t.match(/^\s*(\d+)\s*[·.\-–—]/)?.[1] ?? null;

// Junta capítulos seguidos com o mesmo nome de grupo (o trecho antes do primeiro " · ").
export function agrupar(capitulos: Cap[]): Grupo[] {
  const grupos: Grupo[] = [];
  for (const cap of capitulos) {
    const titulo = semNumero(cap.titulo);
    const i = titulo.indexOf(" · ");
    const nome = i > 0 ? titulo.slice(0, i).trim() : titulo;
    const sub = i > 0 ? titulo.slice(i + 3).trim() : titulo;
    const ultimo = grupos[grupos.length - 1];
    if (i > 0 && ultimo && ultimo.nome === nome) ultimo.caps.push({ cap, nome: sub });
    else grupos.push({ nome, caps: [{ cap, nome: sub }] });
  }
  return grupos;
}

export default function Abas({
  capitulos,
  atual,
  grupos,
  abrir,
}: {
  capitulos: Cap[];
  atual: string;
  grupos: boolean;
  abrir: (id: string) => void;
}) {
  if (!grupos)
    return (
      <nav className="abas" aria-label="Capítulos">
        {capitulos.map((c) => {
          const num = numeroDe(c.titulo);
          const on = c.id === atual;
          return (
            <button key={c.id} className={on ? "aba on" : "aba"} aria-current={on ? "page" : undefined} title={semNumero(c.titulo)} onClick={() => abrir(c.id)}>
              {num && <span className="aba-num">{num}</span>}
              <span className="aba-nome">{semNumero(c.titulo)}</span>
            </button>
          );
        })}
      </nav>
    );

  const lista = agrupar(capitulos);
  const grupoAtual = lista.find((g) => g.caps.some((x) => x.cap.id === atual)) ?? lista[0];
  return (
    <div className="abas-duplas">
      <nav className="abas" aria-label="Seções">
        {lista.map((g, n) => {
          const on = g === grupoAtual;
          return (
            <button key={g.caps[0].cap.id} className={on ? "aba on" : "aba"} aria-current={on ? "page" : undefined} title={g.nome} onClick={() => abrir(g.caps[0].cap.id)}>
              <span className="aba-num">{n + 1}</span>
              <span className="aba-nome">{g.nome}</span>
              {g.caps.length > 1 && <span className="aba-qtd">{g.caps.length}</span>}
            </button>
          );
        })}
      </nav>
      {grupoAtual && grupoAtual.caps.length > 1 && (
        <nav className="abas abas-sub" aria-label={grupoAtual.nome}>
          {grupoAtual.caps.map(({ cap, nome }) => {
            const on = cap.id === atual;
            return (
              <button key={cap.id} className={on ? "aba on" : "aba"} aria-current={on ? "page" : undefined} title={nome} onClick={() => abrir(cap.id)}>
                <span className="aba-nome">{nome}</span>
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
}
