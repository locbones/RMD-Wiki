'use strict';
// Decode current map placements rather than treating every possible file as a
// simultaneous encounter. Files on one lvlprest row are alternative layouts.
function decodeMap(buffer){
  let offset=0;const read=()=>{if(offset+4>buffer.length)throw Error('Truncated DS1');const n=buffer.readInt32LE(offset);offset+=4;return n;};
  const version=read(),width=read()+1,height=read()+1;
  if(version<3||version>30||width<1||height<1||width*height>2000000)throw Error('Unsupported DS1');
  const act=version>=8?read()+1:1,sub=version>=10?read():0,files=read();
  if(files<0||files>2000)throw Error('Invalid DS1 file count');
  for(let i=0;i<files;i++){const end=buffer.indexOf(0,offset);if(end<0)throw Error('Truncated DS1 strings');offset=end+1;}
  if(version>=9&&version<=13)offset+=8;
  const walls=version>=4?read():1,floors=version>=16?read():1,cells=width*height;
  if(walls<0||walls>4||floors<0||floors>2)throw Error('Invalid DS1 layers');
  const schema=version<4?['wall','floor','orientation','sub','shadow']:[...Array(walls*2).fill('wall'),...Array(floors).fill('floor'),'shadow',...([1,2].includes(sub)?['sub']:[])],floor=new Uint8Array(cells);
  for(const layer of schema)for(let i=0;i<cells;i++){const value=read();if(layer==='floor'&&value!==0)floor[i]=1;}
  const count=read(),objects=[];if(count<0||count>100000)throw Error('Invalid DS1 object count');
  for(let i=0;i<count;i++){const type=read(),id=read(),x=read(),y=read(),flags=version>=6?read():0;if(type===1)objects.push({id,x,y,flags});}
  return {width,height,act,objects,floorTiles:floor.reduce((a,b)=>a+b,0)};
}
function build(s,areas,sources,monsterRows,suRows,issues){
  const levels=s.table('levels'),presets=s.table('lvlprest'),monpresets=s.table('monpreset'),monumod=s.table('monumod'),byArea=new Map(areas.map(a=>[a.id,a])),bySource=new Map(sources.map(m=>[m.id,m])),monsters=new Map(monsterRows.map(r=>[r.Id,r])),supers=new Map(suRows.map(r=>[r.Superunique,r])),cache=new Map();
  const presetByAct=new Map([1,2,3,4,5].map(a=>[a,monpresets.filter(r=>Number(r.Act)===a)]));
  function addLocation(source,area,method){if(!source)return;for(let difficulty=0;difficulty<3;difficulty++)if(!source.locations.some(l=>l.area===area&&l.difficulty===difficulty&&l.method===method))source.locations.push({area,difficulty,method});}
  function layout(row){
    const variants=[];
    for(let n=1;n<=6;n++){
      const name=row['File'+n];if(!name||name==='0')continue;
      const relative='global/tiles/'+name.replace(/\\/g,'/');let map=cache.get(relative);
      if(map===undefined){const file=s.file(relative,false);if(!file){issues.push({kind:'missing-population-map',file:relative});cache.set(relative,null);continue;}try{map=decodeMap(file.buffer);cache.set(relative,map);}catch(e){issues.push({kind:'invalid-population-map',file:relative,error:e.message});cache.set(relative,null);continue;}}
      if(!map)continue;
      const counts=new Map(),positions=new Set();
      for(const obj of map.objects){const place=presetByAct.get(map.act)?.[obj.id]?.Place,id=supers.has(place)?'su:'+place:'monster:'+place,src=bySource.get(id),key=obj.x+'|'+obj.y+'|'+id;if(!src||positions.has(key))continue;positions.add(key);counts.set(id,(counts.get(id)||0)+1);}
      // Named definitions and their class baseline must not both represent the
      // same fixed boss. Named identities are also capped across all map parts.
      const namedClasses=new Set([...counts.keys()].filter(id=>id.startsWith('su:')).map(id=>bySource.get(id).monster));
      const encounters=[...counts].filter(([id])=>!id.startsWith('monster:')||!namedClasses.has(bySource.get(id).monster)).map(([id,count])=>({id,count:bySource.get(id).onePerGame?1:count,countsTowardElite:id.startsWith('su:'),evidence:'DS1 map placement'}));
      variants.push({file:relative,floorTiles:map.floorTiles,populate:row.Populate==='1',encounters});
    }
    return variants;
  }
  for(const area of areas){
    const row=levels.find(r=>r.Id===area.id),p=area.population;p.fixedGroups=[];p.fixed=[];p.uniquePool=Array.from({length:25},(_,i)=>row['umon'+(i+1)]).filter(Boolean);p.championPercent=Number(monumod[0]?.constants||0);p.layoutType=Number(row.DrlgType);
    const linked=presets.filter(r=>r.LevelId===area.id);
    for(const preset of linked){const variants=layout(preset);if(variants.length)p.fixedGroups.push({id:preset.Def,name:preset.Name,variants,source:{...preset._source}});}
    // A deterministic outdoor layout assembled from six current preset rows.
    if(area.id==='83')for(const def of [653,654,655,656,657,658]){const row=presets.find(r=>Number(r.Def)===def);if(row){const variants=layout(row);if(variants.length)p.fixedGroups.push({id:row.Def,name:row.Name,variants,source:{...row._source}});}}
    for(const group of p.fixedGroups)for(const variant of group.variants)for(const encounter of variant.encounters)addLocation(bySource.get(encounter.id),area.id,'Fixed map placement');
    const geometry=p.fixedGroups.flatMap(g=>g.variants),meanFloor=linked.length&&geometry.length?geometry.reduce((n,v)=>n+(v.populate?v.floorTiles:0),0)/geometry.length:null;
    p.geometry={floorTiles:meanFloor,method:meanFloor!==null?'Current DS1 floor coverage':'Procedural footprint estimate',fallbackFootprint:20};
  }
  function fixed(areaId,id,evidence){const src=bySource.get(id),p=byArea.get(areaId)?.population;if(!src||!p)return;p.fixed.push({id,count:1,countsTowardElite:false,evidence});addLocation(src,areaId,evidence);}
  for(const [id,area]of Object.entries({andariel:'37',duriel:'73',mephisto:'102',diablo:'108',baalcrab:'132'}))fixed(area,'monster:'+id,'Campaign quest encounter');
  // Script hooks identify hcIdx slots; names/classes/stats still come from the
  // current superuniques.txt so mod replacements in these slots are respected.
  for(const index of [36,37,38]){const row=suRows.find(r=>Number(r.hcIdx)===index);if(row)fixed('108','su:'+row.Superunique,'Chaos seal encounter');}
  for(const index of [61,62,63,64,65]){const row=suRows.find(r=>Number(r.hcIdx)===index);if(row)fixed('131','su:'+row.Superunique,'Throne wave encounter');}
  for(const src of sources){
    const base=monsters.get(src.monster),unique=src.kind==='superunique'?supers.get(src.id.slice(3)):null;
    src.minions=base?.minion1||src.monster;src.minionRange=unique?[Number(unique.MinGrp||0),Number(unique.MaxGrp||0)]:[0,0];
  }
  return {decodedMaps:cache.size,layoutGroups:areas.reduce((n,a)=>n+a.population.fixedGroups.length,0)};
}
module.exports={build,decodeMap};
