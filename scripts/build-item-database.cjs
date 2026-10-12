const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const child=require('node:child_process');
const s=require('./items/source.cjs');
const assets=require('./items/assets.cjs');
const {build,slug}=require('./items/catalog.cjs');
const root=path.resolve(__dirname,'..');
const file=path.join(root,'index.html');
const html=fs.readFileSync(file,'utf8');
const pattern=/(<script class="tiddlywiki-tiddler-store" type="application\/json">)([\s\S]*?)(<\/script>)/;
const match=html.match(pattern);
if(!match)throw new Error('Missing TiddlyWiki store');
const original=JSON.parse(match[2]);
const tiddlers=new Map(original.map(t=>[t.title,t]));
const baselineFile=path.join(root,'.tmp/before-item-database.html');
const baseline=fs.existsSync(baselineFile)?new Map(JSON.parse(fs.readFileSync(baselineFile,'utf8').match(pattern)[2]).map(t=>[t.title,t])):new Map();
const catalog=build();
// Affix definitions and property metadata are shared, not repeated per item.
const affixLists={};
for(const record of catalog.bases)if(record.autoAffixes.length) {
  const key=crypto.createHash('sha256').update(JSON.stringify(record.autoAffixes)).digest('hex').slice(0,20);
  affixLists[key]=record.autoAffixes;record.autoAffixKey=key;delete record.autoAffixes;
}
function compactProperties(value) {
  if(!value||typeof value!=='object')return;
  if(Array.isArray(value)){value.forEach(compactProperties);return;}
  if(value.slot&&value.code&&value.lines){delete value.stats;delete value.parameterMeaning;delete value.valueMeaning;}
  if(value.raw)value.raw=Object.fromEntries(Object.entries(value.raw).filter(([,cell])=>cell!==''));
  Object.values(value).forEach(compactProperties);
}
compactProperties(catalog);compactProperties(affixLists);
const out=path.join(root,'data/item-database');
const temp=path.join(root,'.tmp');
fs.mkdirSync(out,{recursive:true});fs.mkdirSync(temp,{recursive:true});
const spriteManifest={palette:s.file('global/palette/units/pal.dat').absolute,assets:[...assets.chosen.values()]};
const manifestPath=path.join(temp,'item-sprites.json');
fs.writeFileSync(manifestPath,JSON.stringify(spriteManifest));
child.execFileSync(process.env.RMD_PYTHON||'python',[path.join(__dirname,'items/decode-sprites.py'),manifestPath],{stdio:'inherit'});
const decoded=new Map(JSON.parse(fs.readFileSync(path.join(temp,'item-sprites.decoded.json'),'utf8')).map(row=>[row.key,row]));
const changed=new Set();
function put(fields) {changed.add(fields.title);tiddlers.set(fields.title,{...tiddlers.get(fields.title),...fields});}
for(const asset of assets.chosen.values()) {
  const buffer=fs.readFileSync(asset.output),sourceBuffer=fs.readFileSync(asset.path);
  const details=decoded.get(asset.key);
  s.files.set('sprite:'+asset.relative,{relative:asset.relative,origin:asset.origin,sha256:crypto.createHash('sha256').update(sourceBuffer).digest('hex'),bytes:sourceBuffer.length});
  put({title:'$:/rmd/item-sprites/'+asset.key,type:'image/png',text:buffer.toString('base64'),tags:'RMDItemSprite','rmd-source-file':asset.relative,'rmd-source-origin':asset.origin,'rmd-source-sha256':crypto.createHash('sha256').update(sourceBuffer).digest('hex'),width:String(details.width),height:String(details.height)});
}
const inputFiles=[...s.files.values()].sort((a,b)=>(a.origin+a.relative).localeCompare(b.origin+b.relative));
const fingerprint=crypto.createHash('sha256').update(JSON.stringify(inputFiles)).digest('hex');
for(const [kind,records] of Object.entries(catalog)) {
  const document={schemaVersion:1,sourceFingerprint:fingerprint,records};
  fs.writeFileSync(path.join(out,kind+'.json'),JSON.stringify(document,null,2)+'\n');
  put({title:'$:/rmd/item-data/'+kind,type:'application/json',text:JSON.stringify(document),tags:'RMDItemData'});
}
const definitions={properties:Object.fromEntries(s.tables.properties.map(row=>[row.code,row])),stats:Object.fromEntries(s.tables.itemstatcost.map(row=>[row.Stat,row])),autoAffixes:affixLists};
fs.writeFileSync(path.join(out,'definitions.json'),JSON.stringify(definitions,null,2)+'\n');
put({title:'$:/rmd/item-data/definitions',type:'application/json',text:JSON.stringify(definitions),tags:'RMDItemData'});
// Preserve existing links by matching localized names, never shifted row IDs.
const normalize=value=>s.clean(value).toLowerCase().replace(/[^a-z0-9]/g,'');
const aliases=[],unmatched=[];
const ownedRecords=new Set();
const byKind={UniqueItem:'uniques',SetItem:'setitems',SetDefinition:'sets'};
const esc=value=>String(value).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
function widget(kind,ids){return `<$rmd-item kind="${kind}" ids="${esc(ids.join('|'))}"/>`;}
for(const old of original.filter(t=>!t.title.startsWith('$:/rmd/database/')&&/(?:^| )(?:ItemDatabase|RMDHistoricalItem)(?: |$)/.test(t.tags||'')&&t.name)) {
  const kind=Object.entries(byKind).find(([tag])=>(old.tags||'').split(' ').includes(tag))?.[1]||'bases';
  const legacyName=old['rmd-legacy-name']||baseline.get(old.title)?.name||old.name;
  const legacyLevel=old['rmd-legacy-level']??baseline.get(old.title)?.level??old.level??'';
  let candidates=catalog[kind].filter(record=>normalize(record.name)===normalize(legacyName)||normalize(record.nameKey)===normalize(legacyName));
  if(!candidates.length&&kind==='uniques')candidates=catalog[kind].filter(record=>normalize(record.nameKey).startsWith(normalize(legacyName))&&/facet/i.test(legacyName));
  if(!candidates.length&&kind==='setitems'&&old.setname)candidates=catalog[kind].filter(record=>normalize(record.setName)===normalize(old.setname)&&normalize(record.baseName)===normalize(legacyName));
  if(kind==='bases') {
    const pathName=old.title.split('/').pop().replace(/ \(\d+\)$/,'');
    const titleMatches=catalog[kind].filter(record=>normalize(record.name)===normalize(pathName));
    if(titleMatches.length)candidates=titleMatches;
  }
  if(kind==='bases'&&candidates.length>1) {
    const levelMatches=candidates.filter(record=>String(record.level)===String(legacyLevel));
    if(levelMatches.length)candidates=levelMatches;
    const typeMatches=candidates.filter(record=>normalize(record.itemType)===normalize(old.itemtype));
    if(typeMatches.length)candidates=typeMatches;
  }
  if(!candidates.length) {
    unmatched.push({title:old.title,name:legacyName,kind,status:'absent from confirmed source'});
    const historicalText=old['rmd-historical-text']||old.text;
    put({title:old.title,text:'This historical entry is absent from the confirmed mod files. See [[Unique Items]] for the current source-backed database.',tags:(old['rmd-legacy-tags']||old.tags).replace(/\bItemDatabase\b/g,'').trim()+' RMDHistoricalItem','rmd-historical-text':historicalText,'rmd-legacy-tags':old['rmd-legacy-tags']||old.tags,'rmd-legacy-name':legacyName,'rmd-data-kind':kind});
    continue;
  }
  const first=candidates[0];
  candidates.forEach(record=>ownedRecords.add(record.id));
  const base=first.code&&s.bases.get(first.code);
  const damagePair=base?(base.minac||base.maxac?[base.minac,base.maxac]:base['2handed']==='1'?[base['2handmindam'],base['2handmaxdam']]:[base.mindam,base.maxdam]):[];
  put({title:old.title,text:widget(kind,candidates.map(r=>r.id)),type:'text/vnd.tiddlywiki',tags:old['rmd-legacy-tags']||old.tags,name:first.name,level:first.level||'',itemtype:first.itemType,itemcategory:first.category,sockets:String(first.socketCapacity||0),speed:base?.speed||'0',damage:damagePair.every(x=>x!==''&&x!=null)&&damagePair.length?String((Number(damagePair[0])+Number(damagePair[1]))/2):'',modifiers:[...new Set((first.properties||[]).map(p=>p.code))].join(' '),setname:first.setName||'','rmd-legacy-name':legacyName,'rmd-legacy-level':legacyLevel||'','rmd-record-ids':candidates.map(r=>r.id).join('|'),'rmd-data-kind':kind,'rmd-source-fingerprint':fingerprint});
  aliases.push({title:old.title,kind,ids:candidates.map(r=>r.id)});
}
// New standalone records are native tiddlers too; existing aliases retain their URLs.
for(const [kind,records] of Object.entries(catalog))for(const record of records) {
  const title='$:/rmd/database/'+kind+'/'+encodeURIComponent(record.id);
  const tag=kind==='uniques'?'UniqueItem':kind==='setitems'?'SetItem':kind==='sets'?'SetDefinition':'';
  const legacyTags=ownedRecords.has(record.id)?'':` ItemDatabase${tag?' '+tag:''}`;
  put({title,type:'text/vnd.tiddlywiki',text:widget(kind,[record.id]),tags:'RMDItemRecord'+legacyTags,name:record.name,level:record.level||'',itemtype:record.itemType,itemcategory:record.category,'rmd-record-id':record.id,'rmd-data-kind':kind,'rmd-source-fingerprint':fingerprint});
}
for(const [title,kind] of Object.entries({'Item Bases':'bases','Unique Items':'uniques','Set Items':'sets','Runewords':'runewords'}))put({title,type:'text/vnd.tiddlywiki',text:`<$rmd-catalog kind="${kind}"/>`});
// The older public runeword tables must not retain conflicting stat snapshots.
for(const title of ['Armor Runewords','Weapon Runewords'])if(tiddlers.has(title))put({title,type:'text/vnd.tiddlywiki',text:'The current source-backed reference is maintained in [[Runewords]].\n\n<$rmd-catalog kind="runewords"/>'});
const uniqueIssues=[...new Map(s.issues.map(issue=>[JSON.stringify(issue),issue])).values()];
const audit={schemaVersion:1,sourceFingerprint:fingerprint,inputs:inputFiles,counts:Object.fromEntries(Object.entries(catalog).map(([kind,records])=>[kind,{total:records.length,enabled:records.filter(r=>r.enabled).length}])),runewordVariants:catalog.runewords.reduce((n,r)=>n+r.variants.length,0),sprites:{total:assets.chosen.size,fromMod:[...assets.chosen.values()].filter(a=>a.origin==='mod').length,fromArchive:[...assets.chosen.values()].filter(a=>a.origin==='archive').length},updatedAliases:aliases,unmatchedLegacyRecords:unmatched,sourceIssues:uniqueIssues,excludedSourceRows:s.tables.uniqueitems.filter(row=>!row.index||!row.code).map(row=>({source:row._source,index:row.index,reason:'No item code; not an item definition'}))};
fs.writeFileSync(path.join(out,'audit.json'),JSON.stringify(audit,null,2)+'\n');
if(uniqueIssues.some(issue=>['missing-base','missing-rune','missing-sprite'].includes(issue.kind)))throw new Error('Unresolved item references; inspect data/item-database/audit.json');
for(const old of original)if(!changed.has(old.title)&&JSON.stringify(old)!==JSON.stringify(tiddlers.get(old.title)))throw new Error(`Unrelated tiddler changed: ${old.title}`);
const store=JSON.stringify([...tiddlers.values()]).replace(/</g,'\\u003c');
JSON.parse(store);
const next=html.slice(0,match.index)+match[1]+store+match[3]+html.slice(match.index+match[0].length);
if(process.argv.includes('--check')) {
  if(next!==html) {
    const differences=original.filter(old=>JSON.stringify(old)!==JSON.stringify(tiddlers.get(old.title))).map(old=>({title:old.title,fields:Object.keys(tiddlers.get(old.title)).filter(key=>JSON.stringify(old[key])!==JSON.stringify(tiddlers.get(old.title)[key]))}));
    console.log('Changed tiddlers:',differences.slice(0,10));
    throw new Error('Item database is out of sync; rebuild it');
  }
  console.log('Item database is in sync.');
} else {
  const snapshot=path.join(temp,'before-item-database.html');
  if(!fs.existsSync(snapshot))fs.writeFileSync(snapshot,html);
  require('./write-wiki.cjs')(file,next,html);
  console.log(`Imported ${catalog.bases.length} bases, ${catalog.uniques.length} uniques, ${catalog.setitems.length} set items across ${catalog.sets.length} sets, and ${audit.runewordVariants} runeword variants. Updated ${aliases.length} existing item records. Preserved ${original.length-[...changed].filter(title=>original.some(t=>t.title===title)).length} unrelated tiddlers.`);
}
