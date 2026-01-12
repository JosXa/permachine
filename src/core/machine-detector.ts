import os from 'node:os';

let cachedMachineName: string | null = null;

/**
 * Detects the current machine name across platforms
 * Returns normalized lowercase machine name
 */
export function getMachineName(): string {
  if (cachedMachineName) {
    return cachedMachineName;
  }

  // Windows: COMPUTERNAME env variable is most reliable
  // Linux/Mac: hostname() from os module
  const machineName = (
    process.env.COMPUTERNAME || 
    os.hostname()
  ).toLowerCase();

  cachedMachineName = machineName;
  return machineName;
}

/**
 * Reset the cached machine name (useful for testing)
 */
export function resetMachineNameCache(): void {
  cachedMachineName = null;
}
