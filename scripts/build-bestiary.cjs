const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),prepared=path.join(root,'.tmp/bestiary-prepared.json');
const args=new Set(process.argv.slice(2));
const data=args.has('--reuse-prepared')?JSON.parse(fs.readFileSync(prepared,'utf8')):require('./bestiary/catalog.cjs').build();
fs.writeFileSync(prepared,JSON.stringify(data));
if(args.has('--prepare-only')){console.log(data.counts);process.exit(0);}
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const pattern=/(<script class="tiddlywiki-tiddler-store" type="application\/json">)([\s\S]*?)(<\/script>)/;
const match=html.match(pattern);if(!match)throw Error('No native wiki store');
const tiddlers=new Map(JSON.parse(match[2]).map(t=>[t.title,t]));
const mediaKeys=new Set(data.media.map(m=>m.key));
for(const title of tiddlers.keys())if(title.startsWith('$:/rmd/monster-images/')&&!mediaKeys.has(title.slice('$:/rmd/monster-images/'.length)))tiddlers.delete(title);
const report=JSON.parse(fs.readFileSync(path.join(root,'data/bestiary-media.json'),'utf8')).filter(r=>mediaKeys.has(r.key));
const rendered=new Map(report.filter(r=>r.version===4&&r.output&&!r.error).map(r=>[r.key,r]));
const changed=[];
function put(t){changed.push(t.title);tiddlers.set(t.title,{...tiddlers.get(t.title),...t});}
let illustrations=0;
for(const asset of data.media){
  const result=rendered.get(asset.key);if(!result)continue;
  const buffer=fs.readFileSync(path.join(root,result.output));
  put({title:'$:/rmd/monster-images/'+asset.key,type:'image/webp',text:buffer.toString('base64'),width:'480',height:'480',tags:'RMDMonsterImage','rmd-model-unit':asset.unit,'rmd-definition':asset.source.file,'rmd-media-source':JSON.stringify(asset),'rmd-image-sha256':crypto.createHash('sha256').update(buffer).digest('hex')});illustrations++;
}
for(const record of data.records){
  record.title='Bestiary / '+record.name+' ('+record.id+')';
  if(record.image&&!rendered.has(record.image.key)){record.imageError=report.find(r=>r.key===record.image.key)?.error||'No render generated';record.image=null;}
  put({title:record.title,type:'text/vnd.tiddlywiki',text:'<$rmd-bestiary id="'+record.id.replace(/&/g,'&amp;').replace(/"/g,'&quot;')+'"/>',tags:'Bestiary RMDMonster','rmd-monster-id':record.id,'rmd-monster-name':record.name,'rmd-monster-family':record.family,'rmd-monster-role':record.role,'rmd-source-file':record.source.file});
}
data.counts.illustrations=illustrations;data.counts.illustratedEntries=data.records.filter(r=>r.image).length;
const page=`<div class="rmd-page-intro">
<span class="rmd-kicker">CREATURES OF SANCTUARY</span>
<h2>Know your enemy</h2>
<p>Explore ReMoDDeD’s monsters, from the Blood Moor to the depths of the Torment Trials. Search by name, ability or area; select a difficulty to compare life, damage and resistances.</p>
</div>

<$rmd-bestiary/>

<details class="rmd-be-method"><summary>How to read the Bestiary</summary>

Stats use the mod’s current monster tables, with unedited dependencies resolved from the 2.4.1.2 Archive. This catalog contains ${data.counts.definitions} monster definitions and ${data.counts.superuniques} named superuniques. The default view shows enabled hostile enemies; filters also expose summons, NPCs, helpers, and disabled definitions.

Life, damage, defense, attack rating, and XP are calculated from the Expansion columns in ''monlvl.txt'', unless the monster uses direct stats (''noRatio''). Normal uses the monster’s reference level. Nightmare and Hell use the selected area’s level unless the monster has the boss or noRatio flag. Values describe the single-player baseline before additional monster properties, unique/champion bonuses, party scaling, skill damage and quest effects. Named superunique cards show their underlying class baseline and list their fixed modifiers separately.

Resistances at 100% or higher are marked immune. The values shown are the monster’s base resistances before additional properties, affixes, or debuffs. See [[Monster Resistances/Immunities]] for the mod’s immunity mechanics. Elemental attack fields are source damage parameters; poison and skill-driven attacks can have additional runtime calculations.

Area listings identify possible random pools, unique pools, critters, configured minions, and direct DS1 map placements. A pool entry is a possible encounter, not a guarantee. Map templates whose exact area cannot be linked appear separately. Scripted encounters, dynamic map markers and skill summons may not have a directly provable area; their entries remain available.

The ${illustrations} illustrations use actual linked game models and textures decoded through D2RNexus. Animated creatures are shown in a frame from their idle animation with simple preview lighting. Static objects retain their original geometry. Variant tints, equipped attachments, particles and game lighting can change the in-game appearance. Invisible helpers have no creature portrait.

</details>`;
put({title:'Bestiary',type:'text/vnd.tiddlywiki',text:page,tags:'RMDDatabase','rmd-source-fingerprint':crypto.createHash('sha256').update(JSON.stringify(data.sourceFiles)).digest('hex')});
put({title:'$:/rmd/monster-data',type:'application/json',text:JSON.stringify(data),tags:'RMDMonsterData'});
for(const t of tiddlers.values())if(t.text?.includes('[[Bestiary (WIP)|Work in Progress]]'))put({...t,text:t.text.replaceAll('[[Bestiary (WIP)|Work in Progress]]','[[Bestiary|Bestiary]]')});
fs.writeFileSync(path.join(root,'data/bestiary.json'),JSON.stringify(data,null,2)+'\n');
fs.writeFileSync(path.join(root,'data/bestiary-validation.json'),JSON.stringify({counts:data.counts,issues:data.issues,renderFailures:report.filter(r=>r.error),illustrationWarnings:report.filter(r=>r.warnings?.length)},null,2)+'\n');
const store=JSON.stringify([...tiddlers.values()]).replace(/<\/script/gi,'<\\/script');
require('./write-wiki.cjs')(path.join(root,'index.html'),html.replace(pattern,()=>match[1]+store+match[3]),html);
console.log('Bestiary written:',data.counts,'; changed tiddlers:',changed.length);
