# src/audio — synthesised sound for EVERY DROP COUNTS

Dependency-free ES modules on the WebAudio API. No samples, no network: every sound is either
rendered once into an `AudioBuffer` by plain-JS DSP (`dsp.js`) or built from live oscillators,
filters and a generated convolution reverb.

```js
import { createAudio } from './audio/index.js';
const audio = createAudio();
audio.attach(bus);            // subscribes to every event in docs/ARCHITECTURE.md
audio.unlock();               // call from the first user gesture
audio.update(dt, state);      // every frame
audio.setVolume('master' | 'music' | 'sfx', v);   // 0..1, perceptual (v²) taper
audio.suspend(); audio.resume(); audio.dispose();
```

All public methods are wrapped: nothing throws into the game loop. Before `unlock()`, or with no
WebAudio, all calls are silent no-ops. Internal errors are counted in `audio.debug.stats().errors`
and the first five are logged with `console.warn('[audio]', …)`.

Optional extras (not part of the contract): `createAudio({ context, seed })` adopts an existing
`AudioContext`/`OfflineAudioContext` (used by the meters). `audio.debug` exposes `stats()`, `ctx`
and `output` (the final node, for metering).

Optional `state` fields read when present: `hasSaw` / `sawCount`, `hasGrinder` / `grinderCount`.
They start the idle saw whine / grinder hum at shift start. Without them, each loop starts on the
first saw/grinder contact or a non-zero `sawLoad` / `grinderLoad`, and resets on `shift:start`.

## Structure

| File | Role |
|---|---|
| `index.js` | Public facade (`createAudio`), try/catch on every entry point, bus subscription |
| `engine.js` | AudioContext, mix graph, master chain, screen/pause/slow-mo handling, ducking |
| `mix.js` | **All levels in one place**: class buses, voice limits, loop levels, duck depths, screen presets, per-sound trims |
| `events.js` | Bus event to sound mapping, with adaptive normalisation of payload magnitudes |
| `voices.js` | One-shot voice manager: token-bucket rate limit, per-class caps, global cap with priority stealing, node cleanup |
| `bank.js` | Lazy, time-budgeted renderer from sound definitions to `AudioBuffer`s; loudness normalisation; NaN guard |
| `loops.js` | Continuous layers: drum motor, saw whine, grinder, blood slosh, droplet patter bed, room hum, alarm |
| `music.js` | Procedural bossa muzak: composition, three arrangements, sequencer, fill degradation chain |
| `dsp.js` | Offline DSP: RNG, biquads, modes, bubbles, noise bursts, soft clip, normalisation |
| `sounds/gore.js` | Squelch, splat, splash, spurt, bone crack, rip, thud, saw cut, impale "shunk", grinder crunch, crusher hit |
| `sounds/machines.js` | Metal/glass/prop impacts, slam, hatch, telegraphs, O2 puncture/rocket/explosion, sphere crack/shatter, grinder clog/clear, loop beds |
| `sounds/voice.js` | Formant vocal synth for donor yelps (spawn/hurt/death/drown/sigh) and the PA mumble |
| `sounds/ui.js` | PA chimes, UI ticks, combo, register, buzzer, stars, timer, achievement, jingles |
| `sounds/instruments.js` | Muzak instruments: Rhodes-ish EP, vibes, bass, flute, pad, shaker, rim, kick, brush, conga, hat |

### Signal flow

```
voice: BufferSource -> Gain -> StereoPanner -> class bus --(send)--> reverb (generated room IR)
class buses (world) -> worldGain -> worldLP (pause/slow-mo) -\
class buses (ui) -----------------------------------------------> sfxUser -\
music notes -> instrument buses -> speaker band -> {dry | crush | drive} -> degradeLP -> duck -> screen -> musicUser -+
                                                                                                            mixSum -> glue comp (-12 dB, 2.5:1)
  -> limiter (-3 dB, 20:1) -> make-up compensation -> soft clipper (ceiling 0.99) -> masterUser -> destination
```

World one-shots and music notes also get a shared detune input. It carries `timeScale` (slow-mo
pitches everything down by sqrt(timeScale); hit-stop values below 0.1 are ignored). For music it
also carries tape wow, flutter, drift and tape-stop dives.

## Mix levels (targets, by meter)

Every one-shot variant is rendered to the same momentary loudness (-14 dBFS over 100 ms). Class
gains and per-sound trims in `mix.js` then place each sound at its target. Targets are the
momentary level at the master output for one event at gain 1 (see `tools/audio/targets.mjs`):

