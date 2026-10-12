const s=require('./source.cjs');
const p=require('./properties.cjs');
const assets=require('./assets.cjs');
const slug=text=>s.clean(text).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const num=value=>value!==''&&Number.isFinite(Number(value))?Number(value):null;
const textLines=properties=>properties.flatMap(prop=>prop.lines||[]);
// Forsaken Pacts do not drop: every piece has zero rarity and an enabled
// creation recipe. Recipes that consume the same piece are rerolls, not forging.
const creationOutputs=new Set(s.tables.cubemain.filter(recipe=>recipe.enabled==='1').flatMap(recipe=>{
  const inputs=Array.from({length:7},(_,n)=>(recipe[`input ${n+1}`]||'').split(',')[0]);
  return [recipe.output,recipe['output b'],recipe['output c']].filter(output=>output&&!inputs.includes(output));
}));
const setMembers=new Map();
for(const row of s.tables.setitems.filter(row=>row.index&&row.item)) {
  const members=setMembers.get(row.set)||[];members.push(row);setMembers.set(row.set,members);
}
const forsakenPacts=new Set([...setMembers].filter(([,members])=>members.every(row=>row.rarity==='0'&&creationOutputs.has(row.index))).map(([key])=>key));
function tier(base) {
  if(/^lb/i.test(base.type)||/Limit Break| - LB/i.test(base.name))return 'L';
  if(base.code===base.ultracode&&base.ultracode!==base.normcode)return 'III';
  if(base.code===base.ubercode&&base.ubercode!==base.normcode)return 'II';
  return 'I';
}
function source(row) {return {...row._source,id:s.get(row,'*ID')||row.code||row.index||row.Name||''};}
function nameSource(key) {const entry=s.lookup(key);return {key,...(entry?{file:entry.file,origin:entry.origin,id:entry.id}:{fallback:true})};}
function baseStats(row) {
  const list=[];
  const add=(label,value)=>{if(value!==''&&value!=null)list.push({label,value:String(value)});};
  const cat=s.category(row);
  if(row.minac||row.maxac)add('Base defense',p.range(row.minac,row.maxac));
  if(num(row.mindam)>0||num(row.maxdam)>0)add(cat==='armor'?(s.ancestors(row.type).has('boot')?'Base kick damage':'Base smite damage'):'Base one-handed damage',p.range(row.mindam,row.maxdam));
  if(num(row['2handmindam'])>0||num(row['2handmaxdam'])>0)add('Base two-handed damage',p.range(row['2handmindam'],row['2handmaxdam']));
  if(num(row.minmisdam)>0||num(row.maxmisdam)>0)add('Base throwing damage',p.range(row.minmisdam,row.maxmisdam));
  if(cat==='weapon'||cat==='armor') {
    add('Base strength requirement',row.reqstr||'0');add('Base dexterity requirement',row.reqdex||'0');add('Base speed',row.speed||'0');
    if(row.durability&&row.nodurability!=='1')add('Base durability',row.durability);
    if(row.block)add('Base blocking',row.block+'%');
    if(row.rangeadder)add('Melee range adder',row.rangeadder);
    if(row.StrBonus)add('Strength damage bonus',row.StrBonus+'%');
    if(row.DexBonus)add('Dexterity damage bonus',row.DexBonus+'%');
  }
  if(row.invwidth&&row.invheight)add('Inventory size',`${row.invwidth} × ${row.invheight}`);
  if(row.gemsockets) {
    const type=s.itemTypes.get(row.type.toLowerCase());
    const cap=Number(row.gemsockets);
    if(type&&cap>0) {
      const low=Number(type.MaxSocketsLevelThreshold1||25),mid=Number(type.MaxSocketsLevelThreshold2||40);
      add(`Sockets, ilvl 1–${low}`,Math.min(cap,Number(type.MaxSockets1||0)));
      add(`Sockets, ilvl ${low+1}–${mid}`,Math.min(cap,Number(type.MaxSockets2||0)));
      add(`Sockets, ilvl ${mid+1}+`,Math.min(cap,Number(type.MaxSockets3||0)));
    } else add('Socket capacity',cap);
  }
  if(row.stackable==='1')add('Stack size',p.range(row.minstack||'1',row.maxstack));
  return list;
}
function baseInfo(row,qualityRow) {
  const type=s.itemTypes.get(row.type.toLowerCase());
  const stringKey=row.namestr||row.code;
  return {code:row.code,name:s.name(stringKey,row.name),nameKey:stringKey,nameSource:nameSource(stringKey),category:s.category(row),itemType:type?.ItemType||row.type,tier:tier(row),baseStats:baseStats(row),baseSource:source(row),image:assets.resolve(row,qualityRow),className:type?.Class?s.tables.charstats.find(c=>c.class.slice(0,3).toLowerCase()===type.Class)?.class||type.Class:'',socketCapacity:Number(row.gemsockets||0)};
}
const gemByCode=new Map(s.tables.gems.filter(g=>g.code).map(g=>[g.code,g]));
function gemMods(row) {
  const gem=gemByCode.get(row.code);
  if(!gem)return [];
  return ['weapon','helm','shield'].map(context=>({context:context==='helm'?'Armor / helm':context==='weapon'?'Weapons':'Shields',properties:p.slots(gem,context+'Mod',context+'Mod',context+'Mod',context+'Mod',0)})).map((entry,n)=>{
    const context=['weapon','helm','shield'][n];
    entry.properties=[];
    for(let i=1;i<=3;i++) {
      const code=gem[`${context}Mod${i}Code`];if(!code)continue;
      const prop={code,param:gem[`${context}Mod${i}Param`]||'',min:gem[`${context}Mod${i}Min`]||'',max:gem[`${context}Mod${i}Max`]||'',source:source(gem),slot:`${context}Mod${i}Code`};
      prop.lines=p.describe(prop);entry.properties.push(prop);
    }
    return entry;
  }).filter(entry=>entry.properties.length);
}
function automods(row) {
  const group=row['auto prefix'];if(!group||group==='0')return [];
  const types=s.ancestors(row.type);
  return s.tables.automagic.filter(affix=>{
    if(affix.group!==group||affix.spawnable==='0')return false;
    const allowed=Array.from({length:7},(_,n)=>affix[`itype${n+1}`]).filter(Boolean);
    const excluded=Array.from({length:5},(_,n)=>affix[`etype${n+1}`]).filter(Boolean);
    return (!allowed.length||allowed.some(code=>types.has(code.toLowerCase())))&&!excluded.some(code=>types.has(code.toLowerCase()));
  }).map(affix=>{
    const properties=[];
    for(let n=1;n<=3;n++) {
      const code=affix[`mod${n}code`];if(!code)continue;
      const prop={code,param:affix[`mod${n}param`]||'',min:affix[`mod${n}min`]||'',max:affix[`mod${n}max`]||'',slot:`mod${n}code`,source:source(affix)};
      prop.lines=p.describe(prop);properties.push(prop);
    }
    return {name:affix.Name||affix.name||'',group,level:affix.level,maxLevel:affix.maxlevel,frequency:affix.frequency,properties,source:source(affix)};
  });
}
function buildBases() {
  return [...s.tables.weapons,...s.tables.armor,...s.tables.misc].filter(row=>row.code&&row.type).map(row=>{
    const info=baseInfo(row);
    const record={id:'base:'+row.code,kind:'bases',...info,name:info.name,level:row.level,requiredLevel:row.levelreq||'0',properties:[],socketBonuses:gemMods(row),autoAffixes:automods(row),spawnable:row.spawnable==='1',enabled:true,source:source(row),raw:row};
    const type=s.itemTypes.get(row.type.toLowerCase());
    if(type?.StaffMods)record.staffmodClass=s.tables.charstats.find(c=>c.class.slice(0,3).toLowerCase()===type.StaffMods)?.class||type.StaffMods;
    record.search=[record.name,record.code,record.itemType,...record.baseStats.map(x=>x.label+' '+x.value),...record.socketBonuses.flatMap(x=>textLines(x.properties)),...record.autoAffixes.flatMap(x=>textLines(x.properties))].join('\n');
    return record;
  });
}
function buildQuality(rows,kind) {
  return rows.filter(row=>row.index&&(kind==='uniques'?row.code:row.item)).map(row=>{
    const code=kind==='uniques'?row.code:row.item;
    const base=s.bases.get(code);
    if(!base){s.issues.push({kind:'missing-base',quality:kind,name:row.index,code,source:source(row)});return null;}
    const info=baseInfo(base,row);
    const id=s.get(row,'*ID')||row._source.line;
    const properties=p.slots(row,'prop','par','min','max',kind==='uniques'?12:9);
    const record={...info,id:(kind==='uniques'?'unique:':'setitem:')+id,kind,name:s.name(row.index,row.index),nameKey:row.index,nameSource:nameSource(row.index),baseName:info.name,level:row.lvl,requiredLevel:row['lvl req']||'0',rarity:row.rarity||'0',enabled:kind==='uniques'?row.enabled==='1':true,carryOne:row.carry1==='1',properties,source:source(row),raw:row};
    if(kind==='setitems') {
      if(forsakenPacts.has(row.set))record.tier='F';
      record.setKey=row.set;
      record.setName=s.name(row.set,row.set);
      record.partialBonuses=[];
      for(let n=1;n<=5;n++) {
        const bonuses=[];
        for(const suffix of ['a','b']) {
          const code=row[`aprop${n}${suffix}`];if(!code)continue;
          const prop={code,param:row[`apar${n}${suffix}`]||'',min:row[`amin${n}${suffix}`]||'',max:row[`amax${n}${suffix}`]||'',slot:`aprop${n}${suffix}`,source:source(row)};
          prop.lines=p.describe(prop);bonuses.push(prop);
        }
        if(bonuses.length)record.partialBonuses.push({count:Number(row['add func'])?n+1:1,label:Number(row['add func'])?`${n+1} items`:'Always active',properties:bonuses});
      }
      record.addFunction=row['add func'];
    }
    record.search=[record.name,record.baseName,record.code,record.itemType,record.setName||'',...(record.tier==='F'?['Forsaken Pacts']:[]),...textLines(properties),...(record.partialBonuses||[]).flatMap(b=>textLines(b.properties))].join('\n');
    return record;
  }).filter(Boolean);
}
function buildSets(items) {
  return s.tables.sets.filter(row=>row.index).map(row=>{
    const members=items.filter(item=>item.setKey===row.index);
    const partialBonuses=[];
    for(let n=2;n<=5;n++) {
      const list=[];
      for(const suffix of ['a','b']) {
        const code=row[`PCode${n}${suffix}`];if(!code)continue;
        const prop={code,param:row[`PParam${n}${suffix}`]||'',min:row[`PMin${n}${suffix}`]||'',max:row[`PMax${n}${suffix}`]||'',slot:`PCode${n}${suffix}`,source:source(row)};
        prop.lines=p.describe(prop);list.push(prop);
      }
      if(list.length)partialBonuses.push({count:n,label:`${n} items`,properties:list});
    }
    const properties=p.slots(row,'FCode','FParam','FMin','FMax',8);
    const record={id:'set:'+row.index,kind:'sets',name:s.name(row.name||row.index,row.index),nameKey:row.name||row.index,nameSource:nameSource(row.name||row.index),category:'set',itemType:'Set',tier:forsakenPacts.has(row.index)?'F':'',enabled:members.length>0,items:members,properties,partialBonuses,source:source(row),raw:row};
    record.requiredLevel=String(Math.max(0,...members.map(item=>Number(item.requiredLevel||0))));
    record.level=String(Math.max(0,...members.map(item=>Number(item.level||0))));
    record.search=[record.name,...textLines(properties),...partialBonuses.flatMap(x=>textLines(x.properties)),...members.map(item=>item.search)].join('\n');
    return record;
  });
}
function exampleBaseSelector(bases) {
  const candidates=bases.filter(base=>base.spawnable).map(base=>{
    const types=s.ancestors(base.raw.type);s.ancestors(base.raw.type2,types);
    const type=s.itemTypes.get(base.raw.type.toLowerCase());
    const capacity=Math.min(base.socketCapacity,Number(base.raw.invwidth||0)*Number(base.raw.invheight||0),Math.max(...[1,2,3].map(n=>Number(type?.['MaxSockets'+n]||0))));
    return {base,types,capacity};
  });
  return variant=>{
    if(!variant.sockets||!variant.allowedTypes.length)return null;
    const matching=candidates.filter(candidate=>variant.allowedTypes.some(t=>candidate.types.has(t.code.toLowerCase()))&&!variant.excludedTypes.some(t=>candidate.types.has(t.code.toLowerCase())));
    const compatible=matching.filter(candidate=>candidate.capacity>=variant.sockets);
    const pool=compatible.length?compatible:matching;
    const rank=candidate=>variant.allowedTypes.findIndex(t=>candidate.types.has(t.code.toLowerCase()));
    pool.sort((a,b)=>rank(a)-rank(b)||(!compatible.length?b.capacity-a.capacity:0)||Number(a.base.level)-Number(b.base.level)||a.base.code.localeCompare(b.base.code));
    const chosen=pool[0];if(!chosen)return null;
    const base=chosen.base;
    return {code:base.code,name:base.name,itemType:base.itemType,image:base.image,source:base.source,socketCapacity:chosen.capacity,compatible:chosen.capacity>=variant.sockets};
  };
}
function buildRunewords(bases) {
  const groups=new Map();
  const chooseExample=exampleBaseSelector(bases);
  for(const row of s.tables.runes.filter(row=>row.Name)) {
    const nameKey=row.Name;
    const group=groups.get(nameKey)||{id:'runeword:'+nameKey,kind:'runewords',name:s.name(nameKey,row['*RuneName']||nameKey),nameKey,nameSource:nameSource(nameKey),category:'runeword',itemType:'Runeword',enabled:false,variants:[],properties:[]};
    const codes=Array.from({length:6},(_,n)=>row[`Rune${n+1}`]).filter(Boolean);
    const ingredients=codes.map(code=>{
      const base=s.bases.get(code);
      if(!base){s.issues.push({kind:'missing-rune',code,name:nameKey});return {code,name:code};}
      return {code,name:s.name(base.namestr||code,base.name),requiredLevel:base.levelreq||'0',image:assets.resolve(base),socketBonuses:gemMods(base)};
    });
    const properties=p.slots(row,'T1Code','T1Param','T1Min','T1Max',7);
    const runeTier=properties.find(prop=>prop.code==='RW-Tier');
    const variant={id:'rune-row:'+row._source.line,enabled:row.complete==='1',serverOnly:row.server==='1',runic:codes[0]==='jew',runes:ingredients,sockets:codes.length,requiredRuneLevel:Math.max(0,...ingredients.map(r=>Number(r.requiredLevel||0))),allowedTypes:Array.from({length:6},(_,n)=>row[`itype${n+1}`]).filter(Boolean).map(code=>({code,name:s.itemTypes.get(code.toLowerCase())?.ItemType||code})),excludedTypes:Array.from({length:3},(_,n)=>row[`etype${n+1}`]).filter(Boolean).map(code=>({code,name:s.itemTypes.get(code.toLowerCase())?.ItemType||code})),properties,source:source(row),raw:row,forging:[]};
    variant.exampleBase=chooseExample(variant);
    if(variant.exampleBase&&!variant.exampleBase.compatible)s.issues.push({kind:'runeword-example-socket-mismatch',name:group.name,sockets:variant.sockets,example:variant.exampleBase.code,maximumSockets:variant.exampleBase.socketCapacity,source:variant.source});
    else if(variant.enabled&&!variant.exampleBase)s.issues.push({kind:'missing-runeword-example',name:group.name,source:variant.source});
    if(runeTier) {
      const runeWordNumber=Number(runeTier.min);
      variant.runewordNumber=runeWordNumber;
      const recipes=s.tables.cubemain.filter(recipe=>recipe.description&&new RegExp(`^RW ${runeWordNumber} - Tier [2-5]$`,'i').test(recipe.description));
      variant.forging=recipes.map(recipe=>{
        const inputs=Array.from({length:7},(_,n)=>recipe[`input ${n+1}`]).filter(Boolean);
        const inputNames=inputs.map((input,n)=>{
          if(n===0)return group.name+' (previous tier)';
          const [code,...flags]=input.split(',');const base=s.bases.get(code);
          const name=base?s.name(base.namestr||code,base.name):s.itemTypes.get(code.toLowerCase())?.ItemType||code;
          const quantity=flags.find(flag=>flag.startsWith('qty='));return (quantity?quantity.slice(4)+' × ':'')+name;
        });
        return {name:recipe.description,enabled:recipe.enabled==='1',tier:Number(recipe.description.match(/Tier (\d+)/)[1]),inputs,inputNames,operation:{op:recipe.op,param:recipe.param,value:recipe.value},properties:p.cubeSlots(recipe),source:source(recipe),raw:recipe};
      });
    }
    group.enabled ||= variant.enabled;
    group.variants.push(variant);groups.set(nameKey,group);
  }
  return [...groups.values()].map(group=>{
    const active=group.variants.filter(variant=>variant.enabled);
    group.requiredLevel=String(Math.min(...(active.length?active:group.variants).map(variant=>variant.requiredRuneLevel)));
    group.search=[group.name,...group.variants.flatMap(v=>[v.runes.map(r=>r.name).join(' + '),v.allowedTypes.map(t=>t.name).join(' '),v.exampleBase?.name||'',v.exampleBase?.code||'',...textLines(v.properties),...v.forging.flatMap(f=>textLines(f.properties))])].join('\n');
    return group;
  });
}
function build() {
  const bases=buildBases(),uniques=buildQuality(s.tables.uniqueitems,'uniques'),setitems=buildQuality(s.tables.setitems,'setitems'),sets=buildSets(setitems),runewords=buildRunewords(bases);
  for(const rows of [bases,uniques,setitems,sets,runewords])rows.sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
  return {bases,uniques,setitems,sets,runewords};
}
module.exports={build,slug,textLines};
