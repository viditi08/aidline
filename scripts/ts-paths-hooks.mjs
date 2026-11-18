import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);

export async function resolve(specifier, context, next) {
  let target = specifier;
  if (specifier.startsWith("@/")) target = new URL(specifier.slice(2), root).href;
  if ((target.startsWith("file:") || target.startsWith(".")) && !/\.[cm]?[jt]s$/.test(target)) {
    const base = target.startsWith("file:") ? target : new URL(target, context.parentURL).href;
    if (existsSync(fileURLToPath(`${base}.ts`))) target = `${base}.ts`;
  }
  return next(target, context);
}
