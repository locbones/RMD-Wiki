const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const s=require('./source.cjs');
const mapping=new Map();
for(const [origin,root] of [['archive',s.roots.archive],['mod',s.roots.mod]]) {
  const file=path.join(root,'hd/items/items.json');
  if(!fs.existsSync(file))continue;
  const buffer=fs.readFileSync(file);
  s.files.set(`${origin}:hd/items/items.json`,{relative:'hd/items/items.json',origin,bytes:buffer.length,sha256:crypto.createHash('sha256').update(buffer).digest('hex')});
  for(const entry of JSON.parse(buffer.toString('utf8').replace(/^\uFEFF/,''))) for(const [code,value] of Object.entries(entry)) if(value?.asset) mapping.set(code,value.asset.replace(/\\/g,'/').replace(/\/+/g,'/').replace(/\.\.\//g,''));
}
const sprites=new Map();
const byStem=new Map();
function walk(root,relative,origin) {
  const directory=path.join(root,relative);
  if(!fs.existsSync(directory))return;
  for(const entry of fs.readdirSync(directory,{withFileTypes:true})) {
    const rel=relative+'/'+entry.name;
    if(entry.isDirectory())walk(root,rel,origin);
    else if(entry.name.endsWith('.sprite')&&!entry.name.endsWith('.lowend.sprite')) {
      const normalized=rel.toLowerCase();
      const candidate={path:path.join(root,rel),relative:rel,origin};
      sprites.set(normalized,candidate);
      const stem=entry.name.slice(0,-7).toLowerCase();
      const list=byStem.get(stem)||[];
      list.unshift(candidate);byStem.set(stem,list);
    }
  }
}
for(const [origin,root] of [['archive',s.roots.archive],['mod',s.roots.mod]])walk(root,'hd/global/ui/items',origin);
const chosen=new Map();
function mapped(code) {
  const asset=mapping.get(String(code));
  if(!asset)return null;
  for(const category of ['','custom/','weapon/','armor/','misc/']) {
    const candidate=sprites.get(('hd/global/ui/items/'+category+asset+'.sprite').toLowerCase());
    if(candidate)return candidate;
  }
  const suffix='/'+asset.toLowerCase()+'.sprite';
  return [...sprites.entries()].find(([key])=>key.endsWith(suffix))?.[1]||null;
}
function resolve(base,row={}) {
  const override=row.invfile;
  // D2R_Jank is the mod's deliberate legacy placeholder, not its HD artwork.
  let candidate=override&&!/D2R.?Jank/i.test(override)?mapped(override.replace(/^inv/i,'')):null;
  let method=candidate?'quality graphic':'base HD graphic';
  if(!candidate && override&&!/D2R.?Jank/i.test(override)) {candidate=byStem.get(override.toLowerCase())?.[0];method='inventory sprite name';}
  if(!candidate){candidate=mapped(base.code);method='base HD graphic';}
  if(!candidate && base.invfile) {candidate=byStem.get(base.invfile.replace(/^inv/i,'').toLowerCase())?.[0];method='base inventory sprite name';}
  if(!candidate) {
    for(const inv of [override,base.invfile].filter(Boolean)) {
      const entry=s.file(`global/items/${inv}.dc6`,false);
      if(entry) {candidate={path:entry.absolute,relative:entry.relative,origin:entry.origin};method='legacy DC6';break;}
    }
  }
  if(!candidate) {s.issues.push({kind:'missing-sprite',code:base.code,invfile:override||base.invfile});return null;}
  const key=crypto.createHash('sha256').update(candidate.relative.toLowerCase()+'\0'+candidate.origin).digest('hex').slice(0,20);
  if(!chosen.has(key))chosen.set(key,{key,...candidate,output:path.resolve(__dirname,'../../Images/database',key+'.png')});
  return {key,title:'$:/rmd/item-sprites/'+key,relative:candidate.relative,origin:candidate.origin,method,legacyOverride:override||''};
}
module.exports={resolve,chosen,mapping,sprites};
