import AuraActiveEffectDataMixin from "./AuraActiveEffectData.mjs";
import AuraActiveEffectSheetMixin from "./AuraActiveEffectSheet.mjs";
import { auraShouldApply, getAuraRegions, refreshConditionalAuras, removeAndReplaceAuras, updateAllAuraRegions } from "./helpers.mjs";
import { applyAuraEffects, deleteEffects, updateRegionsForToken } from "./queries.mjs";
import { registerSettings } from "./settings.mjs";
import { migrate } from "./migrations.mjs";
import { api } from "./api.mjs";
import { registerDnd5eHooks } from "./systems/dnd5e.mjs";

/** @import { ActiveEffect, TokenDocument, User } from "@client/documents/_module.mjs"; */

// Track whether the "with no GM this no work" warning has been seen
let seenWarning = false;

// Track whether to mix the base effect type
let mixBase = true;

/**
 * A small helper function to determine whether an active GM is present and warn the user if not
 * @returns {User}
 */
function checkActiveGM() {
  const activeGM = game.users.activeGM;
  if (!activeGM && !seenWarning) {
    ui.notifications.warn("AURAEFFECTS.NoActiveGM", { localize: true });
    seenWarning = true;
  }
  return activeGM;
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
  if (!token.actor) return;
  const activeGM = checkActiveGM();
  if (!activeGM) return;
  await updateAllAuraRegions(token);
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
  // Exit early for non-initiators, or if no active GM
  if (game.user.id !== userId) return;
  if (!token.actor) return;
  const activeGM = checkActiveGM();
  if (!activeGM) return;
  await updateAllAuraRegions(token);
  
  // Regions change
  const priorRegionIds = options._priorRegions?.[token.id];
  if (!priorRegionIds) return;
  const oldRegions = priorRegionIds.map(i => token.parent.regions.get(i)).filter(r => r && !token.regions.has(r));
  const originsToRemove = new Set(oldRegions.map(r => r.getFlag("auraeffects", "origin")))
  const toRemove = token.actor.effects.contents.filter(e => e.getFlag("auraeffects", "fromAura") && originsToRemove.has(e.origin));
  await removeAndReplaceAuras(toRemove, token.parent);
  const toApply = getAuraRegions(token)
    .filter(r => !priorRegionIds.includes(r.id))
    .map(r => fromUuidSync(r.getFlag("auraeffects", "origin")))
    .filter(e => e && auraShouldApply(e, token))
    .map(e => e.uuid);
  await activeGM.query("auraeffects.applyAuraEffects", {[token.actor.uuid]: Array.from(toApply)});
}

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
  const [token] = effect.target.getActiveTokens(false, true);
  if (!token) return;
  const activeGM = checkActiveGM();
  if (!activeGM) return;
  await updateAllAuraRegions(token);
  await refreshConditionalAuras(token);
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
   const actor = (effect.parent instanceof Actor) ? effect.parent : effect.parent?.parent;
  const [token] = actor?.getActiveTokens(false, true) ?? [];
  if (!token) return;
  const activeGM = checkActiveGM();
  if (!activeGM) return;
  await updateAllAuraRegions(token);
  await refreshConditionalAuras(token);
}

/**
 * Provided the arguments for the deleteRegion hook, removes any child effects on the scene that share the origin
 * aura effect of that region
 * @param {RegionDocument} region The region being deleted
 * @param {Object} options        Additional options
 * @param {Object} userId         The initiating User's ID
 */
async function deleteRegion(region, options, userId) {
  if (game.user.id !== userId) return;
  const originUuid = region.getFlag("auraeffects", "origin");
  if (!originUuid) return;
  if (!region.parent) return;
  const activeGM = checkActiveGM();
  if (!activeGM) return;
  const toRemove = Array.from(region.tokens).map(t => t.actor?.effects.find(e => e.origin === originUuid)).filter(Boolean);
  await removeAndReplaceAuras(toRemove, region.parent);
}

/**
 * Provided the arguments for the updateActor hook, refresh any conditional-having effects
 * @param {Actor} actor     The actor being updated
 * @param {Object} updates  The updates
 * @param {Object} options  Additional options
 * @param {String} userId   The initiating User's ID
 */
async function updateActor(actor, updates, options, userId) {
  if (game.user.id !== userId) return;
  const [token] = actor.getActiveTokens(false, true) ?? [];
  if (!token) return;
  const activeGM = checkActiveGM();
  if (!activeGM) return;
  await refreshConditionalAuras(token);
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
          ${_loc("AURAEFFECTS.ConvertToAura")}
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
    const currSystem = app.document.toObject().system;
    updates.system = _relpace({
      ...currSystem,
      showRadius: game.settings.get("auraeffects", "defaultVisibility")
    });
    return app.document.update(updates);
  });
}

function registerHooks() {
  // Effect application/removal-specific hooks
  Hooks.on("createToken", createToken);
  Hooks.on("updateToken", updateToken);
  Hooks.on("createActiveEffect", addRemoveEffect);
  Hooks.on("deleteActiveEffect", addRemoveEffect);
  Hooks.on("updateActiveEffect", updateActiveEffect);
  Hooks.on("deleteRegion", deleteRegion);
  Hooks.on("updateActor", updateActor);

  // UI hooks
  Hooks.on("renderActiveEffectConfig", injectAuraButton);

  // System-specific hooks
  switch (game.system.id) {
    case "dnd5e": 
      registerDnd5eHooks();
      break;
  }
}

function registerQueries() {
  CONFIG.queries["auraeffects.deleteEffects"] = deleteEffects;
  CONFIG.queries["auraeffects.applyAuraEffects"] = applyAuraEffects;
  CONFIG.queries["auraeffects.updateRegionsForToken"] = updateRegionsForToken;
}

function registerAuraType() {
  const baseClass = CONFIG.ActiveEffect.dataModels.base ?? foundry.abstract.TypeDataModel;
  try {
    const origSchemaKeys = Object.keys(baseClass.defineSchema()); // Throws if TypeDataModel
    const auraSchemaKeys = Object.keys(AuraActiveEffectDataMixin(foundry.abstract.TypeDataModel).defineSchema());
    mixBase = !auraSchemaKeys.some(k => origSchemaKeys.includes(k));
  } catch (err) {}
  Object.assign(CONFIG.ActiveEffect.dataModels, {
    "auraeffects.aura": AuraActiveEffectDataMixin(mixBase ? baseClass : foundry.abstract.TypeDataModel)
  });
}

function registerAuraSheet() {
  const defaultAESheet = Object.values(CONFIG.ActiveEffect.sheetClasses.base).find(d => d.default)?.cls;
  const sheetToMix = (mixBase && defaultAESheet) ? defaultAESheet : foundry.applications.sheets.ActiveEffectConfig;
  const AuraActiveEffectSheet = AuraActiveEffectSheetMixin(sheetToMix);
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
  if (game.user.isActiveGM) {
    if (!mixBase && !game.settings.get("auraeffects", "seenSystemWarning")) {
      ChatMessage.implementation.create({
        speaker: {
          alias: "Aura Effects"
        },
        whisper: [game.user],
        content: _loc("AURAEFFECTS.PotentialSystemIncompatibility")
      });
      game.settings.set("auraeffects", "seenSystemWarning", true);
    }
    migrate();
  }
});