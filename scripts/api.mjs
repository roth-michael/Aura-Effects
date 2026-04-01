import { DISPOSITIONS } from "./constants.mjs";

/**
 * Migrates Active Auras to Aura Effects on all world actors & items, and all _unlocked_ compendium actors & items
 */
async function migrateActiveAuras() {
  const existingAlert = ui.notifications.info("AURAEFFECTS.Migrations.ActiveAurasBegin", { permanent: true, localize: true });
  const oldSettings = {
    wallsBlock: game.modules.get("ActiveAuras")?.active
      ? game.settings.get("ActiveAuras", "wall-block") ? ["move"] : []
      : game.settings.storage.get("world").find(s => s.key === "ActiveAuras.wall-block")?.value ? ["move"] : []
  }
  const allSyntheticActors = game.scenes.map(s => s.tokens.filter(t => t.actor?.isToken).map(t => t.actor)).flat();
  const allWorldActors = allSyntheticActors.concat(...game.actors).filter(a => a);
  const allWorldItems = allWorldActors.flatMap(a => a.items.contents).concat(...game.items).filter(i => i);
  const allWorldParents = allWorldActors.concat(allWorldItems);
  await Promise.all(allWorldParents.map(document => migrateDocument(document, oldSettings)));
  const allActorPacks = game.packs.filter(p => p.metadata.type === "Actor" && !p.locked);
  for (const pack of allActorPacks) {
    console.log("Aura Effects: migrating pack", pack.metadata.id)
    const actors = await pack.getDocuments();
    const allParents = actors.flatMap(a => [a, ...a.items]);
    await Promise.all(allParents.map(document => migrateDocument(document, oldSettings)));
  }
  const allItemPacks = game.packs.filter(p => p.metadata.type === "Item" && !p.locked);
  for (const pack of allItemPacks) {
    console.log("Aura Effects: migrating pack", pack.metadata.id)
    const items = await pack.getDocuments();
    await Promise.all(items.map(document => migrateDocument(document, oldSettings)));
  }
  existingAlert.remove();
  ui.notifications.success("AURAEFFECTS.Migrations.ActiveAurasComplete", { localize: true });
}

// API Helpers
async function migrateDocument(document, oldSettings) {
  let allEffectDiffs = [];
  for (const effect of document.effects) {
    if (!effect.flags?.ActiveAuras) continue;
    allEffectDiffs.push(getMigratedEffectData(effect, oldSettings));
  }
  return document.updateEmbeddedDocuments("ActiveEffect", allEffectDiffs);
}
function getMigratedEffectData(oldEffect, oldSettings) {
  const {
    // isAura -> become the new type
    isAura = false,
    // applied -> don't, but get `flags.ActiveAuras.fromAura`
    applied = false,
    // type -> see typeCheck based on system
    type = "",
    // customCheck -> will have to see what vars differ
    customCheck = "",
    // alignment -> if exists, assume 5e/sw5e and convert to script
    alignment = "",
    // radius -> system.distance
    radius = "0",
    // nameOverride -> system.overrideName
    nameOverride = "",
    // wallsBlock -> move to system.collisionType with movement ig
    wallsBlock = "system",
    // ignoreSelf -> system.applyToSelf
    ignoreSelf = false,
    // aura -> system.disposition
    aura = "All",
    // statuses -> move to statuses
    statuses = [],
    // wildcard -> move to customCheck
    wildcard = false,
    // extra -> move to customCheck
    extra = false,
    // hidden -> hmm (don't show/work while hidden)
    hidden = true,
    // displayTemp -> remove
    // height -> remove
    // hostile -> hmm (only go on turn of combatant)
    // onlyOnce -> remove
    // isMacro -> remove
    // time -> remove
    // Paused -> remove
  } = oldEffect.flags.ActiveAuras;
  const oldEffectData = oldEffect.toObject();
  const diffEffectData = {
    _id: oldEffect.id
  };
  diffEffectData.statuses = Array.from(new Set(oldEffectData.statuses.concat(statuses)));
  if (isAura) {
    let newCustomCheck = customCheck.trim()
      .replaceAll("sourceToken", "sourceTokenOld")
      .replaceAll("auraEntity", "sourceToken");
    let alreadyTouchedCheck = false;
    if (alignment) {
      alreadyTouchedCheck = true;
      if (newCustomCheck.length) {
        newCustomCheck = `(${newCustomCheck}) && `;
      }
      newCustomCheck += `(actor.system.details?.alignment?.toLowerCase().includes("${alignment.toLowerCase()}"))`;
    }
    if (type) {
      const allowedIds = ["dnd5e", "swade", "dnd4e"];
      if (allowedIds.includes(game.system.id)) {
        if (newCustomCheck.length) {
          if (!alreadyTouchedCheck) newCustomCheck = `(${newCustomCheck})`;
          newCustomCheck += " && ";
        }
        if (game.system.id === "dnd5e") {
          newCustomCheck += `(Object.values(actor.system.details.type).concat(actor.system.details.race?.name).some(type => "${type.toLowerCase()}".split(";").filter(t => t).includes(type?.toLowerCase())))`;
        } else if (game.system.id === "swade") {
          newCustomCheck += `("${type.toLowerCase()}".split(";").filter(t => t).includes(actor.system.details.species?.name?.toLowerCase()))`;
        } else if (game.system.id === "dnd4e") {
          newCustomCheck += `([actor.system.details.type, actor.system.details.other, actor.system.details.origin].some(type => "${type.toLowerCase}".split(";").filter(t => t).includes(type?.toLowerCase())))`;
        }
      }
    }
    if (game.system.id === "swade") {
      if ((!wildcard || !extra) && (wildcard !== extra)) {
        if (newCustomCheck.length) {
          if (!alreadyTouchedCheck) newCustomCheck = `(${newCustomCheck})`;
          newCustomCheck += " && ";
        }
        newCustomCheck += `(${wildcard ? "" : "!"}actor.isWildcard)`;
      }
    }
    diffEffectData.type = "auraeffects.aura";
    diffEffectData.system = _replace({
      applyToSelf: !ignoreSelf,
      collisionType: wallsBlock === "system"
        ? oldSettings.wallsBlock?.[0]
        : wallsBlock === "true"
          ? "move"
          : "",
      disableOnHidden: hidden,
      distanceFormula: radius,
      disposition: aura === "All"
        ? DISPOSITIONS.ANY 
        : aura === "Allies"
          ? DISPOSITIONS.FRIENDLY
          : DISPOSITIONS.HOSTILE,
      evaluatePreApply: true,
      overrideName: nameOverride,
      script: newCustomCheck,
    });
    diffEffectData["flags.ActiveAuras"] = _del;
  } else if (applied) {
    diffEffectData["flags.ActiveAuras"] = _replace({ fromAura: true });
  }
  return diffEffectData;
}

export const api = {
  migrateActiveAuras
}