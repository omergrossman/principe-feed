// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The B→A mode flag + kill-switch policy. The git/gh side effects (open a
// PR vs push to main; upload to GitHub Releases) live in the workflow
// YAML; this module owns the *decisions* so they're testable and the
// B→A switch is one env change with no code change.
//
//   PUBLISH_MODE = review  (B, start here) → daily run opens a PR; merging
//                           it triggers build→sign→upload (publish.yml).
//   PUBLISH_MODE = auto    (A, flip later) → daily run pushes straight to
//                           main; the same push triggers publish.
//
//   FEED_PAUSED = 1        → kill-switch: pause all publishing.

export type PublishMode = "review" | "auto";

export function getMode(): PublishMode {
  return (process.env.PUBLISH_MODE ?? "review").toLowerCase() === "auto" ? "auto" : "review";
}

export function isPaused(): boolean {
  const v = (process.env.FEED_PAUSED ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export interface PublishPlan {
  paused: boolean;
  mode: PublishMode;
  /** What the daily workflow should do with the committed snapshot. */
  gitAction: "none" | "open-pr" | "push-main";
}

export function resolvePublishPlan(): PublishPlan {
  if (isPaused()) return { paused: true, mode: getMode(), gitAction: "none" };
  const mode = getMode();
  return { paused: false, mode, gitAction: mode === "auto" ? "push-main" : "open-pr" };
}
