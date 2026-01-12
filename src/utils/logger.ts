let silent = false;

export const logger = {
  info(message: string): void {
    if (!silent) {
      console.log(`[machine-config-sync] ${message}`);
    }
  },

  success(message: string): void {
    if (!silent) {
      console.log(`[machine-config-sync] ✓ ${message}`);
    }
  },

  warn(message: string): void {
    if (!silent) {
      console.warn(`[machine-config-sync] ⚠ ${message}`);
    }
  },

  error(message: string): void {
    // Always output errors, even in silent mode
    console.error(`[machine-config-sync] ✗ ${message}`);
  },

  setSilent(value: boolean): void {
    silent = value;
  },

  isSilent(): boolean {
    return silent;
  },
};
