import AuraActiveEffectData from "./AuraActiveEffectData.mjs";
import AuraActiveEffectSheetMixin from "./AuraActiveEffectSheet.mjs";
import { executeScript, getAllAuraEffects, getChangingSceneAuras, getNearbyTokens, getTokenToTokenDistance, isFinalMovementComplete, removeAndReplaceAuras } from "./helpers.mjs";
import { applyAuraEffects, deleteEffects } from "./queries.mjs";
import { registerSettings } from "./settings.mjs";
import { canvasInit, destroyToken, drawGridLayer, drawToken, refreshToken, updateAllVisualizations, updateTokenVisualization } from "./auraVisualization.mjs";
import { migrate } from "./migrations.mjs";
import { api } from "./api.mjs";

/** @import { ActiveEffect, TokenDocument, User } from "@client/documents/_module.mjs"; */
/** @import { TokenMovementOperation } from "@client/documents/_types.mjs" */

// Track whether the "with no GM this no work" warning has been seen
let seenWarning = false;

/**
 * Provided the arguments for the createActiveEffect or deleteActiveEffect hooks, check whether any updates should
 * cause a change in auras and applies those changes
 * @param {ActiveEffect} effect   The effect being created or deleted
 * @param {Object} options        Additional options
 * @param {String} userId         The initiating User's ID
 */
async function addRemoveEffect(effect, options, userId) {
  if (!effect.modifiesActor || !(effect.target instanceof Actor)) return;
  // Avoid calling this every time we add/remove an aura effect. Might miss some weird conditionals, but saves time
  if (foundry.utils.getProperty(effect, 'flags.auraeffects.fromAura')) return;
  // Exit early for non-initiators or if no active GM
  if (game.user.id !== userId) return;
  const activeGM = game.users.activeGM;
  if (!activeGM) {
    if (!seenWarning) {
      ui.notifications.warn("AURAEFFECTS.NoActiveGM", { localize: true });
      seenWarning = true;
    }
    return;
  }
  const [activeSourceEffects, inactiveSourceEffects] = getAllAuraEffects(effect.target);
  const [mainToken] = effect.target.getActiveTokens(false, true);
  if (!mainToken) return;

  // Handle source effect condition re-evaluation, or just first-time evaluation
  const actorToEffectsMap = {};
  const toDelete = [];
  for (const sourceEffect of activeSourceEffects) {
    const { distance: radius, disposition, collisionTypes } = sourceEffect.system;
    await sourceEffect.prepareData();
    const nearby = getNearbyTokens(mainToken, radius, { disposition, collisionTypes });
    if (!nearby.length) continue;
    const shouldHave = nearby.filter(t => t !== mainToken && executeScript(mainToken, t, sourceEffect));
    const toAddTo = shouldHave
      .map(t => t.actor)
      .filter(a => !a?.effects.find(e => e.origin === sourceEffect.uuid))
      .map(a => a.uuid);
    for (const actorUuid of toAddTo) {
      actorToEffectsMap[actorUuid] = (actorToEffectsMap[actorUuid] ?? []).concat(sourceEffect.uuid);
    }
    const shouldNotHave = nearby.filter(t => !shouldHave.includes(t));
    for (const currToken of shouldNotHave) {
      const badEffect = currToken.actor.effects.find(e => e.origin === sourceEffect.uuid);
      if (badEffect) toDelete.push(badEffect);
    }
  }

  // Handle effects which currently target the token re-evaluating
  const [sceneAurasToRemove, sceneAurasToAdd] = getChangingSceneAuras(mainToken);

  // Remove effects actor shouldn't have, add effects actor should have (if final segment of token's movement)
  if (sceneAurasToRemove.length) toDelete.push(...sceneAurasToRemove);
  for (const addEffect of sceneAurasToAdd) {
    if (addEffect.uuid === effect.origin) continue;
    actorToEffectsMap[mainToken.actor.uuid] = (actorToEffectsMap[mainToken.actor.uuid] ?? []).concat(addEffect.uuid);
  }

  if (!foundry.utils.isEmpty(actorToEffectsMap)) await activeGM.query("auraeffects.applyAuraEffects", actorToEffectsMap);
  if (toDelete) await removeAndReplaceAuras(toDelete, mainToken.parent);
}


