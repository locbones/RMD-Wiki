/* Item-panel stats, using Properties.txt functions and ItemStatCost.txt links.
 * Rules: D2MOO D2Common/Items/ItemMods.cpp (property functions, ethereality),
 * D2Common/D2StatList.cpp (ops 4, 5, 13). Damage/defense percentages apply to
 * the base stat; flat additions are added afterwards. Character combat totals
 * and bonuses from other equipment are intentionally outside this preview.
 */
'use strict';
const number=v=>Number(v)||0;
const pair=(a,b=a)=>[Math.min(a,b),Math.max(a,b)];
const add=(a,b)=>[a[0]+b[0],a[1]+b[1]];
const format=r=>r[0]===r[1]?String(r[0]):r[0]+'–'+r[1];
const minStats=['mindamage','secondary_mindamage','item_throw_mindamage'];
const maxStats=['maxdamage','secondary_maxdamage','item_throw_maxdamage'];
const local=new Set([...minStats,...maxStats,'armorclass','maxdurability','toblock','item_req_percent','item_normaldamage']);
function calculate(base,properties,definitions,settings={}) {
  if(!base||!['weapon','armor'].includes(base.category))return {stats:[],dependencies:[],notes:[]};
  const raw=base.raw||{},weapon=base.category==='weapon',stats={},origins={},dependencies=new Set(),notes=[];
  const definitionsByCode=definitions.properties||{},statDefinitions=definitions.stats||{};
  let ethereal=false,enhancedArmor=false,indestructible=false,smallDamageFallback=false;
  const indestructibleSources=[];
  const origin=p=>(p.calculationSource||'Item')+' — '+((p.lines||[]).join('; ')||p.code);
  let currentProperty;
  const assign=(stat,value,set)=>{if(!stat)return;stats[stat]=set?value:add(stats[stat]||[0,0],value);const list=set?[]:(origins[stat]||[]);list.push(currentProperty);origins[stat]=list;};
  for(const property of properties||[]) {
    currentProperty=property;
    const meta=definitionsByCode[property.code]||{},roll=pair(number(property.min),number(property.max===''||property.max==null?property.min:property.max));
    for(let i=1;i<=7;i++) {
      const fn=number(meta['func'+i]),stat=meta['stat'+i],set=meta['set'+i]==='1';
      if(fn===23){ethereal=true;continue;}
      if(fn===20){indestructible=true;indestructibleSources.push(origin(property));continue;}
      if(stat==='item_indesctructible'){indestructible=true;indestructibleSources.push(origin(property));}
      if(fn===7) {
        // A tiny ED roll which cannot raise base maximum damage gives +1 max.
        const highest=Math.max(number(raw.maxdam),number(raw['2handmaxdam']));
        const effective=roll.map(v=>!weapon||Math.trunc(highest*v/100)>0?v:0);
        assign('item_mindamage_percent',effective,set);assign('item_maxdamage_percent',effective,set);
        if(weapon){const fallback=roll.map(v=>Math.trunc(highest*v/100)>0?0:1);if(fallback.some(Boolean)){smallDamageFallback=true;maxStats.forEach(s=>assign(s,fallback,false));}}
        continue;
      }
      let value=roll;
      if(fn===15)value=[number(property.min),number(property.min)];
      else if(fn===16)value=[number(property.max),number(property.max)];
      else if(fn===17)value=number(property.param)?[number(property.param),number(property.param)]:roll;
      else if(![1,2,3,5,6,8,13].includes(fn))continue;
      // Functions 5/6, including fixed dmg-norm endpoints, affect every
      // supported weapon mode rather than just the first damage stat.
      if(fn===5||fn===15&&stat==='mindamage'||fn===17&&stat==='mindamage')minStats.forEach(s=>assign(s,value,set));
      else if(fn===6||fn===16&&stat==='maxdamage'||fn===17&&stat==='maxdamage')maxStats.forEach(s=>assign(s,value,set));
      else assign(stat,value,set);
      if(fn===2&&stat==='item_armor_percent')enhancedArmor=true;
    }
  }
  const flat={},percent={},flatDetails={};
  const source=stat=>[...new Set((origins[stat]||[]).map(origin))].join('; ');
  const detail=(stat,value,suffix='')=>source(stat)+': '+format(pair(...value))+suffix;
  for(const [stat,value] of Object.entries(stats)) {
    const meta=statDefinitions[stat]||{},op=number(meta.op),targets=[1,2,3].map(i=>meta['op stat'+i]).filter(t=>local.has(t));
    if(local.has(stat)){flat[stat]=add(flat[stat]||[0,0],value);flatDetails[stat]=(flatDetails[stat]||[]).concat(detail(stat,value));}
    if(!targets.length)continue;
    let amount=value,scaling='';
    if(op===4||op===5) {
      const dependency=meta['op base'];
      if(!['level','strength','dexterity','energy','vitality'].includes(dependency)){notes.push('Some conditional bonuses are not included.');continue;}
      dependencies.add(dependency);
      const context=Math.max(0,number(settings[dependency]));
      amount=value.map(v=>Math.floor(v*context/2**number(meta['op param'])));
      scaling='; floor('+format(value)+' × '+dependency+' '+context+' / '+2**number(meta['op param'])+') = '+format(amount);
    }
    if([1,5,13].includes(op))targets.forEach(t=>(percent[t]||(percent[t]=[])).push({amount,description:detail(stat,amount,'%')+scaling}));
    else if(op===4)targets.forEach(t=>{flat[t]=add(flat[t]||[0,0],amount);(flatDetails[t]||(flatDetails[t]=[])).push(detail(stat,amount)+scaling);});
  }
  const result=[];
  const row=(label,value,baseValue,calculation)=>{
    const rounding=[];if(calculation.some(line=>line.includes('trunc(')))rounding.push('trunc discards fractional digits.');if(calculation.some(line=>line.includes('floor(')))rounding.push('floor rounds down.');
    result.push({label,value,baseValue,altered:value!==baseValue,calculation:['Base: '+(base.name||base.code||'item')+(base.code?' ('+base.code+')':''),'Unmodified '+label.toLowerCase()+': '+baseValue,...calculation,'Result: '+value,...rounding].join('\n')});
  };
  const total=(stat,baseRange)=>{
    const bonus=flat[stat]||[0,0],ed=percent[stat]||[];
    return pair(...[0,1].map(i=>Math.max(0,baseRange[i]+ed.reduce((sum,p)=>sum+Math.trunc(baseRange[i]*p.amount[i]/100),0)+bonus[i])));
  };
  const totalDetails=(stat,baseRange,displayed=total(stat,baseRange))=>{
    const bonus=flat[stat]||[0,0],ed=percent[stat]||[],lines=ed.map(p=>p.description).concat(flatDetails[stat]||[]);
    if(smallDamageFallback&&maxStats.includes(stat))lines.push('Enhanced damage below one whole point adds +1 maximum damage instead of a percentage.');
    const indices=baseRange[0]===baseRange[1]&&bonus[0]===bonus[1]&&ed.every(p=>p.amount[0]===p.amount[1])?[0]:[0,1];
    for(const i of indices){
      const parts=[String(baseRange[i])];let sum=baseRange[i];
      for(const p of ed){const addition=Math.trunc(baseRange[i]*p.amount[i]/100);parts.push('trunc('+baseRange[i]+' × '+p.amount[i]+' / 100)');sum+=addition;}
      if(bonus[i]){parts.push(String(bonus[i]));sum+=bonus[i];}
      lines.push((indices.length===1?'Calculation':i===0?'Lowest roll':'Highest roll')+': '+parts.join(' + ')+' = '+sum);
      if(sum!==displayed[i])lines.push('Damage minimum/maximum limit applied: '+displayed[i]);
    }
    return lines;
  };
  const eth=v=>ethereal?Math.trunc(v*3/2):v;
  if(weapon) {
    [['One-handed damage','mindam','maxdam',0],['Two-handed damage','2handmindam','2handmaxdam',1],['Throwing damage','minmisdam','maxmisdam',2]].forEach(([label,min,max,mode])=>{
      if(!number(raw[min])&&!number(raw[max]))return;
      const minimum=total(minStats[mode],[eth(number(raw[min])),eth(number(raw[min]))]).map(v=>Math.max(1,v));
      const maximum=total(maxStats[mode],[eth(number(raw[max])),eth(number(raw[max]))]).map((v,i)=>Math.max(minimum[i]+1,v));
      const calculation=[];
      if(ethereal)calculation.push('Ethereal base minimum: trunc('+raw[min]+' × 3 / 2) = '+eth(number(raw[min])),'Ethereal base maximum: trunc('+raw[max]+' × 3 / 2) = '+eth(number(raw[max])));
      calculation.push('Minimum damage:',...totalDetails(minStats[mode],[eth(number(raw[min])),eth(number(raw[min]))],minimum),'Maximum damage:',...totalDetails(maxStats[mode],[eth(number(raw[max])),eth(number(raw[max]))],maximum));
      row(label,format(minimum)+' to '+format(maximum),number(raw[min])+' to '+number(raw[max]),calculation);
    });
    if(flat.item_normaldamage){row('Damage added to attacks',format(flat.item_normaldamage),'0',totalDetails('item_normaldamage',[0,0]));notes.push('Damage + applies to attacks separately from displayed weapon damage.');}
  }
  if(number(raw.minac)||number(raw.maxac)) {
    // Innate ED on generated unique/set armor uses max AC + 1. Runewords
    // retain the existing normal base roll; rune ED does not reroll it.
    const innate=enhancedArmor&&settings.quality!=='runeword';
    const defense=innate?[number(raw.maxac)+1,number(raw.maxac)+1]:pair(number(raw.minac),number(raw.maxac));
    const calculation=[];
    if(innate)calculation.push('Innate enhanced defense base: '+raw.maxac+' + 1 = '+defense[0]);
    if(ethereal)calculation.push('Ethereal base: trunc('+format(defense)+' × 3 / 2) = '+format(defense.map(eth)));
    row('Defense',format(total('armorclass',defense.map(eth))),format(pair(number(raw.minac),number(raw.maxac))),calculation.concat(totalDetails('armorclass',defense.map(eth))));
    if(innate)notes.push('Innate enhanced defense uses maximum base defense + 1.');
  }
  for(const [label,key] of [['Required strength','reqstr'],['Required dexterity','reqdex']]) {
    const requirement=number(raw[key]),reduction=flat.item_req_percent||[0,0];
    const adjusted=pair(...reduction.map(v=>Math.max(0,requirement+Math.trunc(requirement*v/100)-(ethereal?10:0))));
    const calculation=(flatDetails.item_req_percent||[]).slice();
    if(ethereal)calculation.push('Ethereal requirement reduction: 10');
    for(const i of reduction[0]===reduction[1]?[0]:[0,1])calculation.push('max(0, '+requirement+' + trunc('+requirement+' × '+reduction[i]+' / 100)'+(ethereal?' − 10':'')+') = '+Math.max(0,requirement+Math.trunc(requirement*reduction[i]/100)-(ethereal?10:0)));
    row(label,format(adjusted),String(requirement),calculation);
  }
  if(number(raw.durability)&&raw.nodurability!=='1') {
    // The explicit ethereal property changes damage/AC, not durability.
    const durability=total('maxdurability',[number(raw.durability),number(raw.durability)]);
    row('Durability',indestructible?'Indestructible':format(durability),String(number(raw.durability)),indestructible?indestructibleSources:totalDetails('maxdurability',[number(raw.durability),number(raw.durability)]));
  }
  if(flat.toblock)row('Item blocking bonus',format(flat.toblock)+'%','0%',totalDetails('toblock',[0,0]));
  return {stats:result,dependencies:[...dependencies],ethereal,notes:[...new Set(notes)]};
}
exports.calculate=calculate;
