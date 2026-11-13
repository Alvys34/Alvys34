# Store text — EVERY DROP COUNTS (working title)

Draft 1, 2026-11-13. Voice: the in-game voice (`src/ui/copy.js`): short, deadpan, corporate,
slightly too cheerful, sentence case, almost no exclamation marks.

**Brand name:** the in-game fictional brand was renamed to the provisional "SUNNYVEIN" (the
previous name is a live US trademark, see `docs/local/LOCAL-REPORT-1.md`, title check). This text
deliberately avoids the brand and says "the Center" instead, so nothing here has to change when
the name is confirmed. The capsules in this
folder show only the game title, no brand.

Steam limits: short description ≤ 300 characters. Long description: no hard limit, BBCode-style
markup in Steamworks (`[h2]`, `[list]`, `[b]`). Plain Markdown below; convert on paste.

---

## Short description (≤ 300 chars)

> Operate a giant rotating donation drum. Tumble cheerful volunteers into saws, spikes and
> grinders, then watch the room flood with what they gave. The rising blood changes the physics.
> Every drop counts. Thank you for donating.

(226 characters)

Alternative, plainer (for festivals where the first line must explain the game):

> A physics splatter arcade game. Rotate and slam a drum full of sedated donors into saws, spikes
> and grinders. The blood you spill floods the drum, floats the bodies and drowns your hazards.
> Hit the quota before the shift ends.

(226 characters)

---

## Long description

**Welcome to your first shift.**

The Community Donation Center thanks you for joining the team. Your workstation is the donation
drum: a sealed, rotating chamber full of lightly sedated volunteers who were told there would be
cookies. Your job is to collect blood. You have two controls. Please use both.

**ROTATE** the drum. Gravity does the rest.
**SLAM** it. Everyone goes up. Some come back down in pieces.

You never touch a donor. Saws, spikes, grinders and crushers are mounted on the drum walls. Turn
the drum so the crowd falls onto them. It is all physics, and it is all your fault.

**The blood stays.**
Every litre you collect pools at the bottom of the drum, and the surface stays level while the
drum turns. Bodies float. Floor hazards disappear under the tide. Donors who keep their heads
under too long drown, which is a waste of perfectly good blood. A shift that starts with drops
onto spikes ends with you churning a red soup against the ceiling.

**Features**
- Two verbs, full 3D ragdoll physics: limbs sever, bones break, Big Givers crush the people they
  land on.
- A rising pool that changes the rules every shift: buoyancy, drowning, hazards going under.
- 8 shifts, each adding one new thing: saws, the grinder, Inspectors who must survive their
  visit, oxygen tanks that rupture, rail saws, crushers, Thin-Bloods. And Staff Appreciation Day.
- Sponsor Match: chain kills for a multiplier. The sponsors are very generous.
- Overtime: an endless mode where the demand pump drains the tank faster and faster. Keep it
  from running dry. Local top-10.
- Keyboard and gamepad, Steam Deck friendly. Shifts are 2–3 minutes.
- Elevator music that does not cope well with the situation.
- Streamer-safe green blood, screen-shake and reduced-flashing options.

**A note from Management**
All donors are adults and volunteers. No donor was harmed in a way that was not covered by the
consent form. Complaints received to date: 0 (donors unavailable for comment).

Every drop counts. Thank you for donating.

---

## Mature content description (Steamworks content survey, "Describe the content")

> EVERY DROP COUNTS contains frequent, cartoonish violence and gore. The player operates a
> machine that kills stylised low-poly human characters (adult volunteers in hospital gowns,
> office workers and staff uniforms) with saws, spikes, grinders, crushers and explosions. Limbs
> are severed and bones break; bodies release large, exaggerated amounts of blood that sprays,
> stains the walls and collects as a pool in which characters can drown. Characters speak short
> lines while alive. The tone is dark slapstick and corporate satire: no realistic anatomy beyond
> simple bone stubs, no torture sequences, no sexual content, no real-world people, groups or
> brands. An in-game option recolours all blood green and others reduce flashing and screen
> shake.

Survey answers to tick (Valve's categories as described in `docs/STEAM_RELEASE.md` §6.1):
**Frequent Violence or Gore** — yes. **General Mature Content** — yes. Sexual content /
Adult Only Sexual Content — no.

Age-suitable screenshots: Valve asks for at least 4 screenshots marked suitable for all ages
(no gore). The screenshots in `screenshots/` all show blood or bodies being hurt, so **none of
them should be marked all-ages**. Candidates for that flag would be a menu or an empty drum at
shift start (see `docs/local/LOCAL-REPORT-1.md`; `screenshots/allages-*` if present).

---

## Suggested tags (≤ 20, most important first)

Physics, Gore, Dark Comedy, Arcade, Violent, Blood, Score Attack, Casual, Funny, Destruction,
Short, Singleplayer, 3D, Stylized, Controller, Indie, Simulation, Dark Humor, Ragdoll, Satire.
