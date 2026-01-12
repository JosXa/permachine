let silent = false;

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
