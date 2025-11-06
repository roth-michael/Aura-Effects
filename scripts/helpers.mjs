/** @import { ActiveEffect, Actor, Scene, TokenDocument } from "@client/documents/_module.mjs" */
/** @import { Token } from "@client/canvas/placeables/_module.mjs" */
/** @import { ElevatedPoint } from "@common/_types.mjs" */
/** @import { TokenPosition } from "@common/documents/_types.mjs" */

/**
 * Get 3D distance in grid units, returning Infinity if any provided collision types would block the ray
 * @param {Scene} scene                         The scene to measure on
 * @param {ElevatedPoint} a                     First Point
 * @param {ElevatedPoint} b                     Second Point
 * @param {Object} options                      Additional options
 * @param {string[]} options.collisionTypes     Which collision types should result in infinite distance
 * @returns {number}                            The distance
 */
function getDistance(scene, a, b, { collisionTypes }) {
  for (const collisionType of collisionTypes) {
    if (CONFIG.Canvas.polygonBackends[collisionType]?.testCollision(a, b, {
      type: collisionType,
      mode: "any"
    })) return Infinity;
  }
  return scene.grid.measurePath([a, b]).distance;
}

/**
 * Get minimum 3D distance from one token to another
 * @param {TokenDocument} tokenA                First Token
 * @param {TokenDocument} tokenB                Second Token
 * @param {Object} options                      Additional options
 * @param {TokenPosition} options.origin        The origin of the source token's movement, if different from its actual position
 * @param {string[]} options.collisionTypes     Which collision types should result in Infinity distance
 * @returns {number}                            The minimum distance
 */
function getTokenToTokenDistance(tokenA, tokenB, { origin = {}, collisionTypes = [] }) {
  const scene = tokenA.parent;
  // TODO: Similar lenience with gridless as gridded?
  const tokenAOffsets = scene.grid.isGridless
    ? [tokenA.getCenterPoint(origin)]
    : tokenA.getOccupiedGridSpaceOffsets(origin);
  const tokenBOffsets = scene.grid.isGridless
    ? [tokenB.getCenterPoint()]
    : tokenB.getOccupiedGridSpaceOffsets();
  // TODO: Perhaps proper elevation ranges
  const tokenAElevation = origin.elevation ?? tokenA.elevation ?? 0;
  const tokenBElevation = tokenB.elevation ?? 0;
  // TODO: Maybe filter down comparisons instead of full 2D array
  const distances = [];
  for (const offsetA of tokenAOffsets) {
    for (const offsetB of tokenBOffsets) {
      const pointA = { ...scene.grid.getCenterPoint(offsetA), elevation: tokenAElevation };
      const pointB = { ...scene.grid.getCenterPoint(offsetB), elevation: tokenBElevation };
      distances.push(getDistance(scene, pointA, pointB, { collisionTypes }));
    }
  }
  const externalAdjust = (scene.grid.distance / scene.grid.size) * (scene.grid.isGridless
    ? tokenA.object.externalRadius
    : 0);
  return Math.min(...distances) - externalAdjust;
}

/**
 * Get a putative set of Tokens which MAY be within the specified radius of the source token
 * @param {TokenDocument} sourceToken   The source token from which to measure
 * @param {number} radius               The radius of the grid-based circle to estimate
 * @returns {Set<Token>}                A set of Tokens which MAY be within range (necessarily containing the subset of Tokens which ARE within range)
 */
function getGenerallyWithin(sourceToken, radius) {
  const adjustedRadius = sourceToken.parent.grid.size * ((radius / sourceToken.parent.grid.distance) + sourceToken.width / 2);
  const center = sourceToken.object.center;
  const rect = new PIXI.Rectangle(center.x - adjustedRadius, center.y - adjustedRadius, 2 * adjustedRadius, 2 * adjustedRadius);
  return sourceToken.layer.quadtree.getObjects(rect);
}

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
    console.error(game.i18n.format("AURAEFFECTS.Errors.ScriptError", {
      actor: sourceToken.actor.name,
      effect: effect.name,
      error
    }));
    return true;
  }
}

/**
 * Get all tokens within a certain range of the source token
 * @param {TokenDocument} source                        The source token from which to measure
 * @param {number} radius                               The radius of the grid-based circle to measure
 * @param {Object} options                              Additional options
 * @param {TokenPosition|undefined} options.origin      The origin of the source token's movement, if different from its actual position
 * @param {-1|0|1} options.disposition                  The relative disposition of token that should be considered (-1 for hostile, 0 for all, 1 for friendly)
 * @param {string[]|undefined} options.collisionTypes   Which collision types should result in Infinity distance
 * @returns {TokenDocument[]}                           The TokenDocuments within range
 */
