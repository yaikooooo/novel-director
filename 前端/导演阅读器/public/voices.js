const $ = id => document.getElementById(id);
const base = '/files/' + ['公共资源','声线库'].map(encodeURIComponent).join('/') + '/';
const fileURL = relative => base + relative.split('/').map(encodeURIComponent).join('/');
const fields = {language: v=>v.labels.language, gender:v=>v.labels.gender_presentation, age:v=>v.labels.age_impression, type:v=>v.labels.voice_type, collection:v=>v.collection};
let voices=[], filtered=[], page=0, selected='', player=null, needsSetup=false;
const pageSize=30;
const node=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
const seconds=x=>Number(x).toFixed(1)+'秒';
$('guide').href=fileURL('使用说明.md');$('indexLink').href=fileURL('声线索引.json');
function filter(){
  const q=$('search').value.trim().toLocaleLowerCase();
  filtered=voices.filter(v=>Object.entries(fields).every(([id,get])=>!$(id).value||get(v)===$(id).value)&&(!q||[v.display_name,v.voice_id,...v.tags,v.source.model_title,v.source.description,...v.source.language_records.map(x=>x.value),...v.samples.map(s=>s.transcript)].join(' ').toLocaleLowerCase().includes(q)));
  page=0;
  if(!filtered.some(v=>v.voice_id===selected)){selected=filtered[0]?.voice_id||'';showDetail();}
  renderList();
}
function renderList(){
  $('list').replaceChildren();$('count').textContent=filtered.length+' / '+voices.length;
  for(const v of filtered.slice(page*pageSize,(page+1)*pageSize)){
    const b=node('button','voice-card'+(v.voice_id===selected?' active':''));b.setAttribute('aria-pressed',String(v.voice_id===selected));b.setAttribute('aria-label',v.display_name+'，'+v.collection);
    const top=node('div','top');top.append(node('span','',v.collection),node('span','',seconds(v.samples[0].technical.duration_sec)));b.append(top,node('strong','',v.display_name),node('div','card-tags',[v.labels.language,v.labels.gender_presentation,v.labels.age_impression,...v.labels.traits.slice(0,2)].join(' · ')));
    if(v.review.issues.length)b.append(node('div','flag',v.review.issues.join(' · ')));
    b.addEventListener('click',()=>{selected=v.voice_id;history.replaceState(null,'','#'+encodeURIComponent(selected));showDetail();renderList();});$('list').append(b);
  }
  if(!filtered.length)$('list').append(node('p','empty',needsSetup?'本机尚未配置声线库。请按使用说明恢复索引和样音，或从空白模板建库。':!voices.length?'声线库为空，请按使用说明添加样音。':'没有匹配的声线。试试减少筛选条件。'));
  const pages=Math.max(1,Math.ceil(filtered.length/pageSize));$('page').textContent=(page+1)+' / '+pages;$('previous').disabled=page===0;$('next').disabled=page+1>=pages;
}
function showDetail(){
  if(player){player.pause();player.removeAttribute('src');player.load();player=null;}
  const d=$('detail');d.replaceChildren();const v=voices.find(x=>x.voice_id===selected);
  if(!v){d.append(node('p','empty','选择一条声线，查看原始样音与来源。'));return;}
  d.append(node('p','detail-source',v.collection+' · '+v.review.status),node('h2','detail-title',v.display_name));
  const pills=node('div','pills');for(const t of v.tags.slice(0,14))pills.append(node('span','pill',t));d.append(pills);
  if(v.source.description)d.append(node('p','description',v.source.description));
  let sample=v.samples[0];
  const technical=node('div','technical');
  const transcript=node('div','transcript');
  const original=node('a','','打开样音原件 ↗');original.target='_blank';original.rel='noopener';
  const identity=node('p');
  const chooseSample=s=>{sample=s;player.pause();player.src=fileURL(s.path);player.load();const t=s.technical;technical.textContent=seconds(t.duration_sec)+' · '+(t.sample_rate_hz/1000)+' kHz · '+t.bit_depth+' bit · '+t.channels+'声道 · 样音 v'+s.version;transcript.textContent=s.transcript||'原清单未提供台词。';original.href=fileURL(s.path);identity.textContent=s.sample_id+' · '+s.sha256;};
  player=node('audio');player.controls=true;player.preload='metadata';player.src=fileURL(sample.path);player.setAttribute('aria-label','试听 '+v.display_name);d.append(player);
  if(v.samples.length>1){const choice=node('select');choice.setAttribute('aria-label','选择样音');v.samples.forEach((s,i)=>{const o=node('option','',s.sample_id);o.value=i;choice.append(o);});choice.addEventListener('change',()=>chooseSample(v.samples[Number(choice.value)]));d.append(choice);}
  d.append(technical);
  const id=node('div','voice-id');id.append(node('code','',v.voice_id));const copy=node('button','','复制声线 ID');copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(v.voice_id);copy.textContent='已复制';}catch{copy.textContent='请选中左侧 ID 复制';}});id.append(copy);d.append(id);
  if(v.review.issues.length){let msg=v.review.issues.join('；');if(v.review.issues.includes('来源语言标签冲突'))msg+='。原记录：'+v.source.language_records.map(x=>x.value).join(' / ');d.append(node('p','issue',msg));}
  d.append(node('p','section-label','原样音台词'));d.append(transcript);
  d.append(node('p','section-label','来源与采用'));const meta=node('dl','metadata');
  for(const [k,val] of [['原名称',v.source.model_title],['作者／说话人',v.source.creator||v.source.speaker_or_model_id],['许可备注',v.source.recorded_license||'未提供'],['标签依据','来源清单，待实际试听'],['角色绑定','由各项目角色资产包登记']]){meta.append(node('dt','',k),node('dd','',val));}d.append(meta);
  const links=node('div','detail-links');links.append(original);
  if(/^https?:\/\//i.test(v.source.page)){const a=node('a','','来源页面 ↗');a.href=v.source.page;a.target='_blank';a.rel='noopener';links.append(a);}d.append(links);
  const more=node('details');more.append(node('summary','','原始标签与记录'));more.append(node('p','',v.source.original_tags.join(' · ')),node('p','',v.source.rights_basis),identity);d.append(more);chooseSample(sample);
}
async function load(){
  $('error').hidden=true;
  try{const res=await fetch(fileURL('声线索引.json'),{cache:'no-store'});needsSetup=res.status===404;if(!res.ok&&!needsSetup)throw new Error('声线索引读取失败：'+res.status);const data=needsSetup?{voices:[]}:await res.json();voices=data.voices;
    $('indexLink').href=fileURL(needsSetup?'声线索引.example.json':'声线索引.json');
    $('stats').replaceChildren();for(const [n,label] of [[voices.length,'条声线'],[new Set(voices.map(v=>v.collection)).size,'组来源'],[voices.filter(v=>v.labels.language==='中文').length,'条中文标签']]){const e=node('div','stat');e.append(node('strong','',n),node('span','',label));$('stats').append(e);}
    for(const [id,get] of Object.entries(fields)){const previous=$(id).value;$(id).replaceChildren();const all=node('option','','全部');all.value='';$(id).append(all);for(const v of [...new Set(voices.map(get))].sort((a,b)=>a.localeCompare(b,'zh-CN'))){const o=node('option','',v);o.value=v;$(id).append(o);}$(id).value=previous;}
    const fromHash=decodeURIComponent(location.hash.slice(1));selected=voices.some(v=>v.voice_id===fromHash)?fromHash:selected;filter();showDetail();
  }catch(e){$('error').textContent=e.message;$('error').hidden=false;}
}
$('search').addEventListener('input',filter);for(const id of Object.keys(fields))$(id).addEventListener('change',filter);
$('reset').addEventListener('click',()=>{$('search').value='';for(const id of Object.keys(fields))$(id).value='';filter();});
$('previous').addEventListener('click',()=>{page--;renderList();});$('next').addEventListener('click',()=>{page++;renderList();});$('refresh').addEventListener('click',load);
window.addEventListener('hashchange',()=>{const id=decodeURIComponent(location.hash.slice(1));if(voices.some(v=>v.voice_id===id)){selected=id;showDetail();renderList();}});
load();