| Tier | Sounds | Target (dBFS, 100 ms) |
|---|---|---|
| Biggest | explosion, hydraulic slam, crusher hit | -13 / -14 / -16 |
| Gore | squelch, thud, saw cut, impale, grinder crunch | -18 / -19 |
| Gore detail | bone crack, rip, splash, spurt, big splat, single drop | -21 ... -26, drop -32 |
| Machines / feedback | hatch, telegraph, grinder clog/clear, rocket, sphere shatter, jingles, combo, bonus, fine, stars | -18 ... -22 |
| Donor voices | spawn/hurt/death/drown/sigh | -21 ... -24 |
| PA | chime, speech | -21 ... -24 |
| Ambience | room hum, distant alarm | about -35 |
| UI | hover / click / back / pause | -38 / -32 |
| Music | RMS while playing | about -29 RMS; menu louder; paused about -8 dB and low-passed |

Music ducks by up to about 8 dB under slams, explosions, mass deaths, jingles and PA. Payload
magnitudes (`size`, `speed×mass`, `rate`, `amount`, `intensity`) have no fixed units, so
`events.js` normalises each one against a slow running average. A typical event lands mid-range
and a big one goes loud. Impacts use a steep curve so that constant tumbling taps stay quiet.

### Voice limiting

Each class has a token bucket (`burst` simultaneous, `rate` per second), a polyphony cap where
the oldest voice is stolen with an 8 ms fade, and a priority. A global cap of 48 one-shots steals
the lowest-priority, oldest voice, or drops the new one if everything playing matters more.
`blood:splat` floods also feed a looping droplet "patter" bed, so 1000+ splats/s still sounds like
heavy rain instead of being dropped. Events that land in the same instant are staggered by 8 to
20 ms to avoid phasey stacking.

## How to add a sound

1. Write a definition in the right `sounds/*.js` file:
   `myThing: { variants: 4, render(sr, rnd, v) { const out = buf(sr, 0.5); /* addMode, addNoise, addBubble … */ return out; } }`.
   `rnd` is seeded per variant, so renders are deterministic. Loudness is normalised for you.
2. Play it from a handler in `events.js`: `P('classname', 'myThing', { gain, pan, rate })`, or add
   a new class in `mix.js` `CLASSES`.
3. Give it a target in `tools/audio/targets.mjs` and a row in `RAW` in `tools/audio/harness.js`.
   Then run `node tools/audio/run.mjs --only=raw --autotrim` and paste the suggested `TRIM_DB`.
4. Run the full `node tools/audio/run.mjs` (meters, 60 s stress test, robustness).
   `--wav` writes WAVs to `tools/audio/out/` for listening.

## Event to sound map

