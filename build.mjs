import {compilePack, extractPack} from "@foundryvtt/foundryvtt-cli";
import {Command} from "commander";

const sourcePath = "_source/aura-effects-macros";
const dbPath = "packs/aura-effects-macros";
export async function extract() {
  await extractPack(dbPath, sourcePath, {clean: true});
}
export async function compile() {
  await compilePack(sourcePath, dbPath);
}

const startup = new Command();

startup.command("compile").action(compile);
startup.command("extract").action(extract);
startup.parseAsync();