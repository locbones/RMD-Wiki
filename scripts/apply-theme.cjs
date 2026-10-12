// Apply native TiddlyWiki overrides without rebuilding or replacing the wiki engine.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const file = path.join(root, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const pattern = /(<script class="tiddlywiki-tiddler-store" type="application\/json">)([\s\S]*?)(<\/script>)/;
const match = html.match(pattern);
if (!match) throw new Error('Expected a TiddlyWiki JSON tiddler store');
const original = JSON.parse(match[2]);
const tiddlers = new Map(original.map(t => [t.title, t]));
const changed = new Set();
function put(fields) {
  if (!fields.title) throw new Error('Tiddler has no title');
  changed.add(fields.title);
  tiddlers.set(fields.title, { ...tiddlers.get(fields.title), ...fields });
}
for (const name of fs.readdirSync(path.join(root, 'theme')).filter(n => n.endsWith('.tid')).sort()) {
  const source = fs.readFileSync(path.join(root, 'theme', name), 'utf8').replace(/\r\n/g, '\n');
  const split = source.indexOf('\n\n');
  if (split < 0) throw new Error(`Missing field separator in ${name}`);
  const fields = {};
  for (const line of source.slice(0, split).split('\n')) {
    const colon = line.indexOf(':');
    if (colon < 1) throw new Error(`Invalid field in ${name}`);
    fields[line.slice(0, colon)] = line.slice(colon + 1).trim();
  }
  fields.text = source.slice(split + 2);
  put(fields);
}
const asset = name => fs.readFileSync(path.join(root, 'theme', 'assets', name));
put({ title: '$:/rmd/assets/forge-sigil', type: 'image/svg+xml', text: asset('forge-sigil.svg').toString('utf8') });
put({ title: '$:/rmd/assets/infernal-forge', type: 'image/webp', text: asset('infernal-forge.webp').toString('base64') });
const fonts = [['Cinzel', 'cinzel.woff2'], ['Inter', 'inter.woff2']].map(([family, name]) =>
  `@font-face{font-family:"${family}";font-style:normal;font-weight:400;font-display:swap;src:url("data:font/woff2;base64,${asset(name).toString('base64')}") format("woff2");}`
).join('\n');
put({ title: '$:/rmd/fonts', type: 'text/css', tags: '$:/tags/Stylesheet', text: fonts });
put({ title: '$:/zzz/rmd/sanctuary.css', type: 'text/css', tags: '$:/tags/Stylesheet', text: fs.readFileSync(path.join(root, 'theme', 'sanctuary.css'), 'utf8') });
const settings = {
  '$:/palette': '$:/rmd/palette/Sanctuary',
  '$:/DefaultTiddlers': '[[ReMoDDeD Wiki]]',
  '$:/config/EmptyStoryMessage': '[[Return to the wiki|ReMoDDeD Wiki]]',
  '$:/themes/tiddlywiki/vanilla/metrics/sidebarwidth': '272px',
  '$:/themes/tiddlywiki/vanilla/metrics/bodyfontsize': '15px',
  '$:/state/sidebar': 'yes',
};
for (const [title, text] of Object.entries(settings)) put({ title, text });
// Chromium rejects oversized iframe data URLs; check the actual UTF-8 payload.
for (const t of tiddlers.values()) {
  if (t.type === 'text/html' && !t._canonical_uri && /class=["'][^"']*\b(?:dt-panel|rw-panel|si-panel)\b/.test(t.text || '')) {
    const themed = t.text + '<style data-rmd-embedded-theme>' + fonts + '\n' + tiddlers.get('$:/rmd/embedded.css').text + '</style><script>' + tiddlers.get('$:/rmd/embedded.js').text + '</script>';
    const length = 'data:text/html;charset=utf-8;base64,'.length + Buffer.from(themed, 'utf8').toString('base64').length;
    if (length >= 2 * 1024 * 1024) throw new Error(`${t.title} exceeds the browser iframe data-URL limit (${length} bytes)`);
  }
}
// Existing public articles and plugin payloads must remain byte-for-byte intact.
for (const t of original) {
  if (!changed.has(t.title) && JSON.stringify(tiddlers.get(t.title)) !== JSON.stringify(t)) {
    throw new Error(`Unexpected change to ${t.title}`);
  }
}
const store = JSON.stringify([...tiddlers.values()]).replace(/</g, '\\u003c');
let next = html.slice(0, match.index) + match[1] + store + match[3] + html.slice(match.index + match[0].length);
// The existing raw iframe relay also forces a 180px gutter on every refresh.
// Keep its item/iframe behavior, but let the native theme own the river geometry.
const legacyWidth = "if(river){ river.style.setProperty('width',riverWidth,'important'); river.style.setProperty('max-width','none','important'); river.style.setProperty('min-width',riverWidth,'important'); }";
const nativeWidth = "if(river && !document.querySelector('.rmd-masthead')){ river.style.setProperty('width',riverWidth,'important'); river.style.setProperty('max-width','none','important'); river.style.setProperty('min-width',riverWidth,'important'); } else if(river){ river.style.removeProperty('width'); river.style.removeProperty('max-width'); river.style.removeProperty('min-width'); }";
next = next.replace(legacyWidth, nativeWidth);
JSON.parse(store); // Validate escaping before writing the single-file wiki.
if (process.argv.includes('--check')) {
  if (next !== html) throw new Error('index.html is out of sync; run node scripts/apply-theme.cjs');
  console.log(`Theme is in sync. ${original.length} tiddlers; ${changed.size} theme/configuration tiddlers verified.`);
} else {
  require('./write-wiki.cjs')(file,next,html);
  console.log(`Applied ${changed.size} theme/configuration tiddlers. Preserved ${original.length - [...changed].filter(k => original.some(t => t.title === k)).length} existing tiddlers.`);
}
