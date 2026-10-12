// Compare the embedded wiki and generated catalog directly with the game tables.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const s=require('./items/source.cjs');
const p=require('./items/properties.cjs');
const root=path.resolve(__dirname,'..');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,'data/item-database',name+'.json'),'utf8'));
const kinds=['bases','uniques','setitems','sets','runewords'];
const data=Object.fromEntries(kinds.map(kind=>[kind,read(kind)]));
const audit=read('audit');
const storePattern=/<script class="tiddlywiki-tiddler-store" type="application\/json">([\s\S]*?)<\/script>/;
const tiddlers=new Map(JSON.parse(fs.readFileSync(path.join(root,'index.html'),'utf8').match(storePattern)[1]).map(t=>[t.title,t]));
let checkedRows=0,checkedProperties=0;
const tablesByFile=new Map(Object.entries(s.tables).map(([name,rows])=>['global/excel/'+name+'.txt',new Map(rows.map(row=>[row._source.line,row]))]));
function checkSource(record) {
  const row=tablesByFile.get(record.source.file)?.get(record.source.line);
  assert.ok(row,'Missing source row for '+record.id);
  for(const [key,value] of Object.entries(row))if(value!=='')assert.equal(record.raw[key],value,record.id+' source field '+key);
  for(const prop of record.properties||[]) {
    assert.equal(row[prop.slot],prop.code,record.id+' property '+prop.slot);
    checkedProperties++;
  }
  checkedRows++;
}
function checkSlots(record,row,prefix,param,min,max,count,suffix='') {
  const actual=record.properties.filter(prop=>prop.slot.startsWith(prefix));
  const expected=[];
  for(let n=1;n<=count;n++)if(row[prefix+n+suffix])expected.push([row[prefix+n+suffix],row[param+n+suffix]||'',row[min+n+suffix]||'',row[max+n+suffix]||'']);
  assert.deepEqual(actual.map(prop=>[prop.code,prop.param,prop.min,prop.max]),expected,record.id+' property values');
}
for(const kind of kinds) {
  const doc=data[kind];
  assert.equal(doc.sourceFingerprint,audit.sourceFingerprint);
  assert.equal(new Set(doc.records.map(r=>r.id)).size,doc.records.length,'Duplicate '+kind+' identifiers');
  assert.ok(tiddlers.get('$:/rmd/item-data/'+kind).text===JSON.stringify(doc),'Embedded '+kind+' differs from JSON; rebuild before verifying');
  for(const record of doc.records) {
    assert.ok(tiddlers.has('$:/rmd/database/'+kind+'/'+encodeURIComponent(record.id)));
    if(kind==='runewords') {
      for(const variant of record.variants) {
        checkSource(variant);
        const row=tablesByFile.get(variant.source.file).get(variant.source.line);
        assert.deepEqual(variant.runes.map(r=>r.code),[1,2,3,4,5,6].map(n=>row['Rune'+n]).filter(Boolean));
        assert.equal(variant.enabled,row.complete==='1');
        checkSlots(variant,row,'T1Code','T1Param','T1Min','T1Max',7);
        for(const tier of variant.forging)checkSource(tier);
      }
    } else {
      checkSource(record);
      const row=tablesByFile.get(record.source.file).get(record.source.line);
      if(kind==='uniques')checkSlots(record,row,'prop','par','min','max',12);
      if(kind==='setitems')checkSlots(record,row,'prop','par','min','max',9);
      if(kind==='sets')checkSlots(record,row,'FCode','FParam','FMin','FMax',8);
      if(kind==='sets')assert.deepEqual(new Set(record.items.map(i=>i.id)),new Set(data.setitems.records.filter(i=>i.setKey===row.index).map(i=>i.id)));
    }
  }
}
assert.equal(data.bases.records.length,[...s.bases.values()].filter(r=>r.code&&r.type).length);
assert.equal(data.uniques.records.length,s.tables.uniqueitems.filter(r=>r.index&&r.code).length);
assert.equal(data.setitems.records.length,s.tables.setitems.filter(r=>r.index&&r.item).length);
assert.equal(data.sets.records.length,s.tables.sets.filter(r=>r.index).length);
const pacts=data.sets.records.filter(record=>record.tier==='F');
assert.equal(pacts.length,26,'Forsaken Pact set coverage changed');
assert.equal(data.setitems.records.filter(record=>record.tier==='F').length,66,'Forsaken Pact piece coverage changed');
for(const record of data.setitems.records) {
  const row=tablesByFile.get(record.source.file).get(record.source.line);
  const creationRecipes=s.tables.cubemain.filter(recipe=>recipe.enabled==='1'&&[recipe.output,recipe['output b'],recipe['output c']].includes(row.index)&&![1,2,3,4,5,6,7].some(n=>(recipe['input '+n]||'').split(',')[0]===row.index));
  assert.equal(record.tier==='F',row.rarity==='0'&&creationRecipes.length>0,record.name+' Forsaken Pact classification');
}
for(const set of data.sets.records) {
  assert.equal(set.tier==='F',set.items.length>0&&set.items.every(item=>item.tier==='F'),set.name+' group classification');
  for(const item of set.items)assert.deepEqual(item,data.setitems.records.find(record=>record.id===item.id));
}
assert.ok(!pacts.some(set=>set.items.some(item=>item.tier==='III')),'Forsaken Pacts must not appear under Elite');
assert.equal(data.sets.records.find(set=>set.name==="Tal Rasha's Wrappings").tier,'','A droppable set must not become a Forsaken Pact');
assert.equal(data.runewords.records.flatMap(r=>r.variants).length,s.tables.runes.filter(r=>r.Name).length);
const bases=new Map(data.bases.records.map(r=>[r.code,r]));
for(const word of data.runewords.records)for(const variant of word.variants) {
  const example=variant.exampleBase;
  if(!variant.sockets||!variant.allowedTypes.length){assert.equal(example,null);continue;}
  assert.ok(example,word.name+' is missing its base illustration');
  const base=bases.get(example.code),row=base.raw;
  assert.ok(base.spawnable);
  const types=s.ancestors(row.type);s.ancestors(row.type2,types);
  assert.ok(variant.allowedTypes.some(t=>types.has(t.code.toLowerCase())),word.name+' example has an incompatible type');
  assert.ok(!variant.excludedTypes.some(t=>types.has(t.code.toLowerCase())),word.name+' example uses an excluded type');
  const type=s.itemTypes.get(row.type.toLowerCase());
  const capacity=Math.min(Number(row.gemsockets),Number(row.invwidth)*Number(row.invheight),Math.max(...[1,2,3].map(n=>Number(type['MaxSockets'+n]||0))));
  assert.equal(example.socketCapacity,capacity);
  assert.equal(example.compatible,capacity>=variant.sockets);
  assert.deepEqual(example.image,base.image);
}
const alacrity=data.runewords.records.find(r=>r.name==='Alacrity');
assert.equal(alacrity.variants[0].exampleBase.code,'crs');
assert.ok(alacrity.variants[0].exampleBase.image.relative.endsWith('/sword/crystal_sword.sprite'));
assert.equal(alacrity.variants.find(v=>v.allowedTypes[0].code==='staf'&&v.sockets===6).exampleBase.code,'wst','A six-socket staff must not use a four-socket Long Staff');
assert.equal(data.runewords.records.find(r=>r.name==='Night').variants[0].exampleBase.compatible,false);
assert.equal(bases.get('D33').name,'Vorpal Axe');
assert.equal(bases.get('d33').name,'Decoy Gidbinn');
assert.notEqual(bases.get('Z01').image.title,bases.get('z01').image.title);
const describe=(code,param,min,max)=>p.describe({code,param,min,max});
assert.deepEqual(describe('charged','Amplify Damage','50','5'),['Level 5 Amplify Damage (50 charges)']);
assert.deepEqual(describe('dmg-pois','125','153','153'),['Adds 75 poison damage over 5 seconds']);
assert.deepEqual(describe('cast/enr','2','',''),['+0.125% Faster Cast Rate per Energy']);
assert.deepEqual(describe('sor','','2','2'),['+2 to Sorceress Skill Levels']);
assert.deepEqual(describe('coldskill','','1','2'),['+1–2 to Cold Skills']);
assert.deepEqual(describe('randclassskill','','0','6'),["+3 to a random class's skill levels"]);
assert.deepEqual(describe('splash-cleaving','444','100','1'),['Cleaving Damage']);
assert.deepEqual(describe('reanimate','9','10','10'),['10% chance to reanimate as Plague Bearer']);
assert.ok(!describe('gethit-skill','CTC_HolyBolt','50','0')[0].includes('level 0'));
const akara=data.uniques.records.find(r=>r.name==="Akara's Blessing");
assert.ok(akara.properties.flatMap(p=>p.lines).includes('Magic Damage Reduced by 5'));
const oldAkara=tiddlers.get('$:/_items/unique/amulet/akaras-blessing-677');
assert.equal(oldAkara['rmd-record-ids'],akara.id,'A shifted unique ID broke its existing link');
assert.equal(tiddlers.get('$:/_items/weapon/axe barbarian/elite/rending axe (6)').name,'Rending Axe');
assert.deepEqual(data.setitems.records.find(r=>r.name==="Civerb's Ward").partialBonuses.map(b=>b.count),[2,3]);
assert.deepEqual(data.runewords.records.find(r=>r.name==='Enigma').variants.map(v=>v.runes.map(r=>r.code)),[['r31','r06','r30'],['jew','r31','r06','r30']]);
for(const [title,tiddler] of tiddlers)if(title.startsWith('$:/rmd/item-sprites/')) {
  const png=Buffer.from(tiddler.text,'base64');
  assert.equal(png.subarray(1,4).toString(),'PNG');
  assert.equal(png.readUInt32BE(16),Number(tiddler.width));
  assert.equal(png.readUInt32BE(20),Number(tiddler.height));
  assert.deepEqual(png,fs.readFileSync(path.join(root,'Images/database',title.split('/').pop()+'.png')));
}
function images(value) {
  if(!value||typeof value!=='object')return;
  if(value.image)assert.ok(tiddlers.has(value.image.title),'Missing embedded sprite');
  Object.values(value).forEach(images);
}
Object.values(data).forEach(images);
assert.ok(!audit.sourceIssues.some(i=>['missing-base','missing-rune','missing-sprite'].includes(i.kind)));
// Import preservation check against the snapshot taken before the database migration.
const snapshot=path.join(root,'.tmp/before-item-database.html');
if(fs.existsSync(snapshot)) {
  const before=JSON.parse(fs.readFileSync(snapshot,'utf8').match(storePattern)[1]);
  const allowed=new Set(['Item Bases','Unique Items','Set Items','Runewords','Armor Runewords','Weapon Runewords','$:/rmd/catalog-widget.js','$:/zzz/rmd/sanctuary.css']);
  for(const old of before)if(!allowed.has(old.title)&&!(old.tags||'').split(' ').includes('ItemDatabase')&&!old.title.startsWith('$:/rmd/item-')&&!old.title.startsWith('$:/rmd/database/'))assert.deepEqual(tiddlers.get(old.title),old,'Unrelated tiddler changed: '+old.title);
}
console.log(`Verified ${checkedRows} source-backed rows, ${checkedProperties} property slots, catalog coverage, stat conversion regressions, old links, embedded sprites, and unrelated-tiddler preservation.`);
