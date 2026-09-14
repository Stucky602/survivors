import assert from 'node:assert/strict';
import { parseSearchHtml, parseTagVotes, parseTagId, stripHtml, decodeEntities } from '../worker/lib/steam.js';
import { extractJSON } from '../worker/lib/ai.js';
import { toProductRow } from '../worker/lib/platprices.js';

const html = `<a href="https://store.steampowered.com/app/1794680/Vampire_Survivors/?snr=1" data-ds-appid="1794680" data-ds-itemkey="App_1794680" class="search_result_row"><div class="col search_name"><span class="title">Vampire Survivors</span></div></a>
<a href="x" data-ds-appid="2002220" class="search_result_row"><span class="title">Keeper&#39;s Toll &amp; Friends</span></a>`;
const items = parseSearchHtml(html);
assert.equal(items.length, 2);
assert.deepEqual(items[0], { appid: 1794680, name: 'Vampire Survivors' });
assert.equal(items[1].name, "Keeper's Toll & Friends");

const page = `var x = 1; InitAppTagModal( 1794680, [{"tagid":1234,"name":"Bullet Heaven","count":412,"browseable":true},{"tagid":3959,"name":"Roguelite","count":300}], "https://..." );`;
const tv = parseTagVotes(page);
assert.equal(tv.length, 2);
assert.equal(tv[0].name, 'Bullet Heaven');
assert.equal(tv[0].count, 412);
assert.equal(parseTagVotes('nothing here'), null);

assert.equal(parseTagId('<a href="https://store.steampowered.com/search/?tags=98765">'), 98765);
assert.equal(parseTagId('{"tagid":4242,"name":"x"}'), 4242);
assert.equal(parseTagId('no ids'), null);

assert.equal(stripHtml('<p>Hello<br>world &nbsp; <b>bold</b></p>'), 'Hello\nworld bold');
assert.equal(decodeEntities('a &amp; b &quot;c&quot;'), 'a & b "c"');

assert.deepEqual(extractJSON('Sure, here you go:\n```json\n{"ppid": 12, "confidence": 0.95, "reason": "same {game}"}\n```'), { ppid: 12, confidence: 0.95, reason: 'same {game}' });
assert.deepEqual(extractJSON('{"a":{"b":"}"}} trailing'), { a: { b: '}' } });
assert.equal(extractJSON('no json'), null);
assert.equal(extractJSON('{"broken": '), null);

const row = toProductRow({ PPID: '7704', ConceptID: '10', ProductName: 'X', IsPS5: '1', IsPS4: '0', BasePrice: '1999', SalePrice: '999', DiscPerc: '50', StarRating: '4.83', StarRatingCount: '120', IsOnSale: 1, LowestEverPrice: null }, 42);
assert.equal(row.ppid, 7704);
assert.equal(row.appid, 42);
assert.equal(row.is_ps5, 1);
assert.equal(row.sale_price, 999);
assert.equal(row.star_rating, 4.83);
assert.equal(row.lowest_ever, null);
assert.equal(row.is_on_sale, 1);

console.log('parse.test: ok');

// v0.6.2: prompt scrubbing and cap detection
import { scrub, isCapError } from '../worker/lib/ai.js';
const s1 = scrub('a \uD83D b \uDE00 c \u0000 d \uD83D\uDE00 e');
assert.equal(Buffer.from(s1, 'utf8').toString('utf8'), s1);
assert.ok(s1.includes('\uD83D\uDE00'), 'a proper surrogate pair survives');
assert.ok(!/\u0000/.test(s1));
assert.equal(isCapError(new Error('4006: you have used up your daily free allocation of 10,000 neurons')), true);
assert.equal(isCapError(new Error('8006: Invalid data for body')), false);
console.log('parse.test v0.6.2: ok');


// v0.8: search name variants
import { nameVariants } from '../worker/lib/stages.js';
assert.deepEqual(nameVariants('Nordic Ashes: Survivors of Ragnarok'), ['Nordic Ashes: Survivors of Ragnarok', 'Nordic Ashes']);
assert.deepEqual(nameVariants('Vampire Survivors'), ['Vampire Survivors']);
assert.deepEqual(nameVariants('Halls of Torment - Definitive Edition'), ['Halls of Torment - Definitive Edition', 'Halls of Torment']);
assert.equal(nameVariants('Deep Rock Galactic: Survivor™')[0], 'Deep Rock Galactic: Survivor');
console.log('parse.test v0.8: ok');


// v0.9: plan parsing tolerance
import { parsePlan } from '../worker/lib/stages.js';
assert.equal(parsePlan({ status: 'Announced Date', date: '2026-11-03', platform: 'PS5' }).status, 'announced_date');
assert.equal(parsePlan({ status: 'Announced Date', date: '2026-11-03', platform: 'PS5' }).date, '2026-11-03');
assert.equal(parsePlan({ status: 'Announced Date', date: '2026-11-03', platform: 'PS5' }).platform, 'ps5');
assert.equal(parsePlan({ ps5_status: 'not planned' }).status, 'not_planned');
assert.equal(parsePlan({ ps5_status: 'ANNOUNCED_WINDOW', ps5_window: 'Q1 2027' }).window, 'Q1 2027');
assert.equal(parsePlan({ ps5_status: 'listed', source_url: 'https://store.playstation.com/x' }).url, 'https://store.playstation.com/x');
assert.equal(parsePlan({ ps5_status: 'garbage' }).status, 'unknown');
assert.equal(parsePlan(null).status, 'unknown');
console.log('parse.test v0.9: ok');

