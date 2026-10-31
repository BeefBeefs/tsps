/**
 * The Enchanted Key (miniquest), the post-Making History treasure hunt.
 *
 * Sources:
 * - OSRS Wiki, "The Enchanted Key": eleven treasure sites, Chebyshev hot/cold
 *   bands, the first site always south of Rellekka and the other ten in a
 *   per-player random order. The loot table below is the Wiki's per-site loot.
 * - Quest Helper (Zoinkwiz/quest-helper @ 06da90f), helpers/miniquests/
 *   enchantedkey: varbit MAKINGHISTORY_LOCSTATUS (1391) is an 11-bit "dug"
 *   mask whose bit order is the one used here. The helper reads that var to
 *   narrow its possible dig locations, so the bits must match.
 * - Cache: quest DB row 41, "The Enchanted Key", type 1 (miniquest), endstate
 *   2. Script 4024 reads its progress from varbit 13717 (varp 3403, bits
 *   8-9); varbit 1391 is varp 604, bits 21-31 (siblings of Making History).
 *
 * Saved stages are 0 not started, 1 in progress, 2 complete. The miniquest
 * starts when Making History completes: the enchanted key is its reward. The
 * durable "dug" mask lives in a player attribute and is mirrored to 1391, so
 * the quest list, the cache and Quest Helper all read the same progress.
 *
 * Approximations:
 * - The Wiki's Lumbridge Swamp note says a player with no zombie head digs one
 *   up before the treasure. The server has no zombie-head/POH storage to test,
 *   so that first dig is omitted.
 * - The exact post-completion "the key is cold" wording is not published; the
 *   message below only records that it no longer leads anywhere.
 * - Temperature is Chebyshev x/y distance, as the Wiki defines it. Digging
 *   still requires the surface plane because every site is on plane 0.
 */
