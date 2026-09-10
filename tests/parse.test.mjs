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
