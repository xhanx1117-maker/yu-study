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

// Keep the PDF's text stream in reading order unless the columns alternate.
// A question can continue on the next page before the next numbered anchor.
export function questionSampler(){
  const hashes=new Set(); let block='';
  function finishBlock(){for(const h of questionSketch([block]))if(hashes.size<300)hashes.add(h)}
  return {
    addPage(lines,markers){
      const anchor=new Set(markers.map(l=>[l.x,l.y].join('|')));
      const split=markers.some(l=>l.x<.28)&&markers.some(l=>l.x>.42&&l.x<.66);
      const interleaved=split&&markers.some((l,n)=>n&&l.n<markers[n-1].n);
      const ordered=interleaved?[...lines.filter(l=>l.x<.45),...lines.filter(l=>l.x>=.45)]:lines;
      for(const l of ordered){
        if(anchor.has([l.x,l.y].join('|'))){finishBlock();block=l.str}
        else if(block&&block.length<350)block+=' '+l.str;
      }
    },
    finish(){finishBlock();return [...hashes].sort((a,b)=>a-b)},
    get size(){return hashes.size}
  };
}
