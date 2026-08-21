# THE BIG MAP — file format v0 (the 12³ contract; runtime later, format now)

**The four decisions this format fixes (everything else safely deferred):**

**1 · Addressing = ShortLex paths, self-similar.** A coordinate is a PATH of base-12 symbols
(`A B C A1 A2 A3 B1 B2 B3 C1 C2 C3`), depth ≤ 3: `B/C3` is a cell of the 144 map; `B/C3/A2`
is a cell of that cell's sub-tesseract (12³ = 1,728 leaves; pairs of paths = the big lattice).
The tree-of-trees: every node is itself a 144 map. No new alphabet, no re-registry.

**2 · Mounting = a fork's WHOLE tesseract is ONE cell of the big map.** You don't upload into
the big map — you MOUNT: your local 144 tesseract (reef + snippet libraries + tape) attaches
at your dignity pixel's path. A mount is a small signed file, never a copy:

```json
{
  "mount": "A1/C3",
  "surface": "https://github.com/wiber/thetacog-mcp",
  "tesseract": { "registry": "data/pmu/shortlex-144-registry.json", "pairs": "data/pmu/snippet-library-20736.json", "reef": "data/pmu/lens-reef.json" },
  "tape_head": "<sha>", "sig": "UNSIGNED (mesh-sign lands with federation)",
  "status": "self-reported | peer-recomputed | stranger-verified"
}
```

**3 · Sharding = one shard per depth-2 node, and a shard IS the local format.** The big map
on disk is a directory: `big-map/<rank>/<rank>/mount.json` (144 possible mount points, each
holding one local-format tesseract by reference). Nothing ever asks the whole 12³ to be
resident — the walk runs per-shard on the mounted tesseract exactly as it runs locally today
(L1-sized by construction; that is the entire point of the discipline). The cloud API later is
just: serve shards, route walks to mounts. Linux boxes; no database; git remains the record.

**4 · Events = the nostr grammar carries mount lifecycle.** `mount` / `update(tape_head)` /
`attest(peer)` / `unmount` — ed25519-signed, relayed; the map view (map.json) is regenerated
from events + crawl, and disputes resolve by recomputation from the mounted surface. The
transport already ships locally (`mesh-up`); federation is the deferred half.

**Honest scope:** v0 = format + mounts + the crawler view. NOT yet: federation relays, cross-
shard walks (a walk that crosses a mount boundary is a v1 design item — the boundary crossing
IS the interesting measurement, per the boundary-probe doctrine), and any runtime hosting.

---

## v0.1 CORRECTION (operator, 2026-08-14) — the side is 12³; the map is (12³)²; the dumps are the asset

**Geometry, corrected:** the SYMMETRIC AXIS SET at depth 3 is one SIDE of the map: 12³ =
**1,728 nodes** (every path `X/Y/Z`, each symbol from the base-12 alphabet). The 2D competence
map is the ordered-pair square of that side: 1,728² = **2,985,984 cells**. Memory class, stated
honestly: ~365 KB as a presence bitmask, ~11.9 MB as Float32 heat — **RAM-native per file
system, deliberately NOT L1-native.** The division of labor: the local 144 walk remains the
L1-native chip primitive (nothing about it changes); the big map is the COLLATION layer that
runs in memory over the dumps, on Linux boxes later as the API.

**The important part — the AXIS-DEFINITION DUMPS.** A node's meaning IS its compression corpus:
the text the gzip aperture compresses against. Format:

```
axes/<X>/<Y>/<Z>.dump.json   →  { "path": "B/C3/A2",
                                  "snippets": ["…extracted passages…"],
                                  "provenance": [{ "source": "<url|repo#file>", "sha256": "…" }],
                                  "extracted_by": "<surface_url>", "sig": "…" }
```

Dumps are EXTRACTED from whatever can be found (the extractive law holds at every scale:
selected real passages, never composed prose), provenance-tagged per snippet, and **collation
is append + dedupe by sha — combining two forks' dumps for the same node IS combining their
aperture sensors.** The evolving big tesseract = the union of all mounted forks' dumps, and
the map's shape at any moment is recomputable: load dumps → compress → place → bitmask.
A fork's contribution is therefore two things: its PLACEMENTS (the tape) and its DEFINITIONS
(the dumps) — the second is the deeper moat, because the dumps are what make every future
placement meaningful.
