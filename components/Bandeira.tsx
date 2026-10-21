import { useId } from "react";
import type { Idioma } from "@/lib/idioma";

// Bandeirinha do idioma (SVG próprio: emojis de bandeira não aparecem no Windows).
export default function Bandeira({ idioma }: { idioma: Idioma }) {
  const id = useId().replace(/:/g, "");
  return (
    <span className="bandeira" aria-hidden="true">
      {idioma === "pt" && (
        <svg viewBox="0 0 20 14" preserveAspectRatio="xMidYMid slice">
          <rect width="20" height="14" fill="#009b3a" />
          <polygon points="10,1.7 18.3,7 10,12.3 1.7,7" fill="#fedf00" />
          <circle cx="10" cy="7" r="3.2" fill="#002776" />
          <path d="M6.9 6.3 Q10 5.4 13.1 7.2" stroke="#fff" strokeWidth="0.7" fill="none" />
        </svg>
      )}
      {idioma === "en" && (
        <svg viewBox="0 0 60 30" preserveAspectRatio="xMidYMid slice">
          <clipPath id={`${id}t`}>
            <path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z" />
          </clipPath>
          <rect width="60" height="30" fill="#012169" />
          <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6" />
          <path d="M0,0 L60,30 M60,0 L0,30" clipPath={`url(#${id}t)`} stroke="#c8102e" strokeWidth="4" />
          <path d="M30,0 v30 M0,15 h60" stroke="#fff" strokeWidth="10" />
          <path d="M30,0 v30 M0,15 h60" stroke="#c8102e" strokeWidth="6" />
        </svg>
      )}
      {idioma === "pl" && (
        <svg viewBox="0 0 20 14" preserveAspectRatio="xMidYMid slice">
          <rect width="20" height="7" fill="#fff" />
          <rect y="7" width="20" height="7" fill="#dc143c" />
        </svg>
      )}
      {idioma === "de" && (
        <svg viewBox="0 0 20 12" preserveAspectRatio="xMidYMid slice">
          <rect width="20" height="4" fill="#000" />
          <rect y="4" width="20" height="4" fill="#dd0000" />
          <rect y="8" width="20" height="4" fill="#ffce00" />
        </svg>
      )}
      {idioma === "fr" && (
        <svg viewBox="0 0 21 14" preserveAspectRatio="xMidYMid slice">
          <rect width="7" height="14" fill="#002654" />
          <rect x="7" width="7" height="14" fill="#fff" />
          <rect x="14" width="7" height="14" fill="#ce1126" />
        </svg>
      )}
    </span>
  );
}
