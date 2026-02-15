import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_CONFIGS } from "./defaults.js";

function parseJsonFile(filePath) {
  const raw = readFileSync(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
  }
}

function validateConfigShape(fileName, config) {
  if (!config || typeof config !== "object") {
    throw new Error(`${fileName} must be a JSON object`);
  }
  if (config.schema !== 1) {
    throw new Error(`${fileName} schema must be 1`);
  }
}

export function ensureDefaultConfigFiles(configDir) {
  mkdirSync(configDir, { recursive: true });
  for (const [fileName, defaultValue] of Object.entries(DEFAULT_CONFIGS)) {
    const filePath = join(configDir, fileName);
    if (!existsSync(filePath)) {
      writeFileSync(filePath, `${JSON.stringify(defaultValue, null, 2)}\n`, "utf8");
    }
  }
}

export function loadConfigBundle(configDir) {
  const bundle = {};
  for (const fileName of Object.keys(DEFAULT_CONFIGS)) {
    const filePath = join(configDir, fileName);
    if (!existsSync(filePath)) {
      throw new Error(`Missing config file: ${filePath}`);
    }
    const parsed = parseJsonFile(filePath);
    validateConfigShape(fileName, parsed);
    bundle[fileName.replace(".json", "")] = parsed;
  }
  return Object.freeze(bundle);
}
