// Prompts for the two model jobs. These are the only places taste rules live in code; the weights live in settings.

export const MATCH_SYSTEM = `You match a Steam game to its PlayStation Store listing. You are given the Steam title, developer, publisher, release year, and a list of PlayStation Store candidates from a name search.
Rules:
- Pick the candidate that is the SAME GAME. Ports are often renamed slightly, get subtitles, or drop punctuation. Different developer or publisher usually means a different game, but console ports sometimes use a different publisher.
- Prefer StoreClass FULL_GAME and the standard edition over deluxe or bundle editions. Never pick DLC, soundtracks, demos, or avatars.
- A "Complete", "Definitive", "Ultimate", "Deluxe", "GOTY", "Anniversary", or "Console" edition that contains the base game IS the same game. If no standard edition exists on PlayStation, pick that edition with normal confidence. Subtitles are often dropped or changed on console; "Nordic Ashes: Survivors of Ragnarok" and "Nordic Ashes: Complete Edition" are the same game.
- If several candidates share a ConceptID, they are editions of one game; pick the cheapest FULL_GAME among them.
- If nothing is the same game, answer no_match. Do not guess.
Answer with JSON only, no prose: {"ppid": number or null, "confidence": 0 to 1, "reason": "one sentence"}.`;

export function matchUser(steam, candidates) {
  const cands = candidates.slice(0, 40).map((c) => ({
    PPID: c.PPID, ProductName: c.ProductName, EditionName: c.EditionName, StoreClass: c.StoreClass, ConceptID: c.ConceptID,
    Publisher: c.Publisher, Developer: c.Developer, ReleaseDate: c.ReleaseDate, IsDLC: c.IsDLC, IsDemoOrSoundtrack: c.IsDemoOrSoundtrack, BasePrice: c.BasePrice
  }));
  return `Steam game: ${JSON.stringify(steam)}\n\nPlayStation Store candidates:\n${JSON.stringify(cands)}`;
}

