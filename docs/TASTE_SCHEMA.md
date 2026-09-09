# Taste schema v0.1

Restructured from Kevin's ChatGPT schema. Same content, split into the three things the site treats differently:

1. **Facets**: facts and judgments about a game. Stored once per game in `facets`, with evidence. `schema/facets.json` is the machine-readable form.
2. **Weights and gates**: Kevin's preferences. Stored in `settings`, editable with sliders, applied at score time. `schema/weights.default.json` is the starting point.
3. **Model rules**: the system prompt for the tagging model. Lives in `docs/TAGGING_PROMPT.md` (to write; it's sections 17 to 21 of the original, nearly verbatim).

Owned and never-recommend lists are Kevin's data, stored in the `kevin` table, edited from a button on each game card. They are not part of the schema.

## Facet table

Type key: `bool`, `0-10`, `enum`. "Judged" means the model reads the corpus and decides; "computed" means code derives it from numbers. Every judged facet stores an `evidence` string: the two or three sentences from the corpus that justified it.

### Hard gates

A gate failing zeroes the score. The game still appears in Browse under "gated" so Kevin can see what was excluded and why.

| Facet | Type | Gate | Judged from |
|---|---|---|---|
| `auto_fire` | bool | must be true | Descriptions, reviews. "Automatic attacks," "no aiming," "just move" pass. "Twin-stick," "aim with right stick," "manual melee" fail. |
| `perspective` | enum: `top_down`, `isometric`, `side_2d`, `third_person`, `first_person` | `first_person` fails | Descriptions, screenshots' captions, reviews. |
| `idle_game` | bool | must be false | Tags (Idler, Clicker), descriptions. |
| `horde` | 0-10 | must be >= 4 | Reviews mentioning screen fill, enemy counts, "hundreds of enemies." |

`manual_primary_attack` from the original is the inverse of `auto_fire` and is not stored separately.

### Weighted facets (sum of weights = 100)

| Facet | Type | Default weight | Judged or computed | What 10 means | What 2 means |
|---|---|---|---|---|---|
| `combat_purity` | 0-10 | 25 | judged | Pure bullet heaven: move, position, auto-attack, nothing else. | Traditional action roguelike with manual combat central. |
| `progression_depth` | 0-10 | 20 | judged | Multiple interconnected systems that change how you play. | Almost nothing persists between runs. |
| `quality` | 0-10 | 15 | computed | See formula below. | |
| `content_longevity` | 0-10 | 10 | judged | Large unlock catalog, many characters, maps, difficulty tiers, endgame. | Done in three hours. |
| `build_variety` | 0-10 | 10 | judged | Distinct archetypes, synergies, build-defining choices. | "+5% damage or +5% health," repeated. |
| `hub` | 0-10 | 8 | judged | Authored hub that starts empty or ruined, visibly develops, gains buildings and NPCs, and is functional. | No hub, or a purely decorative one. |
| `session_fit` | 0-10 | 5 | judged | 20 to 60 minute runs, works in short bursts. | Requires multi-hour sessions. |
| `originality` | 0-10 | 4 | judged | Brings something the genre didn't have. | Reskin of Vampire Survivors. |
| `presentation` | 0-10 | 3 | judged | Polished, readable at high enemy counts, good performance. | Shovelware. |

### Penalties (applied after the weighted sum)

| Condition | Penalty | Source |
|---|---|---|
| `hub_type = freeform` | -25 | judged enum below |
| `progression_depth <= 3` | -20 | facet above |

### Enums and flags (filters, no weight)

| Facet | Type | Values |
|---|---|---|
| `hub_type` | enum | `none`, `decorative`, `authored`, `freeform`. `authored` = the game decides where things go and the player unlocks them. `freeform` = player places buildings, decorates, designs the layout. A hub that is authored but has an optional cosmetic decorate mode is `authored`. |
| `combat_class` | enum | `pure_bullet_heaven`, `survivor_hybrid`, `action_roguelite`, `traditional_roguelike`, `idle`. Section 6 of the original. |
| `meta_systems` | list | any of: characters, classes, weapons, weapon_evolutions, abilities, skill_trees, equipment, loot, relics, crafting, research, meta_currencies, permanent_upgrades, npc_unlocks, hub_upgrades, difficulty_tiers, challenges, rewarded_achievements, prestige, ng_plus, endgame, secrets |
| `prestige` | bool | true if `meta_systems` contains prestige or ng_plus. Its own filter because Kevin asked for it by name. |
| `run_length_minutes` | integer or null | typical run, from reviews and descriptions |
| `coop` | enum | `none`, `local`, `online`, `both` |
| `counts` | object | `characters`, `weapons`, `maps`, `bosses`: integers or null. Only when the corpus states a number. Never estimated. |

### Computed: quality

```
steam_pct   = positive / (positive + negative)            (null if none)
steam_n     = positive + negative
psn_rating  = StarRating / 5                              (null if none)
psn_n       = StarRatingCount

confidence_n = steam_n + psn_n
blend        = weighted mean of steam_pct and psn_rating by their counts
shrink       = confidence_n / (confidence_n + 100)        (pulls small samples toward 0.7)
quality_raw  = 0.7 + (blend - 0.7) * shrink
quality      = round(quality_raw * 10)
```

Abandoned early access (no Steam update in 12 months and still flagged Early Access) caps quality at 5. Under 50 total reviews forces `category = wildcard` regardless of score.

### Computed: category

Assigned in this order, first match wins:

| Category | Rule |
|---|---|
| `do_not_recommend` | any hard gate failed, or `kevin.never = true` |
| `wildcard` | fewer than 50 reviews across both stores |
| `hub_gem` | `hub_type = authored` and `hub >= 8` |
| `progression_monster` | `progression_depth >= 9` and `combat_class != pure_bullet_heaven` |
| `perfect_fit` | `combat_class = pure_bullet_heaven` and `progression_depth >= 8` and score >= 80 |
| `pure_survivor` | `combat_class = pure_bullet_heaven` |
| `survivor_hybrid` | `combat_class = survivor_hybrid` |
| `conditional_action_roguelite` | `combat_class = action_roguelite` and score >= 65 |
| `other` | everything else |

A game gets one category. The Browse page also exposes every enum and flag as a filter, so "hub_type = authored AND prestige" works without a category.

### Score

```
if any gate fails: score = 0
score = sum(facet * weight / 10) over weighted facets      (max 100)
score -= 25 if hub_type = freeform
score -= 20 if progression_depth <= 3
score = clamp(score, 0, 100)
```

Queue threshold for Kevin's confirmation: 70, adjustable.

## What changed from the original, and why

- Sections 2, 3, 6, 7, and 8 restated auto-fire and progression in five places. They're one table now; the numbers are the same.
- Hub is both `hub_type` (filter) and `hub` (weight 8), per Kevin's answer.
- `quality` is computed from store numbers instead of judged, so it can't be talked up by marketing copy in the corpus.
- `counts` only records numbers the corpus states. The original asked the model to "attempt to determine" counts, which produces confident guesses.
- Price and sale fields are gone from the facet output. They come from PlatPrices on every refresh and never from the model.
- Owned and never lists are UI state, not schema.
- The benchmark games (section 12) and ideal profile (section 20) go into the tagging prompt as calibration examples and are not stored per game.
