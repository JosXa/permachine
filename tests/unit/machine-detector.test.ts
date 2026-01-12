import { describe, test, expect, beforeEach } from 'bun:test';
import { getMachineName, resetMachineNameCache } from '../../src/core/machine-detector';
import os from 'node:os';

describe('machine-detector', () => {
  beforeEach(() => {
    resetMachineNameCache();
  });

  test('should detect machine name', () => {
    const machineName = getMachineName();
    expect(machineName).toBeTruthy();
    expect(typeof machineName).toBe('string');
    expect(machineName.length).toBeGreaterThan(0);
  });

  test('should return lowercase machine name', () => {
    const machineName = getMachineName();
    expect(machineName).toBe(machineName.toLowerCase());
  });

  test('should cache result', () => {
    const first = getMachineName();
    const second = getMachineName();
    expect(first).toBe(second);
  });

  test('should match os.hostname() when COMPUTERNAME not set', () => {
    const originalComputerName = process.env.COMPUTERNAME;
    delete process.env.COMPUTERNAME;
    resetMachineNameCache();

    const machineName = getMachineName();
    expect(machineName).toBe(os.hostname().toLowerCase());

    // Restore
    if (originalComputerName) {
      process.env.COMPUTERNAME = originalComputerName;
    }
  });
});
