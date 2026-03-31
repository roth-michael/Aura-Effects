export function registerSettings() {
  // TODO: What do we wanna do here
  // game.settings.register("auraeffects", "exactCircles", {
  //   name: "AURAEFFECTS.SETTINGS.ExactCircles.Name",
  //   hint: "AURAEFFECTS.SETTINGS.ExactCircles.Hint",
  //   scope: "client",
  //   config: true,
  //   type: Boolean,
  //   default: false,
  //   onChange: () => {
  //     // if (canvas?.ready) updateAllVisualizations();
  //   }
  // });
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
  game.settings.register("auraeffects", "seenSystemWarning", {
    name: "Seen System Warning",
    hint: "Tracks whether a warning about potential system incompatibility has been given. Please do not touch this.",
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });
  game.settings.register("auraeffects", "defaultVisibility", {
    name: "AURAEFFECTS.SETTINGS.DefaultVisibility.Name",
    hint: "AURAEFFECTS.SETTINGS.DefaultVisibility.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });
  game.settings.register("auraeffects", "highlightMode", {
    name: "AURAEFFECTS.SETTINGS.HighlightMode.Name",
    hint: "AURAEFFECTS.SETTINGS.HighlightMode.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      shapes: "REGION.HIGHLIGHT_MODES.shapes.label",
      coverage: "REGION.HIGHLIGHT_MODES.coverage.label"
    },
    default: "coverage"
  });
}