# Weapon combat XP audit

Audit of the stat or stats every weapon's attack styles train, against the OSRS Wiki and the
game cache's combat-style table (dbtable 78, `combat_interface_weapon_category`). Branch
`fix/1999-weapon-xp-audit`, based on `origin/main` (`260aceeaa`), November 2026.

## Answer to #1999

**Not a bug.** A bronze sword (item 1277) is a stab sword (`SWORD` type, cache category 17).
Its four styles, from both the Wiki and the cache, are:

| Style | Attack type | Weapon style | Trains |
| --- | --- | --- | --- |
| Stab | Stab | Accurate | Attack |
| Lunge | Stab | Aggressive | **Strength** |
| Slash | Slash | Aggressive | Strength |
| Block | Stab | Defensive | Defence |

Lunge on a stab sword trains Strength, not shared XP. Shared XP (Attack + Strength + Defence)
belongs to the Lunge of scimitars and longswords, the Lunge/Swipe/Pound of spears and hastae,
and the Jab/Spike/Lash of halberds, maces and whips - separate cache categories. The Tutorial
Island combat instructor says the same: "Stab uses accurate, lunge and slash use aggressive and
block uses defensive" (`server/data/definitions/npc-dialogues.json`).

The server already does this: `SWORD_LUNGE` is `AGGRESSIVE` in
`server/data/definitions/item-combat-styles.json:60`, and
`FightStyle.AGGRESSIVE.skill(CombatType.MELEE)` returns Strength
(`server/src/main/typescript/elvarg/game/content/combat/FightStyle.ts:10`). The new regression
test in `server/tests/weapon-styles.test.cjs` locks it in.

## Scope

The 1,080 weapons with an attack speed in the cache (the scope used by
[weapons.md](weapons.md)); 1,068 of them have a weapon type. The 12 untyped are the documented
exceptions: Nature's reprisal (multi-style), the broken axes, the Teasing stick and Arrav's axe.

## Method

1. **Cache dbtable 78** supplies each weapon category's styles and their descriptions, including
   the XP label: `(Accurate)<br>(Stab)<br>(Attack XP)`, `(Controlled)<br>(Slash)<br>(Shared XP)`,
   `(Longrange)<br>(Magic XP)<br>(Defence XP)` and so on.
2. **`server/data/definitions/item-combat-styles.json`** maps each category to the server's
   fight types. Every one of its 53 interfaces and every fight type was compared with the cache
   description (style and attack type).
3. **`FightStyle.skill(CombatType)`** turns the style and attack type into the skills the server
   awards. Each result was compared with the cache's XP label.
4. **The Wiki's combat style** for each weapon (`weapon-stats.json`, joined by item id) was
   compared with the assigned type's cache category. `yarn sync:weapon-types` re-ran against the
   live Wiki: **0 weapons changed**, so every typed weapon is on the category the Wiki gives it.

