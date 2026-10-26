'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {calculate}=require('./items/equipment.cjs');
const root=path.resolve(__dirname,'..'),read=kind=>JSON.parse(fs.readFileSync(path.join(root,'data/item-database',kind+'.json'),'utf8'));
const definitions=read('definitions'),bases=new Map(read('bases').records.map(r=>[r.code,r]));
const prop=(code,min,max=min,param='')=>({code,min:String(min),max:String(max),param:String(param)});
const weapon={category:'weapon',raw:{mindam:'10',maxdam:'20','2handmindam':'20','2handmaxdam':'40',minmisdam:'5',maxmisdam:'15',reqstr:'100',reqdex:'40',durability:'50'}};
const armor={category:'armor',raw:{minac:'100',maxac:'200',reqstr:'100',reqdex:'0',durability:'50'}};
const value=(result,label)=>result.stats.find(s=>s.label===label)?.value;
let checks=0;
function expect(base,properties,settings,label,expected){assert.equal(value(calculate(base,properties,definitions,settings),label),expected,label);checks++;}
expect(weapon,[prop('dmg%',100,200),prop('dmg-min',3,5),prop('dmg-max',7,9)],{},'One-handed damage','23–35 to 47–69');
expect(weapon,[prop('dmg%',100),prop('dmg-norm',2,8)],{},'Two-handed damage','42 to 88');
expect(weapon,[prop('dmg%',100),prop('dmg-min',3),prop('dmg-max',7)],{},'Throwing damage','13 to 37');
expect(weapon,[prop('dmg-norm-2h',2,8)],{},'One-handed damage','10 to 20');
expect(weapon,[prop('dmg-norm-2h',2,8)],{},'Two-handed damage','22 to 48');
expect(weapon,[prop('dmg',100)],{},'One-handed damage','10 to 20');
expect(weapon,[prop('dmg',100)],{},'Damage added to attacks','100');
expect(weapon,[prop('dmg%',1)],{},'One-handed damage','10 to 21');
expect(armor,[prop('ac%',100,200),prop('ac',5,10)],{quality:'uniques'},'Defense','407–613');
expect(armor,[prop('ac%',100,200),prop('ac',5,10)],{quality:'setitems'},'Defense','407–613');
expect(armor,[prop('ac%',100,200),prop('ac',5,10)],{quality:'runeword'},'Defense','205–610');
expect(armor,[prop('ac',5,10)],{quality:'uniques'},'Defense','105–210');
expect(armor,[prop('ac%',100),prop('ac/lvl','','',8)],{quality:'uniques',level:80},'Defense','482');
expect(weapon,[prop('dmg/lvl','','',8)],{level:80},'One-handed damage','10 to 100');
expect(weapon,[prop('dmg%/lvl','','',8)],{level:80},'One-handed damage','10 to 36');
expect({...weapon,raw:{mindam:'11',maxdam:'21',reqstr:'100',reqdex:'40'}},[prop('ethereal',1),prop('dmg%',100)],{},'One-handed damage','32 to 62');
expect(armor,[prop('ac%',100),prop('ethereal',1)],{quality:'uniques'},'Defense','602');
expect(armor,[prop('ease',-20),prop('ethereal',1)],{},'Required strength','70');
expect(armor,[prop('dur',10),prop('dur%',20)],{},'Durability','70');
expect(armor,[prop('indestruct',1)],{},'Durability','Indestructible');
assert.deepEqual(calculate({category:'jewellery'},[],definitions).stats,[]);checks++;
const explained=calculate(armor,[prop('ac%',100,200),prop('ac',5,10)],definitions,{quality:'uniques'}).stats.find(s=>s.label==='Defense');
assert.equal(explained.baseValue,'100–200');assert.equal(explained.altered,true);
assert.ok(explained.calculation.includes('200 + 1 = 201'));
assert.ok(explained.calculation.includes('201 + trunc(201 × 100 / 100) + 5 = 407'));
assert.ok(explained.calculation.includes('201 + trunc(201 × 200 / 100) + 10 = 613'));checks+=5;
const unchanged=calculate(weapon,[],definitions).stats.find(s=>s.label==='Required strength');assert.equal(unchanged.altered,false);assert.ok(unchanged.calculation.includes('Unmodified required strength: 100'));checks+=2;
const level80=calculate(weapon,[prop('dmg/lvl','','',8)],definitions,{level:80}).stats[0],level99=calculate(weapon,[prop('dmg/lvl','','',8)],definitions,{level:99}).stats[0];
assert.ok(level80.calculation.includes('floor(8 × level 80 / 8) = 80'));assert.ok(level99.calculation.includes('floor(8 × level 99 / 8) = 99'));checks+=2;
const socketPreview=calculate(weapon,[prop('dmg%',100),{...prop('dmg-min',9),calculationSource:'Sol Rune'},{...prop('dmg-max',9),calculationSource:'Ith Rune'}],definitions).stats[0];
assert.ok(socketPreview.calculation.includes('Sol Rune')&&socketPreview.calculation.includes('Ith Rune'));assert.ok(socketPreview.calculation.includes('10 + trunc(10 × 100 / 100) + 9 = 29'));assert.ok(socketPreview.calculation.includes('trunc discards fractional digits.'));checks+=3;
// Independent reference values from the catalog's actual base/bonus rows.
const uniques=read('uniques').records;
for(const [name,label,expected] of [['Steelclash','Defense','50–58'],['Bonesnap','Two-handed damage','132–176 to 189–252'],['Death Cleaver','One-handed damage','99–114 to 293–338']]){
  const item=uniques.find(r=>r.name===name);assert.ok(item);expect(bases.get(item.code),item.properties,{quality:'uniques'},label,expected);
}
let computed=0;
for(const kind of ['uniques','setitems'])for(const item of read(kind).records){
  const result=calculate(bases.get(item.code),item.properties,definitions,{quality:kind,level:99,strength:100});
  for(const stat of result.stats){assert.ok(stat.value&&!/NaN|Infinity|undefined/.test(stat.value),item.name+' '+stat.label);assert.equal(stat.altered,stat.value!==stat.baseValue);assert.ok(stat.calculation.includes('Result: '+stat.value)&&! /NaN|Infinity|undefined/.test(stat.calculation),item.name+' calculation');}
  computed+=result.stats.length>0;
}
let runewords=0;
for(const word of read('runewords').records)for(const variant of word.variants){
  if(!variant.exampleBase?.compatible)continue;
  const base=bases.get(variant.exampleBase.code),context=base.category==='weapon'?'Weapons':/shield|heads/i.test(base.itemType)?'Shields':'Armor / helm';
  let properties=variant.properties.concat(variant.runes.flatMap(r=>(r.socketBonuses||[]).filter(b=>b.context===context).flatMap(b=>b.properties)));
  const preview=calculate(base,properties,definitions,{quality:'runeword',level:99});
  for(const stat of preview.stats)assert.ok(stat.value&&!/NaN|Infinity|undefined/.test(stat.value)&&stat.calculation.includes('Result: '+stat.value),word.name+' '+stat.label);
  if(word.name==='Honor'&&!variant.runic){assert.equal(value(preview,'Two-handed damage'),'14 to 94','Honor includes Ith maximum damage and Sol minimum damage once');checks++;}
  runewords++;
}
const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),wiki=new Map(JSON.parse(html.match(/<script class="tiddlywiki-tiddler-store" type="application\/json">([\s\S]*?)<\/script>/)[1]).map(t=>[t.title,t]));
assert.equal(wiki.get('$:/rmd/equipment-stats.js').text,fs.readFileSync(path.join(__dirname,'items/equipment.cjs'),'utf8'));
assert.ok(wiki.get('$:/rmd/catalog-widget.js').text.includes('this.equipmentPreview(record,bonuses,variant)'));
console.log('Equipment stats verified:',checks,'formula/roll checks;',computed,'equipment records and',runewords,'runeword examples produce finite stat previews.');
