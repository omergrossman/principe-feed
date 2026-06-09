// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Signing is REUSED from principe-oss `scripts/build-bundle.ts` (the
// submodule), never reimplemented — it builds the tarball, the manifest
// (merging feed-metadata.json), and the detached ed25519 signature. We
// invoke it as a subprocess so the producer never holds a fork of the
// crypto/bundling logic the consumer verifies against.

import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";

export interface SignResult {
  outputDir: string;
  version: string;
}

/**
 * @param version    bundle version (e.g. a date "2026-06-09").
 * @param inputDir   the emit dir (knowledge/*.md + feed-metadata.json).
 * @param outputDir  where bundles/ manifests/ latest.json land.
 * @param keyPath    ed25519 PEM private key (from the Action secret).
 */
export function signBundle(version: string, inputDir: string, outputDir: string, keyPath: string): SignResult {
  const ossDir = resolve(process.env.PRINCIPE_OSS_DIR ?? "../principe-oss");
  const inAbs = resolve(inputDir);
  const outAbs = resolve(outputDir);
  const script = join(ossDir, "scripts", "build-bundle.ts");
  // Run the real build-bundle via tsx (resolved from THIS package's
  // node_modules); the script's own `tar` import resolves from ossDir.
  execFileSync(
    "node",
    ["--import", "tsx", script, version, inAbs, outAbs],
    { cwd: process.cwd(), env: { ...process.env, PRINCIPE_UPDATES_PRIVATE_KEY_PATH: resolve(keyPath) }, stdio: "inherit" },
  );
  return { outputDir: outAbs, version };
}
