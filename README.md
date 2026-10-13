# ReMoDDeD Wiki

`index.html` is the deployable, single-file TiddlyWiki. Its Sanctuary theme matches [D2R Modding](https://d2rmodding.com) with the site's forge artwork, sigil, Cinzel and Inter fonts, dark backgrounds, warm gold text, and ember accents.

## Maintaining the theme

Edit the sources in `theme/`, then embed them into the wiki:

```powershell
node scripts/apply-theme.cjs
node scripts/apply-theme.cjs --check
```

The script requires Node.js and no additional packages. It reads the current wiki, updates only the named theme/configuration tiddlers, and preserves other tiddlers and plugin payloads. Run it against the latest saved wiki so content changes are retained. `index_backup.html` is not modified.

The theme is implemented through native TiddlyWiki tiddlers:

- `header.tid`, `sidebar.tid`, `navigation.tid`, and `topright.tid` provide the masthead, search, reference navigation, and wiki tools through page-template overrides.
- `home.tid` provides the new **ReMoDDeD Wiki** landing page. The original **ReMoDDeD Overview** remains available.
- `sanctuary.css`, `palette.tid`, and `layout-state.tid` style the shell, articles, editor, and collapsed sidebar.
- `responsive.tid` manages the phone/tablet drawer (up to 900px), backdrop dismissal, background scroll lock, Escape key, and menu accessibility.
- `catalog-widget.tid` renders the four item catalogs and individual item records directly in TiddlyWiki. A compact toolbar keeps search visible, with category/tier/sort controls that can be toggled. Phone inputs and controls retain 44px touch targets. Cards fill available columns without empty row gaps; phones use one column with small sprites beside the main stats. Full base tables, source fields, and conditional/set bonuses expand on demand. Runeword headers summarize sockets/types, with ordered rune sprites and example bases inside each variant.
- `html-parser.tid` extends the existing HTML iframe parser to append the embedded styles and fonts to remaining HTML archives. It retains data-URI isolation, sandbox configuration, and canonical-URI behavior. The four main item catalogs have migrated to native widgets; unrelated HTML articles remain preserved.
- `page-navigation.tid` follows TiddlyWiki's native history after rendering and opens newly selected pages at the top. Browser Back uses the same behavior. Refreshing filters or toggling content on the current page does not trigger a scroll reset.
- `embedded-controls.tid` wraps the existing archive controls in a native disclosure on narrow screens. Search and filters remain available; item identity and stats stack on phones. Desktop controls remain expanded.

The existing raw iframe helper also forced the story river's width on every refresh. The embedding script adjusts that one assignment so this theme can control responsive layout while retaining the helper's other behavior.

Fonts, artwork, and the sigil are embedded as tiddlers, so the new theme does not depend on external font or artwork requests. Existing content may still reference external resources.

## Previewing changes

Open `index.html` in a browser, or serve this directory locally:

```powershell
python -m http.server 8974 --bind 127.0.0.1
```

Then visit <http://127.0.0.1:8974/index.html>. Check the home page, an ordinary article, item filters, and the mobile drawer after changing layout styles. The existing single-file save workflow remains available through **Wiki tools**.

The mobile refinement was checked with browser viewports at 320px and 390px, portrait tablet width (768px), and phone landscape width (844px), with a desktop check at 1280px. These are browser layout checks; physical iOS/Android device checks remain useful for browser chrome and on-screen keyboards.

## Asset sources

`theme/assets/infernal-forge.webp` and `forge-sigil.svg` were reused from the project's D2R Modding website. The Latin WOFF2 subsets of Cinzel and Inter were obtained from Google Fonts; their SIL Open Font License files are included beside the font files. Other scripts and symbols use the theme's system-font fallbacks.

## Maintaining the item database

The authoritative mod is `C:\Users\djsch\Github\RMD-2.4\RMD-MP.mpq\data`. Missing files fall back to `D:\D2R Archive\Complete Archives\2.4.1.2 (69270)\Extracted Data`. Source directories are read-only inputs. Edit `scripts/items/sources.json`, or set `RMD_MOD_DATA` and `RMD_ARCHIVE_DATA`, to relocate them.

The importer covers 1,704 bases (weapons, armor, and miscellaneous items), 686 uniques, 226 set items across 69 sets, and 369 runeword variants grouped into 175 names. Of those, 661 uniques and 130 runeword families are enabled in the supplied tables. Disabled/incomplete definitions remain available through the catalog checkbox. Three unique-table placeholders with no item code are reported instead of treated as items.

English names and stat descriptions merge `local/lng/strings/*.json`, with mod keys overriding Archive keys. Item codes and string keys preserve case: `D33`/`d33` and `Z01`/`z01` refer to different items. Properties, stat costs, skills, skill tabs, item types, automagic, gem/rune socket bonuses, set thresholds, and runic forging recipes are resolved from the supplied tables. Each record retains nonempty source fields, property parameters, roll bounds, and source file/line provenance. Empty source cells are omitted from JSON.

The 602 inventory graphics are decoded from original `.sprite` RGBA/BC3 data or legacy DC6/palette data. Mod assets take priority; 322 come from the mod and 280 from the Archive. PNGs are saved under `Images/database` and also embedded in image tiddlers, allowing the single-file wiki to carry its database artwork offline. Animated assets use their first frame. No replacement artwork is generated. Sprite layouts were checked against [D2RModding-SpriteEdit](https://github.com/eezstreet/D2RModding-SpriteEdit) and [d2r-sprites](https://github.com/dzik87/d2r-sprites).

Rebuild after changing the mod files or importer. This requires Node.js, Python, and Pillow (`python -m pip install Pillow`):

```powershell
node scripts/apply-theme.cjs
node scripts/build-item-database.cjs
node scripts/verify-item-database.cjs
node scripts/build-item-database.cjs --check
node scripts/apply-theme.cjs --check
```

Set `RMD_PYTHON` if a specific Python executable is required. The build updates the current `index.html`, generated JSON under `data/item-database`, and embedded database tiddlers. Existing item URLs are matched by names and base identity rather than shifted numeric IDs; 1,618 existing entries are refreshed, including their searchable metadata. The first pre-import wiki is saved under ignored `.tmp/before-item-database.html`. `index_backup.html` remains untouched.

Base damage, defense, and requirements retain their values before item bonuses. Base catalogs show key stats directly; complete base tables are available under **All base stats & source** or **Base stats & source**. They are not presented as final rolled item values. Poison rates, repair intervals, skill charges, class bonuses, and scaling coefficients are converted using the source definitions. Triggered skills with automatic levels are labeled as scaling with item level. Set add-function and automatic skill-level behavior were cross-checked with the original engine implementation in [D2MOO ItemMods.cpp](https://github.com/ThePhrozenKeep/D2MOO/blob/master/source/D2Common/src/Items/ItemMods.cpp). Forging cards list the ingredients and bonuses added by each upgrade, with raw operation fields in source inspection.

The Set Items tier filter replaces **Limit Break** with **Forsaken Pacts**. These 26 set definitions (66 pieces) are exclusively cube-forged: every piece has zero drop rarity and an enabled creation recipe in `cubemain.txt`. They are classified separately from their base-item tier, so they do not appear under Elite. Reroll recipes alone do not qualify a set. Other catalogs retain their Limit Break filter.

`data/item-database/audit.json` records source hashes, counts, sprite origins, updated URLs, and unresolved source data. Missing English names use the table's name and are identified in source inspection. `Vanish` is referenced without a matching skill definition, and two runeword rows use the undefined `half-freeze-rune` property; the original values are retained instead of inventing their meaning. Two old unique entries, **Champion's Evil Barrier** and **Patriarch's Evil Barrier**, are absent from the confirmed source and marked historical, with their previous text retained in a tiddler field.

The verifier compares every imported source row and main property slot, checks case-sensitive codes, charged/poison/scaling descriptions, set thresholds, rune order, old links, PNG dimensions/embedding, and unrelated-tiddler preservation. The `--check` build also verifies deterministic synchronization with the supplied source folders. Browser checks exercise the catalogs on desktop and at phone/tablet widths; these complement source-data checks and do not replace physical-device testing.

Each enabled runeword variant also shows an example base with its original sprite. Selection follows the allowed types in source order, includes both base types and their inherited types, respects exclusions, and checks socket limits from the base, item type, and inventory dimensions. It prefers a spawnable base with a low quality level; Spell Blade variants therefore use Crystal Sword. Examples adapt to the required socket count, so a six-socket staff variant uses War Staff. These are representative bases.

All 324 enabled variants have base illustrations; 322 have examples meeting the supplied socket limits. **Night** requests six sockets on belts capped at two, and one **Soldier** variant requests six sockets on Limit Break armor capped at four. Their illustrations carry explicit socket-mismatch notes and audit entries. Disabled placeholders without a base type or rune sequence have no invented example. Example images reuse the existing embedded base sprites and appear beside bonuses on desktop, stacking above bonuses on phones.

## Maintaining the Bestiary

The Bestiary imports all 942 monster definitions and 80 named superuniques from the same authoritative mod and Archive folders. Every record has an individual native wiki page. The main catalog provides search, difficulty selection, type/family/act/area/immunity filters, Torment Trials and mod-addition views, and expandable combat, encounter and loot details. Its styles are scoped to the Bestiary so they do not change guide or item imagery.

Life, physical attack damage, defense, attack rating and XP use the Expansion scaling columns in `monlvl.txt`. Nightmare/Hell area levels apply to ordinary monsters; boss and `noRatio` exceptions retain their source levels. Values show the baseline before party scaling, extra monster properties and unique/champion effects. Named superunique cards explicitly identify their class baseline and use their own loot groups and fixed modifiers. Poison, skill damage, affixes and scripted effects can require additional runtime calculations. The page explains these distinctions beside the data.

Encounter evidence combines `levels.txt` spawn pools, direct placements decoded from 2,096 DS1 maps, and explicit spawn/minion relationships. A map template with no linked level remains a named map placement. Dynamic map markers and scripted encounters are not assigned invented locations. Source fields and provenance are retained in `data/bestiary.json` for maintenance, without a source inspector in the player interface. Four missing English string keys use their source names and are listed in `data/bestiary-validation.json`.

The 266 representative model setups are decoded through the user's D2RNexus Granny backend and texture decoder, then rendered with offscreen OpenGL. Models containing several body sections are exported separately; duplicate levels of detail and identifiable corpse fragments are excluded. Albedo transparency is respected. Animated creatures use a still from one quarter of their neutral/idle clip. `idle_pose.py` samples the complete unit rig through Nexus's Granny runtime, then applies each body section's own inverse bind matrices by bone name. Section-only bones follow their animated parent. This preserves alignment on multi-part creatures. Static objects without animation linkage retain their geometry. Simple preview lighting is used; variant tinting, equipped attachments and particles can differ in-game. The Burning Soul clone shares the visual definition of its matching `MonStatsEx` family, with that relationship recorded. Helpers without visible geometry have no invented portrait. WebP files under `Images/bestiary` are also embedded for offline use.

Rebuild with Node.js, Python, NumPy, Pillow and ModernGL. The renderer defaults to `C:\Users\djsch\Github\D2RNexus\vendor\ModelConverter`; set `RMD_NEXUS` to relocate that backend. Its native binaries are Windows dependencies. Install the Python packages into the ignored local dependency folder:

```powershell
python -m pip install --target .tmp/bestiary-python numpy Pillow moderngl
node scripts/build-bestiary.cjs --prepare-only
python scripts/bestiary/render.py --force
node scripts/build-bestiary.cjs --reuse-prepared
node scripts/apply-theme.cjs
node scripts/verify-bestiary.cjs
node scripts/apply-theme.cjs --check
```

`--force` refreshes portraits when source artwork changes. Without it, the renderer resumes using successful cached portraits. Use `--units skeleton1,zombie1 --preview --force` to inspect a subset under `.tmp/bestiary-idle-preview` without replacing wiki portraits. Decompressed models and separate model sections are cached under ignored `.tmp/bestiary-render`; original game inputs and the Nexus application are not modified. `neutral_clip.py` writes only temporary Granny preview files. Where a summon archive contains only death clips, the renderer follows alternate idle links declared by its state machine into the player animation archive (Valkyrie and Assassin shadows). The rendering audit records image dimensions, geometry coverage, sampled idle clip/time, inherited section bones, missing textures and decoding issues.

The verifier compares every monster row, difficulty stat field, property slot, visual definition and superunique loot group with the inputs. It checks stat scaling and exceptions, individual pages, embedded image bytes, and preservation of pre-existing wiki content against `.tmp/before-bestiary/index.html` when that local snapshot exists. Browser checks cover search, filters, difficulty changes, disclosures, paging, native links and mobile overflow.