/**
 * Provided the arguments for the createToken hook, checks whether any auras should be applied & applies if so
 * @param {TokenDocument} token   The token being created
 * @param {Object} options        Additional options
 * @param {String} userId         The initiating User's ID
 */
async function createToken(token, options, userId) {
  // Exit early for non-initiators, or if no active GM
  if (game.user.id !== userId) return;
  const activeGM = game.users.activeGM;
  if (!activeGM) {
    if (!seenWarning) {
      ui.notifications.warn("AURAEFFECTS.NoActiveGM", { localize: true });
      seenWarning = true;
    }
    return;
  }
  if (!token.actor) return;
  const [activeSourceEffects] = getAllAuraEffects(token.actor);
  const actorToEffectsMap = {};
  for (const effect of activeSourceEffects) {
    const { distance: radius, disposition, collisionTypes } = effect.system;
    if (!radius) continue;
    const inRange = new Set(
      getNearbyTokens(token, radius, { disposition, collisionTypes })
      .filter(t => executeScript(token, t, effect))
      .map(t => t.actor)
    );
    const toAddTo = Array.from(inRange.filter(a => (a !== token.actor) && !a?.effects.find(e => e.origin === effect.uuid))).map(a => a?.uuid);
    for (const actorUuid of toAddTo) {
      actorToEffectsMap[actorUuid] = (actorToEffectsMap[actorUuid] ?? []).concat(effect.uuid);
    }
  }
  if (!foundry.utils.isEmpty(actorToEffectsMap)) await activeGM.query("auraeffects.applyAuraEffects", actorToEffectsMap);
}

/**
 * Provided the arguments for the deleteToken hook, removes any auras originating from the deleted token
 * @param {TokenDocument} token   The token being deleted
 * @param {Object} options        Additional options
 * @param {String} userId         The initiating User's ID
 */
async function deleteToken(token, options, userId) {
  if (game.user.id !== userId) return;
  if (!canvas.scene) return;
  const actor = token.actor;
  if (!actor) return;
  const activeGM = game.users.activeGM;
  if (!activeGM) {
    if (!seenWarning) {
      ui.notifications.warn("AURAEFFECTS.NoActiveGM", { localize: true });
      seenWarning = true;
    }
    return;
  }
  const [activeSourceEffects] = getAllAuraEffects(actor);
  const auraSourceUuids = activeSourceEffects.map(e => e.uuid);
  const toRemoveAppliedEffects = canvas.scene.tokens
    .filter(t => t.actor && (t.actor !== actor))
    .flatMap(t => t.actor.appliedEffects)
    .filter(e => e.flags?.auraeffects?.fromAura && auraSourceUuids.includes(e.origin));
  await removeAndReplaceAuras(toRemoveAppliedEffects, canvas.scene);
}

/**
 * Provided the arguments for the updateToken hook, checks whether any updates should cause a change in
 * auras (e.g. a token becoming hidden or un-hidden) and applies those changes
 * @param {TokenDocument} token     The token being updated
 * @param {Object} updates          The updates
 * @param {Object} options          Additional options
 * @param {string} userId           The initiating User's ID
 */
async function updateToken(token, updates, options, userId) {
  updateTokenVisualization(token, updates);
  // Exit early for non-initiators, or if no active GM
  if (game.user.id !== userId) return;
  const activeGM = game.users.activeGM;
  if (!activeGM) {
    if (!seenWarning) {
      ui.notifications.warn("AURAEFFECTS.NoActiveGM", { localize: true });
      seenWarning = true;
    }
    return;
  }
  if (!token.actor) return;
  const [activeSourceEffects, inactiveSourceEffects] = getAllAuraEffects(token.actor);
  // Handle anything that should happen regardless of whether there is movement
  if (updates.hidden) {
    const toRemoveSourceEffects = inactiveSourceEffects.filter(e => e.system.disableOnHidden);
    const toRemoveAppliedEffects = canvas.scene.tokens
      .filter(t => t.actor && (t !== token))
      .flatMap(t => t.actor.appliedEffects)
      .filter(e => e.flags?.auraeffects?.fromAura && toRemoveSourceEffects.some(sourceEff => e.origin === sourceEff.uuid));
    if (toRemoveAppliedEffects.length) await removeAndReplaceAuras(toRemoveAppliedEffects, token.parent);
  }
  if (("x" in updates) || ("y" in updates) || ("elevation" in updates)) return;
  // Handle things that would have already been handled if this was a movement update
  if (updates.hidden === false) {
    const actorToEffectsMap = {};
    for (const effect of activeSourceEffects) {
      const { distance: radius, disposition, collisionTypes } = effect.system;
      if (!radius) continue;
      const inRange = new Set(
        getNearbyTokens(token, radius, { disposition, collisionTypes })
        .filter(t => executeScript(token, t, effect))
        .map(t => t.actor)
      );
      const toAddTo = Array.from(inRange.filter(a => (a !== token.actor) && !a?.effects.find(e => e.origin === effect.uuid))).map(a => a?.uuid);
      for (const actorUuid of toAddTo) {
        actorToEffectsMap[actorUuid] = (actorToEffectsMap[actorUuid] ?? []).concat(effect.uuid);
      }
    }
    if (!foundry.utils.isEmpty(actorToEffectsMap)) await activeGM.query("auraeffects.applyAuraEffects", actorToEffectsMap);
  }
}

