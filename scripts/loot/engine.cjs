/* Exact finite probability calculation for the documented Expansion TC model.
 * Each distribution tracks total drops, no target, and at least one target.
 * Composition stops when the shared six-drop budget is exhausted, including
 * inside nested tables (notably the Countess's ordered item/rune branches).
 * Sources: D2MOO Items.cpp DropTC, ItemMode.cpp unique selection,
 * ItemsMagic.cpp set selection, MonsterTbls.cpp TC compilation/upgrades.
 */
'use strict';
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n)),integer=n=>Math.trunc(Number(n)||0);
function empty(cap){const t=new Float64Array(cap+1),n=new Float64Array(cap+1),h=new Float64Array(cap+1);t[0]=n[0]=1;return {t,n,h};}
function blank(cap){return {t:new Float64Array(cap+1),n:new Float64Array(cap+1),h:new Float64Array(cap+1)};}
function compose(first,next,cap){
  const out=blank(cap);
  for(let i=0;i<=cap;i++){
    if(!first.t[i])continue;
    if(i===cap){out.t[i]+=first.t[i];out.n[i]+=first.n[i];out.h[i]+=first.h[i];continue;}
    const second=next(cap-i);
    for(let j=0;j<=cap-i;j++){
      out.t[i+j]+=first.t[i]*second.t[j];
      out.n[i+j]+=first.n[i]*second.n[j];
      out.h[i+j]+=first.h[i]*second.t[j]+first.n[i]*second.h[j];
    }
  }
  return out;
}
function add(out,dist,weight){for(let i=0;i<out.t.length;i++){out.t[i]+=weight*dist.t[i];out.n[i]+=weight*dist.n[i];out.h[i]+=weight*dist.h[i];}}
function options(o){o=o||{};const players=clamp(integer(o.players)||1,1,8);return {...o,players,nearby:clamp(integer(o.nearby)||1,1,players),mf:clamp(integer(o.mf),0,10000),level:clamp(integer(o.level)||85,1,255)};}
function noDrop(row,o){if(row.picks<0||!row.noDrop)return 0;const exponent=Math.floor((o.players-o.nearby)/2)+o.nearby;if(exponent===1)return row.noDrop;const ratio=Math.pow(row.noDrop/(row.total+row.noDrop),exponent);return ratio>=1?0:Math.floor(row.total*ratio/(1-ratio));}
function runsFor(chance,confidence){return chance<=0?Infinity:chance>=1?1:Math.max(1,Math.ceil(Math.log1p(-confidence)/Math.log1p(-chance)));}
function cumulative(chance,runs){return chance>=1?(runs>0?1:0):chance<=0?0:-Math.expm1(Math.max(0,runs)*Math.log1p(-chance));}
function Engine(data){
  this.data=data;this.classes=new Map(data.classes.map(t=>[t.name,{...t,reachable:null}]));this.items=new Map(data.items.map(i=>[i.id,i]));this.areas=new Map(data.areas.map(a=>[a.id,a]));
  const engine=this,visiting=new Set();
  function reachable(name){const row=engine.classes.get(name);if(!row)throw Error('Missing loot table '+name);if(row.reachable)return row.reachable;if(visiting.has(name))throw Error('Cyclic loot table '+name);visiting.add(name);const found=new Set();for(const entry of row.entries){if(entry.kind==='tc')for(const id of reachable(entry.ref))found.add(id);else{found.add(entry.ref);const item=engine.items.get(entry.ref);if(item)found.add('base:'+item.code);}}visiting.delete(name);row.reachable=found;return found;}
  for(const row of data.classes)reachable(row.name);
  this.byBase=new Map();for(const item of data.items)if(['unique','set'].includes(item.kind)){const list=this.byBase.get(item.code)||[];list.push(item);this.byBase.set(item.code,list);}
  this.finalCache=new Map();this.totalCache=new Map();this.contextCache=new Map();
  this.rawOrder=data.classes.filter(t=>!t.generated);this.rawIndex=new Map(this.rawOrder.map((t,i)=>[t.name,i]));
}
Engine.prototype.upgrade=function(name,level){let row=this.classes.get(name),i=this.rawIndex.get(name);if(!row||!row.group||i==null||level<=0)return name;while(i+1<this.rawOrder.length){const next=this.rawOrder[i+1];if(next.group!==row.group||next.level>level)break;row=next;i++;}return row.name;};
Engine.prototype.contexts=function(src,settings){
  const d=integer(settings.difficulty),mode=settings.encounter||'standard',override=integer(settings.levelOverride),filter=settings.area||'';
  if(mode.startsWith('desecrated')&&!override)return [];
  if(src.kind==='table')return filter?[]:[{source:src,table:src.table,originalTable:src.table,level:override||85,area:null,method:'Unbound loot table · per execution',mode}];
  let selectedMode=src.kind==='superunique'?(mode.startsWith('desecrated')?'desecrated':'standard'):mode;
  if(src.kind==='superunique'&&mode==='quest')return [];
  const table=src.tc[d]?.[selectedMode];if(!table||!this.classes.has(table))return [];
  let locations=src.locations.filter(l=>l.difficulty===d&&(!filter||l.area===filter));
  if(filter&&!locations.length)return [];
  locations=[...new Map(locations.map(l=>[l.area,l])).values()];if(!locations.length)locations=[null];
  return locations.map(l=>{
    const area=l?this.areas.get(l.area):null;
    let level=d>0&&!src.boss&&!src.noRatio&&area?area.levels[d]:src.levels[d];
    if(src.kind==='superunique')level+=3;else if(!src.boss){if(mode==='champion'||mode==='desecratedChampion')level+=2;if(mode==='unique'||mode==='desecratedUnique')level+=3;}
    level=override||Math.max(1,level);
    return {source:src,table:d>0&&!src.boss&&!src.noRatio?this.upgrade(table,level):table,originalTable:table,level,area,method:l?.method||'Area not linked · possibly scripted',mode};
  });
};
Engine.prototype.qualityChance=function(item,leaf,boost,o){
  if(!item.enabled||item.recipeOnly)return 0;
  if(item.kind==='set'&&item.cowOnly&&!o.cow)return 0;
  const dropped=this.items.get(leaf.ref);if(!dropped||dropped.code!==item.code)return 0;
  // A base search includes every quality, including explicitly named drops.
  if(item.kind==='base')return 1;
  if(dropped.kind!=='base')return dropped.id===item.id&&item.level<=o.level?1:0;
  const base=this.data.bases[item.code];if(!base||base.normal)return 0;
  const eligible=(this.byBase.get(item.code)||[]).filter(i=>i.kind===item.kind&&i.enabled&&!i.recipeOnly&&i.level<=o.level&&(!i.cowOnly||o.cow));
  if(!eligible.some(i=>i.id===item.id))return 0;
  const weight=Math.max(item.rarity,1),sum=eligible.reduce((a,i)=>a+Math.max(i.rarity,1),0);
  if(base.unique||(base.magic&&base.quest))return item.kind==='unique'?weight/sum:0;
  // Uber means exceptional/elite equipment, not the unrelated quest-item flag.
  // Expansion chooses the last matching row at the greatest Version <= 100.
  const rows=this.data.ratios.filter(r=>integer(r.Version)<=100&&integer(r['Class Specific'])===Number(base.classSpecific)&&integer(r.Uber)===Number(!!base.uber));
  const ratio=rows.reduce((best,r)=>!best||integer(r.Version)>=integer(best.Version)?r:best,null);
  if(!ratio)throw Error('No itemratio row for '+item.code);
  const difference=o.level-base.level;
  function roll(kind,index){
    const initial=integer(ratio[kind])-Math.trunc(difference/(integer(ratio[kind+'Divisor'])||1));
    let divisor=100+o.mf;
    if(o.mf>10){if(kind==='Unique')divisor=100+Math.floor(250*o.mf/(o.mf+250));else if(kind==='Set')divisor=100+Math.floor(500*o.mf/(o.mf+500));else if(kind==='Rare')divisor=100+Math.floor(600*o.mf/(o.mf+600));}
    let denominator=Math.trunc(12800*initial/divisor);denominator=Math.max(denominator,integer(ratio[kind+'Min']));
    denominator-=Math.trunc(denominator*boost[index]/1024);
    return denominator<=128?1:128/denominator;
  }
  const unique=roll('Unique',0);
  return (item.kind==='unique'?unique:(1-unique)*roll('Set',1))*weight/sum;
};
Engine.prototype.calculate=function(name,targetId,settings){
  const item=this.items.get(targetId),o=options(settings),root=this.classes.get(name);if(!root||!item)throw Error('Unknown item or loot table');
  const key=[name,targetId,o.level,o.mf,o.players,o.nearby,!!o.cow].join('|');if(this.finalCache.has(key))return this.finalCache.get(key);
  const engine=this,contextKey=[targetId,o.level,o.mf,o.players,o.nearby,!!o.cow].join('|');
  let memo=this.contextCache.get(contextKey);if(!memo){memo=new Map();this.contextCache.set(contextKey,memo);if(this.contextCache.size>48)this.contextCache.delete(this.contextCache.keys().next().value);}
  const baseId='base:'+item.code;
  function evaluate(tcName,cap,inherited,depth,totalOnly){
    if(!cap)return empty(0);if(depth>63)throw Error('Treasure class depth exceeds engine stack');
    const tc=engine.classes.get(tcName);if(!tc)throw Error('Missing nested table '+tcName);
    const boost=tc.quality.map((n,i)=>Math.max(n,inherited[i]||0));
    const irrelevant=totalOnly||!item.enabled||item.recipeOnly||(!tc.reachable.has(targetId)&&!tc.reachable.has(baseId));
    const cache=irrelevant?engine.totalCache:memo;
    const cacheKey=irrelevant?[tcName,cap,o.players,o.nearby].join('|'):[tcName,cap,...boost].join('|');
    if(cache.has(cacheKey))return cache.get(cacheKey);
    function entry(e,budget){
      if(e.kind==='tc')return evaluate(e.ref,budget,boost,depth+1,irrelevant);
      const out=blank(budget),q=irrelevant?0:engine.qualityChance(item,e,boost,o);out.t[1]=1;out.n[1]=1-q;out.h[1]=q;return out;
    }
    let result=empty(cap);
    if(tc.total>0){
      if(tc.picks<0){let remaining=Math.max(1,-tc.picks);for(const e of tc.entries){const repeat=Math.min(remaining,e.weight);for(let i=0;i<repeat;i++)result=compose(result,b=>entry(e,b),cap);remaining-=repeat;if(remaining<=0)break;}}
      else{
        const denominator=tc.total+noDrop(tc,o),pickCache=new Map();
        function pick(budget){if(pickCache.has(budget))return pickCache.get(budget);const mixed=blank(budget),nd=denominator-tc.total;mixed.t[0]=mixed.n[0]=nd/denominator;for(const e of tc.entries)add(mixed,entry(e,budget),e.weight/denominator);pickCache.set(budget,mixed);return mixed;}
        for(let i=0;i<Math.max(tc.picks,1);i++)result=compose(result,pick,cap);
      }
    }
    cache.set(cacheKey,result);return result;
  }
  const distribution=evaluate(name,6,[0,0,0,0],0,false),chance=clamp(distribution.h.reduce((a,v)=>a+v,0),0,1);
  const result={chance,oneIn:chance>0?1/chance:Infinity,median:runsFor(chance,.5),ninety:runsFor(chance,.9),expectedDrops:distribution.t.reduce((n,v,i)=>n+i*v,0),distribution:Array.from(distribution.t)};
  this.finalCache.set(key,result);if(this.finalCache.size>12000)this.finalCache.delete(this.finalCache.keys().next().value);return result;
};
Engine.prototype.paths=function(name,itemId,limit){
  const item=this.items.get(itemId);if(!item)return [];const target='base:'+item.code,results=[],engine=this;
  function visit(current,trail,depth){if(depth>40||results.length>=(limit||3))return;const tc=engine.classes.get(current);if(!tc||(!tc.reachable.has(itemId)&&!tc.reachable.has(target)))return;
    const entries=tc.entries.slice().sort((a,b)=>b.weight-a.weight);
    for(const e of entries){if(e.kind==='tc')visit(e.ref,trail.concat({table:current,entry:e.token,weight:e.weight,total:tc.total,source:tc.source}),depth+1);else if(e.ref===itemId||e.ref===target)results.push(trail.concat({table:current,entry:e.token,weight:e.weight,total:tc.total,source:tc.source}));if(results.length>=(limit||3))break;}}
  visit(name,[],0);return results;
};
exports.Engine=Engine;exports.noDrop=noDrop;exports.runsFor=runsFor;exports.cumulative=cumulative;exports.options=options;
