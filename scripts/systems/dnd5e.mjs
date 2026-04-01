import { getAllAuraEffects, removeAndReplaceAuras } from "../helpers.mjs";

/** @import { Actor } from "@client/documents/_module.mjs" */

export function registerDnd5eHooks() {
  Hooks.on("dnd5e.transformActor", onTransformation);
  Hooks.on("dnd5e.revertOriginalForm", onTransformation);
}

/**
 * On transformation, nuke any downstream effects
 * @param {Actor} actor 
 */
function onTransformation(actor) {
  const sourceToken = actor.getActiveTokens(false, true)[0];
  if (!sourceToken) return;
  const [activeSourceEffects, inactiveSourceEffects] = getAllAuraEffects(actor);
  const toDelete = [];
  for (const sourceEffect of activeSourceEffects) {
    for (const token of token.parent.tokens) {
      if (token === sourceToken) continue;
      const badEffect = token.actor?.effects.find(e => e.origin === sourceEffect.uuid);
      if (badEffect) toDelete.push(badEffect);
    }
  }
  if (toDelete.length) removeAndReplaceAuras(toDelete, sourceToken.parent);
}