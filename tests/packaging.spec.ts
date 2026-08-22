import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BOOTSTRAP_FILES } from "../src/templates.js";

/**
 * Packaging guard.
 *
 * `@paperclipai/plugin-llm-wiki@0.1.0` was uninstallable from npm because the
 * bootstrap gitignore shipped as `templates/.gitignore`. npm treats that name
 * specially: it renames it to `.npmignore` when unpacking a package into
 * `node_modules`, so the file the manifest reads at load time was gone the
 * moment the package was installed, and `plugin install` died with ENOENT.
 *
 * The file WAS present in the published tarball, so a "does the tarball contain
 * it" assertion would have passed. The only check that catches this is to pack,
 * genuinely install the tarball, and then exercise the installed copy — which is
 * what this suite does, mirroring the server's own installer
 * (`npm install <spec> --prefix <dir> --ignore-scripts`).
 */

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

/** Files npm renames on extract, keyed by the name that is unsafe to ship. */
const RENAMED_ON_INSTALL: Record<string, string> = {
  ".gitignore": ".npmignore",
};

let workDir: string;
let installedRoot: string;
/** Paths (relative to the package root) that `npm pack` put in the tarball. */
let packedPaths: string[];

function npm(args: string[], cwd: string): string {
  return execFileSync(npmCommand, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/**
 * Every file under the package's `files` allowlist, as paths relative to the
 * package root. This is what the package intends to publish, before npm gets a
 * say in which of those names actually survive.
 */
function listPublishedSourceFiles(): string[] {
  const { files = [] } = JSON.parse(
    readFileSync(path.join(packageRoot, "package.json"), "utf8"),
  ) as { files?: string[] };
  const found: string[] = [];

  function walk(absolute: string) {
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const child = path.join(absolute, entry.name);
      if (entry.isDirectory()) walk(child);
      else found.push(path.relative(packageRoot, child));
    }
  }

  for (const entry of files) {
    const absolute = path.join(packageRoot, entry);
    if (!existsSync(absolute)) continue;
    if (statSync(absolute).isDirectory()) walk(absolute);
    else found.push(entry);
  }

  return found;
}

beforeAll(() => {
  // The tarball ships `dist/`, so the guard is only meaningful against a build.
  execFileSync(process.execPath, ["./esbuild.config.mjs"], { cwd: packageRoot, stdio: "inherit" });

  workDir = mkdtempSync(path.join(tmpdir(), "llm-wiki-packaging-"));

  // `--ignore-scripts` keeps the pack hermetic and skips any prepack rewrite;
  // the `files` allowlist that decides the shipped layout applies either way.
  const packOutput = npm(
    ["pack", "--ignore-scripts", "--json", "--pack-destination", workDir],
    packageRoot,
  );
  const [packed] = JSON.parse(packOutput) as Array<{ filename: string; files: Array<{ path: string }> }>;
  packedPaths = packed.files.map((file) => file.path);

  const prefix = path.join(workDir, "target");
  // Mirrors PluginLoader's npm install, minus the registry round trip: the
  // published bundles are fully self-contained, so nothing needs resolving.
  npm(
    [
      "install",
      path.join(workDir, packed.filename),
      "--prefix",
      prefix,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--legacy-peer-deps",
    ],
    workDir,
  );

  installedRoot = path.join(prefix, "node_modules", "@berrydev-ai", "plugin-llm-wiki");
}, 300_000);

afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

describe("published package", () => {
  it("loads its manifest after a real npm install", async () => {
    // The regression: the manifest reads its templates at module scope, so a
    // template lost during install throws ENOENT right here.
    const manifestPath = path.join(installedRoot, "dist", "manifest.js");
    expect(existsSync(manifestPath)).toBe(true);

    const loaded = await import(pathToFileURL(manifestPath).href);
    const manifest = loaded.default;

    expect(manifest.id).toBe("paperclipai.plugin-llm-wiki");
    expect(manifest.tools.length).toBeGreaterThan(0);
    expect(manifest.capabilities.length).toBeGreaterThan(0);
  });

  it("ships no file whose name npm rewrites on install", () => {
    // Scan the source tree rather than the tarball. Depending on the npm
    // version, a `.gitignore` under `files` either survives packing and gets
    // renamed on install (npm 10 and earlier, which is how 0.1.0 shipped
    // broken) or is treated as an ignore-rules file and silently dropped at
    // pack time (npm 11). Only the source tree shows the mistake either way.
    const unsafe = [...listPublishedSourceFiles(), ...packedPaths].filter((candidate) =>
      Object.hasOwn(RENAMED_ON_INSTALL, path.basename(candidate)),
    );

    expect(
      [...new Set(unsafe)],
      `npm rewrites or drops these when packing/installing, so the installed package would not contain them. ` +
        `Ship the file under a neutral name (see templates/gitignore.template) and write it out at bootstrap instead.`,
    ).toEqual([]);
  });

  it("keeps every packed file at the same path once installed", () => {
    const missing = packedPaths.filter((packedPath) => !existsSync(path.join(installedRoot, packedPath)));

    expect(
      missing,
      `present in the tarball but absent after install (npm renamed or dropped them): ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("installs every file the bootstrap writes from a template", () => {
    // BOOTSTRAP_FILES is the set the plugin materializes into a new wiki root.
    // Each entry is read from `templates/` at manifest load, so each one has to
    // survive packaging for `plugin install` to work at all.
    expect(BOOTSTRAP_FILES.length).toBeGreaterThan(0);

    for (const file of BOOTSTRAP_FILES) {
      expect(typeof file.contents, `bootstrap file ${file.path} has no contents`).toBe("string");
    }

    expect(existsSync(path.join(installedRoot, "templates", "gitignore.template"))).toBe(true);
  });
});
