'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {MAX_PLAYERS,Engine,noDrop,runsFor,cumulative,options}=require('./loot/engine.cjs');
const comparison=require('./loot/comparison.cjs');
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
function close(a,b,label){assert.ok(Math.abs(a-b)<1e-11*Math.max(1,Math.abs(b)),label+': '+a+' vs '+b);}
const ratio={Version:'1',Uber:'0','Class Specific':'0',Unique:'400',UniqueDivisor:'1',UniqueMin:'3200',Set:'160',SetDivisor:'2',SetMin:'2800'};
const fixtureItems=[{id:'base:a',code:'a',kind:'base',enabled:true},{id:'base:b',code:'b',kind:'base',enabled:true},{id:'unique:a',code:'a',kind:'unique',enabled:true,level:10,rarity:1},{id:'unique:a2',code:'a',kind:'unique',enabled:true,level:20,rarity:3},{id:'set:a',code:'a',kind:'set',enabled:true,level:1,rarity:1},{id:'set:craft',code:'a',kind:'set',enabled:true,level:1,rarity:0,recipeOnly:true},{id:'set:cow',code:'a',kind:'set',enabled:true,level:1,rarity:1,cowOnly:true}];
function fixtureTC(name,picks,entries,noDrop=0,quality=[0,0,0,0],group=0,level=0){return {name,picks,entries,noDrop,quality,group,level,reachable:['base:a','base:b','unique:a','unique:a2','set:a','set:craft'],total:entries.reduce((n,e)=>n+e.weight,0)};}
const a={kind:'item',ref:'base:a',weight:1},b={kind:'item',ref:'base:b',weight:1},tc=(ref,weight=1)=>({kind:'tc',ref,weight});
const fixtures={items:fixtureItems,bases:{a:{level:10,normal:false,unique:false,classSpecific:false},b:{level:1,normal:true}},areas:[],ratios:[ratio],classes:[
  fixtureTC('Half',1,[a,b]),fixtureTC('Twice',2,[a,b]),fixtureTC('Fixed',-2,[{...a,weight:2},b],100),
  fixtureTC('OtherSix',6,[b]),fixtureTC('AfterCap',-2,[tc('OtherSix'),a]),
  fixtureTC('ItemBranch',5,[b],1),fixtureTC('RuneBranch',3,[a,b]),fixtureTC('CountessFixture',-2,[tc('ItemBranch'),tc('RuneBranch')]),
  fixtureTC('NoDrop',1,[{...a,weight:100}],100),fixtureTC('LargeParty',1,[{...a,weight:100}],900),fixtureTC('Empty',1,[]),fixtureTC('EmptyChoice',1,[tc('Empty'),a]),
  fixtureTC('Single',1,[a]),fixtureTC('ForcedUnique',1,[{kind:'item',ref:'unique:a',weight:1}]),
  fixtureTC('ForcedCowSet',1,[{kind:'item',ref:'set:cow',weight:1}]),
  fixtureTC('Inherited',1,[tc('Single')],0,[1024,0,0,0]),fixtureTC('VeryRare',1,[a,{...b,weight:1e17}]),
  fixtureTC('UpgradeLow',1,[a],0,[0,0,0,0],7,1),fixtureTC('UpgradeHigh',1,[b],0,[0,0,0,0],7,80),fixtureTC('Boundary',1,[a],0,[0,0,0,0],8,81),fixtureTC('UnrelatedSameGroup',1,[b],0,[0,0,0,0],7,90)
]};
let checks=0;const engine=new Engine(fixtures),calc=(name,id='base:a',settings={})=>{checks++;return engine.calculate(name,id,{level:10,...settings});};
close(calc('Half').chance,.5,'Single weighted pick');close(calc('Twice').chance,.75,'At least one in repeated picks');
close(calc('Fixed').chance,1,'Negative picks repeat slots and ignore NoDrop');close(calc('AfterCap').chance,0,'Ordered cap blocks later loot');
close(calc('CountessFixture').chance,27/32,'Countess ordered branches share six-item budget');
close(calc('EmptyChoice').chance,.5,'Empty branch consumes no item slots');
close(calc('NoDrop').chance,.5,'P1 NoDrop');close(calc('NoDrop','base:a',{players:2}).chance,.5,'P2 equals solo P1');
close(calc('NoDrop','base:a',{players:3}).chance,100/133,'P3 integer NoDrop');close(calc('NoDrop','base:a',{players:8}).chance,100/106,'P8 solo NoDrop');
assert.equal(noDrop(fixtures.classes.find(t=>t.name==='NoDrop'),options({players:8,nearby:8})),0);checks++;
assert.equal(MAX_PLAYERS,20);assert.equal(options({players:20,nearby:20}).nearby,20);assert.equal(options({players:99,nearby:99}).players,20);assert.equal(options({players:8,nearby:20}).nearby,8);checks+=4;
close(calc('LargeParty','base:a',{players:9}).chance,100/244,'P9 solo NoDrop');
close(calc('LargeParty','base:a',{players:20}).chance,100/153,'P20 solo NoDrop');
close(calc('LargeParty','base:a',{players:20,nearby:20}).chance,100/113,'P20 nearby party NoDrop');
close(calc('Single','unique:a').chance,1/400,'Unique roll at equal base/item level');
close(calc('Single','unique:a',{mf:200}).chance,128/24265,'MF with effective-MF and integer truncation');
close(calc('Single','set:a').chance,399/64000,'Set roll follows failed unique roll');
close(calc('Single','unique:a',{level:9}).chance,0,'Unique level gating');
close(calc('Single','set:a',{level:9}).chance,400/64160,'Failed unique eligibility does not reroll quality as a set');
close(calc('Single','unique:a',{level:20}).chance,(128/(390*128))/4,'Eligible named unique rarity weights');
close(calc('Single','set:craft').chance,0,'Forsaken Pact recipe exclusion');
close(calc('ForcedUnique','unique:a',{mf:0}).chance,1,'Explicit unique bypasses MF quality roll');
close(calc('ForcedUnique','unique:a',{level:9}).chance,0,'Explicit unique still requires eligible level');
close(calc('Inherited','unique:a').chance,1,'Quality bonuses propagate into children');
close(calc('ForcedCowSet','set:cow').chance,0,'Cow set restriction also applies to explicit set entries');
close(calc('ForcedCowSet','set:cow',{cow:true}).chance,1,'Explicit cow set entry on a cow');
assert.ok(calc('VeryRare').chance>0&&calc('VeryRare').chance<1e-16,'Rare chances retain precision');checks++;
assert.equal(engine.upgrade('UpgradeLow',79),'UpgradeLow');assert.equal(engine.upgrade('UpgradeLow',99),'UpgradeHigh');checks+=2;
close(cumulative(.1,3),.271,'Repeated-run probability');assert.equal(runsFor(.1,.5),7);assert.equal(runsFor(0,.9),Infinity);assert.equal(cumulative(1,0),0);checks+=4;
// Independent seeded simulation of the ordered Countess-shaped fixture.
let state=0x734a15,success=0;function random(){state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;}
const trials=150000;for(let run=0;run<trials;run++){let count=0,hit=false;for(let i=0;i<5;i++)if(random()<.5)count++;for(let i=0;i<3&&count<6;i++,count++)if(random()<.5)hit=true;if(hit)success++;}
assert.ok(Math.abs(success/trials-27/32)<.004,'Countess DP disagrees with independent simulation');checks++;
const data=JSON.parse(read('data/loot/catalog.json')),real=new Engine(data),s=require('./items/source.cjs');
assert.ok(data.items.every(item=>(item.recipes||[]).every(recipe=>! /\briddle\b/i.test(recipe.name))),'Riddle recipes must not be published in loot source data');checks++;
assert.equal(data.items.filter(i=>i.kind==='base').length,[...s.bases.values()].filter(r=>r.type).length);
for(const row of s.tables.uniqueitems.filter(r=>r.index&&r.code)){
  const item=real.items.get('unique:'+(s.get(row,'*ID')||row._source.line));assert.ok(item);assert.equal(item.code,row.code);assert.equal(item.level,Number(row.lvl||0));assert.equal(item.rarity,Number(row.rarity||0));assert.equal(item.enabled,row.enabled==='1');checks++;
}
for(const row of s.table('treasureclassex')){
  const tc=real.classes.get(row['Treasure Class']);assert.ok(tc);assert.equal(tc.picks,Number(row.Picks)||1);assert.equal(tc.noDrop,Number(row.NoDrop||0));assert.equal(tc.source.line,row._source.line);checks++;
}
// Every imported table conserves probability, including ordered multibranch
// drops. Validate a rune and a common base through all current tables.
for(const target of ['base:r30','base:rin'])for(const tc of data.classes){
  const r=real.calculate(tc.name,target,{level:94,mf:200,players:1,nearby:1});assert.ok(Number.isFinite(r.chance)&&r.chance>=0&&r.chance<=1,'Invalid odds '+tc.name);close(r.distribution.reduce((n,v)=>n+v,0),1,'Mass conservation '+tc.name);assert.ok(r.distribution.length===7&&r.expectedDrops<=6+1e-10);checks++;
}
const diablo=data.sources.find(s=>s.id==='monster:diablo'),normal=real.contexts(diablo,{difficulty:2,encounter:'standard'})[0],quest=real.contexts(diablo,{difficulty:2,encounter:'quest'})[0];
assert.equal(normal.table,'Diablo (H)');assert.equal(quest.table,'Diabloq (H)');assert.equal(normal.area.id,'108');checks+=3;
const countess=data.sources.find(s=>s.id==='su:The Countess');assert.ok(countess);assert.equal(real.contexts(countess,{difficulty:2,encounter:'standard'})[0].table,'Countess (H)');checks++;
const fallen=data.sources.find(s=>s.id==='monster:fallen1');assert.equal(real.contexts(fallen,{difficulty:2,encounter:'desecrated'}).length,0);checks++;
assert.ok(data.items.some(i=>i.code==='Z01')&&data.items.some(i=>i.code==='z01'),'Case-distinct item codes missing');checks++;
assert.ok(!data.issues.some(i=>i.kind==='unresolved-loot-entry'),'Unresolved loot-table entry');
for(const input of data.inputs){const file=path.join(input.origin==='mod'?s.roots.mod:s.roots.archive,input.relative);assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),input.sha256,'Source changed: '+file);}
const parse=html=>new Map(JSON.parse(html.match(/<script class="tiddlywiki-tiddler-store" type="application\/json">([\s\S]*?)<\/script>/)[1]).map(t=>[t.title,t]));
const wiki=parse(read('index.html'));assert.equal(wiki.get('$:/rmd/loot-data').text,JSON.stringify(data));assert.equal(wiki.get('$:/rmd/loot-engine.js').text,read('scripts/loot/engine.cjs'));assert.ok(wiki.get('Loot Calculator').text.includes('<$rmd-loot/>'));
for(const name of ['loot-widget','loot.css','loot-comparison','loot-route-picker']){const text=read('theme/'+name+'.tid').replace(/\r\n/g,'\n'),split=text.indexOf('\n\n'),title=text.match(/^title: (.+)/)[1];assert.equal(wiki.get(title).text,text.slice(split+2));}
assert.equal(wiki.get('$:/rmd/loot-comparison.js').text,read('scripts/loot/comparison.cjs'));
// Whole-run odds, stochastic map mixtures, rare-item precision and reproducibility.
const direct=comparison.simulate({kind:'monster',id:'x',chance:.01,kills:100,minutes:2});
close(direct.chance,1-Math.pow(.99,100),'100 kills aggregate');close(direct.expectedRuns,1/direct.chance,'Geometric expected runs');close(direct.expectedMinutes,2/direct.chance,'Time per run');
assert.equal(comparison.simulate({kind:'monster',id:'x',chance:0,kills:100,minutes:2}).expectedRuns,Infinity);
assert.equal(comparison.simulate({kind:'monster',id:'x',chance:1,kills:0,minutes:2}).chance,0);
assert.throws(()=>comparison.simulate({kind:'monster',chance:null,kills:1,minutes:2}),/supported/);
const spawn=(id,p)=>({id,name:id,chance:p,isSpawn:true,weight:1,min:1,max:1,sparse:0,ranged:false}),areaFixture={kind:'area',method:'manual',kills:10,packs:10,spread:0,types:1,pool:[spawn('a',0),spawn('b',.2)],minutes:3,samples:5000,seed:103};
const sampled=comparison.simulate(areaFixture);assert.deepEqual(sampled,comparison.simulate(areaFixture),'Same seed must reproduce maps');
assert.ok(Math.abs(sampled.chance-(1-Math.pow(.8,10))/2)<.015,'Average map survival, not average per-kill chance');assert.ok(Math.abs(sampled.chance-cumulative(.1,10))>.15);
const tiny=comparison.simulate({...areaFixture,pool:[spawn('a',1e-20)]});assert.ok(tiny.chance>0&&Math.abs(tiny.chance/1e-19-1)<1e-10,'Rare-item integration must retain precision');
const density=comparison.simulate({...areaFixture,method:'density',packs:10,types:1,pool:[spawn('a',.01)]});
assert.ok(Math.abs(density.meanKills-10)<.15,'Poisson population mean');assert.ok(Math.abs(density.chance-(1-Math.exp(-.1)))<.003,'Poisson-integrated success');
const mixed=comparison.simulate({...areaFixture,kills:100,types:2,pool:[{...spawn('a',.01),weight:3},spawn('b',.01)]});assert.ok(Math.abs(mixed.mix.find(m=>m.id==='a').kills-75)<.3,'Rarity-weighted pack mix');close(mixed.chance,cumulative(.01,100),'Fixed-budget equal-probability mix');
const groupSample=comparison.simulate({...areaFixture,method:'density',packs:10,types:1,pool:[{...spawn('a',.01),min:2,max:4}]});assert.ok(Math.abs(groupSample.meanKills-30)<.6,'Group sizes affect population');assert.ok(groupSample.killsRange[1]>groupSample.killsRange[0]);
const sparse=comparison.simulate({...areaFixture,method:'density',packs:20,types:1,pool:[{...spawn('a',.01),sparse:49}]});assert.ok(Math.abs(sparse.meanKills-10)<.2,'Sparse population thinning');
const replaced=comparison.simulate({...areaFixture,method:'density',packs:20,types:1,pool:[{...spawn('a',0),replacement:spawn('b',.01)}]});assert.ok(Math.abs(replaced.mix.find(m=>m.id==='b').kills/20-.79)<.02,'Place-spawn replacement probability');
assert.equal(comparison.simulate({...areaFixture,method:'density',packs:0}).chance,0);assert.throws(()=>comparison.simulate({...areaFixture,pool:[spawn('a',null)]}),/Unsupported/);
close(comparison.densityPacks({size:[[3,3]],density:[999]},0,100),.25,'Subtile population opportunities');
close(comparison.densityPacks({size:[[3,3]],density:[99999]},0,100),2.50025,'Density cap');
assert.equal(comparison.densityPacks({size:[[3,3]],density:[0]},0,100),0);
const poolConfig={pool:[spawn('a',0),spawn('b',0),spawn('c',0)],types:2,rangedFirst:false};
for(let seed=0;seed<20;seed++){const selected=comparison.selectedPool(poolConfig,comparison.rng(seed));assert.equal(selected.length,2);assert.equal(new Set(selected.map(m=>m.id)).size,2);}
assert.deepEqual(comparison.selectedPool({types:2,pool:[{...spawn('a',0),isSpawn:false},spawn('b',0)]},comparison.rng(1)).map(m=>m.id),['b']);
assert.equal(comparison.selectedPool({types:1,rangedFirst:true,pool:[spawn('a',0),{...spawn('b',0),ranged:true}]},comparison.rng(1))[0].id,'b');
// Preset variants are exclusive; shared quest/map identities and their minions
// must not be double-counted. Boss-only maps need no ordinary spawn pool.
const fixedMonster={id:'boss',name:'Boss',chance:.2,onePerGame:true},fixedEntry={monster:fixedMonster,count:1,minion:spawn('guard',.1),minionRange:[2,2]};
const fixedConfig={...areaFixture,method:'density',packs:0,pool:[],types:0,fixed:[fixedEntry],fixedGroups:[{variants:[{floorTiles:10,populate:true,encounters:[fixedEntry]}]}]};
const fixedResult=comparison.simulate(fixedConfig);close(fixedResult.meanKills,3,'One boss and two guards, deduplicated across bindings');close(fixedResult.chance,1-.8*.9*.9,'Fixed boss/minion combined chance');close(fixedResult.components.fixed,1,'One fixed boss');close(fixedResult.components.minion,2,'Two minions');
const variants=comparison.simulate({...fixedConfig,fixed:[],fixedGroups:[{variants:[{encounters:[{monster:fixedMonster}]},{encounters:[]}]}]});assert.ok(Math.abs(variants.chance-.1)<.007,'Alternative maps are not simultaneous spawns');
const eliteBase={...spawn('a',0),championChance:.5,uniqueChance:.2,minion:spawn('guard',.1)};
const eliteConfig={...areaFixture,kills:0,pool:[eliteBase],types:1,elites:true,eliteRange:[1,1],championPercent:0};
const uniqueResult=comparison.simulate(eliteConfig);close(uniqueResult.components.unique,1,'One unique leader');assert.ok(Math.abs(uniqueResult.components.minion-4.5)<.05,'Random unique minion count');assert.ok(Math.abs(uniqueResult.chance-(1-.8*(Math.pow(.9,3)+Math.pow(.9,4)+Math.pow(.9,5)+Math.pow(.9,6))/4))<.004,'Unique table and minion table odds');
const championResult=comparison.simulate({...eliteConfig,championPercent:100});assert.ok(Math.abs(championResult.components.champion-3)<.04,'Two to four champions');assert.equal(championResult.components.unique,0);assert.equal(championResult.components.minion,0);assert.ok(Math.abs(championResult.chance-(1-(.25+.125+.0625)/3))<.005,'Champion quality/pack probability');
const deducted=comparison.simulate({...eliteConfig,fixed:[{monster:{...fixedMonster,chance:0},countsTowardElite:true}],eliteRange:[1,1]});assert.equal(deducted.components.unique,0,'Preset unique consumes area budget');
const party=comparison.simulate({...areaFixture,kills:10,pool:[{...spawn('a',0),min:2,max:2,partyRange:[3,3],partyUnits:[spawn('b',.1)]}],types:1});close(party.meanKills,10,'Manual budget includes companions');close(party.chance,1-Math.pow(.9,6),'PartyMin/PartyMax companion odds without recursion');
const bossLimited=comparison.simulate({kind:'monster',id:'boss',chance:.2,kills:99,minutes:2,onePerGame:true});close(bossLimited.chance,.2,'Boss routes cap at one');assert.equal(bossLimited.meanKills,1);assert.equal(comparison.limitKills({kind:'superunique'},'standard',500),1);assert.equal(comparison.limitKills({kind:'monster'},'unique',500),1);assert.equal(comparison.limitKills({kind:'monster'},'standard',500),500);
const levelRows=s.table('levels');for(const area of data.areas){const row=levelRows.find(r=>r.Id===area.id);assert.deepEqual(area.population.density,['','(N)','(H)'].map(z=>Number(row['MonDen'+z]||0)));assert.equal(area.population.types,Number(row.NumMon||0));}
assert.ok(data.areas.find(a=>a.id==='108').population.fixed.some(e=>e.id==='monster:diablo'));
assert.equal(data.areas.find(a=>a.id==='108').population.fixed.filter(e=>e.evidence==='Chaos seal encounter').length,3);
assert.equal(data.areas.find(a=>a.id==='131').population.fixed.filter(e=>e.evidence==='Throne wave encounter').length,5);
assert.equal(data.areas.find(a=>a.id==='83').population.fixedGroups.flatMap(g=>g.variants.flatMap(v=>v.encounters)).filter(e=>e.id.startsWith('su:')).length,3);
assert.deepEqual(data.sources.find(s=>s.id==='su:The Countess').minionRange,[6,6]);
assert.equal(data.areas.find(a=>a.id==='73').population.geometry.floorTiles,0,'Populate=0 suppresses random density');
const decodeMap=require('./loot/population.cjs').decodeMap,countessMap=s.file('global/tiles/Act1/Crypt/CryptCountess1.ds1');assert.ok(decodeMap(countessMap.buffer).floorTiles>0);assert.throws(()=>decodeMap(Buffer.alloc(4)),/Truncated/);
// Data Guide quality qualification: use equipment tier, all quality divisors,
// minimum caps and TC quality factors with engine integer rounding.
const ratioFixture={...fixtures,bases:{...fixtures.bases,a:{...fixtures.bases.a,uber:true}},ratios:[{...ratio,Version:'0',Uber:'1',Unique:'999'},{...ratio,Version:'1',Uber:'0',Unique:'800'},{...ratio,Version:'1',Uber:'1',Unique:'200'},{...ratio,Version:'101',Uber:'1',Unique:'1'}]};
close(new Engine(ratioFixture).calculate('Single','unique:a',{level:10}).chance,1/200,'Exceptional/elite Uber row and version ceiling');
const divisorEngine=new Engine({...fixtures,ratios:[{...ratio,UniqueDivisor:'3',UniqueMin:'0'}]});close(divisorEngine.calculate('Single','unique:a',{level:19}).chance,1/397,'Quality divisor uses truncated level difference');
const floorEngine=new Engine({...fixtures,ratios:[{...ratio,Unique:'100',UniqueMin:'6400'}]});close(floorEngine.calculate('Single','unique:a',{level:10,mf:10000}).chance,128/6400,'Quality minimum applies after MF');
const tcBonusEngine=new Engine({...fixtures,classes:fixtures.classes.concat([fixtureTC('QualityBonus',1,[a],0,[512,0,0,0])])});close(tcBonusEngine.calculate('QualityBonus','unique:a',{level:10}).chance,1/200,'TC quality divisor bonus');
assert.equal(data.bases.uap.uber,true);assert.equal(data.bases.cap.uber,false);checks+=40;
const rulesAudit=JSON.parse(read('data/loot/rules-audit.json'));assert.deepEqual(rulesAudit.unsupported,[]);assert.equal(wiki.get('$:/rmd/loot-rules-audit').text,JSON.stringify(rulesAudit));
for(const reference of rulesAudit.references){const bytes=fs.readFileSync(path.join(require('./loot/rules-audit.cjs').guideRoot,reference.relative));assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),reference.sha256,'Data Guide reference changed');}
assert.equal(data.sources.find(src=>src.id==='monster:smith').onePerGame,true);assert.deepEqual(data.spawnMonsters.fallen1.partyRange,[2,5]);checks+=4+rulesAudit.references.length;
assert.equal(data.spawnMonsters.fallen1.min,1);assert.equal(data.spawnMonsters.hellbovine.max,10);checks+=50+data.areas.length*2;
for(const item of data.items)if(item.image)assert.ok(wiki.has(item.image),'Missing loot sprite '+item.image);
// The mobile theme has evolved since the original loot import snapshot.
// Check its current source instead of requiring the old embedded stylesheet.
assert.equal(wiki.get('$:/zzz/rmd/sanctuary.css').text,read('theme/sanctuary.css'));
const before=parse(read('.tmp/before-loot-calculator/index.html')),allowed=new Set(['$:/rmd/navigation','ReMoDDeD Wiki','$:/zzz/rmd/sanctuary.css']);
for(const [title,t]of before)if(!allowed.has(title))assert.deepEqual(wiki.get(title),t,'Unrelated tiddler changed: '+title);
assert.ok(wiki.get('$:/rmd/navigation').text.includes('[[Loot Calculator|Loot Calculator]]'));
console.log('Loot calculator verified:',checks,'probability/source checks,',data.items.length,'loot entries,',data.classes.length,'tables; unrelated wiki pages preserved.');
console.log('Documented unresolved monster bindings:',new Set(data.issues.filter(i=>i.kind==='unresolved-monster-table').map(i=>i.monster)).size);
