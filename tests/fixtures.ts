// 原创微型材料，仅用于解析、引用与协议契约测试。
export const paragraphs=['主动回忆是合上材料后，用自己的话提取学过的内容。先独立作答，再核对原文，可以发现理解缺口。','反馈指出正确要点、遗漏和误解。讲解后的再次答对不能覆盖最初独立回忆失败，应在之后按计划复习。'];
export function makePdf(firstPageEmpty=false,outline=false){const objects:string[]=[];objects.push('<< /Type /Catalog /Pages 2 0 R '+(outline?'/Outlines 8 0 R ':'')+'>>','<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>');const text=[firstPageEmpty?'':'Recall requires answering before checking the source. Independent recall exposes missing understanding.','Feedback explains errors. Later review tests independent retention over time.'];for(const [index,line] of text.entries()){const content=`BT /F1 12 Tf 72 720 Td (${line}) Tj ET`;objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents ${index===0?4:6} 0 R >>`,`<< /Length ${content.length} >>\nstream\n${content}\nendstream`)}objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');if(outline)objects.push('<< /Type /Outlines /First 9 0 R /Last 9 0 R /Count 1 >>','<< /Title (Recall and feedback) /Parent 8 0 R /Dest [3 0 R /Fit] >>');let pdf='%PDF-1.4\n',offsets=[0];objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${index+1} 0 obj\n${object}\nendobj\n`});const start=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;return Buffer.from(pdf)}
export type EpubCoverKind='epub2'|'epub3'|'guide'|'spine'|'encoded'|'corrupt'|'external'|'traversal'|'svg';
export async function makeEpub(unsafe=false,options:{cover?:EpubCoverKind;textRepeat?:number}={}){
 const {zipSync,strToU8}=await import('fflate');
 const kind=options.cover,coverName=kind==='encoded'?'art/My Cover.png':'art/cover.png';
 const coverHref=kind==='encoded'?'art/My%20Cover.png':kind==='external'?'https://example.com/cover.png':kind==='traversal'?'../../cover.png':coverName;
 const direct=kind&& !['guide','spine'].includes(kind);
 const metadata=kind==='epub2'?'<metadata><meta name="cover" content="art"/></metadata>':'';
 const guide=kind==='guide'?'<guide><reference type="cover" href="cover.xhtml"/></guide>':'';
 const imageItem=kind?'<item id="art" href="'+coverHref+'" media-type="'+(kind==='svg'?'image/svg+xml':'image/png')+'"'+(direct&&kind!=='epub2'?' properties="cover-image"':'')+'/>':'';
 const pageItem=['guide','spine'].includes(kind||'')?'<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>':'';
 const coverBytes=kind?await (await import('sharp')).default({create:{width:600,height:900,channels:3,background:'#274e3b'}}).png().toBuffer():undefined;
 const files:Record<string,Uint8Array>={
  mimetype:strToU8('application/epub+zip'),
  'META-INF/container.xml':strToU8('<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>'),
  'OEBPS/content.opf':strToU8('<package>'+metadata+'<manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/>'+imageItem+pageItem+'</manifest><spine>'+(kind==='spine'?'<itemref idref="cover"/>':'')+'<itemref idref="one"/><itemref idref="two"/></spine>'+guide+'</package>'),
  'OEBPS/one.xhtml':strToU8('<html><head><title>第一章</title></head><body>'+('<p>'+paragraphs[0]+'</p>').repeat(options.textRepeat||1)+'</body></html>'),
  'OEBPS/two.xhtml':strToU8('<html><head><title>第二章</title></head><body>'+('<p>'+paragraphs[1]+'</p>').repeat(options.textRepeat||1)+'</body></html>'),
 };
 if(kind){files['OEBPS/'+coverName]=kind==='corrupt'?strToU8('损坏的图片'):kind==='svg'?strToU8('<svg xmlns="http://www.w3.org/2000/svg"><script>错误指令</script></svg>'):coverBytes!;files['OEBPS/cover.xhtml']=strToU8('<html><body><svg><image xlink:href="'+coverName+'"/></svg></body></html>')}
 if(unsafe)files['../escape']=strToU8('越界');
 return Buffer.from(zipSync(files));
}

