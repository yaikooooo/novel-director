import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=await fs.realpath(path.resolve(here,'../../公共资源/声线库'));
const data=JSON.parse(await fs.readFile(path.join(root,'声线索引.json'),'utf8'));
const issues=[];const ids=new Set(),sampleIds=new Set(),hashes=new Map();
const check=(ok,field,message)=>{if(!ok)issues.push({field,message});};
const contained=p=>{const r=path.relative(root,p);return r!==''&&!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r);};
check(data.schema_version===1,'schema_version','需要声线库版本1');
check(Array.isArray(data.voices)&&data.voices.length>0,'voices','缺少声线记录');
const counts={voices:0,samples:0,bytes:0,collections:{},languages:{},language_conflicts:0,short_samples:0};
for(const v of data.voices||[]){
  const id=v.voice_id||'(缺少ID)';counts.voices++;
  check(/^VOICE-[A-Za-z0-9_-]+$/.test(id)&&!ids.has(id),id,'声线ID格式不正确或重复');ids.add(id);
  check(Number.isInteger(v.version)&&v.version>0,id+'.version','版本须为正整数');
  for(const key of ['display_name','collection','tag_basis'])check(typeof v[key]==='string'&&v[key].length>0,id+'.'+key,'字段为空');
  for(const key of ['language','gender_presentation','age_impression','accent','voice_type'])check(typeof v.labels?.[key]==='string'&&v.labels[key].length>0,id+'.labels.'+key,'标签为空');
  check(Array.isArray(v.tags)&&Array.isArray(v.labels?.traits),id+'.tags','标签必须为数组');
  check(v.review?.status&&Array.isArray(v.review?.issues),id+'.review','缺少试听状态或问题列表');
  check(v.source?.page&&v.source?.recorded_license&&v.source?.rights_basis,id+'.source','缺少来源或许可记录');
  check(Array.isArray(v.samples)&&v.samples.length>0,id+'.samples','缺少样音');
  counts.collections[v.collection]=(counts.collections[v.collection]||0)+1;
  counts.languages[v.labels?.language]=(counts.languages[v.labels?.language]||0)+1;
  if(v.review?.issues?.includes('来源语言标签冲突'))counts.language_conflicts++;
  if(v.review?.issues?.includes('样音短于5秒'))counts.short_samples++;
  for(const s of v.samples||[]){
    const field=id+'/'+s.sample_id;counts.samples++;counts.bytes+=s.bytes||0;
    check(typeof s.sample_id==='string'&&!sampleIds.has(s.sample_id),field,'样音ID为空或重复');sampleIds.add(s.sample_id);
    check(Number.isInteger(s.version)&&s.version>0,field,'样音版本须为正整数');
    if(typeof s.path!=='string'||path.isAbsolute(s.path)||/^[a-z]+:/i.test(s.path)||/(^|[\\/])(临时|\.\.)([\\/]|$)/.test(s.path)){issues.push({field,message:'样音路径须在公共声线库内'});continue;}
    try{
      const file=await fs.realpath(path.resolve(root,s.path));if(!contained(file))throw new Error('样音越出声线库');
      const bytes=await fs.readFile(file);const hash=crypto.createHash('sha256').update(bytes).digest('hex');
      check(bytes.length===s.bytes,field,'文件大小不符');check(hash===s.sha256,field,'SHA-256不符');
      check(!hashes.has(hash),field,'与'+hashes.get(hash)+'重复');hashes.set(hash,field);
      const t=s.technical;check(t?.duration_sec>0&&t?.sample_rate_hz>0&&t?.channels>0,field,'技术参数无效');
      if(path.extname(file).toLowerCase()==='.wav'){
        check(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WAVE',field,'不是有效RIFF/WAVE');
        let fmt=null,dataSize=null;
        for(let pos=12;pos+8<=bytes.length;){const key=bytes.toString('ascii',pos,pos+4),n=bytes.readUInt32LE(pos+4);if(pos+8+n>bytes.length)throw new Error('WAV块超出文件');if(key==='fmt '&&n>=16)fmt={channels:bytes.readUInt16LE(pos+10),rate:bytes.readUInt32LE(pos+12),align:bytes.readUInt16LE(pos+20),bits:bytes.readUInt16LE(pos+22)};if(key==='data')dataSize=n;pos+=8+n+(n%2);}
        if(!fmt||dataSize===null)throw new Error('WAV缺少fmt/data块');
        check(fmt.channels===t.channels&&fmt.rate===t.sample_rate_hz&&fmt.bits===t.bit_depth,field,'WAV参数不符');
        check(Math.abs(dataSize/fmt.align/fmt.rate-t.duration_sec)<.002,field,'WAV时长不符');
      }
    }catch(e){issues.push({field,message:e.message});}
  }
}
for(const key of ['voices','samples','bytes','language_conflicts','short_samples'])check(data.summary?.[key]===counts[key],'summary.'+key,'汇总计数不符');
for(const key of ['collections','languages'])check(JSON.stringify(Object.entries(data.summary?.[key]||{}).sort())===JSON.stringify(Object.entries(counts[key]).sort()),'summary.'+key,'分类汇总不符');
console.log(JSON.stringify({valid:issues.length===0,counts,issues},null,2));
process.exitCode=issues.length?1:0;
