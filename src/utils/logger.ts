let silent = false;

/**
 * Simple pluralization helper.
 * plural(1, 'file') => '1 file'
 * plural(5, 'file') => '5 files'
 * plural(0, 'directory', 'directories') => '0 directories'
 */
export function plural(count: number, singular: string, pluralForm?: string): string {
  const word = count === 1 ? singular : (pluralForm ?? `${singular}s`);
  return `${count} ${word}`;
}

export const logger = {
  info(message: string): void {
    if (!silent) {
      console.log(`[permachine] ${message}`);
    }
  },

  success(message: string): void {
    if (!silent) {
      console.log(`[permachine] ✓ ${message}`);
    }
  },

  warn(message: string): void {
    if (!silent) {
      console.warn(`[permachine] ⚠ ${message}`);
    }
  },

  error(message: string): void {
    // Always output errors, even in silent mode
    console.error(`[permachine] ✗ ${message}`);
  },

  setSilent(value: boolean): void {
    silent = value;
  },

  isSilent(): boolean {
    return silent;
  },
};
