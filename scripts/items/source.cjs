const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./sources.json');
const roots = { mod: process.env.RMD_MOD_DATA || config.mod, archive: process.env.RMD_ARCHIVE_DATA || config.archive };
const files = new Map();
const issues = [];
function file(relative, required = true) {
  const rel = relative.replace(/\\/g, '/').replace(/^data\//i, '');
  for (const [origin, root] of Object.entries(roots)) {
    const absolute = path.join(root, rel);
    if (fs.existsSync(absolute)) {
      const buffer = fs.readFileSync(absolute);
      const info = { relative: rel, origin, sha256: crypto.createHash('sha256').update(buffer).digest('hex'), bytes: buffer.length };
      files.set(rel, info);
      return { ...info, absolute, buffer };
    }
  }
  if (required) throw new Error(`Source file missing in mod and Archive: ${rel}`);
  return null;
}
function json(relative, required = true) {
  const entry = file(relative, required);
  return entry ? JSON.parse(entry.buffer.toString('utf8').replace(/^\uFEFF/, '')) : null;
}
function table(name) {
  const entry = file(`global/excel/${name}.txt`);
  const lines = entry.buffer.toString('utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
  const headers = lines.shift().split('\t');
  const records = [];
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    const values = line.split('\t'); // Game TSV quotes are literal; never CSV-unquote them.
    if (values[0] === 'Expansion') return;
    const row = Object.fromEntries(headers.map((key, n) => [key, values[n] || '']));
    Object.defineProperty(row, '_source', { value: { file: entry.relative, line: i + 2, origin: entry.origin }, enumerable: false });
    records.push(row);
  });
  return records;
}
const get = (row, key) => row[key] ?? row[Object.keys(row).find(k => k.toLowerCase() === key.toLowerCase())] ?? '';
const clean = text => String(text || '').replace(/ÿc./g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
const strings = new Map();
// Layer complete string tables, Archive first and mod last. Mod definitions win.
for (const [origin, root] of [['archive', roots.archive], ['mod', roots.mod]]) {
  const directory = path.join(root, 'local/lng/strings');
  if (!fs.existsSync(directory)) continue;
  for (const name of fs.readdirSync(directory).filter(n => n.endsWith('.json')).sort()) {
    const absolute = path.join(directory, name);
    const buffer = fs.readFileSync(absolute);
    files.set(`${origin}:local/lng/strings/${name}`, { relative: `local/lng/strings/${name}`, origin, sha256: crypto.createHash('sha256').update(buffer).digest('hex'), bytes: buffer.length });
    const entries = JSON.parse(buffer.toString('utf8').replace(/^\uFEFF/, ''));
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) if (entry.Key && entry.enUS != null) strings.set(entry.Key, { text: clean(entry.enUS), file: `local/lng/strings/${name}`, origin, id: entry.id });
  }
}
function lookup(key) {
  return strings.get(key);
}
function name(key, fallback) {
  const found = lookup(key);
  if (found?.text) return found.text;
  if (key) issues.push({ kind: 'missing-string', key, fallback: fallback || key });
  return clean(fallback || key);
}
const tables = Object.fromEntries(['weapons','armor','misc','uniqueitems','setitems','sets','runes','properties','itemstatcost','itemtypes','gems','skills','skilldesc','charstats','monstats','automagic','cubemain'].map(key => [key, table(key)]));
const index = (rows, key) => new Map(rows.filter(r => get(r,key)).map(r => [get(r,key).toLowerCase(), r]));
const properties = index(tables.properties, 'code');
const stats = index(tables.itemstatcost, 'Stat');
const itemTypes = index(tables.itemtypes, 'Code');
// Item codes are four-byte identifiers. Z01 and z01 can be different items.
const bases = new Map([...tables.weapons,...tables.armor,...tables.misc].filter(row=>row.code).map(row=>[row.code,row]));
const skillsByCode = index(tables.skills, 'skill');
const skillsById = index(tables.skills, '*Id');
const skillDescs = index(tables.skilldesc, 'skilldesc');
const normalize = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const skillAliases = new Map();
for (const row of tables.skills) {
  const desc = skillDescs.get(row.skilldesc.toLowerCase());
  const display = desc && lookup(get(desc,'str name'))?.text;
  for (const alias of [row.skill, display]) if (alias && !skillAliases.has(normalize(alias))) skillAliases.set(normalize(alias), row);
}
function skill(value) {
  const row = skillsByCode.get(String(value).toLowerCase()) || skillsById.get(String(value)) || skillAliases.get(normalize(value));
  if (!row) { issues.push({kind:'missing-skill', key:value}); return { name: clean(value), className: '', id: value }; }
  const desc = skillDescs.get(row.skilldesc.toLowerCase());
  const str = desc && lookup(get(desc,'str name'));
  const classRow = tables.charstats.find(c => get(c,'class').slice(0,3).toLowerCase() === row.charclass);
  return { name: str?.text || clean(row.skill), className: classRow ? clean(classRow.class) : '', id: get(row,'*Id'), code: row.skill, source: row._source };
}
function ancestors(code, visited = new Set()) {
  if (!code || visited.has(code.toLowerCase())) return visited;
  visited.add(code.toLowerCase());
  const row = itemTypes.get(code.toLowerCase());
  if (row) { ancestors(row.Equiv1,visited); ancestors(row.Equiv2,visited); }
  return visited;
}
function category(base) {
  const types = ancestors(base.type);
  if (types.has('weap')) return 'weapon';
  if (types.has('armo')) return 'armor';
  if (types.has('char')) return 'charm';
  if (types.has('ring') || types.has('amul')) return 'jewellery';
  return 'misc';
}
module.exports = { roots, files, issues, file, json, table, tables, get, clean, strings, lookup, name, properties, stats, itemTypes, bases, skill, ancestors, category };