module.exports = function registerTheEnchantedKeyQuest(api) {
  const { Animation, ItemIdentifiers: Items } = api.core;
  const { registerQuest } = require("../QuestRuntime");

  const VARP_ENCHANTED_KEY = 3403;
  const VARBIT_PROGRESS = 13717; // "enchantedkey", bits 8-9, completes at 2
  const VARBIT_LOCSTATUS = 1391; // makinghistory_locstatus, varp 604 bits 21-31
  const STAGE_NOT_STARTED = 0;
  const STAGE_STARTED = 1;
  const STAGE_COMPLETE = 2;

  const ENCHANTED_KEY = Items.ENCHANTED_KEY; // 6754
  const SPADE = Items.SPADE; // 952
  const DIG_ANIMATION = new Animation(830);

  // The bit order is Quest Helper's EnchantedKeyDigLocation order; the tiles
  // are the OSRS Wiki's map pins for each treasure site. Quest Helper's own
  // points are within the four-tile dig radius of these pins, so its
  // highlighted tile always works here.
  const SITES = [
    {
      x: 2716, y: 3606, bit: 1 << 0,
      loot: [[Items.STEEL_ARROW, 20], [Items.MITHRIL_ORE, 10], [Items.LAW_RUNE, 15]],
    },
    {
      x: 3299, y: 3349, bit: 1 << 1,
      loot: [[Items.PURE_ESSENCE, 40], [Items.IRON_ORE, 15], [Items.GUTHIX_MJOLNIR, 1]],
    },
    {
      x: 2972, y: 3304, bit: 1 << 2,
      loot: [[Items.EARTH_RUNE, 15], [Items.IRON_ARROW, 20], [Items.SARADOMIN_MJOLNIR, 1]],
    },
    {
      x: 3291, y: 3220, bit: 1 << 3,
      loot: [[Items.PURE_ESSENCE, 40], [Items.MITHRIL_ORE, 10], [Items.ZAMORAK_MJOLNIR, 1]],
    },
    {
      x: 3161, y: 3176, bit: 1 << 4,
      loot: [[Items.PURE_ESSENCE, 29], [Items.MIND_RUNE, 20], [Items.STEEL_ARROW, 20]],
    },
    {
      x: 3160, y: 3490, bit: 1 << 5,
      loot: [[Items.PURE_ESSENCE, 39], [Items.MITHRIL_ARROW, 10], [Items.LAW_RUNE, 15]],
    },
    {
      x: 3033, y: 3437, bit: 1 << 6,
      loot: [[Items.MITHRIL_ORE, 10], [Items.IRON_ORE, 15], [Items.EARTH_RUNE, 45]],
    },
    {
      x: 2417, y: 3382, bit: 1 << 7,
      loot: [[Items.PURE_ESSENCE, 40], [Items.IRON_ARROWTIPS, 20], [Items.FIRE_RUNE, 20]],
    },
    {
      x: 3016, y: 3166, bit: 1 << 8,
      loot: [[Items.IRON_ORE, 15], [Items.MITHRIL_ARROW, 20], [Items.DEATH_RUNE, 15]],
    },
    {
      x: 2621, y: 3239, bit: 1 << 9,
      loot: [[Items.PURE_ESSENCE, 36], [Items.IRON_ORE, 15], [Items.FIRE_RUNE, 30]],
    },
    {
      x: 2448, y: 3443, bit: 1 << 10,
      loot: [[Items.PURE_ESSENCE, 39], [Items.IRON_ARROWTIPS, 20], [Items.WATER_RUNE, 30]],
    },
  ];

  const ALL_SITES = SITES.reduce((mask, site) => mask | site.bit, 0);
  const DIG_RADIUS = 4; // the Wiki's 9 by 9 "steaming" area
  const LOOT_STACKS = 3;

  // Site index is saved; the first treasure is fixed to Rellekka, so -1 means
  // "pick the next site". Last distance is transient (login and a find reset it).
  const SITE_ATTRIBUTE = "quest.enchanted_key.site";
  const DUG_ATTRIBUTE = "quest.enchanted_key.dug";
  const LAST_DISTANCE_ATTRIBUTE = "quest.enchanted_key.last_distance";

  let quest;

  const held = (player, itemId) => player.getInventory().getAmount(itemId) > 0;
  const banked = (player, itemId) => {
    const banks = player.getBanks?.() ?? (player.getBank ? [player.getBank()] : []);
    return banks.some((bank) => Number(bank?.getAmount?.(itemId) ?? 0) > 0);
  };
  const ownsKey = (player) => held(player, ENCHANTED_KEY) || banked(player, ENCHANTED_KEY);
  const stageOf = (player) => quest.getStage(player);

  function freeSlots(player) {
    const inventory = player.getInventory();
    if (typeof inventory.getFreeSlots === "function") return inventory.getFreeSlots();
    return inventory.isFull?.() ? 0 : LOOT_STACKS;
  }

  function makingHistoryComplete(player) {
    const request = { player, key: "making_history", complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function dugMask(player) {
    const value = Number(player.getAttribute(DUG_ATTRIBUTE));
    return Number.isFinite(value) ? value & ALL_SITES : 0;
  }

  function sendSites(player) {
    player.getPacketSender().sendVarbit(VARBIT_LOCSTATUS, dugMask(player));
  }

  function countDug(mask) {
    let count = 0;
    for (const site of SITES) if ((mask & site.bit) !== 0) count++;
    return count;
  }

  /** The first treasure is always Rellekka; the rest are a saved random order. */
  function currentSite(player) {
    const dug = dugMask(player);
    const stored = Number(player.getAttribute(SITE_ATTRIBUTE));
    if (
      Number.isInteger(stored) && stored >= 0 && stored < SITES.length
      && (dug & SITES[stored].bit) === 0
    ) {
      return stored;
    }
    if ((dug & SITES[0].bit) === 0) {
      player.setAttribute(SITE_ATTRIBUTE, 0);
      return 0;
    }
    const remaining = SITES.map((_site, index) => index).filter((index) => (dug & SITES[index].bit) === 0);
    if (remaining.length === 0) {
      player.setAttribute(SITE_ATTRIBUTE, -1);
      return -1;
    }
    const index = remaining[Math.floor(Math.random() * remaining.length)];
    player.setAttribute(SITE_ATTRIBUTE, index);
    return index;
  }

  function chebyshevDistance(player, site) {
    const location = player.getLocation();
    return Math.max(Math.abs(location.getX() - site.x), Math.abs(location.getY() - site.y));
  }

  function temperature(distance) {
    if (distance > 1000) return "It's freezing";
    if (distance > 700) return "It's very cold";
    if (distance > 400) return "It's cold";
    if (distance > 100) return "It's warm";
    if (distance > 60) return "It's hot";
    if (distance > 30) return "It's very hot";
    if (distance > DIG_RADIUS) return "Ouch! It's burning hot";
    return "The key is steaming. It must be right below your feet.";
  }

  function reading(distance, previous) {
    const base = temperature(distance);
    // The "last time" half only makes sense for a temperature, not the
    // instruction that the treasure is already underfoot.
    if (distance <= DIG_RADIUS) return base;
    const last = Number(previous);
    if (!Number.isFinite(last) || last < 0) return `${base}.`;
    if (distance < last) return `${base} and warmer than last time.`;
    if (distance > last) return `${base} but colder than last time.`;
    return `${base} and the same temperature as last time.`;
  }

  function startIfNeeded(player) {
    if (stageOf(player) !== STAGE_NOT_STARTED) return;
    quest.setStage(player, STAGE_STARTED);
  }

  function feelKey(event) {
    const { player } = event;
    if (event.itemId !== ENCHANTED_KEY || event.handled) return false;
    if (!held(player, ENCHANTED_KEY)) return false;
    if (!makingHistoryComplete(player)) return false;
    event.handled = true;
    if (quest.isComplete(player)) {
      player.sendMessage("The key is cold and lifeless; it has no more treasure to find.");
      return true;
    }
    const index = currentSite(player);
    if (index < 0) return true;
    startIfNeeded(player);
    const site = SITES[index];
    const distance = chebyshevDistance(player, site);
    player.sendMessage(reading(distance, player.getAttribute(LAST_DISTANCE_ATTRIBUTE)));
    player.setAttribute(LAST_DISTANCE_ATTRIBUTE, distance);
    return true;
  }

  function digTreasure(event) {
    const { player } = event;
    if (event.itemId !== SPADE || event.handled) return false;
    if (!held(player, ENCHANTED_KEY)) return false;
    if (!makingHistoryComplete(player)) return false;
    if (quest.isComplete(player)) return false;
    if ((player.getLocation().getZ?.() ?? 0) !== 0) return false;
    const index = currentSite(player);
    if (index < 0) return false;
    const site = SITES[index];
    if (chebyshevDistance(player, site) > DIG_RADIUS) return false;
    event.handled = true;
    if (freeSlots(player) < site.loot.length) {
      player.sendMessage("You need more inventory space to dig up the treasure.");
      return true;
    }
    startIfNeeded(player);
    player.performAnimation?.(DIG_ANIMATION);
    for (const [itemId, amount] of site.loot) player.getInventory().adds(itemId, amount);
    const mask = dugMask(player) | site.bit;
    player.setAttribute(DUG_ATTRIBUTE, mask);
    player.setAttribute(SITE_ATTRIBUTE, -1);
    player.setAttribute(LAST_DISTANCE_ATTRIBUTE, -1);
    sendSites(player);
    player.sendMessage("You dig up a cache of treasure.");
    if (mask === ALL_SITES) quest.complete(player);
    return true;
  }

  function handleLogin({ player }) {
    player.setAttribute(LAST_DISTANCE_ATTRIBUTE, -1);
    if (
      stageOf(player) === STAGE_NOT_STARTED
      && makingHistoryComplete(player)
      && ownsKey(player)
    ) {
      quest.setStage(player, STAGE_STARTED);
    }
    sendSites(player);
    // A save or crash between the last find and quest.complete leaves the mask
    // finished; close the miniquest on login instead of showing it in progress.
    if (!quest.isComplete(player) && dugMask(player) === ALL_SITES) {
      quest.complete(player, { scroll: false });
    }
  }

  function handleLogout({ player }) {
    player.setAttribute(LAST_DISTANCE_ATTRIBUTE, -1);
  }

  /** The login bootstrap re-sends shared varps; restore the 1391 mirror after it. */
  function handleBootstrap({ player }) {
    sendSites(player);
  }

  function handleQuestCompleted({ player, key }) {
    if (key !== "making_history") return;
    if (stageOf(player) === STAGE_NOT_STARTED) quest.setStage(player, STAGE_STARTED);
    sendSites(player);
  }

  function buildJournal(player) {
    if (quest.isComplete(player)) {
      return [
        "<str>I used the enchanted key to find all eleven hidden treasures.</str>",
        "",
        "<col=ff0000>MINIQUEST COMPLETE!</col>",
      ];
    }
    if (stageOf(player) >= STAGE_STARTED) {
      const found = countDug(dugMask(player));
      return [
        `I have found ${found} of ${SITES.length} treasures hidden by the enchanted key.`,
        "I should feel the key to judge how close the next one is, then",
        "dig with a spade where the key is steaming.",
      ];
    }
    return [
      "I can start this miniquest by getting my enchanted key.",
      "I can reclaim it from the silver merchant in East Ardougne",
      "after completing Making History.",
    ];
  }

  api.persistAttribute(SITE_ATTRIBUTE, -1);
  api.persistAttribute(DUG_ATTRIBUTE, 0);

  quest = registerQuest(api, {
    key: "the_enchanted_key",
    name: "The Enchanted Key",
    varpId: VARP_ENCHANTED_KEY,
    varbitId: VARBIT_PROGRESS,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 0,
    scrollItemId: ENCHANTED_KEY,
    otherRewards: ["The key's eleven hidden treasure caches", "Three god mjolnirs"],
    buildJournal,
  });

  api.onItemAction("Enchanted key", { Feel: feelKey });
  api.onItemAction("Spade", { Dig: digTreasure });
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
  api.onCustomEvent("player:bootstrap-complete", handleBootstrap);
  api.onCustomEvent("quest:completed", handleQuestCompleted);
};
