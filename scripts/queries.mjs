const gmQueue = new foundry.utils.Semaphore();

/**
 * Delete all Active Effects whose UUIDs are provided (ignoring any UUIDs which do NOT correspond to Active Effects)
 * @param {Object} data                 Query input data
 * @param {string[]} data.effectUuids   A list of UUIDs for each Active Effect that should be deleted 
 * @returns {Promise<boolean>}          true
 */
async function deleteEffects({ effectUuids }) {
  const disableAnimation = game.settings.get("auraeffects", "disableScrollingText");
  await gmQueue.add(() => {
    const effects = new Set(effectUuids.map(uuid => fromUuidSync(uuid))).filter(e => e instanceof ActiveEffect);
    return Promise.all(effects.map(e => e.delete({ animate: !disableAnimation })));
  });
  return true;
}

/**
 * Create potentially multiple Active Effects on potentially multiple Actors, modifying the provided effects as
 * necessary for "aura effect" treatment and skipping effects which already exist; also choosing best of multiple
 * if a non-stacking effect, so that only one is applied
 * @param {Object<string, string[]>} actorToEffectsMap  An object with Actor UUIDs as keys, and lists of ActiveEffect UUIDs as values
 * @returns {Promise<boolean>}                          true
 */
async function applyAuraEffects(actorToEffectsMap) {
  const disableAnimation = game.settings.get("auraeffects", "disableScrollingText");
  await gmQueue.add(() => {
    return Promise.all(Object.entries(actorToEffectsMap).map(([actorUuid, effectUuids]) => {
      const actor = fromUuidSync(actorUuid);
      const allEffects = actor.effects;
      const effectsToDelete = [];
      const effects = effectUuids.map(uuid => {
        if (allEffects.some(e => e.origin === uuid)) return null;
        const effect = fromUuidSync(uuid);
        if (!effect) return null;
        const effectData = foundry.utils.mergeObject(effect.toObject(), {
          name: effect.system.overrideName?.trim() || effect.name,
          origin: uuid,
          type: effect.getFlag("auraeffects", "originalType") ?? "base",
          transfer: false,
          "flags.auraeffects.fromAura": true
        });
        if (!effect.system.canStack) {
          const bestValue = new Roll(effect.system.bestFormula.trim() || "0", effect.parent?.getRollData?.()).evaluateSync().total;
          foundry.utils.setProperty(effectData, "flags.auraeffects.bestValue", bestValue);
          const existingEffect = allEffects.find(e => e.flags?.auraeffects?.fromAura && e.name === effectData.name);
          if (existingEffect) {
            const currBest = existingEffect.flags.auraeffects.bestValue ?? 0;
            if (!game.settings.get("auraeffects", "preferLatest") && (currBest >= bestValue)) return null;
            else if (currBest > bestValue) return null; 
            effectsToDelete.push(existingEffect.id);
          }
          const existingSourceEffect = allEffects.find(e => 
            e.type === "auraeffects.aura"
            && e.system.applyToSelf
            && (e.system.overrideName.trim() || e.name) === effectData.name);
          if (existingSourceEffect) {
            const currBest = new Roll(existingSourceEffect.system.bestFormula.trim() || "0", existingSourceEffect.parent?.getRollData?.()).evaluateSync().total;
            if (currBest >= bestValue) return null;
          }
        }
        if (game.modules.get("dae")?.active) {
          for (const change of effectData.changes) {
            change.value = Roll.replaceFormulaData(change.value, effect.parent?.getRollData?.());
            change.value = change.value.replaceAll("##", "@");
          }
        } else if (effect.system.evaluatePreApply) {
          for (const change of effectData.changes) {
            change.value = Roll.replaceFormulaData(change.value, effect.parent?.getRollData?.());
          }
        }
        return effectData;
      }).filter(e => e).reduce((acc, effect) => {
        const existing = acc.find(e => e.name === effect.name);
        const existingBestValue = existing?.flags.auraeffects.bestValue;
        if (existingBestValue === undefined) return [...acc, effect];
        const currBestValue = effect.flags.auraeffects.bestValue;
        if (currBestValue > existingBestValue) acc.findSplice(e => e === existing, effect);
        return acc;
      }, []);
      return actor.deleteEmbeddedDocuments("ActiveEffect", effectsToDelete, { animate: !disableAnimation }).then(() => 
        actor.createEmbeddedDocuments("ActiveEffect", effects, { animate: !disableAnimation })
      );
    }));
  });
  return true;
}

/**
 * For a given token, batch region creation, update, and deletion
 * @param {string} tokenUuid 
 * @param {RegionData[]} toCreate 
 * @param {RegionData[]} toUpdate
 * @param {string[]} toDelete 
 */
async function updateRegionsForToken({tokenUuid, toCreate, toUpdate, toDelete}) {
  const token = await fromUuid(tokenUuid);
  const scene = token?.parent;
  if ( !scene ) return;
  const batchOperations = [];
  if ( toCreate.length ) batchOperations.push({
    action: "create",
    documentName: "Region",
    parent: scene,
    data: toCreate
  });
  if ( toUpdate.length ) batchOperations.push({
    action: "update",
    documentName: "Region",
    parent: scene,
    updates: toUpdate
  });
  if ( toDelete.length ) batchOperations.push({
    action: "delete",
    documentName: "Region",
    parent: scene,
    ids: toDelete
  });
  if ( !batchOperations.length ) return;
  await gmQueue.add(() => {
    foundry.documents.modifyBatch(batchOperations);
  });
  return true;
}

export {
  applyAuraEffects,
  deleteEffects,
  updateRegionsForToken
};