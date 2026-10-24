'use strict';
// Sample map populations, then integrate the loot rolls analytically. This keeps
// rare-item estimates useful without waiting for simulated lucky drops.
const math=typeof $tw==='undefined'?require('./engine.cjs'):require('$:/rmd/loot-engine.js');
function rng(seed){let a=Number(seed)>>>0;return function(){a=(a+0x6D2B79F5)>>>0;let t=Math.imul(a^(a>>>15),1|a);t^=t+Math.imul(t^(t>>>7),61|t);return ((t^(t>>>14))>>>0)/4294967296;};}
function integer(random,min,max){return min+Math.floor(random()*(max-min+1));}
function poisson(mean,random){let result=0;while(mean>0){const part=Math.min(mean,30),limit=Math.exp(-part);let product=1,n=0;do{n++;product*=random();}while(product>limit);result+=n-1;mean-=part;}return result;}
function selectedPool(config,random){
  const candidates=config.pool.slice(),selected=[];
  for(let i=0,n=Math.min(13,config.types,candidates.length);i<n;i++){
    let index=integer(random,0,candidates.length-1);
    if(i===0&&config.rangedFirst)for(let attempt=0;attempt<20&&!candidates[index].ranged;attempt++)index=integer(random,0,candidates.length-1);
    const m=candidates.splice(index,1)[0];if(m.isSpawn&&m.weight>0)selected.push(m);
  }
  return selected;
}
function densityPacks(population,difficulty,footprint){
  const size=population.size[difficulty],density=population.density[difficulty];
  // Nominal tile rectangle -> 5x5 subtiles -> one attempt / 3x3 subtiles.
  // Actual populated room geometry is represented by the adjustable footprint.
  const tiles=footprint==null&&population.geometry?.floorTiles!=null?population.geometry.floorTiles:size[0]*size[1]*(footprint==null?(population.geometry?.fallbackFootprint??20):footprint)/100;
  return tiles*25/9*(density>0?(Math.min(10000,density)+1)/100000:0);
}
function limitKills(source,encounter,kills){return source?.onePerGame||source?.kind==='boss'||source?.kind==='superunique'||encounter==='unique'?1:Math.max(0,Math.trunc(kills));}
function summarize(chances,kills,mix,minutes,samples,components){
  const mean=chances.reduce((a,b)=>a+b,0)/chances.length,sorted=chances.slice().sort((a,b)=>a-b),counts=kills.slice().sort((a,b)=>a-b),q=(a,p)=>a[Math.floor((a.length-1)*p)];
  return {chance:mean,expectedRuns:mean>0?1/mean:Infinity,median:math.runsFor(mean,.5),ninety:math.runsFor(mean,.9),minutes,expectedMinutes:mean>0?minutes/mean:Infinity,meanKills:kills.reduce((a,b)=>a+b,0)/kills.length,killsRange:[q(counts,.1),q(counts,.9)],chanceRange:[q(sorted,.1),q(sorted,.9)],mix:Object.entries(mix).map(([id,kills])=>({id,kills:kills/chances.length})).sort((a,b)=>b.kills-a.kills),samples,components:Object.fromEntries(Object.entries(components||{}).map(([k,v])=>[k,v/chances.length]))};
}
function simulate(config){
  const minutes=Number(config.minutes);if(!(minutes>0))throw Error('Run duration must be greater than zero.');
  if((config.kind==='monster'||config.method==='manual')&&(!Number.isFinite(config.kills)||config.kills<0||config.kills>10000))throw Error('Enter a kill count between 0 and 10,000.');
  if(config.kind==='monster'){
    if(!Number.isFinite(config.chance)||!(config.chance>=0&&config.chance<=1))throw Error('This encounter has no supported drop calculation.');
    const kills=limitKills(config,config.encounter,config.kills),p=math.cumulative(config.chance,kills);
    return summarize([p],[kills],{[config.id]:kills},minutes,0);
  }
  if((!config.pool?.length||!config.types)&&!config.fixed?.length&&!config.fixedGroups?.length)throw Error('This area has no supported random or fixed encounters.');
  if(!(config.packs>=0)||config.packs>10000)throw Error('The density estimate must be between 0 and 10,000 packs. Reduce the effective footprint.');
  const samples=Math.max(100,Math.min(5000,Math.trunc(config.samples||2000))),random=rng(config.seed),chances=[],counts=[],mix={},components={ordinary:0,champion:0,unique:0,minion:0,fixed:0};
  for(let sample=0;sample<samples;sample++){
    const chosen=selectedPool({...config,pool:config.pool||[],types:config.types||0},random),pool=config.method==='manual'?chosen.flatMap(m=>m.replacement?[{...m,replacement:null,weight:m.weight*.21},{...m.replacement,weight:m.weight*.79}]:[m]).map(m=>({...m,replacement:null,weight:m.weight*(m.sparse?Math.min(1,(m.sparse+1)/100):1)})):chosen,weight=pool.reduce((n,m)=>n+m.weight,0),spread=1+(random()*2-1)*(config.spread||0)/100;
    let kills=0,logSurvival=0,fixedElite=0,floorTiles=0,eliteEvents=0;const seen=new Set(),fixed=(config.fixed||[]).slice();
    function hit(m,n,category){
      if(!m||n<=0)return false;
      if(!Number.isFinite(m.chance)||m.chance<0||m.chance>1)throw Error('Unsupported loot binding for '+m.name+'. This clear cannot be estimated completely.');
      if(m.onePerGame){if(seen.has(m.id))return false;seen.add(m.id);n=1;}
      kills+=n;logSurvival+=n*Math.log1p(-m.chance);mix[m.id]=(mix[m.id]||0)+n;components[category]+=n;return true;
    }
    for(const group of config.fixedGroups||[]){if(!group.variants.length)continue;const variant=group.variants[integer(random,0,group.variants.length-1)];fixed.push(...variant.encounters);if(variant.populate)floorTiles+=variant.floorTiles;}
    for(const encounter of fixed){if(hit(encounter.monster,encounter.count||1,'fixed')){if(encounter.countsTowardElite)fixedElite++;if(encounter.minion&&encounter.minionRange)hit(encounter.minion,integer(random,...encounter.minionRange),'minion');}}
    const layoutScale=config.geometryFloor>0?floorTiles/config.geometryFloor:1;
    let remaining=config.method==='manual'?Math.round(config.kills*spread):poisson(config.packs*spread*layoutScale,random);
    const elitePool=config.uniquePool?.length?config.uniquePool:chosen;
    const eliteWeight=elitePool.reduce((n,m)=>n+m.weight,0);
    function pick(pool,total){let roll=random()*total;for(const m of pool){roll-=m.weight;if(roll<0)return m;}return pool[pool.length-1];}
    let elites=config.elites&&eliteWeight>0?Math.max(0,integer(random,...config.eliteRange)-fixedElite):0;
    while(elites>0&&(config.method==='manual'||eliteEvents<remaining)){
      let m=pick(elitePool,eliteWeight);if(m.replacement&&random()>=.01)m=m.replacement;
      eliteEvents++;
      if(random()*100<(config.championPercent||0)){
        const n=integer(random,2,4);hit({...m,chance:m.championChance},n,'champion');elites-=n;
      }else{
        hit({...m,chance:m.uniqueChance},1,'unique');elites--;hit(m.minion||{name:m.name+' minions',chance:null},integer(random,3,6),'minion');
      }
    }
    if(config.method!=='manual')remaining=Math.max(0,remaining-eliteEvents);
    while(remaining>0&&weight>0){
      let roll=random()*weight,m=pool[pool.length-1];for(const candidate of pool){roll-=candidate.weight;if(roll<0){m=candidate;break;}}
      if(m.replacement&&random()>=.21)m=m.replacement;
      if(config.method!=='manual'){remaining--;if(m.sparse&&random()>=Math.min(1,(m.sparse+1)/100))continue;}
      const group=integer(random,Math.max(1,m.min),Math.max(1,m.min,m.max)),n=config.method==='manual'?Math.min(group,remaining):group;
      if(config.method==='manual')remaining-=n;
      hit(m,n,'ordinary');
      if(m.partyRange?.[1]>0&&m.partyUnits?.length)for(let parent=0;parent<n;parent++){
        const companions=integer(random,...m.partyRange);
        for(let child=0;child<companions;child++){
          if(config.method==='manual'&&remaining<=0)break;
          hit(m.partyUnits[child%m.partyUnits.length]||{name:m.name+' companion',chance:null},1,'ordinary');if(config.method==='manual')remaining--;
        }
      }
    }
    counts.push(kills);chances.push(-Math.expm1(logSurvival));
  }
  return summarize(chances,counts,mix,minutes,samples,components);
}
exports.rng=rng;exports.selectedPool=selectedPool;exports.densityPacks=densityPacks;exports.simulate=simulate;exports.limitKills=limitKills;
