const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),args=new Set(process.argv.slice(2));
const data=require('./loot/catalog.cjs').build();
const rulesAudit=require('./loot/rules-audit.cjs').build(data);
if(rulesAudit.unsupported.length)throw Error('Unsupported active treasure-class modifiers: '+rulesAudit.unsupported.join(', '));
const errors=data.issues.filter(i=>i.kind==='unresolved-loot-entry');if(errors.length)throw Error(JSON.stringify(errors));
const file=path.join(root,'index.html'),html=fs.readFileSync(file,'utf8'),pattern=/(<script class="tiddlywiki-tiddler-store" type="application\/json">)([\s\S]*?)(<\/script>)/;
const match=html.match(pattern);if(!match)throw Error('Missing native wiki store');
const tiddlers=new Map(JSON.parse(match[2]).map(t=>[t.title,t]));
const folder=path.join(root,'.tmp/before-loot-calculator');fs.mkdirSync(folder,{recursive:true});if(!fs.existsSync(path.join(folder,'index.html')))fs.writeFileSync(path.join(folder,'index.html'),html);
fs.mkdirSync(path.join(root,'data/loot'),{recursive:true});
function put(fields){tiddlers.set(fields.title,{...tiddlers.get(fields.title),...fields});}
const engine=fs.readFileSync(path.join(root,'scripts/loot/engine.cjs'),'utf8');
put({title:'$:/rmd/loot-engine.js',type:'application/javascript','module-type':'library',text:engine});
put({title:'$:/rmd/loot-comparison.js',type:'application/javascript','module-type':'library',text:fs.readFileSync(path.join(root,'scripts/loot/comparison.cjs'),'utf8')});
put({title:'$:/rmd/loot-data',type:'application/json',text:JSON.stringify(data),tags:'RMDLootData'});
put({title:'$:/rmd/loot-rules-audit',type:'application/json',text:JSON.stringify(rulesAudit)});
put({title:'Loot Calculator',type:'text/vnd.tiddlywiki',tags:'RMDDatabase',text:`<div class="rmd-page-intro"><span class="rmd-kicker">THE LOOT ATLAS</span><h2>Plan your next hunt.</h2><p>Search the loot of ReMoDDeD, compare drop sources, and see how your odds change with Magic Find, difficulty, and party size.</p></div>

<$rmd-loot/>

<details class="rmd-loot-method"><summary>How the calculator works</summary>

Odds describe ''at least one copy per kill'', or per execution for an unbound loot table. They use the current mod’s ''treasureclassex.txt'', ''itemratio.txt'', item/type definitions, monster tables and named-superunique tables. Missing dependencies use the Archive. Equipment pools are generated from item types and 3-level buckets through level 96; pool weights use the primary item type’s Rarity. Item codes preserve case.

The calculation follows nested weighted picks and ordered negative picks, inherited quality bonuses, player-adjusted NoDrop, the shared six-item drop cap, and root-table upgrades in Nightmare/Hell for ordinary monsters. Nested tables are not independently upgraded. Named unique/set selection applies item-level eligibility and rarity weights after the quality roll. Forsaken Pacts follow the mod’s cube-only rule. A base search includes all qualities; it does not isolate socket counts, affix rolls or ethereal items.

''Nearby party'' includes you and living party members in the same area. Solo /players-style settings leave it at 1. Monster levels use area levels in Nightmare/Hell except bosses/noRatio definitions, plus champion (+2) or unique/named-superunique (+3) bonuses. The level override takes precedence. Desecrated calculations require that override because the live zone level depends on game state.

These are ''table-based estimates'' under standard Expansion drop rules, with a fresh game for each repeated run. They assume successful item placement and that a unique has not already dropped in the game. They do not include corpse drops, external quest rewards, or server/plugin/scripted rewards that have no table binding. Unlinked areas remain explicitly unmapped. Fixed placements reuse the Bestiary placement index alongside current spawn pools and campaign quest encounter locations. Recipe conditions still apply.

''Simulated comparisons'' compare fresh games: full clears include ordinary packs, random elites, minions and known fixed encounters. Defaults load per-difficulty density, dimensions, NumMon pools, MonUMin/MonUMax, champion chance, group/party sizes, current DS1 placements and verified campaign/seal/wave hooks. Alternative maps are sampled separately and named bosses are capped at one per game. Direct boss or named-unique routes are locked to one kill. Type into the area, monster or location picker to filter, and use the sort buttons to reorder the matches. Results share an aligned comparison panel and graphs can compare equal runs or equal time.

Population is approximate: linked presets use current floor coverage and Populate; procedural maps use a disclosed 20% nominal footprint. Default count variation is ±25%. Exact collision, placement failures, room-by-room elite allocation, skill summons and external scripts are not fully modeled. Population overrides are optional under Adjust clear assumptions. Run duration is the player's loading/travel/combat time. The simulation integrates loot odds for every sampled population instead of waiting for lucky simulated drops.

''Data Guide audit:'' the applicable drop rules were cross-checked against the supplied 3.1.1.0 (91923) Data Guide. This includes Picks/Prob/NoDrop, itemratio row qualification, quality divisors, Magic Find, minimum caps, TC quality modifiers and named-item eligibility/rarity. Uber selects exceptional/elite equipment; Expansion uses the greatest matching itemratio Version ≤100. The mod's earlier TC schema has no ConditionCalc, ladder-season or quest-flag gating columns from the later guide. Current Item# modifiers are gold mul values, which affect stack size rather than stack drop probability. Audit hashes and applicability notes are retained with the generated loot data.

Population rules were checked against [ext[monster-region generation|https://github.com/ThePhrozenKeep/D2MOO/blob/master/source/D2Game/src/MONSTER/MonsterRegion.cpp]], [ext[monster selection|https://github.com/ThePhrozenKeep/D2MOO/blob/master/source/D2Game/src/MONSTER/MonsterChoose.cpp]], [ext[unique/minion spawning|https://github.com/ThePhrozenKeep/D2MOO/blob/master/source/D2Game/src/MONSTER/MonsterUnique.cpp]] and [ext[monster loot tables|https://github.com/ThePhrozenKeep/D2MOO/blob/master/source/D2Game/src/MONSTER/MonsterMode.cpp]].

The model was checked against the [ext[drop and quality routine|https://github.com/ThePhrozenKeep/D2MOO/blob/master/source/D2Game/src/ITEMS/Items.cpp]], [ext[table compiler and equipment pools|https://github.com/ThePhrozenKeep/D2MOO/blob/master/source/D2Common/src/DataTbls/MonsterTbls.cpp]], [ext[unique selection|https://github.com/ThePhrozenKeep/D2MOO/blob/master/source/D2Game/src/ITEMS/ItemMode.cpp]] and [ext[set selection|https://github.com/ThePhrozenKeep/D2MOO/blob/master/source/D2Game/src/ITEMS/ItemsMagic.cpp]]. Runtime changes in the mod can alter these estimates.

</details>`,'rmd-source-fingerprint':data.fingerprint});
const json=JSON.stringify(data,null,2)+'\n';
fs.writeFileSync(path.join(root,'data/loot/catalog.json'),json);
fs.writeFileSync(path.join(root,'data/loot/rules-audit.json'),JSON.stringify(rulesAudit,null,2)+'\n');
fs.writeFileSync(path.join(root,'data/loot/audit.json'),JSON.stringify({schemaVersion:1,fingerprint:data.fingerprint,counts:{items:data.items.length,monsters:data.sources.length,lootTables:data.classes.length,generatedPools:data.classes.filter(t=>t.generated).length,areas:data.areas.length},issues:data.issues,inputs:data.inputs,placementIndexSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'data/bestiary.json'))).digest('hex'),assumptions:data.assumptions},null,2)+'\n');
const store=JSON.stringify([...tiddlers.values()]).replace(/</g,'\\u003c'),next=html.replace(pattern,()=>match[1]+store+match[3]);
if(args.has('--check')){if(next!==html)throw Error('Loot calculator is out of sync');console.log('Loot calculator is in sync.');}
else{require('./write-wiki.cjs')(file,next,html);console.log('Imported loot:',data.items.length,'items,',data.sources.length,'monster sources,',data.classes.length,'loot tables.');}
