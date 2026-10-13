const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const s=require('../items/source.cjs'), props=require('../items/properties.cjs');
const diffs=['Normal','Nightmare','Hell'], suffixes=['','(N)','(H)'];
const issues=[];
const fileCache=new Map(),jsonCache=new Map();
function sourceFile(relative) {
  if(!relative)return null;
  if(!fileCache.has(relative))fileCache.set(relative,s.file(relative,false));
  return fileCache.get(relative);
}
function modelFile(relative) {
  return sourceFile(relative)||sourceFile(relative.replace(/\.models?$/i,'_lod0.model'));
}
const g=s.get, num=x=>Number(x||0), compact=r=>Object.fromEntries(Object.entries(r).filter(([,v])=>v!==''));
function looseJson(relative) {
  if(jsonCache.has(relative))return jsonCache.get(relative);
  const f=sourceFile(relative);if(!f)return null;
  let text=f.buffer.toString('utf8').replace(/^\uFEFF/,'');
  // D2R unit assets allow trailing commas. Remove them outside string literals.
  let out='',quoted=false,escaped=false;
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(!quoted&&c===','){let n=i+1;while(/\s/.test(text[n]||'')&&n<text.length)n++;if(']}'.includes(text[n]))continue;}
    out+=c;if(c==='"'&&!escaped)quoted=!quoted;escaped=quoted&&c==='\\'&&!escaped;
  }
  try{const result={doc:JSON.parse(out),source:{file:f.relative,origin:f.origin,sha256:f.sha256}};jsonCache.set(relative,result);return result;}
  catch(error){issues.push({kind:'invalid-json',file:relative,error:error.message});return null;}
}
const tables=Object.fromEntries(['levels','monlvl','monstats2','montype','monprop','superuniques','monpreset','monplace','monumod','lvlprest','difficultylevels','treasureclassex'].map(n=>[n,s.table(n)]));
const monsters=s.tables.monstats, byId=new Map(monsters.map(r=>[r.Id,r])), ex=new Map(tables.monstats2.map(r=>[r.Id,r]));
const uniques=new Map(tables.superuniques.map(r=>[r.Superunique,r]));
const types=new Map(tables.montype.map(r=>[r.type,r]));
const titleCase=x=>x.replace(/[_-]/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
const familyLabels={bighead:'Afflicted',foulcrow:'Carrion birds',fallen:'Fallen',brute:'Brutes',sandraider:'Sand raiders',corruptrogue:'Corrupted rogues',baboon:'Wendigos',quillrat:'Quill rats',sandmaggot:'Sand maggots',clawviper:'Claw vipers',sandleaper:'Leapers',pantherwoman:'Huntresses',scarab:'Scarab demons',willowisp:'Wisps',arach:'Spiders',thornhulk:'Thorned hulks',batdemon:'Bat demons',blunderbore:'Maulers',undeadfetish:'Undead fetish',zakarum:'Zakarum',frogdemon:'Frog demons',fingermage:'Finger mages',vilekind:'Vile mothers',regurgitator:'Regurgitators',doomknight:'Knights',councilmember:'Council members',megademon:'Megademons',bovine:'Bovines',siegebeast:'Siege beasts',snowyeti:'Snow yetis',succubus:'Succubi',overseer:'Overseers',frozenhorror:'Frozen horrors',bloodlord:'Blood lords',deathmauler:'Death maulers',putriddefiler:'Putrid defilers'};
const areas=tables.levels.filter(r=>num(r.Id)>0).map(r=>({id:r.Id,name:s.name(r.LevelName,r.Name),act:num(r.Act)+1,levels:suffixes.map(z=>num(g(r,'MonLvlEx'+z))),source:r._source,raw:compact(r)}));
const areaById=new Map(areas.map(a=>[a.id,a]));
const locations=new Map(), placements=new Map();
function addLocation(id,area,difficulty,method,source,via) {
  if(!byId.has(id)&&!uniques.has(id))return;
  const key=uniques.has(id)?'su:'+id:id;
  const list=locations.get(key)||[];
  if(!list.some(x=>x.area===area&&x.difficulty===difficulty&&x.method===method&&x.via===via))list.push({area,difficulty,method,source,...(via?{via}:{} )});
  locations.set(key,list);
}
for(const row of tables.levels)if(areaById.has(row.Id)) {
  for(let n=1;n<=25;n++) {
    if(row['mon'+n])addLocation(row['mon'+n],row.Id,0,'Random spawn pool',row._source);
    if(row['nmon'+n])for(const d of [1,2])addLocation(row['nmon'+n],row.Id,d,'Random spawn pool',row._source);
    if(row['umon'+n])addLocation(row['umon'+n],row.Id,0,'Unique spawn pool',row._source);
  }
  for(let n=1;n<=4;n++)if(row['cmon'+n])for(let d=0;d<3;d++)addLocation(row['cmon'+n],row.Id,d,'Critter pool',row._source);
}
function ds1(buffer) {
  let p=0;const read=()=>{if(p+4>buffer.length)throw Error('Truncated DS1');const v=buffer.readInt32LE(p);p+=4;return v;};
  const version=read(),w=read()+1,h=read()+1;let act=1,sub=0;
  if(version<3||version>30||w<1||h<1||w*h>2000000)throw Error('Unsupported DS1 header');
  if(version>=8)act=read()+1;if(version>=10)sub=read();
  const files=read();if(files<0||files>2000)throw Error('Invalid DS1 file count');
  for(let i=0;i<files;i++){const end=buffer.indexOf(0,p);if(end<0)throw Error('Truncated DS1 file list');p=end+1;}
  if(version>=9&&version<=13)p+=8;
  const walls=version>=4?read():1,floors=version>=16?read():1;
  const layers=version<4?5:walls*2+floors+1+([1,2].includes(sub)?1:0);
  p+=layers*w*h*4;
  const count=read();if(count<0||count>100000)throw Error('Invalid DS1 object count');
  const objects=[];for(let i=0;i<count;i++){const type=read(),id=read(),x=read(),y=read(),flags=version>=6?read():0;if(type===1)objects.push({id,x,y,flags});}
  return {act,objects,version};
}
const presetByAct=new Map([1,2,3,4,5].map(a=>[a,tables.monpreset.filter(r=>num(r.Act)===a)]));
const processed=new Map();
for(const row of tables.lvlprest)for(let n=1;n<=6;n++) {
  const filename=row['File'+n];if(!filename||filename==='0')continue;
  const relative='global/tiles/'+filename.replace(/\\/g,'/');const file=sourceFile(relative);if(!file)continue;
  let map=processed.get(relative);
  if(!map){try{map=ds1(file.buffer);processed.set(relative,map);}catch(error){issues.push({kind:'map-decode',file:relative,error:error.message});continue;}}
  for(const obj of map.objects) {
    const preset=presetByAct.get(map.act)?.[obj.id];if(!preset)continue;
    const id=preset.Place;
    if(!byId.has(id)&&!uniques.has(id))continue; // Dynamic MonPlace markers do not identify a particular monster.
    const key=uniques.has(id)?'su:'+id:id;
    const list=placements.get(key)||[];
    if(!list.some(x=>x.file===relative))list.push({file:relative,origin:file.origin,preset:row.Name,act:map.act,area:areaById.has(row.LevelId)?row.LevelId:null,source:row._source,monpresetSource:preset._source});
    placements.set(key,list);
    if(areaById.has(row.LevelId))for(let d=0;d<3;d++)addLocation(id,row.LevelId,d,'Fixed map placement',{file:relative,origin:file.origin});
  }
}
// Area inheritance is explicit: spawned offspring and configured minions.
for(let pass=0;pass<3;pass++)for(const r of monsters)for(const child of [r.spawn,r.minion1,r.minion2].filter(Boolean)) {
  for(const l of (locations.get(r.Id)||[]).slice())addLocation(child,l.area,l.difficulty,'Spawned by '+s.name(r.NameStr,r.Id),r._source,r.Id);
}
const summoned=new Set(s.tables.skills.map(x=>x.summon).filter(Boolean));
const registry=looseJson('hd/character/monsters.json')?.doc||{};
const media=[], mediaKeys=new Map();
const partColumns={head:'HD',torso:'TR',legs:'LG',rarm:'RA',larm:'LA',rhand:'RH',lhand:'LH',shield:'SH',special1:'S1',special2:'S2',special3:'S3',special4:'S4',special5:'S5',special6:'S6',special7:'S7',special8:'S8'};
function mediaFor(r) {
  const shared=!registry[r.Id]&&monsters.find(m=>m.MonStatsEx===r.MonStatsEx&&registry[m.Id]);
  const unit=registry[r.Id]||(shared&&registry[shared.Id]);if(!unit||/inviso|invisible|portal|concground/.test(unit))return null;
  let definition=looseJson('hd/character/enemy/'+unit+'.json')||looseJson('hd/character/npc/'+unit+'.json');
  if(!definition)return null;
  const doc=definition.doc, root=doc.entities?.find(e=>e.components?.some(c=>c.type==='UnitRootComponent'));
  const rc=root?.components||[];
  const skeleton=rc.find(c=>c.type==='SkeletonDefinitionComponent')?.filename;
  const sm=rc.find(c=>c.type==='UnitRootComponent')?.state_machine_filename;
  const state=sm?looseJson(sm):null;
  const neutral=state?.doc.states?.find(x=>x.modeId===1);
  const names=neutral?.animationBindings?Object.values(neutral.animationBindings).flat():[];
  const animation=state?.doc.animations?.find(a=>names.includes(a.name))||state?.doc.animations?.find(a=>/neutral|idle/i.test(a.name));
  const extended=ex.get(r.MonStatsEx)||{};
  const choices={};for(const [part,col]of Object.entries(partColumns))choices[part]=(g(extended,col+'v').replace(/"/g,'').split(',')[0]||'lit').trim();
  const models=[];
  for(const entity of doc.entities||[]) {
    const c=entity.components||[],part=c.find(x=>x.type==='UnitPartComponent');
    if(part&&(choices[part.part]!==part.variant||(partColumns[part.part]&&extended.Id&&g(extended,partColumns[part.part])!=='1')))continue;
    if(!part&&/dead|death/i.test(entity.name))continue;
    const model=c.find(x=>x.type==='ModelDefinitionComponent');if(!model?.filename)continue;
    const actual=modelFile(model.filename);if(!actual)continue;
    models.push({path:actual.relative,reference:model.filename,transform:c.find(x=>x.type==='TransformDefinitionComponent')||null,skinned:/hd\/character\//.test(model.filename)});
  }
  if(!models.length)return null;
  const transform=rc.find(c=>c.type==='TransformDefinitionComponent')||null;
  let animationPath=animation?.filename;
  if(animationPath&&!sourceFile(animationPath))animationPath=sourceFile(animationPath.replace(/[^/]+\.animation$/,'combined.animations'))?.relative;
  // Some NPC units leave the JSON animation list empty but ship a complete
  // archive beside the rig (including the Act II hireling's neutral clip).
  if(!animationPath)animationPath=sourceFile(definition.source.file.replace(/\.json$/,'/animation/combined.animations'))?.relative;
  if(!animationPath&&skeleton)animationPath=sourceFile(skeleton.replace(/\/skeleton\/[^/]+$/,'/animation/combined.animations'))?.relative;
  const idleAlternates=(state?.doc.animations||[]).filter(a=>/neutral|idle/i.test(a.name)&&a!==animation).map(a=>({clip:a.name,path:sourceFile(a.filename)?.relative||sourceFile(a.filename.replace(/[^/]+\.animation$/,'combined.animations'))?.relative})).filter(a=>a.path&&a.path!==animationPath);
  const signature=JSON.stringify({models,skeleton,animation:animationPath,transform});
  const key=crypto.createHash('sha256').update(signature).digest('hex').slice(0,20);
  if(!mediaKeys.has(key)){media.push({key,unit,models,skeleton,animation:animationPath,idleAlternates,transform,source:definition.source,output:'Images/bestiary/'+key+'.webp'});mediaKeys.set(key,true);}
  return {key,unit,definition:definition.source,transLvl:r.TransLvl||'0',...(shared?{representativeOf:shared.Id}:{}),title:'$:/rmd/monster-images/'+key};
}
const tc=new Map(tables.treasureclassex.map(r=>[g(r,'Treasure Class'),r]));
function monsterProperty(p,mp){
  const trigger=/^(?:mondeath|hit|att|gethit|kill|death|levelup)-skill$/.test(p.code);
  const skill=trigger?s.skill(p.param):null;
  const event={'mondeath-skill':'on monster death','hit-skill':'on striking','att-skill':'on attack','gethit-skill':'when struck','kill-skill':'on kill','death-skill':'on death','levelup-skill':'on level-up'}[p.code];
  return {code:p.code,param:p.param,min:p.min,max:p.max,chance:g(mp,p.slot.replace(/^prop/,'chance')),internal:skill&&/Register|Tracker/.test(skill.code),lines:trigger?[`${num(p.min)||5}% chance to cast ${num(p.max)>0?'level '+p.max+' ':''}${skill.name} ${event}${num(p.max)>0?'':' (automatic skill level)'}`]:p.lines};
}
function build() {
  const retailIds=new Set(fs.readFileSync(path.join(s.roots.archive,'global/excel/monstats.txt'),'utf8').split(/\r?\n/).map(line=>line.split('\t')[0]));
  const retailUniques=new Set(fs.readFileSync(path.join(s.roots.archive,'global/excel/superuniques.txt'),'utf8').split(/\r?\n/).map(line=>line.split('\t')[0]));
  const records=monsters.map(r=>{
    const e=ex.get(r.MonStatsEx)||{},type=types.get(r.MonType),group=r.lUndead==='1'||r.hUndead==='1'?'Undead':r.demon==='1'?'Demon':r.MonType==='construct'||r.MonType==='golem'?'Construct':'Other';
    const friendly=num(r.Align)>0;
    const role=r.npc==='1'||r.inTown==='1'?'NPC':summoned.has(r.Id)&&friendly?'Summon':e.critter==='1'?'Critter':r.killable!=='1'?'Helper':friendly?'Ally':r.boss==='1'?'Boss':'Enemy';
    const nameSource=s.lookup(r.NameStr);
    const statData=suffixes.map((z,d)=>{
      const mp=tables.monprop.find(x=>x.Id===r.MonProp);
      const properties=mp?props.slots(mp,'prop','par','min','max',6,z?' '+z:'').map(p=>monsterProperty(p,mp)):[];
      return {level:num(g(r,'Level'+z)),hp:[num(g(r,'minHP'+z)),num(g(r,'maxHP'+z))],defense:num(g(r,'AC'+z)),experience:num(g(r,'Exp'+z)),attacks:['A1','A2','S1'].map(a=>({mode:a,damage:[num(g(r,a+'MinD'+z)),num(g(r,a+'MaxD'+z))],rating:num(g(r,a+'TH'+z))})),resists:['Dm','Ma','Fi','Li','Co','Po'].map(a=>num(g(r,'Res'+a+z))),drain:num(g(r,'Drain'+z)),coldEffect:num(g(r,'coldeffect'+z)),block:num(g(r,'ToBlock'+z)),elements:[1,2,3].filter(n=>r['El'+n+'Type']).map(n=>({type:r['El'+n+'Type'],mode:r['El'+n+'Mode'],chance:num(g(r,'El'+n+'Pct'+z)),damage:[num(g(r,'El'+n+'MinD'+z)),num(g(r,'El'+n+'MaxD'+z))],frames:num(g(r,'El'+n+'Dur'+z))})),properties,treasure:Object.entries(r).filter(([k,v])=>v&&k.startsWith('TreasureClass')&&(d===0?!/\([NH]\)/.test(k):k.includes(z))).map(([field,value])=>({field,value,definition:tc.has(value)?compact(tc.get(value)):null}))};
    });
    const skills=Array.from({length:8},(_,i)=>i+1).filter(i=>r['Skill'+i]).map(i=>({...s.skill(r['Skill'+i]),level:num(r['Sk'+i+'lvl']),mode:r['Sk'+i+'mode']}));
    const areaRefs=locations.get(r.Id)||[];
    return {id:r.Id,name:s.name(r.NameStr,r.Id),nameKey:r.NameStr,nameSource:nameSource||null,enabled:r.enabled==='1',role,group,family:familyLabels[r.MonType]||s.lookup(type?.strplur)?.text||titleCase(r.MonType||r.BaseId||r.Id),type:r.MonType,baseId:r.BaseId,boss:r.boss==='1',noRatio:r.noRatio==='1',stats:statData,skills,locations:areaRefs,placements:placements.get(r.Id)||[],image:mediaFor(r),source:r._source,raw:compact(r),extended:compact(e),description:r.DescStr?s.name(r.DescStr):'',movement:{walk:num(r.Velocity),run:num(r.Run)},pack:[num(r.MinGrp),num(r.MaxGrp)],regeneration:num(r.DamageRegen),critical:num(r.Crit),children:[r.spawn,r.minion1,r.minion2].filter(Boolean),added:!retailIds.has(r.Id)};
  });
  const named=tables.superuniques.map(r=>{
    const base=records.find(m=>m.id===r.Class);if(!base){issues.push({kind:'missing-superunique-class',id:r.Superunique,class:r.Class});return null;}
    const stats=base.stats.map((st,d)=>({...st,treasure:Object.entries(r).filter(([k,v])=>v&&/^TC(?:\([NH]\))?(?: Desecrated)?$/.test(k)&&(d===0?!/\([NH]\)/.test(k):k.includes(suffixes[d]))).map(([field,value])=>({field,value,definition:tc.has(value)?compact(tc.get(value)):null}))}));
    return {...base,id:'su:'+r.Superunique,name:s.name(r.Name,r.Superunique),nameKey:r.Name,role:'Superunique',baseId:r.Class,stats,pack:[num(r.MinGrp),num(r.MaxGrp)],locations:locations.get('su:'+r.Superunique)||[],placements:placements.get('su:'+r.Superunique)||[],source:r._source,baseSource:base.source,uniqueRaw:compact(r),modifiers:[r.Mod1,r.Mod2,r.Mod3].filter(v=>num(v)>0).map(id=>({id,code:tables.monumod[num(id)]?.uniquemod||id})),baseName:base.name,added:!retailUniques.has(r.Superunique)};
  }).filter(Boolean);
  return {schemaVersion:1,records:[...records,...named],areas,scaling:tables.monlvl.map(compact),difficulties:tables.difficultylevels.map(compact),media,issues:[...issues,...s.issues],sourceFiles:[...s.files.values()],counts:{definitions:records.length,superuniques:named.length,hostile:records.filter(r=>r.enabled&&['Enemy','Boss'].includes(r.role)).length,areas:areas.length,images:media.length,decodedMaps:processed.size}};
}
module.exports={build,issues,ds1,looseJson};
