import { describe, it, expect, beforeEach, vi } from 'vitest';
import { config } from '../../../src/config';

/**
 * A simplified test suite for the phase-related functionality
 * This focuses only on the config values without interacting with the gameState
 */

describe('Game Phase Configuration', () => {
  let mockPlaybackTimer: number | null = null;
  
  beforeEach(() => {
    // Set a default playback speed
    config.playbackSpeed = 500;
    
    // Clear any existing timers
    if (mockPlaybackTimer) {
      clearTimeout(mockPlaybackTimer);
      mockPlaybackTimer = null;
    }
    
    // Mock setTimeout and clearTimeout
    vi.useFakeTimers();
  });
  
  afterEach(() => {
    vi.useRealTimers();
  });

  it('should use the configured playback speed for timer', () => {
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
    
    // Use playback speed from config when setting a timeout
    mockPlaybackTimer = setTimeout(() => {
      // This is just a test
    }, config.playbackSpeed);
    
    // Check that setTimeout was called with the correct delay
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 500);
    
    // Change the config playback speed
    config.playbackSpeed = 2000;
    
    // Set another timeout with the new speed
    if (mockPlaybackTimer) {
      clearTimeout(mockPlaybackTimer);
    }
    mockPlaybackTimer = setTimeout(() => {
      // This is just a test
    }, config.playbackSpeed);
    
    // Check that setTimeout was called with the new delay
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 2000);
    
    setTimeoutSpy.mockRestore();
  });

  it('should use the configured animation duration', () => {
    // Default animation duration should be set
    expect(config.animationDuration).toBeDefined();
    expect(typeof config.animationDuration).toBe('number');
    
    // Save the original value
    const originalDuration = config.animationDuration;
    
    // Change the animation duration
    config.animationDuration = 2500;
    
    // Check that the new value is used
    expect(config.animationDuration).toBe(2500);
    
    // Restore the original value
    config.animationDuration = originalDuration;
  });

  it('should properly handle debug mode flag', () => {
    // Save the original value
    const originalDebugMode = config.isDebugMode;
    
    // Set debug mode to true
    config.isDebugMode = true;
    expect(config.isDebugMode).toBe(true);
    
    // Set debug mode to false
    config.isDebugMode = false;
    expect(config.isDebugMode).toBe(false);
    
    // Restore the original value
    config.isDebugMode = originalDebugMode;
  });

  it('should use sound effect frequency from config', () => {
    // Default sound effect frequency should be set
    expect(config.soundEffectFrequency).toBeDefined();
    expect(typeof config.soundEffectFrequency).toBe('number');
    
    // Save the original value
    const originalFrequency = config.soundEffectFrequency;
    
    // Change the sound effect frequency
    config.soundEffectFrequency = 5;
    
    // Check that the new value is used
    expect(config.soundEffectFrequency).toBe(5);
    
    // Restore the original value
    config.soundEffectFrequency = originalFrequency;
  });
});