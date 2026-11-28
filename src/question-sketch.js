import {compact} from './exam-identity.js';
// Hold only small fingerprints. Exact question samples are also useful when a
// combined exam contains just the subject excerpt, or questions were reordered.
export function questionSketch(texts){
  const values=new Set();
  for(const text of texts){
    const s=compact(String(text||'').replace(/^\s*(?:문제?|제)?\s*\d{1,3}\s*[.)번]\s*/,''));if(s.length<20)continue;
    const piece=s.slice(0,90);let h=2166136261;
    for(let n=0;n<piece.length;n++)h=Math.imul(h^piece.charCodeAt(n),16777619);
    values.add(h>>>0);if(values.size>=300)break;
  }return [...values].sort((a,b)=>a-b);
}
