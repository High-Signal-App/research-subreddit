import { isAbsolute } from "node:path";

const VERSION = "4.120.0";

/** Resolve the pinned provider CLI once, rather than starting npm for every object. */
export function createWranglerRunner(exec, cwd) {
  const options = { cwd, maxBuffer: 1024 * 1024 };
  let executable;
  return async args => {
    executable ??= (async () => {
      const result = await exec("npx", ["--yes", `--package=wrangler@${VERSION}`, "--call", "command -v wrangler"], options);
      const path = result.stdout.trim();
      if (!isAbsolute(path) || /[\r\n]/.test(path)) throw new Error("Invalid pinned Wrangler executable");
      const version = await exec(path, ["--version"], options);
      if (version.stdout.trim() !== VERSION) throw new Error("Pinned Wrangler version mismatch");
      return path;
    })();
    return exec(await executable, args, options);
  };
}
