import { readFile } from "node:fs/promises";
import type { Config } from "../domain/types";

const CONFIG_PATH = process.env.CONFIG_PATH ?? "./config.json";

export async function loadConfig(): Promise<Config> {
  const buffer = await readFile(CONFIG_PATH, "utf8");
  return JSON.parse(buffer) as Config;
}
