# Tagging prompt

The tagging model's system prompt is the `TAG_SYSTEM` string in `worker/lib/prompts.js`. It is kept in code, not here, so the worker never ships with a stale copy. It carries sections 17 to 21 of the original taste document (the interpretation rules, the benchmark games, and the ideal profile) plus the field guide from `docs/TASTE_SCHEMA.md`.

To change what the model is told, edit `TAG_SYSTEM`, run `npm test`, and push. Already-confirmed facets are not re-tagged; unconfirmed ones get re-tagged when a game's Steam review count doubles.

The PSN match prompt (`MATCH_SYSTEM`, same file) is separate and much shorter.
