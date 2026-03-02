import { updateAllVisualizations } from "./auraVisualization.mjs";

export function registerSettings() {
  game.settings.register("auraeffects", "disableVisuals", {
    name: "AURAEFFECTS.SETTINGS.DisableVisuals.Name",
    hint: "AURAEFFECTS.SETTINGS.DisableVisuals.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => {
      if (canvas?.ready) updateAllVisualizations();
    }
  });
  game.settings.register("auraeffects", "exactCircles", {
    name: "AURAEFFECTS.SETTINGS.ExactCircles.Name",
    hint: "AURAEFFECTS.SETTINGS.ExactCircles.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => {
      if (canvas?.ready) updateAllVisualizations();
    }
  });
  game.settings.register("auraeffects", "preferLatest", {
    name: "AURAEFFECTS.SETTINGS.PreferLatest.Name",
    hint: "AURAEFFECTS.SETTINGS.PreferLatest.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });
  game.settings.register("auraeffects", "disableScrollingText", {
    name: "AURAEFFECTS.SETTINGS.DisableScrollingText.Name",
    hint: "AURAEFFECTS.SETTINGS.DisableScrollingText.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });
  game.settings.register("auraeffects", "migrationVersion", {
    name: "Migration Version",
    hint: "Tracks the last completed migration. Please do not touch this.",
    scope: "world",
    config: false,
    type: String,
    default: "0.0.0"
  });
  game.settings.register("auraeffects", "defaultVisibility", {
    name: "AURAEFFECTS.SETTINGS.DefaultVisibility.Name",
    hint: "AURAEFFECTS.SETTINGS.DefaultVisibility.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });
}