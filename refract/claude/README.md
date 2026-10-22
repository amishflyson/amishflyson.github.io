# Refract Motion — guide for Claude

Refract Motion is a touch-first motion-graphics editor that runs in the browser
(https://amishflyson.github.io/refract/). Its projects are plain JSON files
(`*.refract.json`). This guide is for **you, Claude**: how to read and write those files so that
what you make opens in the app, plays correctly, and stays fully editable. The user fine-tunes
your work afterwards (every layer, keyframe and effect you write shows up in their editor).

Files next to this guide:

| File | What it is |
|---|---|
| `catalog.json` | Generated from the app source: every effect (with every param, type, default, range, enum options and a plain-language help line), transitions, text animations, look presets, modifiers, ease names, fonts, and **templates** of each layer kind. Treat it as the source of truth. |
| `validate.mjs` | `node validate.mjs file.refract.json [--fix]` checks a file against the catalog (unknown effects/params, bad enums, missing ids, broken references, unsorted keys). `--fix` fills defaults and ids. No dependencies. |

---

## 1. Getting the project and giving it back

**In a chat:** the user attaches their `.refract.json` (from *Project → Edit with Claude → Share
project file*) and pastes instructions. Edit it and give the file back. They open it with the
folder button on the home screen (*Open project file* or *Paste project text*).

**In a Claude Code session with the user's repo (`amishflyson/amishflyson.github.io`):** publish
to the **inbox** so the file appears on the app's home screen under **From Claude**:

1. Write the file to `refract/inbox/<slug>.refract.json` (slug: lowercase, dashes, unique).
2. Run `node refract/claude/validate.mjs refract/inbox/<slug>.refract.json --fix` until it says OK.
3. Add an entry to `refract/inbox/index.json` (create it as `{ "items": [] }` if missing):
   ```json
   { "items": [
     { "id": "boss-title-v2", "name": "Boss title — slower, gold embers",
       "file": "boss-title-v2.refract.json",
       "projectId": "<project.id from the file, when this edits an existing project>",
       "note": "One or two sentences on what you changed.",
       "createdAt": "2026-10-22T18:00:00Z" }
   ] }
   ```
   `id` must be new for every publish (the app remembers which ids it has shown).
4. Commit and push to `main`. GitHub Pages updates within a minute or two.
5. Tell the user it's in their inbox, and give the direct link too:
   `https://amishflyson.github.io/refract/#open=inbox/<slug>.refract.json`

Never delete or rewrite other files in `refract/` (that's the built app). Only touch `refract/inbox/`.

**Editing an existing project:** keep `project.id` unchanged. The app then offers
*Update "<name>"*: it saves the user's current version as a checkpoint (History → Versions) and
loads yours, so nothing is lost and Undo works. A new `project.id` (or none) imports as a new
project.

**Making something new:** start from `catalog.templates.project`, give it a fresh `id`, and add
layers built from `catalog.templates.layers`.

## 2. File shape

```jsonc
{
  "format": "refract-project",
  "version": 2,
  "note": "optional: what you changed (shown to the user when they open it)",
  "project": {
    "schema": 1, "id": "…", "name": "…", "createdAt": 0, "modifiedAt": 0,
    "settings": { "colorSpace": "srgb", "previewQuality": "auto", "snapping": true, "showSafeZones": false },
    "mainCompId": "c1",
    "compositions": { "c1": {
      "id": "c1", "name": "Main", "width": 1080, "height": 1920, "fps": 30, "duration": 6,
      "background": [0.04, 0.04, 0.05, 1], "loop": true, "markers": [], "workArea": null,
      "layers": [ /* TOP of the stack FIRST */ ]
    } }
  },
  "media": { /* optional: embedded files, leave as-is */ }
}
```

IDs are any unique strings (8 random letters/digits is typical). Every layer, effect, keyframe,
modifier, mask and text animator needs one, unique across the file.

## 3. Units and conventions

- **Time**: seconds on the composition timeline (keyframe `t` too, not layer-relative). A layer
  shows from `inPoint` to `outPoint`.
- **Layer order**: `layers[0]` draws on top.
- **Every animatable value is a Prop**: `{ "value": [..] }`, optionally with `keys` and `mods`.
  Scalars are 1-element arrays. Points `[x, y]`. Colors `[r, g, b, a]`, each 0–1 (sRGB).
- **Transform**: `position` = composition pixels of the layer's anchor (default: layer center;
  `[540, 960]` is the middle of a 1080×1920 comp). `scale` is a factor (`[1, 1]` = 100%).
  `rotation` in degrees clockwise. `anchor` in pixels relative to the layer center. `opacity` 0–1.
- **Effect params** (see each param's `type` in the catalog):
  `number` (unit `px` = layer pixels), `percent` = 0–1, `angle` = degrees,
  `point` = **0–1 of the layer's own box** (`[0.5, 0.5]` = center; values outside 0–1 are allowed,
  e.g. a light source above the layer), `color` = RGBA 0–1, `bool` = 0/1, `enum` = one of
  `options[].value`. Params you leave out get their defaults when the app opens the file.
- **Effects run top to bottom** in `layer.effects` (first effect first). Each has `mix` (0–1),
  `blend` (any blend mode) and `field` (where it applies: `none`, `radial`, `ring`, `linear`, or
  `mask` = only inside the layer's masks whose `target` is `"effects"`).
- **Masks**: coordinates are pixels in the layer's own box, top-left origin. `rect`/`ellipse` use
  `box: [x, y, w, h]`; `path` uses 6 numbers per point `[x, y, inX, inY, outX, outY]`
  (tangents relative to the point). Modes `add`/`subtract`/`intersect` combine in order.
  `target: "layer"` cuts the layer; `"effects"` only limits effects whose field mode is `mask`.

## 4. Animation

- **Keyframes**: `{ "id", "t", "v": [...], "ease": {...} }`, sorted by `t`. The ease on a key
  shapes the segment that *starts* at that key. Eases: `{"type":"preset","name":"expo.out"}`
  (families sine, quad, cubic, quart, quint, expo, circ, back, elastic, bounce × in/out/inOut),
  `{"type":"linear"}`, `{"type":"hold"}`, `{"type":"bezier","x1","y1","x2","y2"}`,
  `{"type":"spring","stiffness":170,"damping":14,"mass":1}`.
- **Modifiers** (procedural motion added on top of keyframes): `wiggle` (shake, jitter),
  `oscillate` (float, pulse, spin with `wave: 3` saw and `amp: 180` for continuous rotation),
  `loop` (repeat keyframes). Give them a `label` like "Shake" or "Float" — that's how quick
  animations are shown to the user. Params are in `catalog.modifiers`.
- **Text animations** (`text.animators`): per letter/word/line entrances, exits and loops
  (`bounce-in`, `pop-in`, `typewriter`, `scramble`, `wave`, `rainbow`, …). Fields: `unit`
  (`char`/`word`/`line`), `order` (`forward`/`backward`/`center`/`random`), `delay`, `duration`,
  `stagger`, `amount`. Several can stack (an entrance + a loop + an exit).

## 5. Layer kinds

Copy the templates in `catalog.templates.layers`:

- `text` — `text.content` (use `\n` for lines), `font` (a family from `catalog.fonts`), `weight`,
  `size` (px), `tracking`, `leading`, `fill`, `stroke`, `strokeWidth`, `align`, `textCase`.
- `shape` — `rect`, `ellipse`, `polygon` (`sides`), `star` (`sides`, `innerRatio`), `line`;
  `size [w, h]`, `radius` (rect corners), `fillOn`/`fill`, `strokeOn`/`stroke`/`strokeWidth`.
  For a hollow outline use `fillOn: false, strokeOn: true` or the `hollow` effect.
- `solid` — full-frame color (`solid.color`); a great base for generators like `fractal-noise`,
  `gradient`, `grid`, `starfield`.
- `adjustment` — its effects apply to everything **below** it (color grades, CRT, VHS, grain).
- `merge` (**Metaballs**) — `merge.members` = layer ids that melt together (their shapes, colors
  and effects). Those layers stop drawing on their own. Tune `goo`, `colorBlend`, `wobble`, etc.
- `transition` — `transition.type` (`flare`, `morph`, `dither`, `zoom`, `whip`, `ink`) between
  `from` and `to` layer ids over the transition layer's own `inPoint`→`outPoint`. Overlap the two
  layers across that window (outgoing ends at the transition's out point, incoming starts at
  its in point). Both source layers stop drawing on their own while it runs.
- `media` — photos/videos from the user's device (`assetId`). You can't add new media; keep the
  existing ones and their `assetId` exactly as they are.
- **Track matte**: `layer.matte = { "layerId": "…", "mode": "alpha" | "alphaInverted" | "luma" |
  "lumaInverted" }` shows the layer only where the matte layer is. The matte layer stops drawing.
  Text matte + noise/gradient fill below it = textured type. Inverted alpha + a "boss" layer =
  text that sits behind something.

## 6. Looks (multi-effect presets)

`catalog.looks` lists ~40 named looks (e.g. `boss-gold`, `chromatic-glass`, `modulation-dither`,
`vhs-memories`, `arcade`, `neon`). Each is a list of effects with params (and sometimes keys
given as `[seconds after the layer starts, value]` — add the layer's `inPoint` when converting
them to keyframes). To use one, append those effects to a layer as normal effect instances.

## 7. Checklist before you hand it back

- Run `validate.mjs` (with `--fix` once, then without) — it must say OK.
- Layers sit inside `0…duration`; the comp `duration` covers everything.
- Text is readable at phone size (sizes ~60–300 px in a 1080-wide comp).
- Keep the user's layer names meaningful; name new layers for what they are ("Title", "Glow sweep").
- Say what you changed in `note` (and in the inbox entry).
