# Aura Effects Changelog

## Version 1.3.4
- Fixed a bug where the aura conversion button wouldn't inject if the system removed the statuses dropdown from the details tab
- Fixed a bug where a click on the label of the aura conversion button would convert to aura, instead of just a click on the button
- Fixed a bug where sometimes an error was thrown during aura visualization

## Version 1.3.3
- Fixed a bug where auras would sometimes un-apply and re-apply instead of just staying on

## Version 1.3.2
- Fixed a bug where auras would sometimes apply to self, despite being told not to

## Version 1.3.1
- Fixed a bug with actorless tokens, hopefully for the last time

## Version 1.3.0
- Now hooks on token creation/deletion to apply/remove Aura Effects appropriately
- Fixed a bug where dragging certain actors onto the canvas would infinitely loop data preparation

## Version 1.2.8
- Further guard against actorless tokens, during _migration_ this time
- Also grab _all_ synthetic actors during migration, rather than only those on the viewed scene

## Version 1.2.7
- Added a guard against actorless tokens. Still not supported (and the console warning says as much) but should no longer error

## Version 1.2.6
- Added Czech localization (thanks Lethrendis!)

## Version 1.2.5
- Make migration go one pack at a time, resolving memory issues
- Added console logs to the migration script

## Version 1.2.4
- Ensure migration script operates on items of compendium actors as well
- Added Brazilian Portuguese localization (thanks Kharmans!)

## Version 1.2.3
- Fixed a bug in the migration script

## Version 1.2.2
- Fixed a bug where effects wouldn't immediately act as auras upon application
- Fixed a bug where updating an aura effect didn't result in a re-evaluation of who should have it
- Added Italian localization (thanks GregoryWarn!)

## Version 1.2.1
- Fixed a bug where effects with conditional scripts would sometimes not apply to self when set to

## Version 1.2.0
- Aura Effects aura sheet now extends whatever the base active effect sheet is set to be. This should make it compatible with modules or systems which override the base AE sheet without requiring explicit code to do so (Thanks @mclemente for the idea & implementation!)
  - Removed plugin behavior, as this should no longer be necessary
- Fixed a bug when toggling an Aura Effect on an unowned item

## Version 1.1.0
- Aura Effects now refresh if necessary on adding/removing effects to an actor (e.g. re-running conditional scripts when they exist)
- Conditional Scripts now apply to the source actor as well

## Version 1.0.2
- Fixed release bug (maybe?)

## Version 1.0.1
- Moved a chunk of code into `moveToken` hook, fixing bug where distance was sometimes erroneously calculated from token's final position

## Version 1.0.0
- Welcome to those coming from Active Auras. There is an included migration script (user-triggered, found in the Aura Effects Macros compendium) which aims to automatically convert effects to the new format. Key differences from Active Auras:
  - Auras can now be visualized! This can be disabled globally per-client, and enabled/disabled per-Aura as well.
  - Auras will now always respect whatever grid diagonal settings are selected, and will compute vertical distance using the same rules.
  - You can now select to _not_ evaluate effect change values pre-application (unless you are using a module such as DAE, which forces that behavior). This means you can have an aura grant, for instance, a bonus to each recipient's attacks equal to _the recipient's_ strength score.
  - Aura source effects are now a new subtype of Active Effects. You can turn an Active Effect into an Aura Active Effect on the "Details" tab of the effect configuration. This will re-open the window with a new "Aura" tab.
  - Support for Templates & Drawings calling macros has been dropped; with the existence of Scene Regions, this functionality should no longer be necessary.
  - System-specific options (such as alignment for dnd5e and wildcard/extra for swade) have been dropped. If you used these, the migration script should pick this up and populate the "Conditional Script" field with the appropriate implementation of what you had selected.
  - Combat-only auras are now per-aura, rather than a global setting. Performance, in general, should be greatly enhanced.
  - Custom evaluation (conditional script) has undergone two minor changes: `system` is no longer in the scope (simply use `actor.system` instead), and `auraEntity` has been renamed to `sourceToken`. The latter renaming should be automatically handled via migration script.
- Added no-stacking & best formula fields, along with logic for ensuring only the "best" aura applies
- Added combat-only and disable on hidden fields
- Added a name override so that the applied effect can have a different name from the source effect
- Added a compendium of Macros (currently, only contains the migration script from Active Auras to Aura Effects)
- If color is left blank, now inherits the user color of whichever user has the actor set as their Character (or the GM, if none).
- Added a setting to specify the default visualization of newly-created aura effects.

## Version 0.6.1
- Auras tab is now scrollable

## Version 0.6.0
- Added "Evaluate Changes Early" field
- Ensured (or attempted to ensure) that DAE's rules for value replacement are adhered to, if active

## Version 0.5.0
- Added "Conditional Script" field
- Moved "Is Aura" checkbox

## Version 0.4.0
- Majorly overhauled visualization logic to instead use Point Effect Sources
- "Better" apply-to-self logic, which should work properly now
- Modified token-to-token distance calc on gridless to take external radius of source into account

## Version 0.3.0
- Added the beginning of plugin behavior (so far just compatibility with DAE's custom sheet)
- Setting for showing circles on gridded maps with "Exact" set as diagonal distances
- Settings for whether an aura should apply to self or not
- Added logic for the above - depends on a V13 issue being addressed
- Added logic for effects being enabled/disabled, deleted, and to ensure old effects (from no-longer-active/existent auras) are properly wiped on token movement
- Ensure auras are drawn _under_ any existing drawings

## Version 0.2.0
- Added aura visualization
- Added changelog

## Version 0.1.0
- Initial commit