/** @import { ActiveEffect, Actor, Scene, TokenDocument } from "@client/documents/_module.mjs" */
/** @import { RegionData } from "@common/documents/_types.mjs" */

/**
 * Execute the script on an aura active effect for a given token, returning whether said token should receive
 * the effect or not
 * @param {TokenDocument} sourceToken   The aura-emanating token
 * @param {TokenDocument} token         The potential aura effect recipient token
 * @param {ActiveEffect} effect         The aura effect in question
 * @returns {boolean}                   true if effect should be applied, false if not
 */
function executeScript(sourceToken, token, effect) {
  const actor = token.actor;
  const rollData = actor.getRollData();
  const script = effect.system.script ?? "";
  if (!script?.trim()?.length) return true;
  const toEvaluate = Function("actor", "token", "sourceToken", "rollData", `return Boolean(${script});`);
  try {
    return toEvaluate.call(toEvaluate, actor, token.object, sourceToken.object, rollData);
  } catch (error) {
    console.error(_loc("AURAEFFECTS.Errors.ScriptError", {
      actor: sourceToken.actor.name,
      effect: effect.name,
      error
    }));
    return true;
  }
}

/**
 * Get all "source" aura effects on a given actor, split into inactive & active
 * @param {Actor} actor                         The actor to check
 * @returns {[ActiveEffect[], ActiveEffect[]]}  The Arrays of aura effects (active, then inactive)
 */
function getAllAuraEffects(actor) {
  const activeAuras = [];
  const inactiveAuras = [];
  if (!actor) console.warn("Aura Effects: Actorless tokens are not supported and will be ignored.");
  for (const effect of actor?.allApplicableEffects() ?? []) {
    if (effect.type !== "auraeffects.aura") continue;
    if (!effect.disabled && !effect.isSuppressed) activeAuras.push(effect);
    else inactiveAuras.push(effect);
  }
  return [activeAuras, inactiveAuras];
}

/**
 * Get all aura-providing regions that a token is currently within
 * @param {TokenDocument} token
 * @returns {Set<RegionDocument>} 
 */
function getAuraRegions(token) {
  return token.regions.filter(r => (r.attachment.token !== token) && (r.getFlag("auraeffects", "origin")));
}

/**
 * Returns whether the provided aura effect should apply to the provided token
 * @param {ActiveEffect} effect 
 * @param {TokenDocument} token 
 */
function auraShouldApply(effect, token) {
  // Actorless or sceneless token
  if (!token.actor || !token.parent) return false;
  // Not in range
  if (!getAuraRegions(token).find(r => r.getFlag("auraeffects", "origin") === effect.uuid)) return false;
  // Somehow despite being in range, no source token
  const sourceToken = token.parent.tokens.find(t => t.actor === effect.actor);
  if (!sourceToken) return false;
  // Disposition doesn't match
  const disposition = token.disposition * sourceToken.disposition;
  if (![0, disposition].includes(effect.system.disposition)) return false;
  // Script doesn't pass
  if (!executeScript(sourceToken, token, effect)) return false;
  // All good
  return true;
}

/**
 * Remove specified auras, ensuring that any non-stacking auras perform a search for the "next-best"
 * and apply it, if present
 * @param {ActiveEffect[]} effects  The effects which will be removed
 * @param {Scene} scene             The scene on which to perform any necessary logic
 */