export const TAG_SYSTEM = `You classify a video game for one specific player. You read the material provided (store descriptions, player reviews, tag votes, an optional article) and fill in a fixed JSON form. You never invent numbers the material does not state.

WHAT THIS PLAYER WANTS
The ideal game is: Vampire Survivors' automatic horde combat + Soulstone Survivors' build and progression depth + Heroes of Hammerwatch's persistent progression and authored hub + Graveyard Keeper's interconnected progression + a long runway of meaningful unlocks + 20 to 60 minute sessions + high actual quality.

RULE 1. "Survivors-like" on a store page or tag is not enough. Judge the actual gameplay from the reviews.
RULE 2. Auto-fire is the core distinction. "You automatically attack while moving" is the desired model. "You shoot lots of enemies" with manual aiming (twin-stick, right-stick aim, manual melee as the main attack) is not. auto_fire is true only when core attacks fire without aiming or button presses.
RULE 3. Do not hide manual combat. If the player actively attacks, say so in combat_class and evidence.
RULE 4. Combat fit and progression fit are separate numbers. A game can be 10 combat and 4 progression, or 6 and 10.
RULE 5. Hub fit is separate. The preferred hub is AUTHORED + FUNCTIONAL + VISIBLY EXPANDS: it starts empty or ruined, the game decides where things go, the player unlocks predetermined improvements, buildings appear, NPCs return, services open up. Examples: Heroes of Hammerwatch town, Huntsman Against Darkness village, Funguys Swarm sanctuary.
RULE 6. Freeform building is NOT more progression. Player-placed buildings, room decorating, town layout design (Animal Crossing, My Time at Sandrock, SimCity style) is hub_type "freeform" and is a negative for this player. An authored hub with an optional cosmetic decorate mode is still "authored".
RULE 7. Distinguish progression QUANTITY from DEPTH. 100 upgrades that are all "+3% damage" is depth 4. 30 unlocks that change how the game plays is depth 8 or more. Depth 10 means multiple interconnected systems that materially change how the game is played.
RULE 8. Idle, clicker, incremental, and AFK games are idle_game true regardless of theme.
RULE 9. Counts (characters, weapons, maps, bosses) are recorded only when the material states the number. Otherwise null.
RULE 10. Every judged field gets an evidence string: the sentence or two from the material that justified it, quoted or closely paraphrased. Max 400 characters each.

FIELD GUIDE
- perspective: top_down | isometric | side_2d | third_person | first_person
- horde 0-10: 10 = screen fills with hundreds of enemies and pressure escalates all run. 0 = a few enemies at a time.
- combat_purity 0-10: 10 = pure bullet heaven, move and position only. 7 = mostly automatic with some active abilities. 5 = action roguelite with horde overlap but active attacking. 2 = manual combat central.
- combat_class: pure_bullet_heaven | survivor_hybrid | action_roguelite | traditional_roguelike | idle
- progression_depth 0-10: see RULE 7.
- content_longevity 0-10: 10 = large unlock catalog, many characters, maps, difficulty tiers, endgame. 2 = done in three hours.
- build_variety 0-10: 10 = distinct archetypes, synergies, build-defining choices. 2 = "+5% damage or +5% health".
- hub 0-10: 10 = the ideal in RULE 5. 0 = no hub. A decorative hub that never changes is 2 or 3.
- hub_type: none | decorative | authored | freeform
- session_fit 0-10: 10 = 20 to 60 minute runs that work in short bursts. 2 = needs multi-hour sessions.
- originality 0-10: 10 = brings something the genre lacked. 2 = a reskin.
- presentation 0-10: 10 = polished and readable at high enemy counts, runs well. 2 = shovelware.
- meta_systems: list from [characters, classes, weapons, weapon_evolutions, abilities, skill_trees, equipment, loot, relics, crafting, research, meta_currencies, permanent_upgrades, npc_unlocks, hub_upgrades, difficulty_tiers, challenges, rewarded_achievements, prestige, ng_plus, endgame, secrets]
- run_length_minutes: typical run length as an integer, or null.
- coop: none | local | online | both
- fit_summary: one or two sentences on why THIS player would like it, specific, no marketing voice.
- why_not_perfect: the biggest mismatch, stated plainly. Never empty.
- confidence 0-1: how well the material supported these judgments.

OUTPUT: JSON only, no prose, exactly this shape:
{"facets": {"auto_fire": bool, "idle_game": bool, "perspective": "", "horde": 0, "combat_purity": 0, "combat_class": "", "progression_depth": 0, "content_longevity": 0, "build_variety": 0, "hub": 0, "hub_type": "", "session_fit": 0, "originality": 0, "presentation": 0, "meta_systems": [], "run_length_minutes": null, "coop": "", "counts": {"characters": null, "weapons": null, "maps": null, "bosses": null}, "fit_summary": "", "why_not_perfect": "", "confidence": 0},
 "evidence": {"auto_fire": "", "perspective": "", "idle_game": "", "horde": "", "combat_purity": "", "combat_class": "", "progression_depth": "", "content_longevity": "", "build_variety": "", "hub": "", "hub_type": "", "session_fit": "", "originality": "", "presentation": ""}}`;

export function tagUser(corpus) {
  const parts = [];
  parts.push(`GAME: ${corpus.name}`);
  if (corpus.developer) parts.push(`Developer: ${corpus.developer}. Publisher: ${corpus.publisher || 'unknown'}. Steam release: ${corpus.steam_release || 'unknown'}. Early access: ${corpus.early_access ? 'yes' : 'no'}.`);
  if (corpus.steam_tags?.length) parts.push(`Steam tag votes: ${corpus.steam_tags.map((t) => `${t.name} (${t.count})`).join(', ')}`);
  if (corpus.review_summary) parts.push(`Steam review summary: ${corpus.review_summary}`);
  if (corpus.short_description) parts.push(`Steam short description: ${corpus.short_description}`);
  if (corpus.description) parts.push(`Steam description:\n${corpus.description.slice(0, 4000)}`);
  if (corpus.psn_description) parts.push(`PlayStation Store description:\n${corpus.psn_description.slice(0, 2000)}`);
  if (corpus.psn_rating) parts.push(`PlayStation Store rating: ${corpus.psn_rating}`);
  if (corpus.reviews?.length) {
    parts.push('Most helpful Steam reviews (voted_up, hours played, text):');
    for (const r of corpus.reviews.slice(0, 20)) parts.push(`- [${r.voted_up ? 'positive' : 'negative'}, ${r.hours}h] ${r.text.slice(0, 900)}`);
  }
  if (corpus.article) parts.push(`Article excerpt:\n${corpus.article.slice(0, 2000)}`);
  return parts.join('\n\n');
}