function getNearbyTokens(source, radius, { origin, disposition = 0, collisionTypes }) {
  const putativeTokens = Array.from(getGenerallyWithin(source, radius))
    .map(t => t.document)
    .filter(t => {
      if (!t.actor) return false;
      if (disposition < 0) return (source.disposition * t.disposition) === -1;
      if (disposition > 0) return (source.disposition === t.disposition);
      return true;
    });
  return putativeTokens.filter(token => getTokenToTokenDistance(source, token, { origin, collisionTypes }) <= radius);
}

/**
 * Determine whether a token has no further movement queued (or the game has been paused mid-movement)
 * @param {TokenDocument} token     The token to check
 * @returns {boolean}               true if final movement is complete, else false
 */
function isFinalMovementComplete(token) {
  return (token.movement.state === "stopped") || (
    !token.movement.pending?.distance
    && token.movement.destination.x === token.x
    && token.movement.destination.y === token.y
    && token.movement.destination.elevation === token.elevation
  );
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
 * Determine a list of auras on-scene which should be removed from, and which should be added to, a token
 * @param {TokenDocument} token                 The token which should be having auras added/removed from it
 * @returns {[ActiveEffect[], ActiveEffect[]]}  The Arrays of aura effects (to remove, then to add)
 */
function getChangingSceneAuras(token) {
  const currentAppliedAuras = token.actor.appliedEffects.filter(i => i.flags?.auraeffects?.fromAura);
  // Get all aura source effects on the scene, split into "actor shouldn't have" and "actor should have"
  const [sceneAurasToRemove, sceneAurasToAdd] = token.parent.tokens.reduce(([toRemove, toAdd], sourceToken) => {
    if (sourceToken.actor === token.actor) return [toRemove, toAdd];
    // -1 if enemies, 0 if at least one is neutral, 1 if allied
    // TODO: account for secret? Should secret be treated as hostile, friendly, or neutral?
    // Currently is -2, 0, or 2, so will only really work with "any"
    const disposition = token.disposition * sourceToken.disposition;
    const [activeAuraEffects, inactiveAuraEffects] = getAllAuraEffects(sourceToken.actor);
    const currentlyAppliedToRemove = currentAppliedAuras.filter(appliedEffect => inactiveAuraEffects.some(inactiveEffect => appliedEffect.origin === inactiveEffect.uuid));
    if (inactiveAuraEffects.length) toRemove.push(...currentlyAppliedToRemove);
    const auraEffects = activeAuraEffects
      .filter(e => [0, disposition].includes(e.system.disposition));
    if (!auraEffects.length) return [toRemove, toAdd];

    for (const currEffect of auraEffects) {
      const distance = getTokenToTokenDistance(sourceToken, token, { collisionTypes: currEffect.system.collisionTypes });
      const currentlyApplied = currentAppliedAuras.find(e => e.origin === currEffect.uuid);
      if ((currEffect.system.distance < distance) || !executeScript(sourceToken, token, currEffect)) {
        if (currentlyApplied) toRemove.push(currentlyApplied);
      } else toAdd.push(currEffect);
    }

    // TODO: Can I do this clever thing and still handle the proper collision checks? 
    // Would prefer not to repeat distance checks unnecessarily
    // const distance = getTokenToTokenDistance(token, sourceToken);
    // toRemove.push(...auraEffects.filter(e => e.system.distance < distance));
    // toAdd.push(...auraEffects.filter(e => e.system.distance >= distance));
    return [toRemove, toAdd]
  }, [[], []]);

  for (const effect of token.actor.appliedEffects) {
    if (!effect.flags?.auraeffects?.fromAura) continue;
    const sourceEffect = fromUuidSync(effect.origin);
    if (!sourceEffect || sourceEffect.disabled || sourceEffect.isSuppressed) sceneAurasToRemove.push(effect);
  }
  return [sceneAurasToRemove, sceneAurasToAdd]
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
        const distance = getTokenToTokenDistance(sourceToken, targetToken, { collisionTypes: effect.system.collisionTypes });
        if ((effect.system.distance < distance) || !executeScript(sourceToken, targetToken, effect) || (!effect.system.applyToSelf && (sourceToken === targetToken))) continue;
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

export {
  getNearbyTokens,
  getTokenToTokenDistance,
  isFinalMovementComplete,
  getAllAuraEffects,
  getExtendedParts,
  getExtendedTabs,
  executeScript,
  removeAndReplaceAuras,
  getChangingSceneAuras
};