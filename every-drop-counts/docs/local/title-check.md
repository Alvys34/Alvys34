# Title and brand check — "Every Drop Counts" / "DRAINWELL"

Done 2026-11-13 from a Windows machine: Steam store search API, web search, USPTO TSDR status
pages by serial number. Not a legal opinion; a trademark lawyer should clear the final names.

## DRAINWELL (fictional in-game brand) — conflict

| Mark | Owner | Status (USPTO TSDR) | Goods |
|---|---|---|---|
| **DRAINWELL** (serial 98280147) | Total Drain Solutions LLC, Las Vegas NV | **Registered, live** | Class 3: cleaning preparations for cleansing drains |

This is the exact word the game uses as its fictional corporation, on signage, the title screen
(`DRAINWELL™ Community Donation Centers`), PA lines and every UI string (`src/ui/copy.js BRAND`).
The class (drain cleaner) is far from games, so a classic likelihood-of-confusion claim is weak,
but:

- the GDD's own guardrail (§2, LOCKED) says **no real-world brands**; a real, registered drain
  cleaner brand shown as the corporation that blends people into blood is exactly what that rule
  exists to avoid (disparagement / tarnishment complaints, a takedown request to Valve);
- the in-game ™ symbol implies a claim on someone else's registered mark.

**Recommendation: rename the fictional brand before any public store page, trailer or capsule
shows it.** It is one constant in `src/ui/copy.js` plus the signage atlas and PA/level text in
`src/sim/levels` and `src/render/environment` (all owned by the cloud agents right now). Do the
rename before shooting final marketing material; the screenshots in `steam/screenshots/` show the
current name on signage and would need a reshoot.

Candidate replacements (only a quick web search — none surfaced as a brand; **not cleared**):
- **HEMOVITA** — "blood + life", sounds like a cheerful supplement brand.
- **GIVEFLOW** — corporate-cheerful, says the gameplay out loud.
- **VITALIS CDC** (Community Donation Centers) — bland, institutional.
- **DRUMWELL** — keeps the "-WELL" wellness joke and the existing sign layout, but is one letter
  from the real mark; only if a lawyer is comfortable with it.

## "Every Drop Counts" (working title) — no game conflict, weak name

Steam: no app titled "Every Drop Counts" (store search, exact and partial). Nearest Steam titles
are unrelated water games (The Last Drop, Don't Drain The Lake, Drink Water!).

Other games: a **free 2019 Unreal Engine game-jam game "Every Drop Counts"** by Norgannon on
itch.io (desert survival, water management). Free, jam entry, no Steam release. Low risk, but it
shares search results.

US trademarks for the exact phrase, all outside games/entertainment goods:

| Serial | Owner | Status | Goods |
|---|---|---|---|
| 97049360 | M8 Systems, Inc. | Registered | Class 9 + 42: **irrigation/agriculture software and SaaS** |
| 87983009 | DS Services of America, Inc. | Registered | Class 39: bottled water delivery |
| 87310923 | (Lard Oil Co. per aggregator) | Registered, §8&15 accepted | Classes 35/39: petroleum products distribution |
| 85426440, 78592735 | various | Cancelled | — |

The M8 Systems mark is in Class 9 (software), the same class video games are filed in, but for
irrigation software; a game about blood is unlikely to be confused with it. A lawyer should still
look at it, since a Class 9 registration of the identical phrase is the one most likely to come
up if you ever file for the title yourself.

**Practical problem more than legal:** "every drop counts" is a common water-conservation slogan.
Searches for the game will compete with charity campaigns, utilities and irrigation products, and
the name says nothing about blood, drums or slapstick. That matters for wishlists more than the
marks do.

Suggestion: keep it as the working title until the brand is renamed, then decide the title with
the new brand in mind (e.g. "<Brand>: Every Drop Counts", or a title that is searchable on its
own). Not urgent; the brand rename is.

Sources: Steam store search API; USPTO TSDR status pages for the serials above; itch.io page
norgannon.itch.io/every-drop-counts.
