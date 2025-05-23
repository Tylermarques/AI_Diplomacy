import { describe, it, expect, beforeEach, vi } from 'vitest';
import { gameState } from '../../../src/gameState';
import { ProvinceENUM } from '../../../src/types/map';

/**
 * Test suite for game data loading functionality
 * 
 * These tests verify that game data is correctly loaded and validated,
 * and that errors are properly handled when loading invalid data.
 */

describe('Game Data Loading', () => {
  beforeEach(() => {
    // Reset gameState before each test
    gameState.phaseIndex = 0;
    gameState.gameData = undefined;
    
    // Initialize provinces to prevent province undefined error
    gameState.boardState = {
      provinces: {
        [ProvinceENUM.LON]: { 
          label: { x: 100, y: 100 },
          type: 'Land', 
          unit: { x: 100, y: 100 } 
        },
        [ProvinceENUM.PAR]: { 
          label: { x: 150, y: 150 },
          type: 'Land', 
          unit: { x: 150, y: 150 } 
        }
      }
    };
    
    // Mock console methods
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    
    // Mock DOM elements that might be used during game loading
    document.body.innerHTML = `
      <div id="map-view"></div>
      <div id="info-panel"></div>
      <div id="phase-display"></div>
      <div id="chat-container"></div>
      <div id="news-banner"></div>
      <div id="leaderboard"></div>
      <div id="standings-board" style="display: none"></div>
      <button id="load-btn">Load Game</button>
      <button id="prev-btn" disabled>Previous</button>
      <button id="next-btn" disabled>Next</button>
      <button id="play-btn" disabled>Play</button>
      <button id="standings-btn">Standings</button>
      <input type="file" id="file-input" style="display: none" />
      <select id="speed-selector" disabled>
        <option value="500">Normal Speed</option>
        <option value="100">Fast</option>
        <option value="2000">Slow</option>
      </select>
    `;
  });

  it('should load valid game data correctly', async () => {
    // Sample valid game data with minimal required fields
    const validGameData = JSON.stringify({
      id: 'test-game',
      map: 'standard',
      phases: [
        {
          name: 'Spring 1901, Movement',
          messages: [],
          orders: {},
          results: {},
          state: {
            units: {},
            centers: {},
            homes: {},
            influence: {}
          }
        }
      ]
    });
    
    // Load the game data
    await gameState.loadGameData(validGameData);
    
    // Verify game data was loaded correctly
    expect(gameState.gameData).toBeDefined();
    expect(gameState.gameData.id).toBe('test-game');
    expect(gameState.gameData.phases.length).toBe(1);
    expect(gameState.phaseIndex).toBe(0);
  });

  it('should handle invalid JSON', async () => {
    // Invalid JSON string
    const invalidJson = '{"id": "test-game", "map": "standard", "phases": [';
    
    // Attempt to load invalid JSON
    try {
      await gameState.loadGameData(invalidJson);
      // Should not reach here
      expect(true).toBe(false);
    } catch (error) {
      // Should reject with error
      expect(error).toBeDefined();
    }
  });

  it('should validate game data schema', async () => {
    // Valid JSON but missing required fields
    const invalidSchema = JSON.stringify({
      id: 'test-game',
      // Missing 'map' field
      phases: [
        {
          name: 'Spring 1901, Movement',
          // Missing required order field
          results: {},
          state: {
            units: {},
            centers: {},
            homes: {},
            influence: {}
          }
        }
      ]
    });
    
    // Attempt to load data with invalid schema
    try {
      await gameState.loadGameData(invalidSchema);
      // Should not reach here
      expect(true).toBe(false);
    } catch (error) {
      // Should reject with error
      expect(error).toBeDefined();
    }
  });

  it('should handle empty phases array', async () => {
    // Game data with empty phases array
    const emptyPhasesData = JSON.stringify({
      id: 'test-game',
      map: 'standard',
      phases: []
    });
    
    // Attempt to load game with no phases
    try {
      await gameState.loadGameData(emptyPhasesData);
      // Should not reach here
      expect(true).toBe(false);
    } catch (error) {
      // Should reject with error
      expect(error).toBeDefined();
      expect(error.message).toContain('No phases found');
    }
  });

  it('should handle different order formats', async () => {
    // Game data with orders in object format
    const objectOrdersData = JSON.stringify({
      id: 'test-game',
      map: 'standard',
      phases: [
        {
          name: 'Spring 1901, Movement',
          messages: [],
          orders: {
            'ENGLAND': ['F LON - NTH', 'A LVP - YOR'],
            'FRANCE': ['F BRE - ENG', 'A PAR - BUR']
          },
          results: {},
          state: {
            units: {},
            centers: {},
            homes: {},
            influence: {}
          }
        }
      ]
    });
    
    // Load the game data
    await gameState.loadGameData(objectOrdersData);
    
    // Verify orders were correctly parsed
    expect(gameState.gameData).toBeDefined();
    expect(gameState.gameData.phases[0].orders).toBeDefined();
    expect(gameState.gameData.phases[0].orders['ENGLAND']).toBeInstanceOf(Array);
    expect(gameState.gameData.phases[0].orders['ENGLAND'].length).toBe(2);
  });
});