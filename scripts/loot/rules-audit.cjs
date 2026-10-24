'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const guideRoot=process.env.RMD_DATA_GUIDE||'D:/D2R Archive/Complete Archives/3.1.1.0 (91923)/Extracted Data/global/dataguide';
function build(data){
  const references=['docs/itemratio-calc.html','data/files/treasureclassex.js','data/files/itemratio.js','data/files/uniqueitems.js','data/files/setitems.js','data/files/levels.js','data/files/monstats.js','data/files/superuniques.js','data/files/monumod.js'].map(relative=>{const bytes=fs.readFileSync(path.join(guideRoot,relative));return {relative,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};});
  const modifiers=[...new Set(data.classes.flatMap(tc=>tc.entries.flatMap(e=>e.token.replace(/"/g,'').split(',').slice(1).map(v=>v.split('=')[0]))))];
  const unsupported=modifiers.filter(k=>k!=='mul');
  const gated=['ConditionCalc','firstLadderSeason','lastLadderSeason','QuestFlag','QuestFlagEx'].filter(k=>data.columns.treasureclassex.includes(k));
  if(gated.length)unsupported.push(...gated.map(k=>'conditional field '+k));
  const tcInput=data.inputs.find(i=>i.relative==='global/excel/treasureclassex.txt');
  const coverage=[
    {rule:'Picks / Prob / NoDrop',status:'Implemented',detail:'Weighted positive Picks, ordered negative Picks, nested tables and player/nearby-party NoDrop rounding.'},
    {rule:'Drop budget',status:'Implemented',detail:'Shared six-successful-item cap across all nested branches, preserving ordered branches such as Countess drops.'},
    {rule:'Itemratio qualification',status:'Corrected and tested',detail:'Class-specific and normal/exceptional/elite equipment selection; greatest matching Version <= 100. Uber follows base-item tier, not the quest flag.'},
    {rule:'Quality divisor and minima',status:'Implemented',detail:'Truncated (monster level − base level) / quality divisor, x128 precision, effective MF, minimum cap, then TC quality modifier /1024.'},
    {rule:'Quality sequence / eligibility',status:'Implemented',detail:'Unique before set, enabled/level eligibility, named-item rarity weighting, explicit named drops, Cow set restrictions and mod recipe-only exclusions. Failed unique rolls are not rerolled as sets.'},
    {rule:'Item entry modifiers',status:unsupported.length?'Unsupported active modifiers':'Applicable modifiers checked',detail:'Current entries use '+(modifiers.join(', ')||'no modifiers')+'. Gold mul changes stack size; it does not change the chance of receiving a gold stack.'},
    {rule:'Later-version conditional fields',status:'Not present in current mod TC schema',detail:'The 3.1 guide also describes ConditionCalc, ladder-season and quest-flag gating. The authoritative mod treasure-class file uses the earlier schema and has none of these fields.'},
    {rule:'Population / placement',status:'Approximate',detail:'Current density, monster/elite pools, group/party sizes, champion constant, fixed map alternatives and verified scripted encounters. Actual collision, placement failures, live scripts and room-by-room allocation are not fully emulated.'}
  ];
  return {schemaVersion:1,guideVersion:'3.1.1.0 (91923)',sourceFingerprint:data.fingerprint,treasureClassInput:tcInput,references,coverage,activeEntryModifiers:modifiers,unsupported,notes:['The current mod tables remain authoritative; later retail data is used as documentation only.','Base/material results include all item qualities; separate socket, affix, ethereal and gold-quantity outcomes are outside the current item selectors.','Unique/set diminishing-return MF factors are 250/500. Integer rounding follows the documented standard Expansion implementation.','The newer guide sparsePopulate prose differs from the legacy standard spawn predicate. The approximate population model retains the legacy predicate. Current nonzero definitions: '+Object.values(data.spawnMonsters).filter(m=>m.sparse).map(m=>m.id).join(', ')+'.']};
}
module.exports={build,guideRoot};
