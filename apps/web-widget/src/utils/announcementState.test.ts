import { describe, expect, it } from 'vitest';
import { buildAnnouncementState } from './announcementState.js';

describe('buildAnnouncementState', () => {
  it('prioritizes loading message as polite status', () => {
    const result = buildAnnouncementState({
      loading: true,
      loadingMessage: 'Loading now',
      errorMessage: 'Error message',
      urgentMessage: 'Urgent message',
      readyMessage: 'Ready message'
    });

    expect(result).toEqual({
      message: 'Loading now',
      isAlert: false
    });
  });

  it('prioritizes error message over urgent and ready messages', () => {
    const result = buildAnnouncementState({
      loading: false,
      loadingMessage: 'Loading now',
      errorMessage: 'Error message',
      urgentMessage: 'Urgent message',
      readyMessage: 'Ready message'
    });

    expect(result).toEqual({
      message: 'Error message',
      isAlert: true
    });
  });

  it('uses urgent alert message when there is no error', () => {
    const result = buildAnnouncementState({
      loading: false,
      loadingMessage: 'Loading now',
      urgentMessage: 'Blocked by safety',
      readyMessage: 'Ready message'
    });

    expect(result).toEqual({
      message: 'Blocked by safety',
      isAlert: true
    });
  });

  it('falls back to ready message as polite status', () => {
    const result = buildAnnouncementState({
      loading: false,
      loadingMessage: 'Loading now',
      readyMessage: 'Ready message'
    });

    expect(result).toEqual({
      message: 'Ready message',
      isAlert: false
    });
  });

  it('returns empty polite status when no message applies', () => {
    const result = buildAnnouncementState({
      loading: false,
      loadingMessage: 'Loading now'
    });

    expect(result).toEqual({
      message: '',
      isAlert: false
    });
  });
});
