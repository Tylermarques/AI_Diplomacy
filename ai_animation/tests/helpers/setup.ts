/**
 * Test setup file for Vitest
 * This file runs before each test
 */

import { vi } from 'vitest';

// Mock browser APIs that don't exist in the test environment
global.CanvasRenderingContext2D = class CanvasRenderingContext2D {
  beginPath() {}
  moveTo() {}
  lineTo() {}
  arcTo() {}
  closePath() {}
};

// Add the roundRect method to the prototype
global.CanvasRenderingContext2D.prototype.roundRect = function() {
  return this;
};

// Mock THREE global modules with additional constructors for chat windows and animations
vi.mock('three', () => {
  return {
    Scene: vi.fn().mockImplementation(() => ({
      add: vi.fn(),
      remove: vi.fn(),
      background: null,
      userData: { animatedObjects: [] },
      children: [],
      updateMatrixWorld: vi.fn(),
    })),
    PerspectiveCamera: vi.fn().mockImplementation(() => ({
      aspect: 1,
      position: { set: vi.fn(), lerp: vi.fn(), copy: vi.fn(), x: 0, y: 0, z: 0 },
      updateProjectionMatrix: vi.fn(),
    })),
    WebGLRenderer: vi.fn().mockImplementation(() => ({
      setSize: vi.fn(),
      setPixelRatio: vi.fn(),
      render: vi.fn(),
      setRenderTarget: vi.fn(),
      readRenderTargetPixels: vi.fn((target, x, y, width, height, pixels) => {
        // Fill pixels with valid data to prevent errors
        for (let i = 0; i < pixels.length; i++) {
          pixels[i] = 255;
        }
      }),
      dispose: vi.fn(),
      domElement: document.createElement('canvas'),
    })),
    WebGLRenderTarget: vi.fn().mockImplementation(() => ({
      dispose: vi.fn(),
    })),
    Group: vi.fn().mockImplementation(() => ({
      add: vi.fn(),
      remove: vi.fn(),
      scale: { set: vi.fn() },
      position: { set: vi.fn(), setY: vi.fn(), y: 0, x: 0, z: 0 },
      rotation: { set: vi.fn(), x: 0, y: 0, z: 0 },
      updateMatrixWorld: vi.fn(),
      userData: {},
    })),
    Mesh: vi.fn().mockImplementation(() => ({
      add: vi.fn(),
      position: { set: vi.fn(), setY: vi.fn(), y: 0, x: 0, z: 0 },
      rotation: { set: vi.fn(), x: 0, y: 0, z: 0, y: 0 },
      scale: { set: vi.fn() },
      userData: {},
    })),
    Vector3: vi.fn().mockImplementation(() => {
      // Create a proper vector3 implementation
      const vector = {
        x: 0,
        y: 0,
        z: 0,
        set: function(x, y, z) {
          this.x = x || 0;
          this.y = y || 0;
          this.z = z || 0;
          return this;
        },
        copy: function(v) {
          this.x = v.x;
          this.y = v.y;
          this.z = v.z;
          return this;
        },
        lerp: function(v, alpha) {
          this.x = this.x + (v.x - this.x) * alpha;
          this.y = this.y + (v.y - this.y) * alpha;
          this.z = this.z + (v.z - this.z) * alpha;
          return this;
        }
      };
      return vector;
    }),
    Box3: vi.fn().mockImplementation(() => ({
      setFromObject: vi.fn(),
      getCenter: vi.fn((v) => { v.x = 0; v.y = 0; v.z = 0; return v; }),
    })),
    AmbientLight: vi.fn().mockImplementation(() => ({})),
    DirectionalLight: vi.fn().mockImplementation(() => ({
      position: { set: vi.fn() },
    })),
    ShapeGeometry: vi.fn().mockImplementation(() => ({})),
    EdgesGeometry: vi.fn().mockImplementation(() => ({})),
    LineSegments: vi.fn().mockImplementation(() => ({})),
    LineBasicMaterial: vi.fn().mockImplementation(() => ({})),
    MeshBasicMaterial: vi.fn().mockImplementation(() => ({})),
    MeshStandardMaterial: vi.fn().mockImplementation(() => ({})),
    BoxGeometry: vi.fn().mockImplementation(() => ({})),
    Color: vi.fn().mockImplementation(() => ({})),
  };
});

// Mock Three.js Addons
vi.mock('three/addons/loaders/FontLoader.js', () => ({
  FontLoader: vi.fn().mockImplementation(() => ({
    load: vi.fn().mockImplementation((path, callback) => {
      callback({ generateShapes: vi.fn().mockReturnValue([]) });
    }),
  })),
}));

vi.mock('three/addons/loaders/SVGLoader.js', () => ({
  SVGLoader: vi.fn().mockImplementation(() => ({
    load: vi.fn().mockImplementation((path, callback) => {
      callback({ paths: [] });
    }),
  })),
  createShapes: vi.fn().mockReturnValue([]),
}));

vi.mock('three/examples/jsm/Addons.js', () => ({
  OrbitControls: vi.fn().mockImplementation(() => ({
    enableDamping: true,
    dampingFactor: 0.05,
    screenSpacePanning: true,
    minDistance: 100,
    maxDistance: 2000,
    maxPolarAngle: Math.PI / 2,
    target: { set: vi.fn() },
    update: vi.fn(),
  })),
}));

// Mock Tween.js
vi.mock('@tweenjs/tween.js', () => ({
  Tween: vi.fn().mockImplementation(() => ({
    to: vi.fn().mockReturnThis(),
    easing: vi.fn().mockReturnThis(),
    onUpdate: vi.fn().mockReturnThis(),
    onComplete: vi.fn().mockReturnThis(),
    start: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    chain: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    pause: vi.fn().mockReturnThis(),
    isPlaying: vi.fn().mockReturnValue(false),
    yoyo: vi.fn().mockReturnThis(),
    repeat: vi.fn().mockReturnThis(),
  })),
  Group: vi.fn().mockImplementation((tween1, tween2) => ({
    getAll: vi.fn().mockReturnValue([tween1, tween2]),
    update: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    pause: vi.fn(),
  })),
  Easing: {
    Quadratic: {
      InOut: vi.fn(),
      Out: vi.fn(),
    },
  },
}));

// Create DOM elements
function setupDOM() {
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
}

// Mock fetch requests
global.fetch = vi.fn().mockImplementation((url) => {
  if (url.includes('coords.json')) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({}),
    });
  }
  if (url.includes('styles.json')) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({}),
    });
  }
  if (url.includes('default_game.json')) {
    return Promise.resolve({
      ok: true,
      text: () => Promise.resolve('{}'),
      headers: {
        get: () => 'application/json',
      },
    });
  }
  return Promise.reject(new Error(`Unhandled fetch URL: ${url}`));
});

// Add any global helper functions needed for tests
global.addWord = (parentElement, word, delay) => {
  const span = document.createElement('span');
  span.textContent = word;
  parentElement.appendChild(span);
};

// Run setup
setupDOM();