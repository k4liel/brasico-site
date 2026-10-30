// Texto de um PDF (o relatório de situação fiscal da Receita), linha a linha, para virar lista de pendências.
export async function textoDoPdf(base64: string): Promise<string> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await getDocument({ data: new Uint8Array(Buffer.from(base64, "base64")), useSystemFonts: false, isEvalSupported: false }).promise;
  const linhas: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const c = await (await doc.getPage(i)).getTextContent();
    let linha = "";
    let ultimoY: number | null = null;
    for (const it of c.items as { str: string; transform: number[] }[]) {
      const y = it.transform[5];
      if (ultimoY !== null && Math.abs(y - ultimoY) > 2) { linhas.push(linha); linha = ""; }
      linha += (linha && !linha.endsWith(" ") && it.str && !it.str.startsWith(" ") ? " " : "") + it.str;
      ultimoY = y;
    }
    linhas.push(linha);
  }
  return linhas.map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
}
