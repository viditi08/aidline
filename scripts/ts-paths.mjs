// Lets Node run this project's TypeScript directly: maps "@/x" to the project root and adds ".ts".
import { register } from "node:module";
register(new URL("./ts-paths-hooks.mjs", import.meta.url));