The cache's descriptions are the game's own strings and match the Wiki's `{{CombatStyles}}`
tables for every category checked. The Wiki pages used for the per-weapon spot checks include
[Bronze sword](https://oldschool.runescape.wiki/w/Bronze_sword),
[Salamander](https://oldschool.runescape.wiki/w/Salamander),
[Tzhaar-ket-om](https://oldschool.runescape.wiki/w/Tzhaar-ket-om) and
[Barrelchest anchor](https://oldschool.runescape.wiki/w/Barrelchest_anchor).

## Findings

### 1. No weapon trains the wrong skill

After matching every interface's fight types to the cache's XP labels and running each through
`FightStyle.skill`, there are **0 XP mismatches**. The style-to-skill rules in
`FightStyle.ts` are:

| Style | Melee | Ranged | Magic |
| --- | --- | --- | --- |
| Accurate | Attack | Ranged | Magic |
| Aggressive | Strength | Ranged | Magic |
| Controlled | Attack + Strength + Defence | - | - |
| Defensive | Defence | Ranged + Defence | Magic + Defence |
| Longrange | - | Ranged + Defence | Magic + Defence |

Two special cases are handled outside `FightStyle` and are correct:

- **Salamander Blaze** is a Defensive magic style, but the cache labels it `Magic XP` only (no
  `Defence XP`). `Salamanders.plugin.js` overrides
  `splitsDefensiveMagicExperience() { return false; }`, so it pays Magic only, as the Wiki says.
- **Salamander Flare** is stored as `AGGRESSIVE`, while the cache labels it Accurate. Both give
  Ranged XP, so the XP is right. The Wiki notes that Flare is labelled Accurate but, unlike a
  bow's Accurate style, gives **no invisible Ranged level boost**; the server's Aggressive value
  produces exactly that (no +3), so the current data is functionally correct even though the
  label differs from the cache. A future `noBoost` flag on the style would express this without
  overloading `AGGRESSIVE`.

### 2. Zorya's tome is on the powered-staff type, not a book type

`item-gameplay.json` gives Zorya's tome (34725, 34727) the `POWERED_STAFF` type (category 24),
but the Wiki's combat style is "Powered Book" (cache category 37, `book_selfpowering`).
`sync-weapon-types.ts` has no mapping for "powered book", so it reports the item as unresolved
and leaves its type alone. The styles of categories 24 and 37 are identical (Accurate, Accurate,
Longrange; Magic, Magic, Magic + Defence), so **the XP is correct**. This is a type/animation
mapping gap, not an XP bug.

### 3. Dinh's bulwark Block is marked "No attacking!" but is not blocked

The cache's Block row for the bulwark category is `No attacking!`. The server stores it as
`BULWARK_BLOCK` with `ACCURATE`/`CRUSH`, so if a client selected slot 3 the player would attack
and train Attack. The normal client draws the combat tab from the cache's CS2 and does not offer
the style, so this is not reachable in ordinary play; the server has no explicit guard. This is
a combat-behaviour gap rather than an XP-data error, and is left open here.

### 4. Gun / Aim and Fire is inert

`GUN_AIM_AND_FIRE` has no XP label in the cache (`(Aim and Fire)`). The only item on the type is
the Fixed device (6082), a quest prop with no attack speed; the Goblin paint cannon (12727) is
`UNARMED` per the Wiki. No audited weapon uses `GUN`, so it cannot award wrong XP today.

## Every type and the skills its styles train

Counts are audited weapons from [weapon-census.csv](weapon-census.csv); "0 (unused)" means the
type exists in the JSON but no audited weapon uses it.

| Type | Cat | Weapons | Styles (skills trained) |
| --- | ---: | ---: | --- |
| STAFF | 18 | 115 | Bash crush (Attack); Pound crush (Strength); Focus crush (Defence) |
| WARHAMMER | 2 | 126 | Pound crush (Attack); Pummel crush (Strength); Block crush (Defence) |
| MAUL | 27 | 0 (unused) | Pound/Pummel/Smash crush (Strength) |
| GRANITE_MAUL | 2 | 5 | Pound crush (Attack); Pummel crush (Strength); Block crush (Defence) |
| VERACS_FLAIL | 16 | 6 | Pound crush (Attack); Pummel crush (Strength); Spike stab (Attack+Strength+Defence); Block crush (Defence) |
| SCYTHE | 14 | 9 | Reap slash (Attack); Chop slash (Strength); Jab crush (Strength); Block slash (Defence) |
| BATTLEAXE | 1 | 51 | Chop slash (Attack); Hack slash (Strength); Smash crush (Strength); Block slash (Defence) |
| GREATAXE | 1 | 6 | Chop slash (Attack); Hack slash (Strength); Smash crush (Strength); Block slash (Defence) |
| CROSSBOW | 5 | 28 | Accurate range (Ranged); Rapid range (Ranged); Longrange range (Ranged+Defence) |
| BALLISTA | 5 | 6 | Accurate range (Ranged); Rapid range (Ranged); Longrange range (Ranged+Defence) |
| BLOWPIPE | 19 | 12 | Accurate range (Ranged); Rapid range (Ranged); Longrange range (Ranged+Defence) |
| KARILS_CROSSBOW | 5 | 6 | Accurate range (Ranged); Rapid range (Ranged); Longrange range (Ranged+Defence) |
| SHORTBOW | 3 | 33 | Accurate range (Ranged); Rapid range (Ranged); Longrange range (Ranged+Defence) |
| LONGBOW | 3 | 33 | Accurate range (Ranged); Rapid range (Ranged); Longrange range (Ranged+Defence) |
| DRAGON_DAGGER | 17 | 9 | Stab stab (Attack); Lunge stab (Strength); Slash slash (Strength); Block stab (Defence) |
| ABYSSAL_DAGGER | 17 | 8 | Stab stab (Attack); Lunge stab (Strength); Slash slash (Strength); Block stab (Defence) |
| DAGGER | 17 | 51 | Stab stab (Attack); Lunge stab (Strength); Slash slash (Strength); Block stab (Defence) |
| SWORD | 17 | 47 | Stab stab (Attack); Lunge stab (Strength); Slash slash (Strength); Block stab (Defence) |
| FANG | 17 | 1 | Stab stab (Attack); Lunge stab (Strength); Slash slash (Strength); Block stab (Defence) |
| SCIMITAR | 9 | 77 | Chop slash (Attack); Slash slash (Strength); Lunge stab (Attack+Strength+Defence); Block slash (Defence) |
| LONGSWORD | 9 | 13 | Chop slash (Attack); Slash slash (Strength); Lunge stab (Attack+Strength+Defence); Block slash (Defence) |
| MACE | 16 | 30 | Pound crush (Attack); Pummel crush (Strength); Spike stab (Attack+Strength+Defence); Block crush (Defence) |
| KNIFE | 19 | 33 | Accurate range (Ranged); Rapid range (Ranged); Longrange range (Ranged+Defence) |
| OBBY_RINGS | 19 | 1 | Accurate range (Ranged); Rapid range (Ranged); Longrange range (Ranged+Defence) |
| SPEAR | 15 | 97 | Lunge/Swipe/Pound (Attack+Strength+Defence); Block stab (Defence) |
| TWO_HANDED_SWORD | 10 | 23 | Chop slash (Attack); Slash slash (Strength); Smash crush (Strength); Block slash (Defence) |
| PICKAXE | 11 | 27 | Spike stab (Attack); Impale stab (Strength); Smash crush (Strength); Block stab (Defence) |
| CLAWS | 4 | 15 | Chop slash (Attack); Slash slash (Strength); Lunge stab (Attack+Strength+Defence); Block slash (Defence) |
| HALBERD | 12 | 16 | Jab stab (Attack+Strength+Defence); Swipe slash (Strength); Fend stab (Defence) |
| UNARMED | 0 | 6 | Punch crush (Attack); Kick crush (Strength); Block crush (Defence) |
| WHIP | 20 | 8 | Flick slash (Attack); Lash slash (Attack+Strength+Defence); Deflect slash (Defence) |
| THROWNAXE | 19 | 11 | Accurate range (Ranged); Rapid range (Ranged); Longrange range (Ranged+Defence) |
| DART | 19 | 44 | Accurate range (Ranged); Rapid range (Ranged); Longrange range (Ranged+Defence) |
| JAVELIN | 19 | 2 | Accurate range (Ranged); Rapid range (Ranged); Longrange range (Ranged+Defence) |
| ANCIENT_STAFF | 18 | 2 | Bash crush (Attack); Pound crush (Strength); Focus crush (Defence) |
| POWERED_STAFF | 24 | 42 | Accurate magic (Magic); Accurate magic (Magic); Longrange magic (Magic+Defence) |
| DARK_BOW | 3 | 9 | Accurate range (Ranged); Rapid range (Ranged); Longrange range (Ranged+Defence) |
| GODSWORD | 10 | 13 | Chop slash (Attack); Slash slash (Strength); Smash crush (Strength); Block slash (Defence) |
| ABYSSAL_BLUDGEON | 27 | 1 | Pound/Pummel/Smash crush (Strength) |
| SARADOMIN_SWORD | 10 | 1 | Chop slash (Attack); Slash slash (Strength); Smash crush (Strength); Block slash (Defence) |
| ELDER_MAUL | 2 | 3 | Pound crush (Attack); Pummel crush (Strength); Block crush (Defence) |
| GHRAZI_RAPIER | 17 | 4 | Stab stab (Attack); Lunge stab (Strength); Slash slash (Strength); Block stab (Defence) |
| PARTISAN | 30 | 5 | Stab stab (Attack); Lunge stab (Strength); Pound crush (Strength); Block stab (Defence) |
| BANNER | 25 | 0 (unused) | Lunge stab (Attack); Swipe slash (Strength); Pound crush (Attack+Strength+Defence); Block stab (Defence) |
| POLESTAFF | 13 | 17 | Bash crush (Attack); Pound crush (Strength); Block crush (Defence) |
| SALAMANDER | 6 | 5 | Scorch slash (Strength); Flare range (Ranged); Blaze magic (Magic; the plugin suppresses Defence) |
| CHINCHOMPA | 7 | 3 | Short fuse range (Ranged); Medium fuse range (Ranged); Long fuse range (Ranged+Defence) |
| BLADED_STAFF | 21 | 2 | Jab stab (Attack); Swipe slash (Strength); Fend crush (Defence) |
| BULWARK | 28 | 2 | Pummel crush (Attack); Block crush (Attack; cache says "No attacking!") |
| GUN | 8 | 0 (unused) | Aim and Fire crush (Attack); Kick crush (Strength) |
| MULTI_MELEE | 34 | 1 | Poke stab (Attack); Slash slash (Strength); Pound crush (Strength); Block slash (Defence) |
| SLASH_FLAIL | 35 | 1 | Chop slash (Attack); Slash slash (Strength); Block slash (Defence) |
| EXTENDING_CHAINMACE | 36 | 2 | Thrust crush (Attack); Thrust crush (Strength); Smash crush (Strength) |

## Verification

```bash
cd server && npx tsc --build
cd server && node --test tests/weapon-styles.test.cjs
```

The read-only audit compared 53 interfaces and every fight type with cache dbtable 78:

- 1 style-label mismatch (`SALAMANDER_FLARE`: cache Accurate, stored Aggressive; XP unaffected),
- 2 styles with no XP label (`BULWARK_BLOCK`, `GUN_AIM_AND_FIRE`; see findings 3 and 4),
- 0 XP mismatches after the salamander plugin override,
- 0 weapon-type changes when `yarn sync:weapon-types` was re-run against the live Wiki.

## Limitations

- The cache's description strings are the primary style/XP source; the Wiki was checked for the
  categories and the weapons called out above, not re-read for all 1,068 weapons.
- Special attacks are not audited; they award the XP of the selected style.
- Nature's reprisal is untyped because the engine cannot switch combat method by style yet.