async function removeAndReplaceAuras(effects, scene) {
  const activeGM = game.users.activeGM;

  // Get map of effect name -> tokens removed from (only for non-stacking effects)
  const effectToRemovedMap = effects.reduce((acc, effect) => {
    if (!effect) return acc;
    acc[effect.name] ??= [];
    acc[effect.name].push(...effect.parent.getActiveTokens(false, true));
    return acc;
  }, {});

  // Remove effects
  if (effects) await activeGM.query("auraeffects.deleteEffects", { effectUuids: effects.map(e => e.uuid) });

  // Get all on-scene aura sources for the effects just deleted, sort by best, apply to tokens as possible
  const newBestApplyMap = {};
  function getSourceEffect(token, effectName) {
    return token.actor.appliedEffects.find(e => (e.type === "auraeffects.aura") && ((e.system.overrideName.trim() || e.name) === effectName));
  }
  Object.keys(effectToRemovedMap).forEach(effectName => {
    const allEmitting = scene.tokens.filter(t => getAllAuraEffects(t.actor)[0].some(e => (e.system.overrideName.trim() || e.name) === effectName));
    allEmitting.sort((a, b) => {
      const effectA = getSourceEffect(a, effectName);
      const effectB = getSourceEffect(b, effectName);
      if (!effectA) return 1;
      if (!effectB) return -1;
      const bestFormulaA = effectA.system.bestFormula?.trim();
      const bestFormulaB = effectB.system.bestFormula?.trim();
      if (!bestFormulaA) return 1;
      if (!bestFormulaB) return -1;
      const totalA = new Roll(bestFormulaA, a.actor.getRollData()).evaluateSync().total;
      const totalB = new Roll(bestFormulaB, b.actor.getRollData()).evaluateSync().total;
      return totalB - totalA;
    });

    for (const targetToken of effectToRemovedMap[effectName]) {
      for (const sourceToken of allEmitting) {
        const effect = getSourceEffect(sourceToken, effectName);
        if (!effect) continue;
        if (!getAuraRegions(targetToken).find(r => r.getFlag("auraeffects", "origin") === effect.uuid)) continue;
        if (!executeScript(sourceToken, targetToken, effect) || (!effect.system.applyToSelf && (sourceToken === targetToken))) continue;
        newBestApplyMap[targetToken.actor.uuid] ??= [];
        newBestApplyMap[targetToken.actor.uuid].push(effect.uuid);
        break;
      }
    }
  });
  if (!foundry.utils.isEmpty(newBestApplyMap)) return activeGM.query("auraeffects.applyAuraEffects", newBestApplyMap);
}

/**
 * Insert the new "aura" tab's Handlebars template part into an existing object of PARTS, for use when
 * extending an existing AE Config Sheet
 * @param {Record<string, HandlebarsTemplatePart} origParts     The application's original PARTS
 * @returns {Record<string, HandlebarsTemplatePart>}            The extended PARTS
 */
function getExtendedParts(origParts) {
  return Object.fromEntries(Object.entries(origParts).toSpliced(-1, 0, ["aura", { template: "modules/auraeffects/templates/auraConfig.hbs" }]));
}

/**
 * Add the new "aura" tab to an existing TABS object, for use when extending an existing AE Config Sheet
 * @param {Record<string, ApplicationTabsConfiguration>} origTabs   The application's original TABS
 * @returns {Record <string, ApplicationTabsConfiguration>}         The extended TABS
 */
function getExtendedTabs(origTabs) {
  return {
    sheet: {
      ...origTabs.sheet,
      tabs: [
        ...origTabs.sheet.tabs,
        { id: "aura", icon: "fa-solid fa-person-rays" }
      ]
    }
  };
}

/**
 * Create or delete all token-attached regions as necessary
 * @param {TokenDocument} token         A specified token document
 */
