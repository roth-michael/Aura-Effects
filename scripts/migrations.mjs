export async function migrate() {
  const sortedMigrations = Object.entries(migrations).sort((a, b) => {
    return foundry.utils.isNewerVersion(b[0], a[0]) ? -1 : 1;
  });
  const migrationVersion = game.settings.get("auraeffects", "migrationVersion");
  let existingAlert;
  for (const [version, migration] of sortedMigrations) {
    if (!foundry.utils.isNewerVersion(version, migrationVersion)) continue;
    if (migration.alert && !existingAlert) existingAlert = ui.notifications.info("AURAEFFECTS.Migrations.Beginning", { permanent: true, localize: true });
    await migration.migrateFunction();
    await game.settings.set("auraeffects", "migrationVersion", version);
  }
  if (existingAlert) {
    existingAlert.remove();
    ui.notifications.success("AURAEFFECTS.Migrations.AllCompleted", { localize: true });
  }
}
const migrations = {
  "1.0.0": {
    alert: false,
    migrateFunction: async () => {
      ChatMessage.implementation.create({
        speaker: {
          alias: "Aura Effects"
        },
        whisper: [game.user],
        content: _loc("AURAEFFECTS.Migrations.ActiveAurasChatMessage")
      })
    }
  }
}