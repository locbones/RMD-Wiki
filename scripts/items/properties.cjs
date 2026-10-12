const s = require('./source.cjs');
const number = x => x !== '' && Number.isFinite(Number(x)) ? Number(x) : null;
const decimal = x => Number.isFinite(x) ? String(Number(x.toFixed(6))) : String(x);
function range(min,max,divisor=1) {
  const a=number(min), b=number(max);
  if(a==null) return s.clean(min || max);
  const lo=decimal(a/divisor), hi=decimal((b==null?a:b)/divisor);
  return lo===hi?lo:`${lo}–${hi}`;
}
function printf(template, values) {
  let n=0;
  return s.clean(template).replace(/%%|%(\+)?(?:\d+\$)?[difus]/g,(match,plus)=>{
    if(match==='%%') return '%';
    const value=String(values[Math.min(n++,values.length-1)] ?? '');
    return plus && !/^[-+]/.test(value) ? '+'+value : value;
  });
}
const hiddenCodes = new Set(['state','aura-hidden','auracheck','RW-Tier','rng-generator','weight-combo','weight-combo-ac','kill-tracker','death-tracker','Weight-Tracker','Weight-Display','GB-Total','JB-Rare','RB-High','RB-Low','RB-Mid','score']);
const tabs = new Map();
s.tables.charstats.forEach((row,classId)=>{
  for(let n=1;n<=3;n++) tabs.set(classId*3+n-1,s.lookup(s.get(row,`StrSkillTab${n}`))?.text);
});
function fromStat(statName,value,parameter) {
  const stat=s.stats.get(statName.toLowerCase());
  if(!stat) return null;
  const negative=number(value)!=null&&number(value)<0;
  const key=negative&&stat.descstrneg?stat.descstrneg:stat.descstrpos;
  const template=s.lookup(key)?.text;
  if(!template || !stat.descfunc) return null;
  if(template.includes('%')) return printf(template,[value,parameter]);
  // descval 1 places the value before a description; 2 places it afterwards.
  if(stat.descval==='1') return `${value} ${template}`;
  if(stat.descval==='2') return `${template} ${value}`;
  return template;
}
function describe(property) {
  const {code,param,min,max}=property;
  const meta=s.properties.get(code.toLowerCase());
  if(!meta) { s.issues.push({kind:'unknown-property',code,source:property.source}); return [`${code}: ${range(min,max)}${param?' (parameter '+param+')':''}`]; }
  property.stats=Array.from({length:7},(_,i)=>({name:meta[`stat${i+1}`],func:meta[`func${i+1}`],value:meta[`val${i+1}`]})).filter(t=>t.name||t.func);
  property.parameterMeaning=meta['*Parameter'];
  property.valueMeaning={min:meta['*Min'],max:meta['*Max']};
  if(hiddenCodes.has(code)||code.endsWith('-hidden')) {property.internal=true;return [];}
  const v=range(min,max);
  const sk=()=>s.skill(param);
  if(['skill-death','skill-kill'].includes(code)) {property.internal=true;return [];}
  if(/^splash-(cleaving|piercing|sweeping)$/.test(code)) return [fromStat(meta.stat1,v,param)||`${code.split('-')[1]} damage`];
  if(meta.func1==='21'&&meta.stat1==='item_addclassskills') return [`+${v} to ${s.tables.charstats[Number(meta.val1)]?.class||'class '+meta.val1} Skill Levels`];
  if(meta.func1==='21'&&meta.stat1==='item_elemskill') return [meta['*Tooltip'].replace(/^"|"$/g,'').replace(/#/g,v)];
  if(meta.func1==='21'&&meta.stat1==='item_nonclassskill') return [`+${v} to ${s.skill(meta.val1).name} (any class)`];
  if(code==='skill-rand') return [`+${param} to a random skill (skill IDs ${range(min,max)}; matching class only)`];
  if(/^(?:hit|att|gethit|kill|death|levelup)-skill$/.test(code)||code==='hit-skill-noctc') {
    const event={'hit-skill':'on striking','att-skill':'on attack','gethit-skill':'when struck','kill-skill':'on kill','death-skill':'on death','levelup-skill':'on level-up'}[code]||'on striking';
    const dynamic=Number(max)<=0;
    if(dynamic)property.skillLevel={mode:'item-level',sourceValue:max};
    return [`${Number(min)>0?min:'5'}% chance to cast ${dynamic?'':`level ${max} `}${sk().name} ${event}${dynamic?' (skill level scales with item level)':''}`];
  }
  if(code==='charged') return [`Level ${max} ${sk().name} (${min} charges)`]; // Source columns explicitly define Min=charges, Max=level.
  if(code==='skill'||code==='oskill') {const skill=sk();return [`${Number(min)>=0?'+':''}${v} to ${skill.name}${code==='skill'&&skill.className?` (${skill.className} only)`:code==='oskill'?' (any class)':''}`];}
  if(code==='aura') return [`Level ${v} ${sk().name} aura when equipped`];
  if(code==='skilltab') {
    const template=tabs.get(Number(param));
    if(template) return [printf(template,[v])];
    s.issues.push({kind:'unknown-skill-tab',param,source:property.source});
    return [`+${v} to skill tab ${param}`];
  }
  if(/^randclassskill/.test(code)) return [`+${meta.val1} to a random class's skill levels`];
  if(code==='reanimate'||code==='reanimate-display') {const monster=s.tables.monstats.find(r=>s.get(r,'*hcIdx')===param||r.Id===param);const name=monster?s.name(monster.NameStr,monster.Id):param;return [code==='reanimate-display'?`${name} [Tier ${v}]`:`${v}% chance to reanimate as ${name}`];}
  if(code==='rep-dur'||code==='rep-quant') {const rate=number(param);return [rate&&rate>0?`${code==='rep-dur'?'Repairs 1 durability':'Replenishes 1 quantity'} every ${decimal(100/rate)} seconds`:meta['*Tooltip']];}
  if(code==='dmg-pois') {const frames=number(param);if(frames!=null&&frames>0&&number(min)!=null&&number(max)!=null){property.poisonRate={min:number(min),max:number(max),divisor:256,frames};return [`Adds ${range(Math.ceil(Number(min)*frames/256),Math.ceil(Number(max)*frames/256))} poison damage over ${decimal(frames/25)} seconds`];}}
  if(code==='dmg-cold') return [`Adds ${range(min,max)} cold damage${number(param)>0?` (${decimal(Number(param)/25)} second chill length)`:''}`];
  if(code==='dmg-elem') return ['fire','lightning','cold'].map(element=>`Adds ${v} ${element} damage`);
  if(/^dmg-(fire|ltng|mag|norm|norm-2h|throw)$/.test(code)) {const element={fire:'fire',ltng:'lightning',mag:'magic',norm:'physical','norm-2h':'two-handed physical',throw:'throwing'}[code.slice(4)];return [`Adds ${range(min,max)} ${element} damage`];}
  if(code==='cold-len'||code==='pois-len') return [`${code==='cold-len'?'Cold':'Poison'} duration: ${range(min,max,25)} seconds`];
  if(code==='dur') return [`Maximum durability +${v}`];
  if(code==='res-all') return [`All resistances ${Number(min)>=0?'+':''}${v}%`];
  if(code==='res-all-max') return [`Maximum all resistances ${Number(min)>=0?'+':''}${v}%`];
  if(code==='all-stats') return [`${Number(min)>=0?'+':''}${v} to all attributes`];
  if(code==='dualsteal') return [`${v}% life stolen per hit`,`${v}% mana stolen per hit`];
  if(code==='indestruct'||code==='indest-rune') return ['Indestructible'];
  if(code==='ethereal') return ['Ethereal'];
  if(code==='noconsume') return ['Does not consume quantity'];
  if(code==='hidden-vit') return ['Mercenary only'];
  if(code==='limitbreak') return ['Unlocks Limit Break'];
  if(code==='dmg%'||code==='dmg-min'||code==='dmg-max'||code==='dmg') {
    const label={'dmg%':'% Enhanced Damage','dmg-min':' to Minimum Damage','dmg-max':' to Maximum Damage',dmg:' Damage'}[code];
    return [`${Number(min)>=0?'+':''}${v}${label}`];
  }
  const lines=[];
  for(const statSlot of property.stats) {
    if(!statSlot.name) continue;
    const stat=s.stats.get(statSlot.name.toLowerCase());
    let value=v;
    if(statSlot.func==='15')value=min;
    if(statSlot.func==='16')value=max;
    if(statSlot.func==='17') {
      const divisor=stat?.['op base'] && stat['op param']!=='' ? 2**Number(stat['op param']):1;
      value=range(param,param,divisor);
    }
    let line=fromStat(statSlot.name,value,param);
    if(line&&statSlot.func==='17'&&stat?.['op base']) {
      const base=stat['op base'];
      line+=` per ${base==='level'?'character level':base[0].toUpperCase()+base.slice(1)}`;
      property.scaling={base,divisor:2**Number(stat['op param']||0),coefficient:param};
    }
    if(line&&!/%[+\d$]*[dis]|\[Skill\]/.test(line)) lines.push(line);
  }
  if(lines.length) return [...new Set(lines)];
  const template=meta['*Tooltip'];
  if(template) {
    const values=(template.match(/#/g)||[]).length>1?[min,max,param]:[v||param];
    let n=0;
    let result=template.replace(/#/g,()=>values[Math.min(n++,values.length-1)]||'');
    if(result.includes('[Skill]')) result=result.replace(/\[Skill\]/g,sk().name);
    if(/\[Class\]/.test(result)) result=result.replace(/\[Class\]/g,sk().className);
    if(/[\[\]]/.test(result)) s.issues.push({kind:'unresolved-tooltip',code,text:result,source:property.source});
    return [result];
  }
  // No in-game description exists: retain the property in the source inspector.
  property.internal=true;
  return [];
}
function slots(row,prefix='prop',parameter='par',minimum='min',maximum='max',count=12,suffix='') {
  const list=[];
  for(let n=1;n<=count;n++) {
    const code=row[`${prefix}${n}${suffix}`];
    if(!code) continue;
    const property={code,param:row[`${parameter}${n}${suffix}`]||'',min:row[`${minimum}${n}${suffix}`]||'',max:row[`${maximum}${n}${suffix}`]||'',slot:`${prefix}${n}${suffix}`,source:row._source};
    property.lines=describe(property);
    list.push(property);
  }
  return list;
}
function cubeSlots(row) {
  const list=[];
  for(let n=1;n<=5;n++) {
    const code=row[`mod ${n}`];if(!code)continue;
    const property={code,param:row[`mod ${n} param`]||'',min:row[`mod ${n} min`]||'',max:row[`mod ${n} max`]||'',slot:`mod ${n}`,source:row._source};
    property.lines=describe(property);list.push(property);
  }
  return list;
}
module.exports={number,decimal,range,printf,describe,slots,cubeSlots};