/**
 * Provided the arguments for the moveToken hook, checks if any effects on the token are aura source effects
 * and, if so, removes/adds to nearby tokens as necessary. Also checks if moving should remove non-source aura
 * effects (or add them) and does so if necessary.

 * @param {TokenDocument} token                 The existing TokenDocument which was updated
 * @param {TokenMovementOperation} movement     The movement of the Token
 * @param {DatabaseUpdateOperation} operation   The update operation that contains the movement
 * @param {User} user                           The User that requested the update operation
 */
async function moveToken(token, movement, operation, user) {
  // Exit early for non-initiators, if no active GM, or if non-movement update
  if (game.user !== user) return;
  const activeGM = game.users.activeGM;
  if (!activeGM) {
    if (!seenWarning) {
      ui.notifications.warn("AURAEFFECTS.NoActiveGM", { localize: true });
      seenWarning = true;
    }
    return;
  }
  if (!token.actor) return;
  const [activeSourceEffects, inactiveSourceEffects] = getAllAuraEffects(token.actor);
  const inactiveUuids = inactiveSourceEffects.map(e => e.uuid);

  // Get start-of-movement in-range tokens for each aura source effect
  const preMoveRanges = {};
  for (const effect of activeSourceEffects) {
    const { distance: radius, disposition, collisionTypes } = effect.system;
    if (!radius) continue;
    preMoveRanges[effect.uuid] = new Set(getNearbyTokens(token, radius, { origin: movement.origin, disposition, collisionTypes }).map(t => t.actor));
  }
  await token.object.movementAnimationPromise;

  // Get end-of-movement in-range tokens for each aura source effect, removing effects which should be removed,
  // adding effects which should be added IF this is the final segment of movement
  const actorToEffectsMap = {};
  for (const effect of activeSourceEffects) {
    const { distance: radius, disposition, collisionTypes } = effect.system;
    if (!radius) continue;
    const preMoveRange = preMoveRanges[effect.uuid];
    const postMoveRange = new Set(
      getNearbyTokens(token, radius, { disposition, collisionTypes })
      .filter(t => executeScript(token, t, effect))
      .map(t => t.actor)
    );
    const toDelete = Array.from(preMoveRange.difference(postMoveRange)).map(a => a.effects.find(e => e.origin === effect.uuid));

    // Grab any lingering effects from now-inactive auras, too
    const additionalDeletion = token.parent.tokens.map(t => t.actor?.appliedEffects.filter(e => inactiveUuids.includes(e.origin)) ?? []).flat();

    await removeAndReplaceAuras(toDelete.concat(additionalDeletion).filter(e => e), token.parent);

    if (isFinalMovementComplete(token)) {
      const toAddTo = Array.from(postMoveRange.filter(a => (a !== token.actor) && !a?.effects.find(e => e.origin === effect.uuid))).map(a => a?.uuid);
      for (const actorUuid of toAddTo) {
        actorToEffectsMap[actorUuid] = (actorToEffectsMap[actorUuid] ?? []).concat(effect.uuid);
      }
    }
  }
  if (isFinalMovementComplete(token)) {
    if (!foundry.utils.isEmpty(actorToEffectsMap)) await activeGM.query("auraeffects.applyAuraEffects", actorToEffectsMap);
  }

  const [sceneAurasToRemove, sceneAurasToAdd] = getChangingSceneAuras(token);

  // Remove effects actor shouldn't have, add effects actor should have (if final segment of token's movement)
  if (sceneAurasToRemove.length) await removeAndReplaceAuras(sceneAurasToRemove, token.parent);
  if (sceneAurasToAdd.length && isFinalMovementComplete(token)) await activeGM.query("auraeffects.applyAuraEffects", {
    [token.actor.uuid]: sceneAurasToAdd.map(e => e.uuid)
  });
}