// v0.12: deterministic title matching
import { normaliseTitle, pickByTitle } from '../worker/lib/stages.js';
assert.equal(normaliseTitle('Nordic Ashes: Survivors of Ragnarok'), 'nordic ashes survivors of ragnarok');
assert.equal(normaliseTitle('Halls of Torment - Definitive Edition'), 'halls of torment');
assert.equal(normaliseTitle('Deep Rock Galactic: Survivor™'), 'deep rock galactic survivor');
assert.equal(normaliseTitle('Megabonk  PS5'), 'megabonk');
// exact match beats a bundle, cheapest full game wins
const cands = [
  { PPID: 1, ProductName: 'Death Must Die Bundle', StoreClass: 'BUNDLE', BasePrice: 3000 },
  { PPID: 2, ProductName: 'Death Must Die', StoreClass: 'FULL_GAME', BasePrice: 1999 },
  { PPID: 3, ProductName: 'Death Must Die - Deluxe Edition', StoreClass: 'FULL_GAME', BasePrice: 2999 }
];
assert.equal(pickByTitle('Death Must Die', cands).PPID, 2);
// an edition-only listing still matches when no plain edition exists
assert.equal(pickByTitle('Halls of Torment', [{ PPID: 9, ProductName: 'Halls of Torment: Definitive Edition', StoreClass: 'FULL_GAME', BasePrice: 1499 }]).PPID, 9);
// unrelated games must not match
assert.equal(pickByTitle('Vampire Survivors', [{ PPID: 5, ProductName: 'Zombie Survivors', StoreClass: 'FULL_GAME', BasePrice: 500 }]), null);
console.log('parse.test v0.12: ok');

// v0.12.1: subtitle-dropping console listings
import { titleSimilarity } from '../worker/lib/stages.js';
assert.equal(titleSimilarity('Nordic Ashes: Survivors of Ragnarok', 'Nordic Ashes') >= 0.9, true);
assert.equal(titleSimilarity('Deadly Days: Roadtrip', 'Deadly Days Roadtrip'), 1);
assert.equal(titleSimilarity('Vampire Survivors', 'Zombie Survivors') < 0.5, true);
assert.equal(titleSimilarity('Halls of Torment', 'Halls of Torment: Definitive Edition'), 1);
assert.ok(titleSimilarity('Brotato', 'Brotato: Deluxe') >= 0.5);
// a single short shared word must not be enough
assert.ok(titleSimilarity('Loot', 'Loot Survivor') < 0.9);
assert.equal(pickByTitle('Nordic Ashes: Survivors of Ragnarok', [{ PPID: 7, ProductName: 'Nordic Ashes', StoreClass: 'FULL_GAME', BasePrice: 1499 }]).PPID, 7);
assert.equal(pickByTitle('Vampire Survivors', [{ PPID: 8, ProductName: 'Zombie Survivors', StoreClass: 'FULL_GAME', BasePrice: 500 }]), null);
console.log('parse.test v0.12.1: ok');

// v0.13: manual add input parsing
import { parseAppid } from '../worker/lib/stages.js';
assert.equal(parseAppid('1794680'), 1794680);
assert.equal(parseAppid('https://store.steampowered.com/app/1794680/Vampire_Survivors/'), 1794680);
assert.equal(parseAppid('store.steampowered.com/app/2739020'), 2739020);
assert.equal(parseAppid('not a game'), null);
assert.equal(parseAppid(''), null);
console.log('parse.test v0.13: ok');

// v0.13.1: search terms must survive PlatPrices' parser
import { searchTerm, nameVariants as nv2 } from '../worker/lib/stages.js';
assert.equal(searchTerm('AHAPIKA – Heroic Agency'), 'AHAPIKA Heroic Agency');
assert.equal(searchTerm("Oh No! I'm Surrounded by Polygons!"), 'Oh No I m Surrounded by Polygons');
assert.equal(searchTerm('Deep Rock Galactic: Survivor™'), 'Deep Rock Galactic: Survivor');
assert.equal(searchTerm('Nordic Ashes: Survivors of Ragnarok'), 'Nordic Ashes: Survivors of Ragnarok');
// no variant may contain characters that broke the API
for (const v of nv2('AHAPIKA – Heroic Agency')) assert.ok(!/[–—’!]/.test(v), `bad char in variant: ${v}`);
for (const v of nv2("Oh No! I'm Surrounded by Polygons!")) assert.ok(!/[–—’!]/.test(v), `bad char in variant: ${v}`);
assert.ok(nv2('AHAPIKA – Heroic Agency').length >= 1);
console.log('parse.test v0.13.1: ok');
