/* 示例由结构化概念编译成 Mermaid；未接入上传、书籍解析或模型服务。 */
(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const sample = {
    id: 'sample', title: '学习的回路', version: '原创示例 v1',
    nodes: [
      {id:'recall', label:'主动回忆', chapter:1, anchor:'§1.1', quote:'主动回忆，是暂时合上材料，用自己的话回答一个问题或解释一个概念。'},
      {id:'familiarity', label:'熟悉感', chapter:1, anchor:'§1.2', quote:'看着答案产生的熟悉感，与独立说出答案是两种不同的表现。'},
      {id:'feedback', label:'反馈与纠错', chapter:2, anchor:'§2.1', quote:'反馈应指出答案中的正确要点、遗漏与误解，并提供可以核对的依据。'},
      {id:'remedy', label:'讲解后的再测', chapter:2, anchor:'§2.2', quote:'看过讲解后，可以换一个情境再试一次；这次表现用于判断是否理解了讲解，不能覆盖最初独立作答的记录。'},
      {id:'spacing', label:'间隔复习', chapter:3, anchor:'§3.1', quote:'主动回忆暴露理解缺口，反馈帮助纠正缺口，隔一段时间再进行回忆则检验内容是否仍能被独立提取。'},
      {id:'retention', label:'跨时间的独立提取', chapter:3, anchor:'§3.1', quote:'隔一段时间再进行回忆则检验内容是否仍能被独立提取。'}
    ],
    edges: [
      {from:'recall', to:'familiarity', label:'区别于', chapter:1, paragraph:2},
      {from:'recall', to:'feedback', label:'暴露缺口后需要', chapter:3, paragraph:1},
      {from:'feedback', to:'remedy', label:'讲解后再次检验', chapter:2, paragraph:2},
      {from:'feedback', to:'spacing', label:'纠错后延时检验', chapter:3, paragraph:1},
      {from:'spacing', to:'retention', label:'检验能否', chapter:3, paragraph:1}
    ]
  };
  const books = [{id:sample.id, title:sample.title, sample:true}];
  const state = {book:'sample', ready:false, edited:false, busy:false, revision:0, renderedSource:'', svg:'', subset:null, originalSource:'', preparedKey:''};
  const MAX_BYTES = 50 * 1024 * 1024;
  let selectedFile = null;
  let renderChain = Promise.resolve();

  function book(){ return books.find(item => item.id === state.book); }
  function element(tag, text, className){
    const node = document.createElement(tag);
    if(text !== undefined) node.textContent = text;
    if(className) node.className = className;
    return node;
  }
  function sourceHref(chapter, paragraph){ return './reader.html?chapter=' + chapter + '&paragraph=' + paragraph; }
  function subset(){
    const chapter = Number(el('map-scope').value);
    const nodes = sample.nodes.filter(node => !chapter || node.chapter === chapter);
    const ids = new Set(nodes.map(node => node.id));
    return {nodes, edges:sample.edges.filter(edge => ids.has(edge.from) && ids.has(edge.to))};
  }
  function compile(graph, direction){
    const lines = ['flowchart ' + direction];
    graph.nodes.forEach(node => lines.push('    ' + node.id + '["' + node.label + '"]'));
    graph.edges.forEach(edge => lines.push('    ' + edge.from + ' -->|"' + edge.label + '"| ' + edge.to));
    lines.push('    classDef concept fill:#e6eddf,stroke:#53725b,color:#253d2e,stroke-width:1px');
    lines.push('    class ' + graph.nodes.map(node => node.id).join(',') + ' concept');
    return lines.join('\n');
  }
  function controls(){
    const isSample = book()?.sample;
    ['map-scope','map-direction','map-generate'].forEach(id => el(id).disabled = !isSample || state.busy);
    el('map-generate').textContent = state.busy ? '正在校验并绘图…' : '生成示例概念图';
    ['map-apply','map-restore'].forEach(id => el(id).disabled = !isSample || !state.preparedKey || state.busy);
    el('map-code').disabled = !isSample || !state.preparedKey;
    const valid = state.ready && state.renderedSource === el('map-code').value && !state.busy;
    ['map-export-mmd','map-export-md','map-export-svg','map-copy'].forEach(id => el(id).disabled = !valid);
  }
  function steps(done = 0){
    [...el('map-steps').children].forEach((item,index) => item.dataset.done = String(index < done));
  }
  function empty(title, text){
    const panel = element('div',undefined,'graph-empty');
    panel.append(element('h3',title),element('p',text));
    el('map-canvas').replaceChildren(panel);
  }
  function selectBook(id){
    if(!books.some(item => item.id === id)) return;
    state.book = id; state.revision++; state.busy = false; state.ready = false;
    state.svg = ''; state.renderedSource = ''; state.originalSource = ''; state.preparedKey = ''; state.edited = false;
    el('map-book').value = id; el('map-code').value = ''; el('map-error').textContent = '';
    el('map-evidence').replaceChildren(element('p','生成概念图后，在这里查看节点与关系的原文依据。','muted small'));
    el('map-count').textContent = book().sample ? '示例图谱 · 尚未生成' : '等待解析服务';
    el('map-origin').textContent = book().sample ? '内置原创材料 · 预设概念 · Mermaid 实际渲染' : '已选择文件名；尚未读取正文、上传或启动 Agent。';
    el('map-run-status').textContent = book().sample ? '示例流程：固定概念数据，不调用 AI。' : '尚未接入书籍解析与 Agent 服务。';
    steps();
    empty(book().sample ? '把一本书，读成一张图。' : '这本书还在等待解析。', book().sample ? '使用内置示例体验概念提取结果、原文依据和 Mermaid 图表。' : '当前原型仅保留所选文件的名称和大小，不会为它套用示例图。');
    controls();
  }
  function library(){
    const host = el('library-books'); host.replaceChildren();
    books.forEach(item => {
      const title = item.sample ? item.title : item.title.replace(/\.(pdf|epub)$/i,'');
      const openGraph = () => { selectBook(item.id); window.navigate('graph'); if(item.sample) generate(); };
      const tile = element('article',undefined,'book-tile');
      tile.setAttribute('aria-labelledby','book-title-'+item.id);
      const cover = element('button',undefined,'book-cover-button');
      cover.setAttribute('aria-label',item.sample ? '打开《'+title+'》阅读' : '查看《'+title+'》的处理状态');
      cover.onclick = item.sample ? ()=>window.read() : openGraph;
      // 尚未读取用户文件的封面，以文件名制作文字封面，不虚构作者或书籍信息。
      const hue = [...item.title].reduce((sum,char)=>sum+char.codePointAt(0),0)%3;
      cover.dataset.palette = item.sample ? 'forest' : ['clay','slate','olive'][hue];
      const jacket = element('span',undefined,'book-jacket');jacket.setAttribute('aria-hidden','true');
      jacket.append(element('span',item.sample?'READOR ORIGINAL':item.format,'book-cover-kicker'),element('span',title,'book-cover-title'),element('span',undefined,'book-cover-art'),element('span',item.sample?'阅读 · 理解 · 记住':'READOR / 我的藏书','book-cover-footer'));
      const format = element('span',item.sample?'原创示例':item.format,'book-format');format.setAttribute('aria-hidden','true');
      cover.append(format,jacket);
      if(!item.sample){const placeholder=element('span','文字封面','book-cover-placeholder');placeholder.setAttribute('aria-hidden','true');cover.append(placeholder)}
      const body = element('div',undefined,'book-card-body');
      const heading = element('h3',title,'book-card-title');heading.id='book-title-'+item.id;heading.title=item.title;
      const status = element('span',item.sample?'可阅读 · 示例':'等待解析','book-status');status.dataset.state=item.sample?'ready':'pending';
      body.append(status,heading,element('p',item.sample?'Reador · 内置原创材料':item.format+' · '+(item.bytes/1024/1024).toFixed(2)+' MB · 尚未上传','book-card-meta'));
      body.append(element('p',item.sample?'3 节内容 / 6 个概念':'正文未读取，解析后可阅读与生成图谱。','book-card-detail'));
      const actions = element('div',undefined,'book-card-actions');
      const read=element('button',item.sample?'继续阅读 →':'等待解析后阅读','primary');
      read.disabled=!item.sample;read.onclick=()=>window.read();
      const graph = element('button',item.sample?'生成示例概念图 →':'查看处理状态 →','text-button');graph.onclick=openGraph;
      const review = element('button','查看复习计划 →','text-button');
      review.onclick=()=>window.openBookReview(item.id);
      const counts=window.reviewCounts(item.id);
      body.append(element('p',item.sample?counts.pending+' 个待回忆 · '+counts.done+' 个本轮已完成':'暂无复习计划 · 等待解析','book-card-meta'));
      actions.append(read,graph,review);body.append(actions);tile.append(cover,body);host.append(tile);
    });
    const add = element('button',undefined,'book-add-card');add.dataset.action='import';add.setAttribute('aria-label','添加一本书');
    const plus=element('span','＋','book-add-icon');plus.setAttribute('aria-hidden','true');
    add.append(plus,element('strong','下一本，想读什么？'),element('span','添加一本书，开始新的阅读。'),element('span','PDF / EPUB','book-add-formats'));
    host.append(add);
    const select = el('map-book'); select.replaceChildren();
    books.forEach(item => {const option=element('option',item.title + (item.sample?' · 内置示例':' · 等待解析'));option.value=item.id;select.append(option)});
    select.value = state.book;
    window.setReviewBooks(books);
    el('library-count').textContent = books.length+' 本 · 含 1 本示例' + (books.length > 1 ? ' · ' + (books.length - 1) + ' 本等待解析' : '');
  }
  function validateFile(file){
    selectedFile = null; el('add-book').disabled = true;
    if(!file){el('file-info').textContent='原型只保留文件名与大小，不读取或上传正文。';return}
    if(!/\.(pdf|epub)$/i.test(file.name)){el('file-info').textContent='请选择 PDF 或 EPUB 文件。';return}
    if(file.size === 0){el('file-info').textContent='文件为空，请选择有内容的电子书。';return}
    if(file.size > MAX_BYTES){el('file-info').textContent='首版原型支持选择不超过 50 MB 的文件。';return}
    selectedFile = file;
    el('file-info').textContent = file.name + ' · ' + (file.size / 1024 / 1024).toFixed(2) + ' MB。可加入待解析列表；尚未上传。';
    el('add-book').disabled = false;
  }
  function addFile(){
    if(!selectedFile) return;
    const fingerprint = selectedFile.name + ':' + selectedFile.size + ':' + selectedFile.lastModified;
    const existing = books.find(item => item.fingerprint === fingerprint);
    if(existing){window.message('此文件已在本次待解析列表中。');return}
    const entry={id:'local-'+crypto.randomUUID(),title:selectedFile.name,format:selectedFile.name.split('.').pop().toUpperCase(),bytes:selectedFile.size,fingerprint,sample:false};
    books.push(entry); library(); selectBook(entry.id);
    window.closeModal(el('import-modal')); window.navigate('library');
    el('book-file').value='';validateFile(null);
    window.message('已加入本次待解析列表，尚未读取或上传正文。');
  }
  function assertSource(source){
    if(source.length > 18000) throw new Error('图表过大：请拆成全书总览和章节子图，源码限制为 18,000 字符。');
    if(!/^\s*(flowchart|graph)\s+(TB|TD|BT|LR|RL)\b/.test(source)) throw new Error('本工作台支持 flowchart / graph 概念关系图，请显式指定 TB 或 LR 等方向。');
    if(/%%\{|^\s*---|^\s*(click|link|href)\s|javascript\s*:|https?\s*:|<[a-z!\/]|@\{|\]\(/im.test(source)) throw new Error('请使用基础节点和关系语法；图表不接受配置指令、链接、HTML 或外部资源。');
  }
  async function render(source, edited){
    const ticket = ++state.revision;
    const mount = element('div',undefined,'graph-mount');
    state.ready = false; state.busy = true; state.svg = ''; el('map-error').textContent='';controls();
    empty('正在校验图表…','Mermaid 在本地浏览器中解析代码。');
    el('map-evidence').replaceChildren(element('p',edited?'源码已编辑，原有来源对应关系待重新核对。':'正在准备原文依据。','muted small'));
    try{
      assertSource(source);
      if(!window.mermaid) throw new Error('Mermaid 渲染器未加载，请保留项目 assets/vendor 目录后重新打开页面。');
      await renderChain;
      if(ticket !== state.revision) return;
      const task = (async () => {
        window.mermaid.initialize({startOnLoad:false,securityLevel:'strict',theme:'base',maxTextSize:18000,maxEdges:100,suppressErrorRendering:true,flowchart:{htmlLabels:false,useMaxWidth:true},themeVariables:{fontFamily:'PingFang SC, Microsoft YaHei, sans-serif',primaryColor:'#e6eddf',primaryTextColor:'#253d2e',lineColor:'#53725b'}});
        await window.mermaid.parse(source);
        if(ticket !== state.revision) return null;
        document.body.append(mount);
        return window.mermaid.render('book-map-'+ticket,source,mount);
      })();
      renderChain = task.catch(()=>null);
      const rendered = await task;
      if(!rendered || ticket !== state.revision) return;
      // 仅插入固定版本 Mermaid 在 strict 模式下清理过的 SVG，不插入用户原始文本。
      const wrapper=element('div');wrapper.innerHTML=rendered.svg;
      const svg=wrapper.querySelector('svg');if(!svg) throw new Error('没有得到有效图表，请检查源码。');
      const oldDesc=svg.querySelector('desc');if(oldDesc)oldDesc.remove();
      svg.setAttribute('role',edited?'img':'group');svg.setAttribute('aria-label',book().title+'的'+(edited?'手动编辑概念图':'示例概念图'));
      el('map-canvas').replaceChildren(svg);
      state.ready=true;state.edited=edited;state.renderedSource=source;state.svg=svg.outerHTML;
      el('map-origin').textContent=edited?'手动编辑版本 · 语法有效 · 内容与引用尚未核对':'原创示例 v1 · 预设概念与关系 · 未调用 AI';
      el('map-count').textContent=edited?'手动编辑图谱':state.subset.nodes.length+' 个概念 · '+state.subset.edges.length+' 条有依据的关系';
      el('map-run-status').textContent=edited?'已通过 Mermaid 语法校验；语义待核对。':'示例完成：原文、预设概念、Mermaid 校验与渲染。';
      steps(edited?0:4);evidence(edited,svg);
    }catch(error){
      if(ticket !== state.revision) return;
      state.ready=false;state.svg='';steps();
      empty('图表暂时没有生成。','打开下方源码，修正后重新校验。');
      el('map-editor').open=true;
      el('map-error').textContent=String(error.message||error).slice(0,700);
      el('map-count').textContent='校验失败';el('map-run-status').textContent='失败状态已保留；不会导出旧图。';
    }finally{
      mount.remove();if(ticket===state.revision){state.busy=false;controls()}
    }
  }
  function generate(){
    if(!book()?.sample || state.busy) return;
    const key=el('map-scope').value+':'+el('map-direction').value;
    if(state.preparedKey===key && el('map-code').value!==state.originalSource){
      window.message('已保留你的修改。可重新校验，或点击“恢复示例源码”生成原版。');return;
    }
    state.preparedKey=key;state.subset=subset();state.originalSource=compile(state.subset,el('map-direction').value);el('map-code').value=state.originalSource;
    steps(3);render(state.originalSource,false);
  }
  function evidence(edited,svg){
    const host=el('map-evidence');host.replaceChildren();
    if(edited){host.append(element('p','源码编辑后，节点与关系可能改变。请重新核对原文；本原型不会自动为新增概念附上示例来源。','muted small'));return}
    const buttons=element('div'),detail=element('div');
    const show=node=>{
      [...buttons.children].forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.node===node.id)));
      detail.replaceChildren(element('h3',node.label),element('blockquote',node.quote,'evidence-quote'));
      const link=element('a','查看原文 '+node.anchor+' →','evidence-source');link.href=sourceHref(node.chapter,Number(node.anchor.split('.')[1]));detail.append(link);
    };
    state.subset.nodes.forEach(node=>{
      const button=element('button',node.label,'evidence-node');button.dataset.node=node.id;button.onclick=()=>show(node);buttons.append(button);
      const graphNode=[...svg.querySelectorAll('.node')].find(n=>n.getAttribute('data-id')===node.id || n.id.startsWith(svg.id+'-flowchart-'+node.id+'-') || n.id.startsWith('flowchart-'+node.id+'-'));
      if(graphNode){graphNode.setAttribute('tabindex','0');graphNode.setAttribute('role','button');graphNode.setAttribute('aria-label','查看'+node.label+'的原文依据');graphNode.addEventListener('click',()=>show(node));graphNode.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();show(node)}})}
    });
    const relations=element('ul',undefined,'evidence-relations');
    state.subset.edges.forEach(edge=>{
      const from=sample.nodes.find(n=>n.id===edge.from),to=sample.nodes.find(n=>n.id===edge.to);
      const item=element('li',from.label+' — '+edge.label+' → '+to.label);
      const link=element('a','依据 §'+edge.chapter+'.'+edge.paragraph);link.href=sourceHref(edge.chapter,edge.paragraph);item.append(element('br'),link);relations.append(item);
    });
    host.append(buttons,detail,element('h3','关系依据'),relations);show(state.subset.nodes[0]);
  }
  function validExport(){return state.ready&&!state.busy&&state.renderedSource===el('map-code').value}
  function download(format){
    if(!validExport()) return;
    const name='学习的回路-'+(state.edited?'手动编辑':'示例概念图');
    let data=state.renderedSource+'\n',type='text/plain;charset=utf-8';
    if(format==='md'){
      type='text/markdown;charset=utf-8';
      data='# 学习的回路 · '+(state.edited?'手动编辑图谱':'示例概念图')+'\n\n'+(state.edited?'语法已校验；内容和来源对应关系尚未核对。':'原创示例 v1；固定概念数据，无 AI 调用。')+'\n\n```mermaid\n'+state.renderedSource+'\n```\n';
      if(!state.edited){data+='\n## 概念来源\n\n';state.subset.nodes.forEach(n=>{data+='- '+n.label+'（'+n.anchor+'）：'+n.quote+'\n'});data+='\n## 关系来源\n\n';state.subset.edges.forEach(e=>{data+='- '+e.from+' → '+e.to+'：'+e.label+'，依据 §'+e.chapter+'.'+e.paragraph+'。\n'})}
    }
    if(format==='svg'){data=state.svg;type='image/svg+xml;charset=utf-8'}
    const url=URL.createObjectURL(new Blob([data],{type}));const a=element('a');a.href=url;a.download=name+'.'+format;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  el('book-file').onchange=event=>validateFile(event.target.files[0]);
  el('add-book').onclick=addFile;
  el('try-sample').onclick=()=>{window.closeModal(el('import-modal'));selectBook('sample');window.navigate('graph');generate()};
  el('map-book').onchange=()=>selectBook(el('map-book').value);
  el('map-generate').onclick=generate;
  ['map-scope','map-direction'].forEach(id=>el(id).onchange=()=>{
    if(el('map-code').value!==state.originalSource&&state.preparedKey){
      const [scope,direction]=state.preparedKey.split(':');el('map-scope').value=scope;el('map-direction').value=direction;window.message('请先导出修改，或恢复示例源码后再切换范围与布局。');return;
    }
    generate();
  });
  el('map-code').oninput=()=>{
    state.revision++;state.busy=false;state.ready=false;state.svg='';el('map-error').textContent='';
    empty('源码已修改，等待校验。','点击“校验并更新图表”后查看结果。');
    el('map-evidence').replaceChildren(element('p','待重新校验；不沿用旧图的来源标记。','muted small'));
    el('map-count').textContent='源码未校验';steps();controls();
  };
  el('map-apply').onclick=()=>render(el('map-code').value,el('map-code').value!==state.originalSource);
  el('map-restore').onclick=()=>{el('map-code').value=state.originalSource;render(state.originalSource,false)};
  el('map-export-mmd').onclick=()=>download('mmd');el('map-export-md').onclick=()=>download('md');el('map-export-svg').onclick=()=>download('svg');
  el('map-copy').onclick=async()=>{if(!validExport())return;try{await navigator.clipboard.writeText(state.renderedSource);window.message('Mermaid 源码已复制。')}catch{el('map-editor').open=true;el('map-code').focus();el('map-code').select();window.message('源码已选中，请按 ⌘C 或 Ctrl+C 复制。')}};
  document.addEventListener('reador:reset',()=>{books.splice(1);selectedFile=null;el('book-file').value='';validateFile(null);library();selectBook('sample')});
  document.addEventListener('reador:review-updated',()=>{
    document.querySelectorAll('.book-tile').forEach((tile,index)=>{
      const item=books[index], counts=window.reviewCounts(item.id);
      const meta=tile.querySelectorAll('.book-card-meta')[1];
      if(meta && item.sample) meta.textContent=counts.pending+' 个待回忆 · '+counts.done+' 个本轮已完成';
    });
  });
  library();selectBook('sample');
})();
