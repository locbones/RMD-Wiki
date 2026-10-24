// Current mod tables are authoritative; existing catalogs supply links and art only.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const s=require('../items/source.cjs');
const root=path.resolve(__dirname,'../..'),num=v=>Number(v||0),g=s.get;
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const source=r=>({...r._source});
const token=v=>String(v||'').replace(/"/g,'').split(',')[0].trim();
function build(){
  const issues=[],tcRows=s.table('treasureclassex'),ratios=s.table('itemratio'),levelRows=s.table('levels'),suRows=s.table('superuniques');
  const bestiary=read('data/bestiary.json'),oldMonsters=new Map(bestiary.records.map(r=>[r.id,r]));
  const oldItems=new Map(['bases','uniques','setitems','runewords'].flatMap(kind=>read('data/item-database/'+kind+'.json').records).map(r=>[r.id,r]));
  const recipes=s.tables.cubemain.filter(r=>r.enabled==='1');
  const creations=new Map();
  for(const r of recipes){
    const inputs=Array.from({length:7},(_,i)=>r['input '+(i+1)]).filter(Boolean);
    for(const output of [r.output,r['output b'],r['output c']].filter(Boolean)){
      const key=token(output);if(inputs.some(i=>token(i)===key)||['useitem','usetype'].includes(key))continue;
      const list=creations.get(key)||[];list.push({name:r.description,inputs,output,condition:[r.op,r.param,r.value].some(Boolean)?{op:r.op,param:r.param,value:r.value}:null,source:source(r)});creations.set(key,list);
    }
  }
  const setGroups=new Map();
  for(const r of s.tables.setitems.filter(r=>r.index&&r.item)){const list=setGroups.get(r.set)||[];list.push(r);setGroups.set(r.set,list);}
  const pacts=new Set([...setGroups].filter(([,members])=>members.every(r=>r.rarity==='0'&&creations.has(r.index))).map(([key])=>key));
  const items=[],bases={};
  function addItem(r,kind){
    const code=kind==='base'?r.code:kind==='unique'?r.code:r.item,base=s.bases.get(code);if(!base)return;
    const id=kind==='base'?'base:'+code:(kind==='unique'?'unique:':'setitem:')+(g(r,'*ID')||r._source.line),old=oldItems.get(id);
    const item={id,kind,code,key:kind==='base'?code:r.index,name:s.name(kind==='base'?(r.namestr||code):r.index,kind==='base'?r.name:r.index),baseName:s.name(base.namestr||code,base.name),category:s.category(base),type:s.itemTypes.get(base.type.toLowerCase())?.ItemType||base.type,level:num(kind==='base'?base.level:r.lvl),rarity:num(r.rarity),enabled:kind!=='unique'||r.enabled==='1',source:source(r),image:old?.image?.title||null,title:old?'$:/rmd/database/'+(kind==='base'?'bases':kind==='unique'?'uniques':'setitems')+'/'+encodeURIComponent(id):null,recipes:creations.get(kind==='base'?code:r.index)||[],recipeOnly:kind==='set'&&pacts.has(r.set),setName:kind==='set'?s.name(r.set,r.set):'',nolimit:r.nolimit==='1',ladder:r.ladder==='1'};
    // Riddle solutions must never be shipped in the public catalog. Keep the
    // complete creation index above for drop eligibility, but publish only
    // ordinary recipes (including their ingredients, conditions and sources).
    item.recipes=item.recipes.filter(recipe=>! /\briddle\b/i.test(recipe.name));
    if(!item.image)item.image=oldItems.get('base:'+code)?.image?.title||null;
    if(kind==='set')item.cowOnly=r.set==="Cow King's Leathers";
    items.push(item);return item;
  }
  for(const r of s.bases.values()){
    if(!r.type)continue;addItem(r,'base');const type=s.itemTypes.get(r.type.toLowerCase());
    const ancestors=new Set([...s.ancestors(r.type),...s.ancestors(r.type2)]);
    bases[r.code]={code:r.code,level:num(r.level),types:[...ancestors],type:r.type,rarity:Math.max(num(type?.Rarity),1),spawnable:r.spawnable==='1',quest:num(r.quest),uber:!num(r.quest)&&!ancestors.has('tpot')&&(ancestors.has('armo')||ancestors.has('weap'))&&(r.ubercode===r.code||r.ultracode===r.code),normal:type?.Normal==='1',magic:type?.Magic==='1',rare:type?.Rare==='1',unique:r.unique==='1',classSpecific:!!type?.Class};
  }
  for(const r of s.tables.uniqueitems)if(r.index&&r.code)addItem(r,'unique');
  for(const r of s.tables.setitems)if(r.index&&r.item)addItem(r,'set');
  for(const nameKey of new Set(s.tables.runes.filter(r=>r.Name).map(r=>r.Name))){
    const id='runeword:'+nameKey,old=oldItems.get(id),rows=s.tables.runes.filter(r=>r.Name===nameKey),active=rows.filter(r=>r.complete==='1');
    const components=[...new Set(active.flatMap(r=>Array.from({length:6},(_,i)=>r['Rune'+(i+1)]).filter(Boolean)))];
    items.push({id,kind:'runeword',key:nameKey,name:s.name(nameKey,old?.name||rows[0]['*RuneName']||nameKey),code:'',baseName:'Socketed base + rune sequence',category:'runeword',type:'Runeword',level:0,enabled:!!active.length,recipeOnly:true,components,title:old?'$:/rmd/database/runewords/'+encodeURIComponent(id):'Runewords',image:old?.variants?.find(v=>v.enabled)?.exampleBase?.image?.title||null,recipes:[],source:rows[0]?source(rows[0]):null});
  }
  const byId=new Map(items.map(i=>[i.id,i])),uniqueNames=new Map(items.filter(i=>i.kind==='unique').map(i=>[i.key,i.id])),setNames=new Map(items.filter(i=>i.kind==='set').map(i=>[i.key,i.id]));
  const classes=[],classMap=new Map();
  function addTC(tc){if(classMap.has(tc.name))throw Error('Duplicate treasure class '+tc.name);classes.push(tc);classMap.set(tc.name,tc);}
  // Standard Expansion engine: 3-level buckets through 96. Weight is the
  // primary item type's Rarity, not the item's rarity column.
  for(const type of s.tables.itemtypes.filter(r=>r.TreasureClass==='1'))for(let level=3;level<=96;level+=3){
    const entries=Object.values(bases).filter(b=>b.spawnable&&!b.quest&&b.types.includes(type.Code.toLowerCase())&&(!b.types.includes('tpot')||type.Code==='tpot')&&b.level>level-3&&b.level<=level).map(b=>({kind:'item',ref:'base:'+b.code,weight:b.rarity,token:b.code}));
    addTC({name:type.Code+level,group:0,level:level-3,picks:1,noDrop:0,quality:[0,0,0,0],entries,generated:true,source:source(type)});
  }
  for(const r of tcRows)addTC({name:r['Treasure Class'],group:num(r.group),level:num(r.level),picks:num(r.Picks)||1,noDrop:num(r.NoDrop),quality:['Unique','Set','Rare','Magic'].map(k=>num(r[k])),entries:[],source:source(r)});
  for(const r of tcRows){const tc=classMap.get(r['Treasure Class']);for(let i=1;i<=10;i++){
    const raw=r['Item'+i];if(!raw)break;const ref=token(raw),weight=num(r['Prob'+i]);if(weight<=0)continue;
    let kind,target;if(bases[ref]){kind='item';target='base:'+ref;}else if(classMap.has(ref)){kind='tc';target=ref;}else if(uniqueNames.has(ref)){kind='item';target=uniqueNames.get(ref);}else if(setNames.has(ref)){kind='item';target=setNames.get(ref);}else{issues.push({kind:ref==='NaN'?'empty-placeholder':'unresolved-loot-entry',table:tc.name,entry:raw,source:tc.source});continue;}
    tc.entries.push({kind,ref:target,weight,token:raw,slot:i});
  }}
  // Build a reachability index once. No false zeroes from unresolved references.
  const visiting=new Set(),reach=new Map();
  function reachable(name){if(reach.has(name))return reach.get(name);if(visiting.has(name))throw Error('Cyclic treasure class '+name);visiting.add(name);const found=new Set();for(const e of classMap.get(name).entries){if(e.kind==='tc')for(const id of reachable(e.ref))found.add(id);else{found.add(e.ref);const item=byId.get(e.ref);if(item)found.add('base:'+item.code);}}visiting.delete(name);reach.set(name,found);return found;}
  for(const tc of classes){reachable(tc.name);tc.total=tc.entries.reduce((n,e)=>n+e.weight,0);}
  for(const item of items){item.inTables=item.kind==='runeword'?false:classes.some(tc=>tc.entries.some(e=>e.kind==='item'&&(e.ref===item.id||(item.kind!=='base'&&e.ref==='base:'+item.code))));item.search=[item.name,item.key,item.code,item.baseName,item.type,item.setName,item.recipeOnly?(item.kind==='set'?'crafting Forsaken Pacts':'crafting runes'):''].join(' ').toLowerCase();}
  const areas=levelRows.filter(r=>num(r.Id)>0).map(r=>{let name=s.name(r.LevelName,r.Name);if(/Level \d+$/i.test(r.LevelName)&&! /\d/.test(name))name=r.LevelName;return {id:r.Id,name,act:num(r.Act)+1,levels:['','(N)','(H)'].map(z=>num(g(r,'MonLvlEx'+z)||g(r,'MonLvl'+z))),source:source(r)};}),areaMap=new Map(areas.map(a=>[a.id,a]));
  // Keep the raw selection pool: NumMon is drawn before isSpawn filtering.
  for(const a of areas){const r=levelRows.find(r=>r.Id===a.id);a.population={density:['','(N)','(H)'].map(z=>num(g(r,'MonDen'+z))),size:['','(N)','(H)'].map(z=>[num(g(r,'SizeX'+z)),num(g(r,'SizeY'+z))]),types:num(r.NumMon),rangedFirst:r.rangedspawn==='1',pools:['mon','nmon'].map(prefix=>Array.from({length:25},(_,i)=>r[prefix+(i+1)]).filter(Boolean)),elitePacks:['','(N)','(H)'].map(z=>[num(g(r,'MonUMin'+z)),num(g(r,'MonUMax'+z))])};}
  const spawnMonsters=Object.fromEntries(s.tables.monstats.map(r=>[r.Id,{id:r.Id,name:s.name(r.NameStr,r.Id),weight:num(r.Rarity),min:['fallen1','scarab1'].includes(r.BaseId)?1:num(r.MinGrp),max:['fallen1','scarab1'].includes(r.BaseId)?1:num(r.MaxGrp),sparse:num(r.sparsePopulate),partyRange:[num(r.PartyMin),num(r.PartyMax)],partyIds:[r.minion1,r.minion2].filter(Boolean),ranged:r.rangedtype==='1',isSpawn:r.isSpawn==='1',replacement:r.placespawn==='1'?r.spawn:null}]));
  const monsterMap=new Map(s.tables.monstats.map(r=>[r.Id,r]));
  const campaign={andariel:'37',duriel:'73',mephisto:'102',diablo:'108',baalcrab:'132'};
  function locations(id,row){
    const locs=(oldMonsters.get(id)?.locations||[]).filter(l=>areaMap.has(l.area)&&l.method==='Fixed map placement').map(l=>({area:l.area,difficulty:l.difficulty,method:l.method}));
    if(!id.startsWith('su:'))for(const r of levelRows)for(let n=1;n<=25;n++){
      if(r['mon'+n]===id)locs.push({area:r.Id,difficulty:0,method:'Random spawn pool'});
      if(r['nmon'+n]===id)for(const d of [1,2])locs.push({area:r.Id,difficulty:d,method:'Random spawn pool'});
      if(r['umon'+n]===id)locs.push({area:r.Id,difficulty:0,method:'Unique spawn pool'});
    }
    if(campaign[id]&&areaMap.has(campaign[id]))for(let d=0;d<3;d++)locs.push({area:campaign[id],difficulty:d,method:'Campaign quest encounter'});
    return [...new Map(locs.filter(l=>areaMap.has(l.area)).map(l=>[l.area+'|'+l.difficulty+'|'+l.method,l])).values()];
  }
  const locationIndex=new Map(s.tables.monstats.map(r=>[r.Id,locations(r.Id,r)]));
  for(const r of suRows)locationIndex.set('su:'+r.Superunique,locations('su:'+r.Superunique,monsterMap.get(r.Class)));
  // Resolve current spawn/minion relationships, rather than retaining stale
  // inherited locations from an older Bestiary import.
  for(let pass=0;pass<3;pass++)for(const parent of [...s.tables.monstats.map(r=>({id:r.Id,row:r,name:s.name(r.NameStr,r.Id)})),...suRows.map(r=>({id:'su:'+r.Superunique,row:monsterMap.get(r.Class),name:s.name(r.Name,r.Superunique)}))]){
    if(!parent.row)continue;
    for(const child of [parent.row.spawn,parent.row.minion1,parent.row.minion2].filter(Boolean)){
      const list=locationIndex.get(child);if(!list)continue;
      for(const l of locationIndex.get(parent.id)||[])if(!list.some(x=>x.area===l.area&&x.difficulty===l.difficulty))list.push({area:l.area,difficulty:l.difficulty,method:'Spawned by '+parent.name});
    }
  }
  const sources=[];
  for(const r of s.tables.monstats){
    if(r.enabled!=='1'||r.killable!=='1'||r.npc==='1'||r.inTown==='1'||num(r.Align)>0)continue;
    const old=oldMonsters.get(r.Id),name=s.name(r.NameStr,r.Id);
    const tc=['','(N)','(H)'].map(z=>Object.fromEntries([['standard','TreasureClass1'],['champion','TreasureClass2'],['unique','TreasureClass3'],['quest','TreasureClass4'],['desecrated','TreasureClassDesecrated'],['desecratedChampion','TreasureClassDesecratedChamp'],['desecratedUnique','TreasureClassDesecratedUnique']].map(([mode,key])=>[mode,mode==='quest'&&!num(r.TCQuestId)?'':g(r,key+z)])));
    sources.push({id:'monster:'+r.Id,monster:r.Id,name,kind:r.boss==='1'?'boss':'monster',title:old?.title||null,levels:['','(N)','(H)'].map(z=>num(g(r,'Level'+z))),boss:r.boss==='1',noRatio:r.noRatio==='1',tc,locations:locationIndex.get(r.Id)||[],source:source(r)});
  }
  for(const r of suRows){const base=monsterMap.get(r.Class);if(!base||base.enabled!=='1')continue;const id='su:'+r.Superunique,old=oldMonsters.get(id);sources.push({id,monster:r.Class,name:s.name(r.Name,r.Superunique),kind:'superunique',title:old?.title||null,levels:['','(N)','(H)'].map(z=>num(g(base,'Level'+z))),boss:base.boss==='1',noRatio:base.noRatio==='1',tc:['','(N)','(H)'].map(z=>({standard:g(r,'TC'+z),desecrated:g(r,'TC'+z+' Desecrated')})),locations:locationIndex.get(id)||[],source:source(r)});}
  for(const src of sources)src.onePerGame=src.kind==='boss'||src.kind==='superunique'||(monsterMap.get(src.monster)?.isSpawn!=='1'&&suRows.some(r=>r.Class===src.monster));
  const populationAudit=require('./population.cjs').build(s,areas,sources,s.tables.monstats,suRows,issues);
  for(const src of sources){src.search=[...new Set([src.name,src.monster,src.id,...src.locations.map(l=>areaMap.get(l.area)?.name),...src.tc.flatMap(t=>Object.values(t))])].join(' ').toLowerCase();for(const group of src.tc)for(const name of Object.values(group))if(name&&!classMap.has(name)&&!issues.some(i=>i.monster===src.id&&i.table===name))issues.push({kind:'unresolved-monster-table',monster:src.id,table:name});}
  const inputs=[...s.files.values()].sort((a,b)=>(a.origin+a.relative).localeCompare(b.origin+b.relative));
  const fingerprint=crypto.createHash('sha256').update(JSON.stringify(inputs)).digest('hex');
  return {schemaVersion:1,fingerprint,items,bases,types:Object.fromEntries(s.tables.itemtypes.map(t=>[t.Code,t.ItemType])),classes,sources,areas,spawnMonsters,populationAudit,columns:{treasureclassex:Object.keys(tcRows[0])},ratios,issues,inputs,assumptions:{dropCap:6,ruleSet:'Standard Expansion treasure-class and quality rolls, with ReMoDDeD Forsaken Pact recipe exclusions',locations:'Current levels.txt spawn pools plus the Bestiary fixed-placement index and campaign quest encounters',population:'Density-based area population with sampled elite packs, minions, current DS1 layout alternatives and verified campaign/seal/wave encounters. Procedural geometry, placement success and elite allocation remain approximations; skill summons and unbound scripts are excluded.',excluded:'Server/plugin/scripted rewards without a table binding, quest rewards outside treasure classes, affix rolls, sockets and ethereal rolls'}};
}
module.exports={build};
