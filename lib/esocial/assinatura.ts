// Assinatura digital dos XML do eSocial (MOD v1.16, seção 6.7): XMLDSig "enveloped",
// RSA-SHA256, digest SHA-256, canonicalização C14N 1.0, referência ao documento inteiro (URI="")
// e só o certificado em KeyInfo. A assinatura entra como último filho da raiz <eSocial>.
import { SignedXml } from "xml-crypto";

const C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";

export function assinar(xml: string, certificadoPem: string, chavePem: string): string {
  const sig = new SignedXml({
    privateKey: chavePem,
    publicCert: certificadoPem,
    signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
    canonicalizationAlgorithm: C14N,
  });
  sig.addReference({
    xpath: "/*",
    transforms: ["http://www.w3.org/2000/09/xmldsig#enveloped-signature", C14N],
    digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
    isEmptyUri: true,
  });
  sig.computeSignature(xml.replace(/^\s*<\?xml[^>]*\?>\s*/, ""), { location: { reference: "/*", action: "append" } });
  // Nada antes da raiz e nenhuma reformatação depois de assinar
  return sig.getSignedXml();
}
