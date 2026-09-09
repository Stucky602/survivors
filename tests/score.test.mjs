import assert from 'node:assert/strict';
import { scoreGame, computeQuality, categorize, needsReview, normalizeFacets, failedGates, DEFAULT_SETTINGS, DEFAULT_WEIGHTS } from '../shared/score.js';

const ideal = normalizeFacets({
  auto_fire: true, idle_game: false, perspective: 'top_down', horde: 10, combat_purity: 10, combat_class: 'pure_bullet_heaven',
  progression_depth: 10, content_longevity: 10, build_variety: 10, hub: 10, hub_type: 'authored', session_fit: 10, originality: 10, presentation: 10,
  meta_systems: ['characters', 'prestige'], run_length_minutes: 30, coop: 'none', counts: { characters: 12 }, confidence: 0.9
});
ideal.quality = 10;

// weights sum to 100 so the ideal game scores 100
assert.equal(Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0), 100);
assert.equal(scoreGame(ideal).score, 100);

// gates
assert.deepEqual(failedGates({ ...ideal, auto_fire: false }), ['auto_fire']);
assert.equal(scoreGame({ ...ideal, perspective: 'first_person' }).score, 0);
assert.equal(scoreGame({ ...ideal, idle_game: true }).score, 0);
assert.equal(scoreGame({ ...ideal, horde: 3 }).score, 0);
assert.equal(scoreGame({ ...ideal, horde: 4 }).score, 100);

// penalties
assert.equal(scoreGame({ ...ideal, hub_type: 'freeform' }).score, 75);
assert.equal(scoreGame({ ...ideal, progression_depth: 3 }).score, 100 - 14 - 20);
assert.deepEqual(scoreGame({ ...ideal, progression_depth: 3 }).penalties, ['shallow_progression']);

// weights are applied per facet
const halfCombat = scoreGame({ ...ideal, combat_purity: 5 }).score;
assert.equal(halfCombat, 100 - 12.5 - 0 === 87.5 ? 88 : Math.round(87.5)); // rounding to 88
assert.equal(scoreGame({ ...ideal, combat_purity: 0 }).score, 75);

// custom weights
const custom = { ...DEFAULT_SETTINGS, weights: { ...DEFAULT_WEIGHTS, hub: 15, combat_purity: 18 } };
assert.equal(scoreGame({ ...ideal, hub: 0 }, custom).score, 85);

// quality shrinks toward 7 on small samples
assert.equal(computeQuality({ steamPos: 6, steamNeg: 0 }).quality, 7);
assert.equal(computeQuality({ steamPos: 9200, steamNeg: 800 }).quality, 9);
assert.equal(computeQuality({ steamPos: 100, steamNeg: 900 }).quality, 2);
assert.equal(computeQuality({}).quality, 7);
assert.equal(computeQuality({ steamPos: 9200, steamNeg: 800, abandonedEA: true }).quality, 5);
assert.equal(computeQuality({ psnRating: 4.8, psnCount: 2000 }).quality, 9);

// categories, first rule wins
assert.equal(categorize(ideal, 100, 5000), 'hub_gem');
assert.equal(categorize({ ...ideal, hub_type: 'none', hub: 0 }, 92, 5000), 'perfect_fit');
assert.equal(categorize({ ...ideal, hub_type: 'none', hub: 0, progression_depth: 6 }, 70, 5000), 'pure_survivor');
assert.equal(categorize({ ...ideal, hub_type: 'none', hub: 0, combat_class: 'action_roguelite', combat_purity: 5 }, 88, 5000), 'progression_monster');
assert.equal(categorize({ ...ideal, hub_type: 'none', hub: 0, combat_class: 'action_roguelite', progression_depth: 7 }, 66, 5000), 'conditional_action_roguelite');
assert.equal(categorize(ideal, 100, 20), 'wildcard');
assert.equal(categorize(ideal, 100, 5000, { never: 1 }), 'do_not_recommend');
assert.equal(categorize({ ...ideal, auto_fire: false }, 0, 5000), 'do_not_recommend');

// review queue
assert.equal(needsReview(ideal, 70), true);
assert.equal(needsReview(ideal, 69), false);
assert.equal(needsReview({ ...ideal, horde: 5 }, 40), true);
assert.equal(needsReview({ ...ideal, confidence: 0.4 }, 40), true);

// normalize is defensive
const n = normalizeFacets({ horde: '11', perspective: 'bogus', meta_systems: ['prestige', 'nope'], counts: { weapons: '15', maps: 'lots' }, confidence: 3 });
assert.equal(n.horde, 10);
assert.equal(n.perspective, 'top_down');
assert.deepEqual(n.meta_systems, ['prestige']);
assert.equal(n.prestige, true);
assert.equal(n.counts.weapons, 15);
assert.equal(n.counts.maps, null);
assert.equal(n.confidence, 1);
assert.equal(n.auto_fire, false);
assert.equal(normalizeFacets(null).combat_class, 'pure_bullet_heaven');

console.log('score.test: ok');