/**
 * Provided the arguments for the updateActiveEffect hook, removes any child effects on the scene for a source
 * aura effect, or adds to the proper tokens, depending on whether the effect was enabled or disabled
 * @param {ActiveEffect} effect     The effect being updated
 * @param {Object} updates          The updates
 * @param {Object} options          Additional options
 * @param {String} userId           The initiating User's ID
 */
async function updateActiveEffect(effect, updates, options, userId) {
  if (game.user.id !== userId) return;
  if (effect.type !== "auraeffects.aura") return;
  if (!updates.hasOwnProperty("disabled") && !updates.hasOwnProperty("system")) return;
  if (!canvas.scene) return;
  const actor = (effect.parent instanceof Actor) ? effect.parent : effect.parent?.parent;
  const [token] = actor?.getActiveTokens(false, true) ?? [];
  if (!token) return;
  const activeGM = game.users.activeGM;
  if (!activeGM) {
    if (!seenWarning) {
      ui.notifications.warn("AURAEFFECTS.NoActiveGM", { localize: true });
      seenWarning = true;
    }
    return;
  }

  // Since this change either disabled the effect or modified its parameters, get all currently-applied effects
  let toRemoveAppliedEffects = canvas.scene.tokens
    .filter(t => t.actor && (t.actor !== actor))
    .flatMap(t => t.actor.appliedEffects)
    .filter(e => e.flags?.auraeffects?.fromAura && e.origin === effect.uuid);

  if (!updates.disabled) {
    // TODO: Maybe refactor this logic so that it can be utilized in the main updateToken function
    const { distance: radius, disposition, collisionTypes } = effect.system;
    if (!radius) return;
    const tokensInRange = getNearbyTokens(token, radius, { disposition, collisionTypes }).filter(t => t !== token && t.actor !== token.actor);
    const shouldHave = tokensInRange.filter(t => executeScript(token, t, effect)).map(t => t.actor);
    
    // Remove the "to delete" effects which should actually exist
    toRemoveAppliedEffects = toRemoveAppliedEffects.filter(e => !shouldHave.includes(e.target));

    // Don't try to apply the effect if already applied
    const toAddTo = shouldHave.filter(a => !a.effects.find(e => e.origin === effect.uuid));
    const actorToEffectsMap = Object.fromEntries(toAddTo.map(a => [a.uuid, [effect.uuid]]));
    if (!foundry.utils.isEmpty(actorToEffectsMap)) await activeGM.query("auraeffects.applyAuraEffects", actorToEffectsMap);
  }
  if (toRemoveAppliedEffects.length) await removeAndReplaceAuras(toRemoveAppliedEffects, canvas.scene);
}

/**
 * Provided the arguments for the deleteActiveEffect hook, removes any child effects on the scene for a deleted
 * source aura effect
 * @param {ActiveEffect} effect     The deleted Active Effect
 * @param {Object} options          Additional options
 * @param {string} userId           The initiating User's ID
 */
async function deleteActiveEffect(effect, options, userId) {
  if (game.user.id !== userId) return;
  if (effect.type !== "auraeffects.aura") return;
  if (!canvas.scene) return;
  const actor = (effect.parent instanceof Actor) ? effect.parent : effect.parent?.parent;
  if (!actor) return;
  const activeGM = game.users.activeGM;
  if (!activeGM) {
    if (!seenWarning) {
      ui.notifications.warn("AURAEFFECTS.NoActiveGM", { localize: true });
      seenWarning = true;
    }
    return;
  }
  const toRemoveAppliedEffects = canvas.scene.tokens
    .filter(t => t.actor && (t.actor !== actor))
    .flatMap(t => t.actor.appliedEffects)
    .filter(e => e.flags?.auraeffects?.fromAura && e.origin === effect.uuid);
  await removeAndReplaceAuras(toRemoveAppliedEffects, canvas.scene);
}

