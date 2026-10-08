/* 仅演示配置管理；不读取、保存或发送 API Key，不发起网络请求。 */
(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const presets = {
    openai:{name:'OpenAI',base:'https://api.openai.com/v1',protocol:'responses',protocols:['responses','chat']},
    claude:{name:'Anthropic / Claude',base:'https://api.anthropic.com/v1',protocol:'messages',protocols:['messages']},
    glm:{name:'智谱 / GLM',base:'https://open.bigmodel.cn/api/paas/v4',protocol:'chat',protocols:['chat']},
    deepseek:{name:'DeepSeek',base:'https://api.deepseek.com',protocol:'chat',protocols:['chat']},
    custom:{name:'其他 / 自定义',base:'',protocol:'chat',protocols:['responses','messages','chat']}
  };
  const paths = {responses:'/responses',messages:'/messages',chat:'/chat/completions'};
  const names = {responses:'Responses',messages:'Messages',chat:'Chat Completions'};
  const profiles = [];
  let editing = null, defaultId = null;
  function node(tag,text,className){
    const item=document.createElement(tag);if(text!==undefined)item.textContent=text;
    if(className)item.className=className;return item;
  }
  function clearKey(){
    el('agent-key').value='';el('agent-key').type='password';
    el('agent-key-toggle').textContent='显示';el('agent-key-toggle').setAttribute('aria-pressed','false');
  }
  function preview(){
    const base=el('agent-base').value.trim().replace(/\/+$/,'');
    el('agent-endpoint').textContent=base ? base + paths[el('agent-protocol').value] : '填写 Base URL 后显示完整地址';
  }
  function routeControls(){
    const preset=presets[el('agent-provider').value];
    const official=el('agent-route').value==='official';
    el('agent-base').readOnly=official;
    [...el('agent-protocol').options].forEach(option=>option.disabled=official&&!preset.protocols.includes(option.value));
    if(official&&!preset.protocols.includes(el('agent-protocol').value))el('agent-protocol').value=preset.protocol;
    el('agent-provider-note').textContent=official
      ? '官方预设：地址已填入，协议列表提供本原型已核对的常用接口。其他接口可通过第三方 / 自建网关方式自定义。'
      : '按网关文档选择协议、模型 ID 和接口前缀；模型厂商与传输协议可以不同。填写配置不代表网关已通过兼容性验证。';
    preview();
  }
  function presetChanged(){
    const preset=presets[el('agent-provider').value];
    const custom=el('agent-provider').value==='custom';
    el('agent-route').querySelector('[value=official]').disabled=custom;
    if(custom)el('agent-route').value='third-party';
    el('agent-protocol').value=preset.protocol;
    el('agent-base').value=el('agent-route').value==='official'?preset.base:'';
    el('agent-model').value='';clearKey();routeControls();
    el('agent-status').textContent='已切换厂商预设，请填写本次接入的模型 ID。';
  }
  function blank(){
    editing=null;el('agent-form').reset();clearKey();
    el('agent-provider').value='openai';el('agent-route').value='official';el('agent-protocol').value='responses';
    el('agent-form-title').textContent='新建 Agent 配置';
    el('agent-route').querySelector('[value=official]').disabled=false;
    el('agent-base').value=presets.openai.base;el('agent-is-default').checked=!defaultId;
    el('agent-error').textContent='';el('agent-status').textContent='';routeControls();
  }
  function readConfig(){
    el('agent-error').textContent='';
    if(!el('agent-form').reportValidity())return null;
    const name=el('agent-name').value.trim(),model=el('agent-model').value.trim();
    if(!name||!model)throw new Error('请填写有效的配置名称和模型 ID，不能只输入空格。');
    const raw=el('agent-base').value.trim();
    const url=new URL(raw);
    if(url.username||url.password||url.search||url.hash)throw new Error('Base URL 不能包含账号、密码、查询参数或片段。');
    const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
    if(url.protocol!=='https:'&&!(url.protocol==='http:'&&local))throw new Error('请填写 HTTPS 地址；本机 localhost 或回环地址可使用 HTTP。');
    const base=url.href.replace(/\/+$/,'');
    if(/\/(responses|messages|chat\/completions)$/i.test(base))throw new Error('请移除 Base URL 末尾的接口路径，完整请求地址会自动拼接。');
    const provider=el('agent-provider').value,route=el('agent-route').value,protocol=el('agent-protocol').value;
    if(route==='official'&&(base!==presets[provider].base||!presets[provider].protocols.includes(protocol)))throw new Error('官方接入请使用预设地址和协议；自定义地址请切换到第三方 / 自建网关。');
    return {id:editing||crypto.randomUUID(),name,model,provider,route,protocol,base,
      timeout:Number(el('agent-timeout').value),retries:Number(el('agent-retries').value),
      tokens:Number(el('agent-tokens').value),temperature:el('agent-temperature').value===''?null:Number(el('agent-temperature').value)};
  }
  function check(){
    try{return readConfig()}catch(error){el('agent-error').textContent=error instanceof TypeError?'请填写有效的 Base URL。':error.message;return null}
  }
  function edit(profile){
    editing=profile.id;clearKey();
    const fields={name:'name',provider:'provider',route:'route',protocol:'protocol',base:'base',model:'model',timeout:'timeout',retries:'retries',tokens:'tokens',temperature:'temperature'};
    Object.entries(fields).forEach(([id,key])=>el('agent-'+id).value=profile[key]??'');
    el('agent-route').querySelector('[value=official]').disabled=profile.provider==='custom';
    el('agent-is-default').checked=defaultId===profile.id;
    el('agent-form-title').textContent='编辑 Agent 配置';el('agent-error').textContent='';
    el('agent-status').textContent='配置仅保留在本页，未保存 API Key，也未连接模型。';routeControls();el('agent-name').focus();
  }
  function render(){
    const host=el('agent-profiles');host.replaceChildren();
    const current=profiles.find(profile=>profile.id===defaultId);
    el('agent-default').textContent=current?'默认 Agent：'+current.name+' · 未连接':'尚未设置默认 Agent';
    if(!profiles.length)host.append(node('p','还没有配置。先选择厂商，连接方式和模型由你决定。','notice'));
    profiles.forEach(profile=>{
      const item=node('article',undefined,'agent-profile');
      item.append(node('h3',profile.name+(profile.id===defaultId?' · 默认':'')),
        node('p',presets[profile.provider].name+' / '+(profile.route==='official'?'官方':'第三方 / 自建')),
        node('p',profile.model+' · '+names[profile.protocol]),node('p',profile.base),node('p','凭据未保存 · 未连接'));
      const actions=node('div',undefined,'actions');
      const editButton=node('button','编辑','text-button');editButton.type='button';editButton.onclick=()=>edit(profile);
      const choose=node('button','设为默认','text-button');choose.type='button';choose.disabled=profile.id===defaultId;
      choose.onclick=()=>{defaultId=profile.id;render();if(editing)el('agent-is-default').checked=editing===defaultId;window.message('已切换原型默认 Agent，尚未连接模型。')};
      const remove=node('button','删除','text-button');remove.type='button';remove.onclick=()=>{
        profiles.splice(profiles.findIndex(entry=>entry.id===profile.id),1);
        if(defaultId===profile.id)defaultId=null;
        if(editing===profile.id)blank();render();window.message('本页配置已删除。');
      };
      actions.append(editButton,choose,remove);item.append(actions);host.append(item);
    });
  }
  el('agent-provider').onchange=presetChanged;
  el('agent-route').onchange=()=>{
    el('agent-base').value=el('agent-route').value==='official'?presets[el('agent-provider').value].base:'';
    clearKey();routeControls();el('agent-status').textContent='接入方式已更改，请核对地址、协议和模型。';
  };
  el('agent-key-toggle').onclick=()=>{
    const show=el('agent-key').type==='password';el('agent-key').type=show?'text':'password';
    el('agent-key-toggle').textContent=show?'隐藏':'显示';el('agent-key-toggle').setAttribute('aria-pressed',String(show));
  };
  el('agent-form').addEventListener('input',()=>{el('agent-error').textContent='';el('agent-status').textContent='有未保存的修改。';preview()});
  el('agent-validate').onclick=()=>{if(check())el('agent-status').textContent='配置格式通过。尚未发送请求；模型权限、协议兼容性和连通性未验证。'};
  el('agent-form').onsubmit=event=>{
    event.preventDefault();const profile=check();if(!profile)return;
    const index=profiles.findIndex(item=>item.id===profile.id);
    if(index<0)profiles.push(profile);else profiles[index]=profile;
    if(el('agent-is-default').checked)defaultId=profile.id;else if(defaultId===profile.id)defaultId=null;
    editing=profile.id;clearKey();render();el('agent-form-title').textContent='编辑 Agent 配置';
    el('agent-status').textContent='配置已保留在本页，刷新后重置。API Key 输入已清空，凭据未保存；模型尚未连接。';
    window.message('本页配置已保存，API Key 未保存，尚未连接模型。');
  };
  el('agent-new').onclick=()=>{blank();el('agent-name').focus()};
  el('agent-cancel').onclick=()=>{blank();el('agent-status').textContent='已取消编辑，已保存的本页配置保留。'};
  document.addEventListener('reador:reset',()=>{profiles.length=0;defaultId=null;blank();render()});
  document.addEventListener('reador:view',event=>{if(event.detail!=='settings')clearKey()});
  window.addEventListener('pagehide',clearKey);
  blank();render();
})();
