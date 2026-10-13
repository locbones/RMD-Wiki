// Verify generated records against game inputs, the embedded wiki, and the
// independent stat formulas. No game inputs are modified.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),s=require('./items/source.cjs');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');
const data=JSON.parse(read('data/bestiary.json'));
const store=html=>new Map(JSON.parse(html.match(/<script class="tiddlywiki-tiddler-store" type="application\/json">([\s\S]*?)<\/script>/)[1]).map(t=>[t.title,t]));
const wiki=store(read('index.html')),records=new Map(data.records.map(r=>[r.id,r]));
assert.equal(records.size,data.records.length,'Duplicate monster identifiers');
assert.equal(data.counts.definitions,s.tables.monstats.length);
const uniques=s.table('superuniques'),props=s.table('monprop'),extensions=s.table('monstats2');
assert.equal(data.counts.superuniques,uniques.length);
assert.equal(wiki.get('$:/rmd/monster-data').text,JSON.stringify(data),'Embedded catalog differs from generated JSON');
const compact=r=>Object.fromEntries(Object.entries(r).filter(([,v])=>v!==''));
const suffixes=['','(N)','(H)'];
let statChecks=0;
for(const row of s.tables.monstats){
  const r=records.get(row.Id);assert.ok(r,'Missing '+row.Id);assert.deepEqual(r.raw,compact(row));assert.deepEqual(r.source,row._source);
  assert.deepEqual(r.extended,compact(extensions.find(e=>e.Id===row.MonStatsEx)||{}));
  assert.equal(r.name,s.name(row.NameStr,row.Id));assert.equal(r.enabled,row.enabled==='1');
  for(let d=0;d<3;d++){
    const st=r.stats[d],z=suffixes[d],num=k=>Number(s.get(row,k+z)||0);
    assert.equal(st.level,num('Level'));assert.deepEqual(st.hp,[num('minHP'),num('maxHP')]);
    assert.equal(st.defense,num('AC'));assert.equal(st.experience,num('Exp'));
    assert.deepEqual(st.resists,['Dm','Ma','Fi','Li','Co','Po'].map(k=>num('Res'+k)));
    assert.deepEqual(st.attacks,['A1','A2','S1'].map(a=>({mode:a,damage:[num(a+'MinD'),num(a+'MaxD')],rating:num(a+'TH')})));
    assert.equal(st.drain,num('Drain'));assert.equal(st.coldEffect,num('coldeffect'));assert.equal(st.block,num('ToBlock'));
    assert.deepEqual(st.elements,[1,2,3].filter(n=>row['El'+n+'Type']).map(n=>({type:row['El'+n+'Type'],mode:row['El'+n+'Mode'],chance:num('El'+n+'Pct'),damage:[num('El'+n+'MinD'),num('El'+n+'MaxD')],frames:num('El'+n+'Dur')})));
    const mp=props.find(p=>p.Id===row.MonProp),expected=[];
    if(mp)for(let n=1;n<=6;n++){const end=z?' '+z:'';if(mp['prop'+n+end])expected.push([mp['prop'+n+end],mp['par'+n+end],mp['min'+n+end],mp['max'+n+end],mp['chance'+n+end]]);}
    assert.deepEqual(st.properties.map(p=>[p.code,p.param,p.min,p.max,p.chance]),expected);statChecks++;
  }
}
for(const row of uniques){
  const r=records.get('su:'+row.Superunique);assert.ok(r);assert.deepEqual(r.uniqueRaw,compact(row));assert.equal(r.baseId,row.Class);
  assert.deepEqual(r.raw,records.get(row.Class).raw);
  for(let d=0;d<3;d++){
    const z=suffixes[d],expected=Object.entries(row).filter(([k,v])=>v&&/^TC(?:\([NH]\))?(?: Desecrated)?$/.test(k)&&(d===0?!/\([NH]\)/.test(k):k.includes(z))).map(([field,value])=>[field,value]);
    assert.deepEqual(r.stats[d].treasure.map(t=>[t.field,t.value]),expected,'Superunique treasure: '+row.Superunique);
  }
}
const library={exports:{}};vm.runInNewContext(read('theme/bestiary-stats.tid').split(/\r?\n\r?\n/).slice(1).join('\n\n'),library);
const calculate=library.exports.calculate;
const levels=new Map(data.areas.map(a=>[a.id,a])),scaling=data.scaling;
for(const r of data.records){
  const page=wiki.get(r.title);assert.ok(page,'Missing individual page '+r.id);assert.equal(page['rmd-monster-id'],r.id);
  for(const l of r.locations){assert.ok(levels.has(l.area));assert.ok(l.difficulty>=0&&l.difficulty<3);assert.ok(l.source.file);}
  for(let d=0;d<3;d++){
    const a=r.locations.find(l=>l.difficulty===d),area=a&&levels.get(a.area),st=r.stats[d],z=suffixes[d];
    const level=d>0&&!r.boss&&!r.noRatio&&area&&area.levels[d]>0?area.levels[d]:st.level;
    const base=scaling[Math.max(0,Math.min(level,scaling.length-1))];
    const expected=(n,key)=>r.noRatio?n:Math.floor(n*Number(s.get(base,'L-'+key+z)||0)/100);
    const result=calculate(r,d,area,scaling);assert.equal(result.level,level);
    assert.deepEqual(Array.from(result.hp),st.hp.map(n=>Math.min(expected(n,'HP'),8388607)));
    assert.equal(result.defense,expected(st.defense,'AC'));assert.equal(result.experience,expected(st.experience,'XP'));
    result.attacks.forEach((attack,i)=>{assert.deepEqual(Array.from(attack.damage),st.attacks[i].damage.map(n=>expected(n,'DM')));assert.equal(attack.rating,expected(st.attacks[i].rating,'TH'));});statChecks++;
  }
  if(r.image)assert.ok(wiki.has(r.image.title),'Missing image '+r.image.title);
}
// Regression fixtures exercise area overrides, boss/direct-stat exceptions,
// case-insensitive Nightmare/Hell fields, and named superunique loot.
const fallen=records.get('fallen1'),syntheticArea={levels:[1,60,85]};
assert.equal(calculate(fallen,2,syntheticArea,scaling).level,85);
assert.equal(calculate({...fallen,boss:true},2,syntheticArea,scaling).level,fallen.stats[2].level);
assert.equal(calculate({...fallen,noRatio:true},2,syntheticArea,scaling).hp[0],fallen.stats[2].hp[0]);
assert.equal(records.get('su:Corpsefire').stats[2].treasure[0].value,'Corpsefire (H)');
assert.ok(records.get('willowisp3_stompers').image?.representativeOf,'Missing shared visual definition');
assert.ok(!records.get('zombie1').stats[0].properties[0].lines[0].includes('100–1%'));
let imageChecks=0;
const mediaReport=new Map(JSON.parse(read('data/bestiary-media.json')).map(r=>[r.key,r]));
for(const asset of data.media){
  const result=mediaReport.get(asset.key);assert.ok(result?.output&&!result.error&&result.version===4,'Unfinished portrait '+asset.unit);
  if(asset.animation&&asset.skeleton){
    assert.equal(result.pose,'Idle','No idle frame for '+asset.unit);
    assert.ok(result.animationSamples.length,'No animation sampling evidence for '+asset.unit);
    for(const sample of result.animationSamples){assert.ok(sample.time>0&&sample.time<sample.duration);assert.ok(/neutral|idle/i.test(sample.clip),'Non-idle clip '+sample.clip);}
  }else assert.equal(result.pose,'Static');
  const image=fs.readFileSync(path.join(root,result.output)),embedded=wiki.get('$:/rmd/monster-images/'+asset.key);
  assert.deepEqual(result.warnings,[],'Partial portrait '+asset.unit);
  assert.equal(image.toString('base64'),embedded?.text);assert.equal(image.subarray(0,4).toString(),'RIFF');assert.equal(image.subarray(8,12).toString(),'WEBP');
  assert.equal(embedded['rmd-image-sha256'],crypto.createHash('sha256').update(image).digest('hex'));assert.equal(result.missingTextures,0);assert.ok(result.coverage>.001);imageChecks++;
}
assert.ok(!wiki.get('$:/rmd/bestiary-widget.js').text.includes('Source & model details'));
assert.ok(!wiki.get('Bestiary').text.includes('Source & model details'));
for(const id of ['skeleton1','zombie1','fallenshaman1']){
  const result=mediaReport.get(records.get(id).image.key);
  assert.ok(result.animationSamples.some(s=>s.poseDifference>.1),'Unposed idle regression: '+id);
}
const snapshot=path.join(root,'.tmp/before-bestiary/index.html');
if(fs.existsSync(snapshot)){
  const before=store(fs.readFileSync(snapshot,'utf8')),navigation=new Set(['$:/plugins/rudi/tweakcat/ui/sidebar/index','$:/rmd/navigation']);
  for(const [title,original]of before){const current=wiki.get(title);assert.ok(current,'Deleted existing tiddler '+title);if(navigation.has(title))assert.equal(current.text,original.text.replaceAll('[[Bestiary (WIP)|Work in Progress]]','[[Bestiary|Bestiary]]').replace(/\[\[(?:Bosses|Edyrem) \(WIP\)\|Work in Progress\]\](?:<br><br>)?\r?\n/g,''));else assert.deepEqual(current,original,'Unrelated tiddler changed: '+title);}
}
console.log('Bestiary verified:',data.records.length,'records,',statChecks,'difficulty/stat checks,',imageChecks,'embedded portraits; existing pages preserved.');
