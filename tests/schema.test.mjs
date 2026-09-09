// The JSON schema files and the code must agree, or the docs lie.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_WEIGHTS, DEFAULT_SETTINGS, FACET_KEYS_INT, ENUMS, META_SYSTEMS } from '../shared/score.js';

const facets = JSON.parse(readFileSync(new URL('../schema/facets.json', import.meta.url)));
const weights = JSON.parse(readFileSync(new URL('../schema/weights.default.json', import.meta.url)));

assert.deepEqual(weights.weights, DEFAULT_WEIGHTS, 'weights.default.json drifted from shared/score.js');
assert.equal(weights.penalties.hub_freeform, DEFAULT_SETTINGS.penalties.hub_freeform);
assert.equal(weights.penalties.shallow_progression, DEFAULT_SETTINGS.penalties.shallow_progression);
assert.equal(weights.gates.horde_min, DEFAULT_SETTINGS.gates.horde_min);
assert.equal(weights.queue_threshold, DEFAULT_SETTINGS.queue_threshold);
assert.equal(weights.wildcard_max_reviews, DEFAULT_SETTINGS.wildcard_max_reviews);

const weightedKeys = Object.keys(facets.weighted).sort();
assert.deepEqual(weightedKeys, Object.keys(DEFAULT_WEIGHTS).sort(), 'facets.json weighted keys differ from DEFAULT_WEIGHTS');
const judgedInts = Object.entries(facets.weighted).filter(([, v]) => v.judged).map(([k]) => k).concat(['horde']).sort();
assert.deepEqual(judgedInts, [...FACET_KEYS_INT].sort(), 'judged int facets differ from FACET_KEYS_INT');
assert.deepEqual(facets.gates.perspective.values, ENUMS.perspective);
assert.deepEqual(facets.filters.hub_type.values, ENUMS.hub_type);
assert.deepEqual(facets.filters.combat_class.values, ENUMS.combat_class);
assert.deepEqual(facets.filters.coop.values, ENUMS.coop);
assert.deepEqual(facets.filters.meta_systems.values, META_SYSTEMS);

console.log('schema.test: ok');
