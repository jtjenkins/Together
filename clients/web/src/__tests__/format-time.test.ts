import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatMessageTime } from '../utils/formatTime';

describe('formatMessageTime', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('should format today as time only', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T14:30:00Z'));

    const result = formatMessageTime('2024-06-15T10:30:00Z');
    // Should show time like "10:30 AM" (format varies by locale)
    expect(result).toMatch(/\d{1,2}:\d{2}\s[AP]M/);
  });

  it('should format yesterday with "Yesterday" prefix', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T14:30:00Z'));

    const result = formatMessageTime('2024-06-14T10:30:00Z');
    expect(result).toContain('Yesterday');
  });

  it('should format older dates with full date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T14:30:00Z'));

    const result = formatMessageTime('2024-05-01T10:30:00Z');
    expect(result).toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });
});