export async function makeStructuredEpub(options:{toc?:'ncx'|'nav'|'broken'|'external'|'backwards'|'missing-anchor';layout?:'files'|'anchors'|'nested';prefix?:boolean}={}){
 const {zipSync,strToU8}=await import('fflate');
 const toc=options.toc||'ncx',layout=options.layout||'files';
 const points=layout==='nested'?[{title:'第一部分',href:'one.xhtml',depth:0},{title:'回忆',href:'one.xhtml#start',depth:1},{title:'反馈',href:'two.xhtml',depth:1},{title:'第二部分',href:'three.xhtml',depth:0}]:layout==='anchors'?[{title:'独立回忆',href:'one.xhtml#start',depth:0},{title:'理解缺口',href:'one.xhtml#second',depth:0},{title:'再次练习',href:'three.xhtml#middle',depth:0}]:[{title:'第一章 回忆与反馈',href:'one.xhtml',depth:0},{title:'第二章 再次练习',href:'three.xhtml',depth:0}];
 if(toc==='external')points[0].href='https://example.com/one.xhtml';
 if(toc==='missing-anchor')points[0].href='one.xhtml#absent';
 if(toc==='backwards')points.reverse();
 let ncxPoints='';for(let index=0;index<points.length;index++){
  const point=points[index];ncxPoints+='<navPoint id="p'+index+'"><navLabel><text>'+point.title+'</text></navLabel><content src="'+point.href+'"/>';
  if(points[index+1]?.depth>point.depth)continue;
  ncxPoints+='</navPoint>';if(point.depth>(points[index+1]?.depth||0))ncxPoints+='</navPoint>';
 }
 let links='';for(let index=0;index<points.length;index++){
  const point=points[index];links+='<li><a href="'+point.href+'">'+point.title+'</a>';
  if(points[index+1]?.depth>point.depth){links+='<ol>';continue}
  links+='</li>';if(point.depth>(points[index+1]?.depth||0))links+='</ol></li>';
 }
 const files:Record<string,Uint8Array>={
  mimetype:strToU8('application/epub+zip'),
  'META-INF/container.xml':strToU8('<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>'),
  'OEBPS/content.opf':strToU8('<package><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/><item id="three" href="three.xhtml" media-type="application/xhtml+xml"/><item id="toc" href="'+(toc==='nav'?'nav.xhtml':'toc.ncx')+'" media-type="'+(toc==='nav'?'application/xhtml+xml':'application/x-dtbncx+xml')+'"'+(toc==='nav'?' properties="nav"':'')+'/></manifest><spine toc="toc"><itemref idref="one"/><itemref idref="two"/><itemref idref="three"/></spine></package>'),
  'OEBPS/one.xhtml':strToU8('<html><head><title>同一本书名</title></head><body>'+(options.prefix?'<p>这是目录之前的正文，仍需要保留和定位。</p>':'')+'<p id="start">'+paragraphs[0]+'</p><p id="second">先独立作答，才能发现理解缺口。</p></body></html>'),
  'OEBPS/two.xhtml':strToU8('<html><head><title>同一本书名</title></head><body><p>'+paragraphs[1]+'</p></body></html>'),
  'OEBPS/three.xhtml':strToU8('<html><head><title>同一本书名</title></head><body><p>原文中的方法也需要通过新的情境验证理解。</p><div id="middle"><p>再次练习尽量更换题面，并保留来源。</p></div></body></html>'),
  'OEBPS/toc.ncx':strToU8(toc==='broken'?'<broken/>':'<ncx><navMap>'+ncxPoints+'</navMap></ncx>'),
  'OEBPS/nav.xhtml':strToU8('<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="page-list"><ol><li><a href="three.xhtml">页码不是章节</a></li></ol></nav><nav epub:type="toc"><ol>'+links+'</ol></nav></body></html>'),
 };
 return Buffer.from(zipSync(files));
}
