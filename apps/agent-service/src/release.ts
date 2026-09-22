/**
 * Deployment identity for the health endpoints.
 *
 * A deploy gate has to know *which build* answered the health check, not just
 * that something is up. Railway injects `RAILWAY_GIT_COMMIT_SHA` for
 * GitHub-triggered deploys; `KIDBOT_RELEASE_COMMIT` overrides it for hosts
 * that do not. Only a short commit and the environment name are published, so
 * the public endpoint never carries deployment, account, or repository
 * identifiers.
 *
 * This file is byte-identical in agent-service and mcp-server; a contract test
 * fails if they drift.
 */

export interface ReleaseInfo {
  /** Short commit of the running build, or null when the host reports none. */
  commit: string | null;
  /** Deployment environment name, for spotting a staging URL in a production check. */
  environment: string | null;
}

type ReleaseEnv = Partial<
  Record<
    | 'KIDBOT_RELEASE_COMMIT'
    | 'NODE_ENV'
    | 'RAILWAY_ENVIRONMENT_NAME'
    | 'RAILWAY_GIT_COMMIT_SHA',
    string
  >
>;

/** Published commit length: enough to be unambiguous, short enough to stay a build tag. */
export const releaseCommitLength = 12;

const shortCommit = (value: string | undefined): string | null => {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed || !/^[0-9a-f]{7,40}$/.test(trimmed)) {
    return null;
  }
  return trimmed.slice(0, releaseCommitLength);
};

const trimOptional = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

export const resolveRelease = (env: ReleaseEnv = process.env): ReleaseInfo => ({
  commit: shortCommit(env.KIDBOT_RELEASE_COMMIT) ?? shortCommit(env.RAILWAY_GIT_COMMIT_SHA),
  environment: trimOptional(env.RAILWAY_ENVIRONMENT_NAME) ?? trimOptional(env.NODE_ENV),
});

/**
 * True when `candidate` names the commit that `deployed` reports. The two are
 * compared at whichever length is shorter, so a caller holding a full SHA and a
 * service publishing a short one still agree.
 */
export const releaseMatches = (
  deployed: string | null | undefined,
  candidate: string | null | undefined,
): boolean => {
  const expected = shortCommit(candidate ?? undefined);
  const actual = shortCommit(deployed ?? undefined);
  if (!expected || !actual) {
    return false;
  }
  return actual.startsWith(expected) || expected.startsWith(actual);
};
