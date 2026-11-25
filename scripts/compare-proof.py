import sys, json, re, collections, io, base64
import fitz
import numpy as np
from PIL import Image,ImageFilter
from pathlib import Path
source, output = map(fitz.open,sys.argv[1:3])
rects=json.loads(Path(sys.argv[2]+'.rects.json').read_text())
byq=collections.defaultdict(list)
for p in rects: byq[p['question']].append(p)
def gray(page,z=2):
    pix=page.get_pixmap(matrix=fitz.Matrix(z,z),colorspace=fitz.csGRAY,alpha=False)
    return Image.frombytes('L',(pix.width,pix.height),pix.samples)
src=[gray(p) for p in source]
dst=[gray(p) for p in output]
coverage={}
for q,tiles in byq.items():
    parts=[]
    for t in tiles:
        sx,sy,sw,sh=t['source']; x,y,w,h=t['output']
        shape=max(1,round(w*2)),max(1,round(h*2))
        ref=src[t['sourcePage']-1].transform(shape,Image.Transform.EXTENT,(sx*2,sy*2,(sx+sw)*2,(sy+sh)*2),Image.Resampling.BILINEAR)
        got=dst[t['outputPage']-1].transform(shape,Image.Transform.EXTENT,(x*2,y*2,(x+w)*2,(y+h)*2),Image.Resampling.BILINEAR)
        a=np.asarray(ref)<180;b=np.asarray(got)<180
        dilate=lambda arr:np.asarray(Image.fromarray(arr.astype('uint8')*255).filter(ImageFilter.MaxFilter(5)))>0
        recall=np.mean(dilate(b)[a]) if a.any() else 1
        precision=np.mean(dilate(a)[b]) if b.any() else 1
        parts.append([round(float(recall),4),round(float(precision),4)])
    coverage[q]=parts
print('PIXEL_AGREEMENT',json.dumps(coverage))
# Inspect independently extracted words, including everything after the last choice
# marker up to the next question in reading order. Coordinates use the source, not the app.
active=0;words=collections.defaultdict(list)
for n,page in enumerate(source,1):
    w,h=page.rect.width,page.rect.height
    runs=page.get_text('words',sort=False)
    for col in range(2):
        lane=[e for e in runs if (e[0]>w*.48)==bool(col)]
        # Keep neighboring line fragments together despite different font metrics.
        lane.sort(key=lambda e:(round((e[1]+e[3])*.5/3),e[0]))
        for e in lane:
            x0,y0,x1,y1,word=e[:5]
            m=re.match(r'^(\d{1,2})[.)](?:$|[^\d])',word)
            anchor=(x0/w if col==0 else x0/w-.5)
            if m and -.06<anchor<.15 and int(m[1])==active+1:
                active=int(m[1])
            if active:words[active].append((n,x0,y0,x1,y1,word))
checks={}
for q,tiles in byq.items():
    runs=words[q]
    where=[i for i,r in enumerate(runs) if '④' in r[-1]]
    if not where: checks[q]={'marker':False};continue
    tail=runs[where[-1]:]
    first=tail[0]
    # Drop the next sheet's running heading. Require all real choice words in the
    # original column; include following pages / lanes when they contain body text.
    end=0;missing=0;wordCount=0
    for p,x0,y0,x1,y1,txt in tail:
        page=source[p-1]
        if p>first[0] and y0<page.rect.height*.075:continue
        if y0<first[2]-8 and p==first[0] and x0-first[1]>page.rect.width*.25:continue
        if y0<page.rect.height*.065 and (p!=first[0] or abs(x0-first[1])>page.rect.width/3):continue
        if txt.strip() in ['쪽','책형'] or '채용' in txt and y0<page.rect.height*.08:continue
        if x1-x0<=0 or y1-y0<=0:continue
        mask=src[p-1].crop((round(2*x0),round(2*y0),round(2*x1),round(2*y1)))
        if min(mask.size)<=0:continue
        ys,xs=np.nonzero(np.asarray(mask)<120)
        if not len(xs):continue
        px=x0+xs/2;py=y0+ys/2
        contained=np.zeros(len(xs),dtype=bool)
        for t in tiles:
            if t['sourcePage']!=p:continue
            x,y,w,h=t['source'];contained|=(px>=x-1)&(px<=x+w+1)&(py>=y-1)&(py<=y+h+1)
        wordCount+=1
        if contained.mean()<.975: missing+=1
    checks[q]={'marker':True,'words':wordCount,'outside':missing}
print('FINAL_OPTION',json.dumps(checks))
# These thumbnails contain invented fixtures only.
if len(sys.argv)>3:
    for name in sys.argv[3:]:
        im=Image.open(name);im.thumbnail((560,800));b=io.BytesIO();im.convert('RGB').save(b,format='JPEG',quality=67,optimize=True)
        print('FICTIONAL_PREVIEW',base64.b64encode(b.getvalue()).decode())