| Event | Sound |
|---|---|
| `shift:start` | Rising vibes jingle with bell. Music restarts in the shift arrangement 1.6 s later. Saw/grinder presence resets |
| `shift:end` | `complete`: major cadence jingle. `timeout`: clock bells and a descending line. `failed`: sour minor fall with a flat drone. Music holds, then plays the results arrangement |
| `wave:incoming` | Polite two-tone intake doorbell with a pneumatic swell |
| `hatch:open` | Latch clack, servo whirr, heavy metal clunk, creak (panned) |
| `donor:spawn` | 70 % chance of a muffled cheerful blip ("hi!", "hel-lo!", "wheee", "oh!", "hm?"). Pitch depends on type (big lower, thin higher) plus a stable per-donor offset |
| `donor:hurt` | "oof/ow/eep/ugh/ah/oop/nngh/whoa" blip, at most one per donor per 0.7 s, level from `amount` |
| `donor:death` | Cause-specific. `cut`: death yelp + big squelch + rip. `impale`: yelp + squelch. `crush`: yelp cut off mid-word + crack + squelch. `grind`: cut-off yelp + crunch + squelch. `impact`: yelp + thud + squelch. `drown`: bubbly blubbering. `explode`: "eep" + squelch. `bleedout`: faint sigh + gob. Three or more deaths within 1 s duck the music harder |
| `limb:sever` | Bone crack + wet rip + small squelch |
| `limb:break` | Bone snap + small thud |
| `impact` | `flesh`: meaty thud (pitch drops with energy), plus a gob on hard hits. `metal`: plate clang. `glass`: tink. `prop`: hollow knock. Soft contacts are silent |
| `blood:spurt` | Pulsing arterial hiss with gurgle and spray |
| `blood:splat` | Droplet blip (glassy bubble), or a wet gob for big sizes. Every splat also feeds the patter bed |
| `splash` | Plop + spray + bubbles + slosh, size-scaled |
| `hazard:contact` | `saw`: tooth-rate ripping grind with bogging whine (and the saw loop gets a load boost). `spike`: "shunk" (scrape, thud, squish). `grinder`: crunch train. `crusher`: metal slam + crunch + squelch + hiss |
| `hazard:telegraph` | Crusher: two warning beeps + rising pneumatic hiss. Other hazards: double beep |
| `grinder:clog` / `grinder:clear` | Jam clunk and stalling motor groan (the hum loop drops to a strained 24 Hz) / ka-chunk, wet blorp, rev-up |
| `slam` | Hydraulic SLAM: sub drop + mid punch + shell clank + rattle + hiss release. Ducks music |
| `slam:ready` | Tiny pressure tick + soft blip |
| `combo` | Pluck + sparkle and a noise riser, both pitched up the scale with `multiplier` (x2 to x8) |
| `bonus` / `fine` | Cash-register "ka-ching" / sad two-note "womp-womp" buzzer |
| `prop:puncture` | Metal pierce + pressure burst, then a 2.4 s rocket hiss/whistle voice |
| `prop:explode` | Kills the nearest rocket voice; explosion (crack, boom, debris, shrapnel). Strong duck |
| `sphere:crack` / `sphere:shatter` | Glassy crack with crackle run / burst + 70 tinkling shards |
| `pa:announce` | Chime by mood (calm: three soft bells; urgent: fast bright alternation; glitch: stuttering, sour, crushed), then a ceiling-speaker "wah-wah" mumble sized to the text length |
| `timer:warning` | Woodblock tick; urgent beep at 5 s or less |
| `game:pause` | Down/up blip. Paused screen: world SFX at -9 dB and low-passed at 700 Hz, music quiet and low-passed, loops stop |
| `ui:hover` / `ui:click` / `ui:back` | Tiny sine tick / two-note marimba tock / descending tock |
| `ui:star` | Bell + vibes stinger at three ascending pitches (n = 1, 2, 3). Star 3 adds an arpeggio shimmer |
| `achievement` | Vibes arpeggio fanfare |

### Continuous (from `state` each frame)

| State | Sound |
|---|---|
| `drumOmega` | Motor: buzzy fundamental 30 to 78 Hz plus gear whine and rumble. Attack time constant 10 ms, plus a relay-clack "motor start" on first movement after rest |
| `sawLoad` | Saw whine (230 Hz saw through a 2.8 kHz band plus 13th-harmonic sine) sags in pitch by up to 33 %, and grinding noise rises |
| `grinderLoad` | Roller hum slows and the looped crunch chug gets louder and slower |
| `fill` × \|`drumOmega`\| | Blood slosh (low filtered noise with wave LFOs). The alarm fades in from fill 0.78. Room hum is masked as the room fills. Music degrades (below) |
| `timeScale` | Pitch and tempo down by sqrt(timeScale), and world SFX low-pass |
| `screen` | menu / playing / paused / results mix presets and music arrangement |
| `intensity` | Music layers: congas (> 0.3), string pad (> 0.55), hats (> 0.75), octave-doubled melody (> 0.85) |

## Music: "Hold Music No. 4 in F, for Donation Floor"

A 16-bar bossa in F: Fmaj9 Dm9 Gm9 C13 / Am7 D7b9 Gm9 C9 / Bbmaj9 Eb9 Am7 D9 / Gm7 C9 Fmaj7 Gm7-C9.
It has rootless Rhodes voicings, bossa bass (root and fifth), a vibes melody (flute in the bridge),
shaker, rim clave and soft kick.

- Menu: 90 bpm, sustained chords, brushes.
- Shift: 108 bpm, full bossa comping and percussion.
- Results: 84 bpm, sparse.

Degradation with `fill` (smoothed):

- Tape wow rises from 3 to 63 cents, flutter to 22 cents, plus drift.
- Per-note random detune rises from about 2 to 47 cents.
- Sour notes (±1 semitone): up to 60 % of the melody, 35 % of chord tones, 25 % of bass notes.
- Tempo sags to -13 % and wobbles, with rhythmic jitter.
- Tape dropouts.
- Drive and bit-crush mixes rise; a resonant low-pass closes from 18 kHz to about 700 Hz; the high-pass rises (tinny speaker).
- Above fill 0.65, random tape-stop dives.
