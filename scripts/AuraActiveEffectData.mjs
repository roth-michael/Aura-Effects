import { DISPOSITIONS } from "./constants.mjs";
import { executeScript } from "./helpers.mjs";

const { ArrayField, BooleanField, ColorField, JavaScriptField, NumberField, SetField, SchemaField, StringField } = foundry.data.fields;

export default function AuraActiveEffectDataMixin(ActiveEffectClass) {
  return class AuraActiveEffectData extends ActiveEffectClass {
    static LOCALIZATION_PREFIXES = [...super.LOCALIZATION_PREFIXES, "AURAEFFECTS.ACTIVEEFFECT.Aura"];
    static defineSchema() {
      let schema = {};
      try {
        schema = super.defineSchema(); // Throws if TypeDataModel
      } catch (err) {}
      return {
        ...schema,
        applyToSelf: new BooleanField({ initial: true }),
        bestFormula: new StringField({ initial: "" }),
        canStack: new BooleanField({ initial: false }),
        collisionType: new StringField({
          choices: {
            "": "COMMON.None",
            light: "WALL.FIELDS.light.label",
            move: "WALL.FIELDS.move.label",
            sight: "WALL.FIELDS.sight.label",
            sound: "WALL.FIELDS.sound.label"
          },
          required: true,
          blank: true,
          nullable: true,
          initial: source => source.system?.collisionTypes?.[0] ?? "move"
        }),
        color: new ColorField(),
        combatOnly: new BooleanField({ initial: false }),
        disableOnHidden: new BooleanField({ initial: true }),
        distanceFormula: new StringField({ initial: "0" }),
        disposition: new NumberField({
          initial: DISPOSITIONS.ANY,
          choices: {
            [DISPOSITIONS.HOSTILE]: "AURAEFFECTS.ACTIVEEFFECT.Aura.FIELDS.disposition.Choices.Hostile",
            [DISPOSITIONS.ANY]: "AURAEFFECTS.ACTIVEEFFECT.Aura.FIELDS.disposition.Choices.Any",
            [DISPOSITIONS.FRIENDLY]: "AURAEFFECTS.ACTIVEEFFECT.Aura.FIELDS.disposition.Choices.Friendly"
          }
        }),
        evaluatePreApply: new BooleanField({ initial: false }),
        overrideName: new StringField({ initial: '' }),
        script: new JavaScriptField(),
        stashedChanges: new ArrayField(new SchemaField({
          key: new StringField(),
          value: new StringField(),
          mode: new NumberField(),
          priority: new NumberField()
        })),
        stashedStatuses: new SetField(new StringField()),
        showRadius: new BooleanField({ initial: false }),

        // TODO: Remove this, eventually
        collisionTypes: new SetField(new StringField({
          choices: {
            light: "WALL.FIELDS.light.label",
            move: "WALL.FIELDS.move.label",
            sight: "WALL.FIELDS.sight.label",
            sound: "WALL.FIELDS.sound.label"
          },
          required: false,
          blank: false
        }), {
          initial: ["move"],
        })
      }
    }
  
    get isSuppressed() {
      if (super.isSuppressed) return true;
      if (this.combatOnly && !game.combat?.active) return true;
      if (this.disableOnHidden) {
        let actor = this.parent.parent;
        if (actor instanceof Item) actor = actor.actor;
        if (actor?.getActiveTokens(false, true)[0]?.hidden) return true;
      }
      return false;
    }
  
    get distance() {
      return new Roll(this.distanceFormula || "0", this.parent.parent?.getRollData?.()).evaluateSync({ strict: false }).total;
    }

    prepareDerivedData() {
      super.prepareDerivedData?.();
      let actor = this.parent.parent;
      if (actor instanceof Item) actor = actor.actor;
      if (!this.applyToSelf) {
        this.stashedChanges = this.changes;
        this.stashedStatuses = this.parent.statuses;
        this.changes = [];
        this.parent.statuses = new Set();
      } else {
        const token = actor?.getActiveTokens(false, true)[0];
        if (token) {
          // Don't try to execute the script for synthetic actors that haven't yet had their delta prepared, lest we enter a loop
          const deltaPrepped = !actor.isToken || Object.getOwnPropertyDescriptor(token, "delta")?.value;
          if (deltaPrepped && !executeScript(token, token, this.parent)) {
            this.stashedChanges = this.changes;
            this.stashedStatuses = this.parent.statuses;
            this.changes = [];
            this.parent.statuses = new Set();
          } else {
            if (this.stashedChanges?.length) this.changes = this.stashedChanges;
            if (this.stashedStatuses?.size) this.parent.statuses = this.stashedStatuses;
          }
        }
      }
      if (!this.canStack) {
        const nameMatch = this.overrideName || this.parent.name;
        const existing = actor?.effects.find(e => e.flags?.auraeffects?.fromAura && e.name === nameMatch);
        if (existing) {
          this.stashedChanges = this.changes;
          this.stashedStatuses = this.parent.statuses;
          this.changes = [];
          this.parent.statuses = new Set();
        }
      }
    }
  }
}