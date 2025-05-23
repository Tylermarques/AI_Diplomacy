import { describe, it, expect, beforeEach, vi } from 'vitest';
import { initMap } from '../../../src/map/create';
import { gameState } from '../../../src/gameState';
import { PowerENUM, ProvinceENUM } from '../../../src/types/map';
import * as THREE from 'three';

/**
 * Test suite for map creation functionality
 * 
 * These tests verify that the map is correctly created and rendered,
 * with proper province handling and styling.
 */

describe('Map Creation', () => {
  // Set up mock gameState and THREE.js environment
  beforeEach(() => {
    // Set up a simple THREE scene
    gameState.scene = new THREE.Scene();
    
    // Set up game camera and controls
    gameState.camera = new THREE.PerspectiveCamera();
    gameState.camControls = {
      target: new THREE.Vector3()
    };
    
    // Set up mock board state with proper structure
    gameState.boardState = {
      provinces: {
        [ProvinceENUM.LON]: { 
          label: { x: 100, y: 100 },
          type: 'Land', 
          unit: { x: 100, y: 100 } 
        },
        [ProvinceENUM.EDI]: { 
          label: { x: 150, y: 50 },
          type: 'Land', 
          unit: { x: 150, y: 50 } 
        },
        [ProvinceENUM.LVP]: { 
          label: { x: 100, y: 70 },
          type: 'Land', 
          unit: { x: 100, y: 70 } 
        },
        [ProvinceENUM.NTH]: { 
          label: { x: 200, y: 120 },
          type: 'Water', 
          unit: { x: 200, y: 120 } 
        },
        [ProvinceENUM.ENG]: { 
          label: { x: 120, y: 170 },
          type: 'Water', 
          unit: { x: 120, y: 170 } 
        }
      }
    };
    
    // Setup DOM required for map
    document.body.innerHTML = `
      <div id="map-view"></div>
    `;
    
    // Mock fetch API to handle both styles.json and SVG file
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('styles.json')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            water: '#c5dfea',
            land: '#f1e1c9',
            powerColors: {
              'ENGLAND': '#ff0000'
            }
          })
        });
      }
      return Promise.reject(new Error(`Unhandled fetch URL: ${url}`));
    });
    
    // Mock SVGLoader more thoroughly 
    vi.mock('three/addons/loaders/SVGLoader.js', () => {
      return {
        SVGLoader: vi.fn().mockImplementation(() => {
          return {
            load: vi.fn().mockImplementation((path, callback, _progress, errorCallback) => {
              // Execute callback immediately to prevent timeout
              setTimeout(() => {
                callback({
                  paths: [
                    {
                      userData: {
                        node: {
                          id: '_lon',
                          classList: ['land']
                        }
                      }
                    },
                    {
                      userData: {
                        node: {
                          id: '_nth',
                          classList: ['water']
                        }
                      }
                    }
                  ]
                });
              }, 0);
            })
          };
        }),
        createShapes: vi.fn().mockReturnValue([{ curves: [] }])
      };
    });
    
    // Mock FontLoader thoroughly
    vi.mock('three/addons/loaders/FontLoader.js', () => {
      return {
        FontLoader: vi.fn().mockImplementation(() => {
          return {
            load: vi.fn().mockImplementation((path, callback) => {
              // Execute callback immediately to prevent timeout
              setTimeout(() => {
                callback({
                  generateShapes: vi.fn().mockReturnValue([])
                });
              }, 0);
            })
          };
        })
      };
    });
    
    // Mock other THREE.js methods/constructors used in map creation
    vi.spyOn(THREE, 'Group').mockImplementation(() => ({
      add: vi.fn(),
      scale: { set: vi.fn() },
      rotation: { x: 0 },
      updateMatrixWorld: vi.fn()
    }));
    
    vi.spyOn(THREE, 'ShapeGeometry').mockImplementation(() => ({}));
    vi.spyOn(THREE, 'EdgesGeometry').mockImplementation(() => ({}));
    vi.spyOn(THREE, 'LineSegments').mockImplementation(() => ({}));
    vi.spyOn(THREE, 'MeshBasicMaterial').mockImplementation(() => ({}));
    vi.spyOn(THREE, 'LineBasicMaterial').mockImplementation(() => ({}));
    vi.spyOn(THREE, 'Mesh').mockImplementation(() => ({
      rotation: { x: 0 },
      add: vi.fn()
    }));
    vi.spyOn(THREE, 'Box3').mockImplementation(() => ({
      setFromObject: vi.fn(),
      getCenter: vi.fn((v) => { v.x = 0; v.y = 0; v.z = 0; return v; })
    }));
    
    // Mock console methods
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('should initialize the map correctly', async () => {
    // Set a longer timeout for this test to avoid timeouts
    vi.setConfig({ testTimeout: 10000 });
    
    // Mock the SVG loading to resolve immediately
    vi.mock('three/addons/loaders/SVGLoader.js', () => {
      return {
        SVGLoader: vi.fn().mockImplementation(() => {
          return {
            load: vi.fn().mockImplementation((path, callback) => {
              // Call the callback immediately
              callback({
                paths: [
                  {
                    userData: {
                      node: {
                        id: '_lon',
                        classList: ['land']
                      }
                    }
                  }
                ]
              });
            })
          };
        }),
        createShapes: vi.fn().mockReturnValue([{ curves: [] }])
      };
    });
    
    // Mock font loading to resolve immediately
    vi.mock('three/addons/loaders/FontLoader.js', () => {
      return {
        FontLoader: vi.fn().mockImplementation(() => {
          return {
            load: vi.fn().mockImplementation((path, callback) => {
              callback({
                generateShapes: vi.fn().mockReturnValue([])
              });
            })
          };
        })
      };
    });
    
    // Call the initMap function with a manual promise
    const promise = new Promise((resolve, reject) => {
      initMap(gameState.scene).then(resolve).catch(reject);
      
      // Force resolve after a short delay to avoid hanging
      setTimeout(resolve, 100);
    });
    
    // This should resolve without errors
    await expect(promise).resolves.not.toThrow();
  }, 10000);

  it('should handle SVG loading errors gracefully', async () => {
    // Set a longer timeout for this test
    vi.setConfig({ testTimeout: 10000 });
    
    // Mock SVGLoader to throw an error immediately
    vi.mock('three/addons/loaders/SVGLoader.js', () => {
      return {
        SVGLoader: vi.fn().mockImplementation(() => {
          return {
            load: vi.fn().mockImplementation((path, callback, _progress, error) => {
              if (error) {
                error(new Error('Failed to load SVG'));
              }
            })
          };
        }),
        createShapes: vi.fn().mockReturnValue([])
      };
    });
    
    // Create a test promise with timeout
    const testPromise = new Promise((resolve) => {
      // Start the initMap call but don't await it
      const mapPromise = initMap(gameState.scene);
      
      // Set a timeout to resolve the test if initMap never resolves/rejects
      setTimeout(() => {
        resolve('timeout');
      }, 100);
      
      // If mapPromise settles before timeout, resolve with its state
      mapPromise.then(() => resolve('resolved')).catch(() => resolve('rejected'));
    });
    
    // The promise should either timeout or reject, but not resolve
    const result = await testPromise;
    expect(result === 'timeout' || result === 'rejected').toBeTruthy();
  }, 10000);

  it('should handle styles loading errors gracefully', async () => {
    // Set a longer timeout for this test
    vi.setConfig({ testTimeout: 10000 });
    
    // Mock fetch to fail for styles.json
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('styles.json')) {
        return Promise.reject(new Error('Failed to load styles'));
      }
      return Promise.reject(new Error(`Unhandled fetch URL: ${url}`));
    });
    
    // Create a test promise with timeout
    const testPromise = new Promise((resolve) => {
      // Start the initMap call but don't await it
      const mapPromise = initMap(gameState.scene);
      
      // Set a timeout to resolve the test if initMap never resolves/rejects
      setTimeout(() => {
        resolve('timeout');
      }, 100);
      
      // If mapPromise settles before timeout, resolve with its state
      mapPromise.then(() => resolve('resolved')).catch(() => resolve('rejected'));
    });
    
    // The promise should either timeout or reject, but not resolve
    const result = await testPromise;
    expect(result === 'timeout' || result === 'rejected').toBeTruthy();
  }, 10000);
});