import { describe, expect, it } from 'vitest';
import { releaseMatches, resolveRelease } from '../release.js';

describe('release identity', () => {
  it('reports the commit Railway injected for a GitHub deploy', () => {
    const release = resolveRelease({
      RAILWAY_GIT_COMMIT_SHA: 'D0BEB8F5C55B36DF7D674D55965A23B8D54AD69B',
      RAILWAY_ENVIRONMENT_NAME: 'production',
    });

    expect(release.commit).toBe('d0beb8f5c55b');
    expect(release.environment).toBe('production');
  });

  it('prefers an explicit override for hosts that inject nothing', () => {
    expect(resolveRelease({
      KIDBOT_RELEASE_COMMIT: 'abc1234',
      RAILWAY_GIT_COMMIT_SHA: 'd0beb8f5c55b36df7d674d55965a23b8d54ad69b',
    }).commit).toBe('abc1234');
  });

  it('reports null rather than guessing when no commit is available', () => {
    expect(resolveRelease({}).commit).toBeNull();
    expect(resolveRelease({ RAILWAY_GIT_COMMIT_SHA: 'not-a-sha' }).commit).toBeNull();
    expect(resolveRelease({ RAILWAY_GIT_COMMIT_SHA: 'abcdef' }).commit).toBeNull();
    expect(resolveRelease({}).environment).toBeNull();
  });

  it('falls back to NODE_ENV for the environment name', () => {
    expect(resolveRelease({ NODE_ENV: 'production' }).environment).toBe('production');
  });

  it('matches a deployed short commit against a full SHA in either direction', () => {
    expect(releaseMatches('d0beb8f5c55b', 'd0beb8f5c55b36df7d674d55965a23b8d54ad69b')).toBe(true);
    expect(releaseMatches('d0beb8f5c55b36df7d674d55965a23b8d54ad69b', 'd0beb8f')).toBe(true);
    expect(releaseMatches('d0beb8f5c55b', 'e0beb8f5c55b')).toBe(false);
    expect(releaseMatches(null, 'd0beb8f')).toBe(false);
    expect(releaseMatches('d0beb8f5c55b', undefined)).toBe(false);
  });
});