/**
 * Injects a button to transform the effect into an "Aura Active Effect" when the AE Config sheet is rendered
 * @param {ActiveEffectConfig} app  The Active Effect Config sheet being rendered
 * @param {HTMLElement} html        The HTML Element
 */
function injectAuraButton(app, html) {
  const typesToInjectOn = ["base"];
  if (!typesToInjectOn.includes(app.document.type)) return;
  const template = document.createElement("template");
  template.innerHTML = `
    <div class="form-group">
      <label>Aura Effects</label>
      <div class="form-fields">
        <button type="button" data-tooltip="AURAEFFECTS.ConvertToAuraHint">
          <i class="fa-solid fa-person-rays"></i>
          ${game.i18n.localize("AURAEFFECTS.ConvertToAura")}
        </button>
      </div>
    </div>
  `;
  const element = template.content.children[0];
  html.querySelector(".tab[data-tab=details]")?.insertAdjacentElement("beforeend", element);
  element.querySelector("button")?.addEventListener("click", () => {
    const currType = app.document.type;
    const updates = app._processFormData(null, app.form, new foundry.applications.ux.FormDataExtended(app.form));
    // Ensure changes are properly serialized into an array
    if (foundry.utils.getType(updates.changes) !== "Array") updates.changes = Object.values(updates.changes ?? {});
    updates.type = "auraeffects.aura";
    foundry.utils.setProperty(updates, "flags.auraeffects.originalType", currType);
    updates["==system"] = {
      showRadius: game.settings.get("auraeffects", "defaultVisibility")
    };
    return app.document.update(updates);
  });
}

function registerHooks() {
  // Effect application/removal-specific hooks
  Hooks.on("createActiveEffect", addRemoveEffect);
  Hooks.on("deleteActiveEffect", addRemoveEffect);
  Hooks.on("createToken", createToken);
  Hooks.on("deleteToken", deleteToken);
  Hooks.on("updateToken", updateToken);
  Hooks.on("moveToken", moveToken);
  Hooks.on("updateActiveEffect", updateActiveEffect);
  Hooks.on("deleteActiveEffect", deleteActiveEffect);

  // UI hooks
  Hooks.on("renderActiveEffectConfig", injectAuraButton);

  // Visualization-specific hooks
  Hooks.on("canvasInit", canvasInit)
  Hooks.on("drawGridLayer", drawGridLayer);
  Hooks.on("drawToken", drawToken);
  Hooks.on("destroyToken", destroyToken);
  Hooks.on("refreshToken", refreshToken);
  Hooks.on("initializeLightSources", updateAllVisualizations);
}

function registerQueries() {
  CONFIG.queries["auraeffects.deleteEffects"] = deleteEffects;
  CONFIG.queries["auraeffects.applyAuraEffects"] = applyAuraEffects;
}

function registerAuraType() {
  Object.assign(CONFIG.ActiveEffect.dataModels, {
    "auraeffects.aura": AuraActiveEffectData
  });
}

function registerAuraSheet() {
  const defaultAESheet = Object.values(CONFIG.ActiveEffect.sheetClasses.base).find(d => d.default)?.cls;
  const AuraActiveEffectSheet = AuraActiveEffectSheetMixin(defaultAESheet ?? foundry.applications.sheets.ActiveEffectConfig);
  foundry.applications.apps.DocumentSheetConfig.registerSheet(ActiveEffect, "auraeffects", AuraActiveEffectSheet, {
    label: "AURAEFFECTS.SHEETS.AuraActiveEffectSheet",
    types: ["auraeffects.aura"],
    makeDefault: true
  });
}

Hooks.once("init", () => {
  registerHooks();
  registerQueries();
  registerAuraType();
  registerSettings();
  CONFIG.Canvas.polygonBackends.aura = foundry.canvas.geometry.ClockwiseSweepPolygon;
});

Hooks.once("ready", () => {
  registerAuraSheet();
  game.modules.get("auraeffects").api = api;
  if (game.user.isActiveGM) migrate();
});