import { AuraPointEffectSource } from "./AuraPointEffectSource.mjs";
import { getAllAuraEffects } from "./helpers.mjs";

// Map of Token -> Collection of Auras for visualizing all auras
const tokenAuras = new Map()

/**
 * When a new canvas is initialized, create a new effects Collection to hold aura visual effects
 */
function canvasInit() {
  canvas.effects.auraEffects = new Collection();
}

/**
 * When the grid layer is drawn, add a new child for aura visual effects, set its filter for appropriate masking
 * @param {CanvasLayer} layer   The grid layer
 */
function drawGridLayer(layer) {
  layer.auraEffects = layer.addChild(new PIXI.Container());
  const aurasFilter = foundry.canvas.rendering.filters.VisualEffectsMaskingFilter.create({
    mode: foundry.canvas.rendering.filters.VisualEffectsMaskingFilter.FILTER_MODES.BACKGROUND,
    visionTexture: canvas.masks.vision.renderTexture
  });
  layer.auraEffects.filters = [aurasFilter];
  canvas.effects.visualEffectsMaskingFilters.add(aurasFilter);
}

/**
 * When first drawing a token, update its aura visualizations
 * @param {Token} token   The token being drawn
 */
function drawToken(token) {
  if (token.isPreview && !game.settings.get("core", "visionAnimation")) return;
  if (!tokenAuras.has(token)) tokenAuras.set(token, new Collection());
  updateAurasForToken(token);
}

/**
 * In updateToken hook, if token document has moved, update auras for the associated placeable
 * @param {TokenDocument} token   The token document being updated
 * @param {Object} updates        The updates
 */
async function updateTokenVisualization(token, updates) {
  if (!token.rendered) return;
  const keys = ["x", "y"];
  if (keys.some(key => foundry.utils.hasProperty(updates, key))) {
    await token.object.movementAnimationPromise;
    updateAurasForToken(token.object);
  }
}

/**
 * When a token placeable is destroyed, destroy & clear its auras and clean it from tokenAuras
 * @param {Token} token   The token being destroyed
 */
function destroyToken(token) {
  if (!tokenAuras.has(token)) return;
  tokenAuras.get(token).forEach(aura => {
    aura._destroy();
    canvas.effects.auraEffects.delete(aura.sourceId);
  });
  tokenAuras.get(token).clear();
  tokenAuras.delete(token);
}

/**
 * On token refresh, update aura visualizations, only updating the location of visualizations if visionAnimation is
 * enabled (to respect performance settings & expected behavior)
 * @param {Token} token   The token being refreshed
 */
function refreshToken(token) {
  if (game.settings.get("core", "visionAnimation")) {
    updateAurasForToken(token);
  } else if (!token.isPreview) {
    updateAurasForToken(token, true);
  }
}

/**
 * Update aura visualizations for a give token, optionally only creating/removing visualizations, rather than
 * updating aura location (which is the default behavior)
 * @param {Token} token       The token to update auras for
 * @param {boolean} onlyNew   Whether to only update newly added/removed auras, ignoring x/y changes
 * @returns 
 */
function updateAurasForToken(token, onlyNew = false) {
  if (!token.actor || game.settings.get("auraeffects", "disableVisuals")) {
    Array.from(tokenAuras.get(token).entries()).forEach(([id, aura]) => {
      removeAura(token, aura);
    });
    return;
  }
  const origin = token.getCenterPoint();
  const sourceEffects = getAllAuraEffects(token.actor)[0].filter(e => e.system.showRadius);
  for (const effect of sourceEffects) {
    if (tokenAuras.get(token).has(effect.id)) continue;
    tokenAuras.get(token).set(effect.id, new AuraPointEffectSource({ object: token, effect }));
  }
  const tokenOwner = game.users.getDesignatedUser(u => u.character === token.actor) ?? game.users.activeGM;
  for (const [id, aura] of (tokenAuras.get(token)?.entries() ?? [])) {
    const data = sourceEffects.find(e => e.id === id)?.system;
    if (!data) {
      removeAura(token, aura);
      continue;
    }
    if (aura.active && onlyNew) continue;
    const { externalRadius } = token;
    aura.initialize({
      x: origin.x,
      y: origin.y,
      disabled: false,
      radius: (canvas.dimensions?.size * data.distance) / canvas.dimensions.distance,
      externalRadius: externalRadius,
      preview: token.isPreview,
      walls: data.walls,
      alpha: data.opacity,
      color: data.color ?? tokenOwner?.color,
      collisionTypes: data.collisionTypes
    });
    aura.add();

    canvas.effects.auraEffects.set(aura.sourceId, aura);
  }
  refreshAuras();
}

/**
 * Re-render all on-canvas auras
 */
function refreshAuras() {
  canvas.interface.grid?.auraEffects?.removeChildren();
  for (const aura of canvas.effects.auraEffects) {
    if (!aura.active) continue;
    canvas.interface.grid?.auraEffects?.addChild(aura.graphics);
  }
}

/**
 * Remove an aura from the scene's rendering
 * @param {Token} token                 The token on which the aura exists
 * @param {AuraPointEffectSource} aura  The aura to be removed
 */
function removeAura(token, aura) {
  canvas.effects.auraEffects.delete(aura.sourceId);
  aura._destroy();
  tokenAuras.get(token).delete(aura.id);
}

/**
 * When vision is first initialized, also initialize all auras
 */
function updateAllVisualizations() {
  for (const token of canvas.tokens.placeables) {
    updateAurasForToken(token);
  }
}

export {
  canvasInit,
  drawGridLayer,
  drawToken,
  updateTokenVisualization,
  destroyToken,
  refreshToken,
  updateAllVisualizations
};