async function updateAllAuraRegions(token) {
  if (!token.actor) return;
  const [activeSourceEffects] = getAllAuraEffects(token.actor);
  const attachedAuraRegions = Array.from(token.attachments.regions.filter(r => r.getFlag("auraeffects", "origin")));
  const shouldHaveUuids = new Set(activeSourceEffects.map(e => e.uuid));
  const toDelete = attachedAuraRegions.filter(r => !shouldHaveUuids.has(r.flags.auraeffects.origin)).map(r => r.id);
  const toCreate = [];
  const toUpdate = [];
  for (const effect of activeSourceEffects) {
    const existingRegion = attachedAuraRegions.find(r => r.getFlag("auraeffects", "origin") === effect.uuid);
    if (!existingRegion) toCreate.push(getRegionDataFromEffect(effect, token));
    else {
      const updateData = {_id: existingRegion.id, ...getRegionDataFromEffect(effect, token)};
      toUpdate.push(updateData);
    }
  }
  await game.users.activeGM.query("auraeffects.updateRegionsForToken", { tokenUuid: token.uuid, toCreate, toUpdate, toDelete });
  const updatedIds = new Set(toUpdate.map(r => r._id));
  const toRemove = [];
  const toAdd = {};
  for (const region of attachedAuraRegions) {
    if (!updatedIds.has(region.id)) continue;
    const sourceEffect = fromUuidSync(region.getFlag("auraeffects", "origin"));
    for (const currToken of region.tokens) {
      if (!currToken.actor) continue;
      const currAppliedEffect = currToken.actor.effects.find(e => e.origin === sourceEffect.uuid);
      if (currAppliedEffect) {
        if (!auraShouldApply(sourceEffect, currToken)) toRemove.push(currAppliedEffect);
      } else {
        if (auraShouldApply(sourceEffect, currToken)) toAdd[currToken.actor.uuid] = [sourceEffect.uuid]
      }
    }
  }
  if (toRemove.length) await removeAndReplaceAuras(toRemove, token.parent);
  if (!foundry.utils.isEmpty(toAdd)) await game.users.activeGM.query("auraeffects.applyAuraEffects", toAdd);
}

/**
 * Ensure all applied auras shouldn't be removed, and all non-applied auras shouldn't be applied
 * @param {TokenDocument} token 
 */
// TODO: Any way to keep this from always toggling between effects if prefer recent is on & both require conditionals?
async function refreshConditionalAuras(token) {
  if (!token.actor) return;
  const toRemove = [];
  const toAdd = [];
  for (const region of getAuraRegions(token)) {
    const sourceEffect = fromUuidSync(region.getFlag("auraeffects", "origin"));
    if (!sourceEffect?.system.script.length) continue;
    const existingEffect = token.actor.effects.find(e => e.origin === sourceEffect.uuid);
    const shouldApply = auraShouldApply(sourceEffect, token);
    if (existingEffect && !shouldApply) toRemove.push(existingEffect);
    else if (!existingEffect && shouldApply) toAdd.push(sourceEffect.uuid);
  }
  if (toRemove.length) await removeAndReplaceAuras(toRemove, token.parent);
  if (toAdd.length) await game.users.activeGM.query("auraeffects.applyAuraEffects", {[token.actor.uuid]: toAdd});
}

/**
 * Get region creation data from an aura effect and a given token
 * @param {ActiveEffect} effect 
 * @param {TokenDocument} token
 * @returns {RegionData}
 */
function getRegionDataFromEffect(effect, token) {
  if (effect.type !== "auraeffects.aura") return {};
  const tokenOwner = game.users.getDesignatedUser(u => u.character === token.actor) ?? game.users.activeGM
  const restriction = {enabled: false};
  if (effect.system.collisionType.length) {
    restriction.enabled = true;
    restriction.type = effect.system.collisionType;
  }
  const regionData = {
    attachment: {
      token: token.id
    },
    color: (effect.system.color ?? tokenOwner?.color)?.css,
    displayMeasurements: false,
    flags: {
      "auraeffects.origin": effect.uuid
    },
    highlightMode: game.settings.get("auraeffects", "highlightMode"),
    levels: [token.level],
    locked: true,
    name: effect.name,
    restriction,
    shapes: [{
      type: "emanation",
      base: {
        type: "token",
        x: token._source.x,
        y: token._source.y,
        width: token._source.width,
        height: token._source.height,
        shape: token._source.shape
      },
      gridBased: true,
      hole: false,
      radius: token.parent.dimensions.distancePixels * effect.system.distance
    }],
    visibility: effect.system.showRadius ? CONST.REGION_VISIBILITY.ALWAYS : CONST.REGION_VISIBILITY.LAYER_UNLOCKED
  };
  return regionData;
}

export {
  getAllAuraEffects,
  getAuraRegions,
  getExtendedParts,
  getExtendedTabs,
  executeScript,
  removeAndReplaceAuras,
  updateAllAuraRegions,
  getRegionDataFromEffect,
  refreshConditionalAuras,
  auraShouldApply
};