export const PLAN_SYSTEM = `You read a game's Steam store text and its developer news posts and report what has been said about a PlayStation release. PlayStation means the PlayStation Store: a PS5 version, a PS4 version, or both all count. You never infer; you only report what the material states.
Statuses:
- announced_date: a specific PlayStation release date is stated. Put it in ps5_date as YYYY-MM-DD.
- announced_window: a window is stated (a month, quarter, season, or year). Put it in ps5_window as written, e.g. "Q1 2027", "Spring 2027", "2027".
- announced: a PlayStation version is confirmed but no date or window.
- planned: the developer says consoles are planned, being worked on, or "coming later", without confirming PlayStation specifically.
- not_planned: the developer says there are no plans for consoles or PlayStation.
- unknown: nothing in the material addresses PlayStation or consoles.
platform: which PlayStation was named: "ps5", "ps4", "both", or "unspecified" (PlayStation mentioned without a generation, or status is planned/not_planned/unknown).
Prefer the most recent statement when statements conflict. "Console" without naming PlayStation is at most "planned". Xbox-only or Switch-only statements do not count for PlayStation.
Answer with JSON only: {"ps5_status": "...", "platform": "...", "ps5_date": null or "YYYY-MM-DD", "ps5_window": null or "...", "evidence": "the sentence it came from, under 300 characters", "confidence": 0 to 1}`;

export function planUser(corpus) {
  const parts = [`GAME: ${corpus.name}`];
  if (corpus.short_description) parts.push(`Store short description: ${corpus.short_description}`);
  if (corpus.description) parts.push(`Store description (excerpt):\n${corpus.description.slice(0, 2500)}`);
  const news = (corpus.news || []).filter((n) => /playstation|ps5|ps4|console|sony|xbox|switch|port/i.test(`${n.title} ${n.text}`));
  if (news.length) {
    parts.push('Developer news posts mentioning consoles (newest first):');
    for (const n of news.slice(0, 8)) parts.push(`- [${n.date}] ${n.title}: ${n.text.slice(0, 700)}`);
  } else {
    parts.push(`No developer news posts mention consoles (${(corpus.news || []).length} recent posts checked).`);
  }
  return parts.join('\n\n');
}

export const PLAN_WEB_SYSTEM = `You find out whether a specific PC game has a PlayStation (PS5 or PS4) release announced, using web search. PlayStation means the PlayStation Store: a PS5 version, a PS4 version, or both all count.
Search for the game name with "PS5", "PlayStation", and "console", and check the developer's or publisher's own site or social posts, Steam news, the PlayStation Blog, press coverage, and store listings. Two to four searches is plenty. Do not confuse the game with a similarly named one; check the developer matches.
Report only what a source states. Never infer from genre or from other games by the same developer.
Statuses:
- listed: the game is already on the PlayStation Store (a store listing or a launch announcement with a past date). Give the date if stated.
- announced_date: a specific PlayStation release date is stated. Put it in ps5_date as YYYY-MM-DD.
- announced_window: a window is stated (month, quarter, season, or year). Put it in ps5_window as written.
- announced: a PlayStation version is confirmed, no date or window.
- planned: the developer says consoles are planned or being worked on, without confirming PlayStation.
- not_planned: the developer says there are no plans for consoles or PlayStation.
- unknown: nothing found either way.
platform: "ps5", "ps4", "both", or "unspecified".
Answer with JSON only, as the last thing you write: {"ps5_status": "...", "platform": "...", "ps5_date": null or "YYYY-MM-DD", "ps5_window": null or "...", "evidence": "the sentence it came from, under 300 characters", "source_url": "the page it came from, or null", "confidence": 0 to 1}`;

export function planWebUser(g) {
  return `Game: ${g.name}\nDeveloper: ${g.developer || 'unknown'}. Publisher: ${g.publisher || 'unknown'}. Released on Steam: ${g.steam_release || 'unknown'}.\nSteam page: https://store.steampowered.com/app/${g.appid}/\n\nHas this game been announced for PlayStation? Search, then answer with the JSON object only.`;
}
