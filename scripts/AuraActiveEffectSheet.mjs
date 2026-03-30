import { getExtendedParts, getExtendedTabs } from "./helpers.mjs";
/** @import ActiveEffectConfig from "@client/applications/sheets/active-effect-config.mjs"; */

/**
 * Extend an Active Effect Config sheet to include the Aura Effects tab & logic
 * @param {typeof ActiveEffectConfig} ActiveEffectSheet An existing Active Effect Config sheet class
 * @returns The extended sheet
 */
export default function AuraActiveEffectSheetMixin(ActiveEffectSheet) {
  return class AuraActiveEffectSheet extends ActiveEffectSheet {
    static PARTS = getExtendedParts(super.PARTS);
  
    static TABS = getExtendedTabs(super.TABS);
  
    static DEFAULT_OPTIONS = {
      actions: {
        revert: AuraActiveEffectSheet.#onRevert
      }
    };
  
    async _preparePartContext(id, context) {
      context = await super._preparePartContext(id, context);
      if (id === "aura") {
        context = foundry.utils.mergeObject(context, {
          fields: this.document.system.schema.fields,
          isDAEEnabled: game.modules.get("dae")?.active
        }, { inplace: false });
      }
      return context;
    };
  
    static #onRevert() {
      const updates = this._processFormData(null, this.form, new foundry.applications.ux.FormDataExtended(this.form));
      if (foundry.utils.getType(updates.changes) !== "Array") updates.changes = Object.values(updates.changes ?? {});
      updates.type = this.document.getFlag("auraeffects", "originalType") ?? "base";
      foundry.utils.setProperty(updates, "flags.auraeffects", _del);
      updates.system = _replace(this.document.toObject().system);
      delete updates.system;
      this.document.update(updates);
    }
  }
}