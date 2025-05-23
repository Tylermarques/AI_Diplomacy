import { describe, it, expect } from 'vitest';
import { config } from '../../src/config';

/**
 * Test suite for configuration settings
 * 
 * These tests verify that the configuration settings are correctly defined
 * and have appropriate default values.
 */

describe('Configuration Settings', () => {
  it('should have a default playback speed', () => {
    expect(config.playbackSpeed).toBeDefined();
    expect(typeof config.playbackSpeed).toBe('number');
  });

  it('should have a debug mode setting', () => {
    expect(config.isDebugMode).toBeDefined();
    expect(typeof config.isDebugMode).toBe('boolean');
  });

  it('should have an animation duration setting', () => {
    expect(config.animationDuration).toBeDefined();
    expect(typeof config.animationDuration).toBe('number');
    expect(config.animationDuration).toBeGreaterThan(0);
  });

  it('should have a sound effect frequency setting', () => {
    expect(config.soundEffectFrequency).toBeDefined();
    expect(typeof config.soundEffectFrequency).toBe('number');
    expect(config.soundEffectFrequency).toBeGreaterThan(0);
  });

  it('should have reasonable default values', () => {
    // Playback speed should be in a reasonable range
    expect(config.playbackSpeed).toBeGreaterThanOrEqual(100);
    expect(config.playbackSpeed).toBeLessThanOrEqual(5000);
    
    // Animation duration should be in a reasonable range
    expect(config.animationDuration).toBeGreaterThanOrEqual(100);
    expect(config.animationDuration).toBeLessThanOrEqual(10000);
    
    // Sound effect frequency should be a small positive integer
    expect(Number.isInteger(config.soundEffectFrequency)).toBe(true);
    expect(config.soundEffectFrequency).toBeGreaterThanOrEqual(1);
    expect(config.soundEffectFrequency).toBeLessThanOrEqual(10);
  });
});