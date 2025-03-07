import * as THREE from "three";
import { loadCoordinateData } from "./data"
import "./style.css"


// --- CORE VARIABLES ---
let gameData = null;
let currentPhaseIndex = 0;
let coordinateData = null;
let unitMeshes = []; // To store references for units + supply center 3D objects
let isPlaying = false; // Track playback state
let playbackSpeed = 500; // Default speed in ms
let playbackTimer = null; // Timer reference for playback
let animationDuration = 1500; // Duration of unit movement animation in ms
let unitAnimations = []; // Track ongoing unit animations
let territoryTransitions = []; // Track territory color transitions
let chatWindows = {}; // Store chat window elements by power
let currentPower = 'FRANCE'; // Default perspective is France

// >>> ADDED: Camera pan and message playback variables
let cameraPanTime = 0;   // Timer that drives the camera panning
const cameraPanSpeed = 0.0005; // Smaller = slower
let messagesPlaying = false;    // Lock to let messages animate before next phase
let faceIconCache = {}; // Cache for generated face icons

// --- DOM ELEMENTS ---
const loadBtn = document.getElementById('load-btn');
const fileInput = document.getElementById('file-input');
const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');
const playBtn = document.getElementById('play-btn');
const speedSelector = document.getElementById('speed-selector');
const phaseDisplay = document.getElementById('phase-display');
const infoPanel = document.getElementById('info-panel');
const mapView = document.getElementById('map-view');
const leaderboard = document.getElementById('leaderboard');

// Add roundRect polyfill for browsers that don't support it
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, width, height, radius) {
    if (typeof radius === 'undefined') {
      radius = 5;
    }
    this.beginPath();
    this.moveTo(x + radius, y);
    this.lineTo(x + width - radius, y);
    this.arcTo(x + width, y, x + width, y + radius, radius);
    this.lineTo(x + width, y + height - radius);
    this.arcTo(x + width, y + height, x + width - radius, y + height, radius);
    this.lineTo(x + radius, y + height);
    this.arcTo(x, y + height, x, y + height - radius, radius);
    this.lineTo(x, y + radius);
    this.arcTo(x, y, x + radius, y, radius);
    this.closePath();
    return this;
  };
}

// --- INITIALIZE SCENE ---

// --- ANIMATION LOOP ---
function animate() {
  requestAnimationFrame(animate);

  const currentTime = Date.now();

  // >>> ADDED: Camera panning when in playback mode
  if (isPlaying) {
    cameraPanTime += cameraPanSpeed;
    // Create a circular arc from SE to SW with vertical wave
    const angle = 0.9 * Math.sin(cameraPanTime) + 1.2;  // range ~0.3..2.1 rad
    const radius = 1200;   // distance from center
    camera.position.set(
      radius * Math.cos(angle),
      800 + 100 * Math.sin(cameraPanTime * 0.5),
      radius * Math.sin(angle)
    );
  } else {
    // Normal camera controls when not in playback
    controls.update();
  }

  // Process unit movement animations
  if (unitAnimations.length > 0) {
    unitAnimations.forEach((anim, index) => {
      // Calculate progress (0 to 1)
      const elapsed = currentTime - anim.startTime;
      const progress = Math.min(1, elapsed / anim.duration);

      // Apply movement
      if (progress < 1) {
        // Apply easing for more natural movement - ease in and out
        const easedProgress = easeInOutCubic(progress);

        // Update position
        anim.object.position.x = anim.startPos.x + (anim.endPos.x - anim.startPos.x) * easedProgress;
        anim.object.position.z = anim.startPos.z + (anim.endPos.z - anim.startPos.z) * easedProgress;

        // Subtle bobbing up and down during movement
        anim.object.position.y = 10 + Math.sin(progress * Math.PI * 2) * 5;

        // For fleets (ships), add a gentle rocking motion
        if (anim.object.userData.type === 'F') {
          anim.object.rotation.z = Math.sin(progress * Math.PI * 3) * 0.05;
          anim.object.rotation.x = Math.sin(progress * Math.PI * 2) * 0.05;
        }
      } else {
        // Animation complete, remove from active animations
        unitAnimations.splice(index, 1);

        // Set final position
        anim.object.position.x = anim.endPos.x;
        anim.object.position.z = anim.endPos.z;
        anim.object.position.y = 10; // Reset height

        // Reset rotation for ships
        if (anim.object.userData.type === 'F') {
          anim.object.rotation.z = 0;
          anim.object.rotation.x = 0;
        }

        // >>> MODIFIED: Check if messages are still playing before advancing
        if (unitAnimations.length === 0 && isPlaying && !messagesPlaying) {
          // Schedule next phase after a pause delay
          playbackTimer = setTimeout(() => advanceToNextPhase(), playbackSpeed);
        }
      }
    });
  }

  // Process territory color transitions
  if (territoryTransitions.length > 0) {
    territoryTransitions.forEach((transition, index) => {
      const elapsed = currentTime - transition.startTime;
      const progress = Math.min(1, elapsed / transition.duration);

      if (progress < 1) {
        // Interpolate colors
        const easedProgress = easeInOutCubic(progress);
        transition.canvas.style.opacity = easedProgress;
      } else {
        // Transition complete
        territoryTransitions.splice(index, 1);
        transition.canvas.style.opacity = 1;
      }
    });
  }

  // Update any pulsing or wave animations on supply centers or units
  if (scene.userData.animatedObjects) {
    scene.userData.animatedObjects.forEach(obj => {
      if (obj.userData.pulseAnimation) {
        const anim = obj.userData.pulseAnimation;
        anim.time += anim.speed;
        if (obj.userData.glowMesh) {
          const pulseValue = Math.sin(anim.time) * anim.intensity + 0.5;
          obj.userData.glowMesh.material.opacity = 0.2 + (pulseValue * 0.3);
          obj.userData.glowMesh.scale.set(
            1 + (pulseValue * 0.1),
            1 + (pulseValue * 0.1),
            1 + (pulseValue * 0.1)
          );
        }
        // Subtle bobbing up/down
        obj.position.y = 2 + Math.sin(anim.time) * 0.5;
      }
    });
  }

  controls.update();
  renderer.render(scene, camera);
}

// Easing function for smooth animations
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// --- RESIZE HANDLER ---
function onWindowResize() {
  camera.aspect = mapView.clientWidth / mapView.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(mapView.clientWidth, mapView.clientHeight);
}


// --- DRAW THE FALLBACK MAP ON A CANVAS ---
function drawFallbackCanvas(ownershipMap = null) {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 2048;
  const ctx = canvas.getContext('2d');

  // Fill background with a radial gradient (sea-like)
  const seaGradient = ctx.createRadialGradient(
    canvas.width / 2, canvas.height / 2, 0,
    canvas.width / 2, canvas.height / 2, canvas.width / 1.5
  );
  seaGradient.addColorStop(0, '#1a3c6e');
  seaGradient.addColorStop(0.7, '#2a5d9e');
  seaGradient.addColorStop(0.9, '#3973ac');
  seaGradient.addColorStop(1, '#4b8bc5');
  ctx.fillStyle = seaGradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // If we have coordinateData, we can draw an "accurate" map:
  if (window.coordinateData && window.coordinateData.coordinates) {
    drawImprovedMap(ctx, canvas.width, canvas.height, ownershipMap);
  } else {
    // Otherwise, just some placeholder
    drawSimplifiedOcean(ctx, canvas.width, canvas.height);
  }

  return new THREE.CanvasTexture(canvas);
}

// --- DRAW AN IMPROVED MAP WITH TERRITORIES ---


// New function to handle territory squishing effects
function applyTerritorySquishing(provinces) {
  // Run several iterations of the simulation with improved approach
  const iterations = 35; // Increased iterations for more stable packing

  // Configure physical simulation parameters - improved values for tighter packing
  const repulsionStrength = 0.04;  // Fine-tuned for better spacing
  const squishFactor = 0.85;      // Increased - makes territories deform more on contact
  const minSquish = 0.22;         // Adjusted for better deformation
  const expansionFactor = 0.012;  // Slightly reduced expansion to prevent oversized territories

  // For each province, we'll store squish data about where and how it's being squished
  provinces.forEach(p => {
    p.squishData = [];
    // Add some variance to radius based on province type
    if (p.territoryType === 'Water') {
      p.radius *= 0.92; // Water even smaller to create more space
    } else if (p.territoryType === 'Land') {
      p.radius *= 1.03; // Land slightly larger
    }
  });

  // Run the simulation
  for (let iter = 0; iter < iterations; iter++) {
    // On each iteration, reset squish data but preserve positions
    provinces.forEach(p => p.squishData = []);

    // First all territories attempt to expand to fill available space
    for (let i = 0; i < provinces.length; i++) {
      const p = provinces[i];
      // Expansion rate is higher in early iterations, then diminishes
      const currentExpansion = expansionFactor * (1 - iter / iterations);

      // Water expands less than land (water can have gaps)
      if (p.territoryType !== 'Water') {
        p.radius *= (1 + currentExpansion);
      }
    }

    // Then check for collisions and resolve them
    for (let i = 0; i < provinces.length; i++) {
      for (let j = i + 1; j < provinces.length; j++) {
        const a = provinces[i];
        const b = provinces[j];

        // Calculate distance between province centers
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // Only process meaningful interactions (not extremely distant territories)
        if (distance > a.radius * 3 || distance > b.radius * 3) continue;

        // Calculate how much provinces would overlap
        const overlap = a.radius + b.radius - distance;

        // If they overlap, calculate repulsion and deformation
        if (overlap > 0) {
          // Normalize direction vector
          const nx = dx / distance;
          const ny = dy / distance;

          // Calculate squish angles (direction from center to contact point)
          const squishAngleA = Math.atan2(dy, dx);
          const squishAngleB = Math.atan2(-dy, -dx);

          // Add squish data for both provinces
          a.squishData.push({
            angle: squishAngleA,
            amount: Math.min(overlap * squishFactor, a.radius * (1 - minSquish)),
            contactPoint: { x: a.x + nx * a.radius, y: a.y + ny * a.radius },
            otherProvince: b.prov
          });

          b.squishData.push({
            angle: squishAngleB,
            amount: Math.min(overlap * squishFactor, b.radius * (1 - minSquish)),
            contactPoint: { x: b.x - nx * b.radius, y: b.y - ny * b.radius },
            otherProvince: a.prov
          });

          // Reduce repulsion for water vs land/coast territories
          let actualRepulsion = repulsionStrength;
          if (a.territoryType === 'Water' || b.territoryType === 'Water') {
            actualRepulsion *= 0.3; // Much less repulsion if water is involved
          }

          // Move provinces apart very slightly to prevent extreme overlaps
          a.x -= nx * overlap * actualRepulsion;
          a.y -= ny * overlap * actualRepulsion;
          b.x += nx * overlap * actualRepulsion;
          b.y += ny * overlap * actualRepulsion;
        }
      }
    }
  }

  // Final pass - add neighbor awareness
  provinces.forEach(p => {
    // Get list of neighboring provinces from squish data
    p.neighbors = [...new Set(p.squishData.map(sd => sd.otherProvince))];
  });
}

// --- NEW FUNCTIONS FOR TERRITORY TYPES ---
// Draw water territories with wave patterns
function drawWaterTerritory(ctx, x, y, radius, fillColor, prov, squishData) {
  ctx.beginPath();

  // Create a more wavy shape for water territories
  const points = 24; // More points for smoother waves
  const angleStep = (Math.PI * 2) / points;
  const seed = prov.charCodeAt(0) + prov.charCodeAt(prov.length - 1);

  // Draw the shape point by point, applying squishing where needed
  for (let i = 0; i <= points; i++) {
    const angle = i * angleStep;

    // Base radius with wave pattern (reduced wave amplitude for cleaner edges)
    let waveFreq = 6; // Wave frequency
    let waveAmp = 0.15; // REDUCED wave amplitude for smoother edges
    let r = radius * (1 + waveAmp * Math.sin(seed + angle * waveFreq));

    // Apply squishing based on overlap data
    if (squishData && squishData.length > 0) {
      // For each squish point, reduce radius in that direction
      squishData.forEach(squish => {
        // Calculate how much this angle is affected by the squish
        const angleDiff = Math.abs(normalizeAngle(angle - squish.angle));

        // Apply squish with a sharper falloff (more squish closer to the contact point)
        if (angleDiff < Math.PI / 2) {
          // Non-linear falloff that creates more natural squishing
          const falloff = Math.pow(1 - (angleDiff / (Math.PI / 2)), 2);
          const squishEffect = falloff * squish.amount;
          r -= squishEffect;
        }
      });
    }

    // Ensure minimum radius
    r = Math.max(r, radius * 0.3);

    const px = x + r * Math.cos(angle);
    const py = y + r * Math.sin(angle);

    if (i === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  }

  ctx.closePath();

  // Fill with gradient for water look
  const gradient = ctx.createRadialGradient(
    x, y, radius * 0.4,
    x, y, radius * 1.2
  );
  gradient.addColorStop(0, fillColor);
  gradient.addColorStop(1, '#0c1d36'); // Darker blue at edges
  ctx.fillStyle = gradient;
  ctx.fill();

  // Add wave details
  ctx.save();
  ctx.clip(); // Clip to territory shape

  // Draw wave lines within the territory
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.lineWidth = 1.5;

  // Randomly positioned wave lines
  for (let i = 0; i < 8; i++) {
    const waveY = y - radius + (i * radius / 4);

    ctx.beginPath();
    for (let wx = x - radius; wx < x + radius; wx += 5) {
      const waveDist = Math.sin((wx + seed) / 20) * 5;
      ctx.lineTo(wx, waveY + waveDist);
    }
    ctx.stroke();
  }

  ctx.restore();

  // Add subtle border
  ctx.lineWidth = 0.8; // Thinner border for cleaner appearance
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)'; // More subtle border
  ctx.stroke();
}

// Draw coastal territories with beach-like transitions
function drawCoastalTerritory(ctx, x, y, radius, fillColor, prov, squishData) {
  // Base shape with slightly irregular coastline
  ctx.beginPath();

  const points = 20; // Increased for smoother shapes
  const angleStep = (Math.PI * 2) / points;
  const seed = prov.charCodeAt(0) + prov.charCodeAt(prov.length - 1);

  // Draw the shape point by point
  for (let i = 0; i <= points; i++) {
    const angle = i * angleStep;

    // Base radius with coastal variation (reduced variation for cleaner edges)
    let r = radius * (0.95 + 0.1 * Math.sin(seed + angle * 4));

    // Add occasional small inlets (reduced frequency)
    if (Math.random() > 0.92) {
      r *= 0.96;
    }

    // Apply squishing where needed
    if (squishData && squishData.length > 0) {
      squishData.forEach(squish => {
        // Calculate how much this angle is affected by the squish
        const angleDiff = Math.abs(normalizeAngle(angle - squish.angle));

        // Apply squish with a natural deformation profile
        if (angleDiff < Math.PI / 3) {
          // Create a natural squish curve (more at direct impact, less at edges)
          const falloff = Math.pow(1 - (angleDiff / (Math.PI / 3)), 1.5);
          const squishEffect = falloff * squish.amount * 1.1;
          r -= squishEffect;

          // Add bulges on the sides with a nice natural curve
          if (angleDiff > Math.PI / 6 && angleDiff < Math.PI / 3) {
            const bulgeAmount = Math.sin((angleDiff - Math.PI / 6) / (Math.PI / 6) * Math.PI);
            r += squish.amount * 0.3 * bulgeAmount;
          }
        }
      });
    }

    // Ensure minimum radius
    r = Math.max(r, radius * 0.3);

    const px = x + r * Math.cos(angle);
    const py = y + r * Math.sin(angle);

    if (i === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  }

  ctx.closePath();

  // Create a coastal gradient (land blending to beach to water)
  const gradient = ctx.createRadialGradient(
    x, y, radius * 0.5,
    x, y, radius
  );
  gradient.addColorStop(0, fillColor);
  gradient.addColorStop(0.7, fillColor);
  gradient.addColorStop(0.85, '#c2b280'); // Sandy beach color
  gradient.addColorStop(1, '#88a0bd'); // Shallow water color at edge

  ctx.fillStyle = gradient;
  ctx.fill();

  // Add a bit more texture for coast
  ctx.save();
  ctx.clip();

  // Draw some dots for sandy texture
  ctx.fillStyle = 'rgba(194, 178, 128, 0.3)'; // Sandy color
  for (let i = 0; i < 30; i++) {
    const dotX = x + (Math.random() * 2 - 1) * radius * 0.8;
    const dotY = y + (Math.random() * 2 - 1) * radius * 0.8;
    const dotSize = 1 + Math.random() * 3;

    ctx.beginPath();
    ctx.arc(dotX, dotY, dotSize, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();

  // Stronger border for coastal areas
  ctx.lineWidth = 1.2; // Slightly thinner for cleaner edges
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)'; // More subtle
  ctx.stroke();
}

// Draw land territories with more angular shapes
function drawLandTerritory(ctx, x, y, radius, fillColor, prov, squishData) {
  ctx.beginPath();

  // Land territories have fewer, more angular points
  const points = 12; // Slightly more points for better squishing
  const angleStep = (Math.PI * 2) / points;
  const seed = prov.charCodeAt(0) + prov.charCodeAt(prov.length - 1);

  // Draw the shape point by point
  for (let i = 0; i <= points; i++) {
    const angle = i * angleStep;

    // Base radius with angular variation (reduced variation for cleaner edges)
    let r = radius * (0.97 + 0.07 * Math.sin(seed + angle * 2));

    // Apply squishing where needed - much improved land squishing
    if (squishData && squishData.length > 0) {
      squishData.forEach(squish => {
        // Calculate how much this angle is affected by the squish
        const angleDiff = Math.abs(normalizeAngle(angle - squish.angle));

        // Apply squish with a sharper profile for land (more angular deformation)
        if (angleDiff < Math.PI / 4) {
          // Sharper, more pronounced squish for land
          const falloff = Math.pow(1 - (angleDiff / (Math.PI / 4)), 1.8);
          const squishEffect = falloff * squish.amount;
          r -= squishEffect;

          // Add more dramatic bulges on edges - creates a "pressed against" effect
          if (angleDiff > Math.PI / 8 && angleDiff < Math.PI / 4) {
            const bulgePos = (angleDiff - Math.PI / 8) / (Math.PI / 8);
            // Sine curve for natural bulging
            const bulgeAmount = Math.sin(bulgePos * Math.PI);
            r += squish.amount * 0.35 * bulgeAmount;
          }
        }
      });
    }

    // Ensure minimum radius but allow more squishing for land
    r = Math.max(r, radius * 0.25);

    const px = x + r * Math.cos(angle);
    const py = y + r * Math.sin(angle);

    if (i === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  }

  ctx.closePath();

  // Land has a bit of texture/gradient
  const gradient = ctx.createRadialGradient(
    x, y, radius * 0.2,
    x, y, radius
  );
  const lighterColor = lightenColor(fillColor, 15);
  const darkerColor = darkenColor(fillColor, 15);

  gradient.addColorStop(0, lighterColor);
  gradient.addColorStop(0.7, fillColor);
  gradient.addColorStop(1, darkerColor);

  ctx.fillStyle = gradient;
  ctx.fill();

  // Add some terrain detail
  ctx.save();
  ctx.clip();

  // Add a few "mountain" or "hill" details as small triangles
  ctx.fillStyle = darkenColor(fillColor, 25);
  for (let i = 0; i < 5; i++) {
    const mx = x + (Math.random() * 2 - 1) * radius * 0.6;
    const my = y + (Math.random() * 2 - 1) * radius * 0.6;
    const size = 3 + Math.random() * 6;

    ctx.beginPath();
    ctx.moveTo(mx, my - size);
    ctx.lineTo(mx - size, my + size);
    ctx.lineTo(mx + size, my + size);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();

  // Strong border for land
  ctx.lineWidth = 1.5; // Slightly thinner for cleaner look
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)'; // More subtle
  ctx.stroke();
}

// Helper to normalize angle to range -PI to PI
function normalizeAngle(angle) {
  while (angle > Math.PI) angle -= 2 * Math.PI;
  while (angle < -Math.PI) angle += 2 * Math.PI;
  return Math.abs(angle);
}

// Get color for a power
function getPowerHexColor(power) {
  const powerColors = {
    'AUSTRIA': '#c40000',
    'ENGLAND': '#00008B',
    'FRANCE': '#0fa0d0',
    'GERMANY': '#444444',
    'ITALY': '#008000',
    'RUSSIA': '#cccccc',
    'TURKEY': '#e0c846'
  };
  return powerColors[power] || '#b19b69'; // fallback to neutral
}

// Just a helper for the star shape
function starPath(ctx, cx, cy, spikes, outerR, innerR) {
  let rot = Math.PI / 2 * 3;
  let x = cx;
  let y = cy;
  const step = Math.PI / spikes;

  ctx.moveTo(cx, cy - outerR);
  for (let i = 0; i < spikes; i++) {
    x = cx + Math.cos(rot) * outerR;
    y = cy + Math.sin(rot) * outerR;
    ctx.lineTo(x, y);
    rot += step;

    x = cx + Math.cos(rot) * innerR;
    y = cy + Math.sin(rot) * innerR;
    ctx.lineTo(x, y);
    rot += step;
  }
  ctx.lineTo(cx, cy - outerR);
  ctx.closePath();
}

// Draw some faint wave lines
function drawOceanBackground(ctx, width, height) {
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 40; i++) {
    const x1 = Math.random() * width;
    const y1 = Math.random() * height;
    const len = 40 + Math.random() * 60;
    const angle = Math.random() * Math.PI;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(
      x1 + Math.cos(angle) * len,
      y1 + Math.sin(angle) * len
    );
    ctx.stroke();
  }
  ctx.restore();
}

// If coordinate data isn't available, just do a big watery rectangle
function drawSimplifiedOcean(ctx, width, height) {
  ctx.fillStyle = '#1a3c6e';
  ctx.fillRect(0, 0, width, height);
}

// --- 3D SUPPLY CENTERS ---
function displaySupplyCenters() {
  if (!coordinateData || !coordinateData.provinces) return;
  for (const [province, data] of Object.entries(coordinateData.provinces)) {
    if (data.isSupplyCenter && coordinateData.coordinates[province]) {
      const pos = getProvincePosition(province);

      // Build a small pillar + star in 3D
      const scGroup = new THREE.Group();

      const baseGeom = new THREE.CylinderGeometry(12, 12, 3, 16);
      const baseMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
      const base = new THREE.Mesh(baseGeom, baseMat);
      base.position.y = 1.5;
      scGroup.add(base);

      const pillarGeom = new THREE.CylinderGeometry(2.5, 2.5, 12, 8);
      const pillarMat = new THREE.MeshStandardMaterial({ color: 0xcccccc });
      const pillar = new THREE.Mesh(pillarGeom, pillarMat);
      pillar.position.y = 7.5;
      scGroup.add(pillar);

      // We'll just do a cone star for simplicity
      const starGeom = new THREE.ConeGeometry(6, 10, 5);
      const starMat = new THREE.MeshStandardMaterial({ color: 0xFFD700 });
      const starMesh = new THREE.Mesh(starGeom, starMat);
      starMesh.rotation.x = Math.PI; // point upwards
      starMesh.position.y = 14;
      scGroup.add(starMesh);

      // Optionally add a glow disc
      const glowGeom = new THREE.CircleGeometry(15, 32);
      const glowMat = new THREE.MeshBasicMaterial({ color: 0xFFFFAA, transparent: true, opacity: 0.3, side: THREE.DoubleSide });
      const glowMesh = new THREE.Mesh(glowGeom, glowMat);
      glowMesh.rotation.x = -Math.PI / 2;
      glowMesh.position.y = 2;
      scGroup.add(glowMesh);

      // Store userData for ownership changes
      scGroup.userData = {
        province,
        isSupplyCenter: true,
        owner: null,
        starMesh,
        glowMesh
      };

      scGroup.position.set(pos.x, 2, pos.z);
      scene.add(scGroup);
      unitMeshes.push(scGroup);
    }
  }
}

function updateSupplyCenterOwnership(centers) {
  if (!centers) return;
  const ownershipMap = {};
  // centers is typically { "AUSTRIA":["VIE","BUD"], "FRANCE":["PAR","MAR"], ... }
  for (const [power, provinces] of Object.entries(centers)) {
    provinces.forEach(p => {
      ownershipMap[p.toUpperCase()] = power.toUpperCase();
    });
  }

  // Basic color scheme
  const powerColors = {
    'AUSTRIA': 0xc40000,
    'ENGLAND': 0x00008B,
    'FRANCE': 0x0fa0d0,
    'GERMANY': 0x444444,
    'ITALY': 0x008000,
    'RUSSIA': 0xcccccc,
    'TURKEY': 0xe0c846
  };

  unitMeshes.forEach(obj => {
    if (obj.userData && obj.userData.isSupplyCenter) {
      const prov = obj.userData.province;
      const owner = ownershipMap[prov];
      if (owner) {
        const c = powerColors[owner] || 0xFFD700;
        obj.userData.starMesh.material.color.setHex(c);

        // Add a pulsing animation
        if (!obj.userData.pulseAnimation) {
          obj.userData.pulseAnimation = {
            speed: 0.003 + Math.random() * 0.002,
            intensity: 0.3,
            time: Math.random() * Math.PI * 2
          };
          if (!scene.userData.animatedObjects) scene.userData.animatedObjects = [];
          scene.userData.animatedObjects.push(obj);
        }
      } else {
        // Neutral
        obj.userData.starMesh.material.color.setHex(0xFFD700);
        // remove pulse
        obj.userData.pulseAnimation = null;
      }
    }
  });
}

// --- UNITS ---
function displayUnit(unitData) {
  // Choose color by power
  const powerColors = {
    'AUSTRIA': 0xc40000,
    'ENGLAND': 0x00008B,
    'FRANCE': 0x0fa0d0,
    'GERMANY': 0x444444,
    'ITALY': 0x008000,
    'RUSSIA': 0xcccccc,
    'TURKEY': 0xe0c846
  };
  const color = powerColors[unitData.power] || 0xAAAAAA;

  let group = new THREE.Group();
  // Minimal shape difference for armies vs fleets
  if (unitData.type === 'A') {
    // Army: a block + small head for soldier-like appearance
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(15, 20, 10),
      new THREE.MeshStandardMaterial({ color })
    );
    body.position.y = 10;
    group.add(body);

    // Head
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(4, 12, 12),
      new THREE.MeshStandardMaterial({ color })
    );
    head.position.set(0, 24, 0);
    group.add(head);
  } else {
    // Fleet: a rectangle + a mast and sail
    const hull = new THREE.Mesh(
      new THREE.BoxGeometry(30, 8, 15),
      new THREE.MeshStandardMaterial({ color: 0x8B4513 })
    );
    hull.position.y = 4;
    group.add(hull);

    // Mast
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 30, 8),
      new THREE.MeshStandardMaterial({ color: 0x000000 })
    );
    mast.position.y = 15;
    group.add(mast);

    // Sail
    const sail = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 15),
      new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide })
    );
    sail.rotation.y = Math.PI / 2;
    sail.position.set(0, 15, 0);
    group.add(sail);
  }

  // Position
  const pos = getProvincePosition(unitData.location);
  group.position.set(pos.x, 10, pos.z);

  // Store meta
  group.userData = {
    power: unitData.power,
    type: unitData.type,
    location: unitData.location
  };

  scene.add(group);
  unitMeshes.push(group);
}

function getProvincePosition(loc) {
  // Convert e.g. "Spa/sc" to "SPA_SC" if needed
  const normalized = loc.toUpperCase().replace('/', '_');
  const base = normalized.split('_')[0];

  if (coordinateData && coordinateData.coordinates) {
    if (coordinateData.coordinates[normalized]) {
      return coordinateData.coordinates[normalized];
    }
    if (coordinateData.coordinates[base]) {
      return coordinateData.coordinates[base];
    }
  }
  // Fallback if missing
  return hashStringToPosition(loc);
}

function hashStringToPosition(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  const x = (hash % 800) - 400;
  const z = ((hash >> 8) % 800) - 400;
  return { x, y: 0, z };
}

// --- LOADING & DISPLAYING GAME PHASES ---
function loadGame(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      gameData = JSON.parse(e.target.result);
      infoPanel.textContent = `Game data loaded: ${gameData.phases?.length || 0} phases found.`;
      currentPhaseIndex = 0;
      if (gameData.phases?.length) {
        prevBtn.disabled = false;
        nextBtn.disabled = false;
        playBtn.disabled = false;
        speedSelector.disabled = false;

        // Initialize chat windows
        createChatWindows();

        displayPhase(currentPhaseIndex);
      }
    } catch (err) {
      infoPanel.textContent = "Error parsing JSON: " + err.message;
    }
  };
  reader.onerror = () => {
    infoPanel.textContent = "Error reading file.";
  };
  reader.readAsText(file);
}

function displayPhase(index) {
  if (!gameData || !gameData.phases || index < 0 || index >= gameData.phases.length) {
    infoPanel.textContent = "Invalid phase index.";
    return;
  }

  // Clear old units
  unitMeshes.forEach(m => scene.remove(m));
  unitMeshes = [];

  const phase = gameData.phases[index];
  phaseDisplay.textContent = `Era: ${phase.name || 'Unknown Era'} (${index + 1}/${gameData.phases.length})`;

  // Build ownership map for territory coloring - IMPROVED TO INCLUDE BOTH UNITS AND CENTERS
  const centers = phase.state?.centers || {};
  const units = phase.state?.units || {};
  const ownershipMap = {};

  // First add supply centers to ownership map
  for (const [power, provinces] of Object.entries(centers)) {
    provinces.forEach(p => {
      ownershipMap[p.toUpperCase()] = power.toUpperCase();
    });
  }

  // Then add territories where units are located (if not already claimed by supply centers)
  for (const [power, unitArray] of Object.entries(units)) {
    unitArray.forEach(unitStr => {
      const match = unitStr.match(/^([AF])\s+(.+)$/);
      if (match) {
        const location = match[2].toUpperCase().split('/')[0]; // Handle special coast cases like "SPA/SC"
        // Only add if not already claimed as a supply center
        if (!ownershipMap[location]) {
          ownershipMap[location] = power.toUpperCase();
        }
      }
    });
  }

  // Re-draw the fallback map with updated territory colors
  //createFallbackMap(ownershipMap);

  // 1) Show supply centers (3D approach)
  displaySupplyCenters();

  // 2) If phase has supply center ownership data
  if (phase.state?.centers) {
    updateSupplyCenterOwnership(phase.state.centers);
  }

  // 3) Show units
  if (phase.state?.units) {
    for (const [power, unitArr] of Object.entries(phase.state.units)) {
      unitArr.forEach(unitStr => {
        const match = unitStr.match(/^([AF])\s+(.+)$/);
        if (match) {
          displayUnit({
            power: power.toUpperCase(),
            type: match[1],
            location: match[2],
          });
        }
      });
    }
  }

  // Update the leaderboard
  updateLeaderboard(phase);

  // Update chat windows with messages from this phase
  updateChatWindows(phase);

  // Show some info in the panel
  infoPanel.textContent = `Phase: ${phase.name}\nSupply centers: ${phase.state?.centers ? JSON.stringify(phase.state.centers) : 'None'
    }\nUnits: ${phase.state?.units ? JSON.stringify(phase.state.units) : 'None'
    }`;
}

// --- LEADERBOARD FUNCTION ---
function updateLeaderboard(phase) {
  // Get supply center counts
  const centerCounts = {};
  const unitCounts = {};

  // Count supply centers by power
  if (phase.state?.centers) {
    for (const [power, provinces] of Object.entries(phase.state.centers)) {
      centerCounts[power] = provinces.length;
    }
  }

  // Count units by power
  if (phase.state?.units) {
    for (const [power, units] of Object.entries(phase.state.units)) {
      unitCounts[power] = units.length;
    }
  }

  // Combine all powers from both centers and units
  const allPowers = new Set([
    ...Object.keys(centerCounts),
    ...Object.keys(unitCounts)
  ]);

  // Sort powers by supply center count (descending)
  const sortedPowers = Array.from(allPowers).sort((a, b) => {
    return (centerCounts[b] || 0) - (centerCounts[a] || 0);
  });

  // Build HTML for leaderboard
  let html = `<strong>Council Standings</strong><br/>`;

  sortedPowers.forEach(power => {
    const centers = centerCounts[power] || 0;
    const units = unitCounts[power] || 0;

    // Use CSS classes instead of inline styles for better contrast
    html += `<div style="margin: 5px 0; display: flex; justify-content: space-between;">
          <span class="power-${power.toLowerCase()}">${power}</span>
          <span>${centers} SCs, ${units} units</span>
        </div>`;
  });

  // Add victory condition reminder
  html += `<hr style="border-color: #555; margin: 8px 0;"/>
        <small>Victory: 18 supply centers</small>`;

  leaderboard.innerHTML = html;
}

// --- PLAYBACK CONTROLS ---
function togglePlayback() {
  if (!gameData || gameData.phases.length <= 1) return;

  isPlaying = !isPlaying;

  if (isPlaying) {
    // Update button text to show pause
    playBtn.textContent = "⏸ Pause";

    // Disable manual navigation during playback
    prevBtn.disabled = true;
    nextBtn.disabled = true;

    // Start playback with animation
    displayPhaseWithAnimation(currentPhaseIndex);
  } else {
    // Update button text to show play
    playBtn.textContent = "▶ Play";

    // Clear any pending timers
    if (playbackTimer) {
      clearTimeout(playbackTimer);
      playbackTimer = null;
    }

    // Cancel any ongoing animations
    unitAnimations = [];
    messagesPlaying = false;

    // Re-enable manual navigation
    prevBtn.disabled = false;
    nextBtn.disabled = false;
  }
}

function advanceToNextPhase() {
  // If we've reached the end, loop back to the beginning
  if (currentPhaseIndex >= gameData.phases.length - 1) {
    currentPhaseIndex = 0;
  } else {
    currentPhaseIndex++;
  }

  // Display the new phase with animation
  displayPhaseWithAnimation(currentPhaseIndex);
}

function displayPhaseWithAnimation(index) {
  if (!gameData || !gameData.phases || index < 0 || index >= gameData.phases.length) {
    infoPanel.textContent = "Invalid phase index.";
    return;
  }

  const previousIndex = index > 0 ? index - 1 : gameData.phases.length - 1;
  const currentPhase = gameData.phases[index];
  const previousPhase = gameData.phases[previousIndex];

  phaseDisplay.textContent = `Era: ${currentPhase.name || 'Unknown Era'} (${index + 1}/${gameData.phases.length})`;

  // Build ownership maps for territory coloring
  const currentCenters = currentPhase.state?.centers || {};
  const currentUnits = currentPhase.state?.units || {};
  const previousCenters = previousPhase.state?.centers || {};
  const previousUnits = previousPhase.state?.units || {};

  const currentOwnershipMap = buildOwnershipMap(currentCenters, currentUnits);
  const previousOwnershipMap = buildOwnershipMap(previousCenters, previousUnits);

  // Update map with new territory colors (if needed)
  createFallbackMap(currentOwnershipMap);

  // Clear previous unit meshes (except supply centers)
  const supplyCenters = unitMeshes.filter(m => m.userData && m.userData.isSupplyCenter);
  const oldUnits = unitMeshes.filter(m => m.userData && !m.userData.isSupplyCenter);

  oldUnits.forEach(m => scene.remove(m));
  unitMeshes = supplyCenters; // Keep supply centers

  // Update supply center ownership
  if (currentPhase.state?.centers) {
    updateSupplyCenterOwnership(currentPhase.state.centers);
  }

  // Create unit position maps for animation
  const previousUnitPositions = {};
  const currentUnitPositions = {};

  // Map previous unit positions
  if (previousPhase.state?.units) {
    for (const [power, unitArr] of Object.entries(previousPhase.state.units)) {
      unitArr.forEach(unitStr => {
        const match = unitStr.match(/^([AF])\s+(.+)$/);
        if (match) {
          const key = `${power}-${match[1]}-${match[2]}`;
          previousUnitPositions[key] = getProvincePosition(match[2]);
        }
      });
    }
  }

  // Create and position new units, with animation from previous positions if available
  if (currentPhase.state?.units) {
    for (const [power, unitArr] of Object.entries(currentPhase.state.units)) {
      unitArr.forEach(unitStr => {
        const match = unitStr.match(/^([AF])\s+(.+)$/);
        if (match) {
          const unitType = match[1];
          const location = match[2];
          const key = `${power}-${unitType}-${location}`;

          // Create the unit mesh
          const unitMesh = createUnitMesh({
            power: power.toUpperCase(),
            type: unitType,
            location: location,
          });

          // Get current position
          const currentPos = getProvincePosition(location);
          currentUnitPositions[key] = currentPos;

          // Choose starting position
          let startPos;

          // Try to find a matching unit in the previous phase
          let matchFound = false;
          for (const prevKey in previousUnitPositions) {
            // Check if same power and type (but possibly different location)
            if (prevKey.startsWith(`${power}-${unitType}`)) {
              startPos = previousUnitPositions[prevKey];
              matchFound = true;
              delete previousUnitPositions[prevKey]; // Mark as matched
              break;
            }
          }

          if (!matchFound) {
            // New unit - create with a "spawn" animation
            startPos = {
              x: currentPos.x,
              y: -20, // Start below the map
              z: currentPos.z
            };
          }

          // Position at start position
          unitMesh.position.set(startPos.x, 10, startPos.z);
          scene.add(unitMesh);
          unitMeshes.push(unitMesh);

          // Add animation to move to final position
          unitAnimations.push({
            object: unitMesh,
            startPos: startPos,
            endPos: currentPos,
            startTime: Date.now(),
            duration: animationDuration
          });
        }
      });
    }
  }

  // Update the leaderboard
  updateLeaderboard(currentPhase);

  // Update chat windows with messages from this phase - in step mode for playback
  updateChatWindows(currentPhase, true);

  // Show phase info
  infoPanel.textContent = `Phase: ${currentPhase.name}\nSupply centers: ${currentPhase.state?.centers ? JSON.stringify(currentPhase.state.centers) : 'None'
    }\nUnits: ${currentPhase.state?.units ? JSON.stringify(currentPhase.state.units) : 'None'
    }`;
}

// Helper function to create ownership map from centers and units
function buildOwnershipMap(centers, units) {
  const ownershipMap = {};

  // First add supply centers
  for (const [power, provinces] of Object.entries(centers)) {
    provinces.forEach(p => {
      ownershipMap[p.toUpperCase()] = power.toUpperCase();
    });
  }

  // Then add territories with units
  for (const [power, unitArray] of Object.entries(units)) {
    unitArray.forEach(unitStr => {
      const match = unitStr.match(/^([AF])\s+(.+)$/);
      if (match) {
        const location = match[2].toUpperCase().split('/')[0];
        if (!ownershipMap[location]) {
          ownershipMap[location] = power.toUpperCase();
        }
      }
    });
  }

  return ownershipMap;
}

// Create a unit mesh (extracted from displayUnit for reuse)
function createUnitMesh(unitData) {
  // Choose color by power
  const powerColors = {
    'AUSTRIA': 0xc40000,
    'ENGLAND': 0x00008B,
    'FRANCE': 0x0fa0d0,
    'GERMANY': 0x444444,
    'ITALY': 0x008000,
    'RUSSIA': 0xcccccc,
    'TURKEY': 0xe0c846
  };
  const color = powerColors[unitData.power] || 0xAAAAAA;

  let group = new THREE.Group();
  // Minimal shape difference for armies vs fleets
  if (unitData.type === 'A') {
    // Army: a block + small head for soldier-like appearance
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(15, 20, 10),
      new THREE.MeshStandardMaterial({ color })
    );
    body.position.y = 10;
    group.add(body);

    // Head
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(4, 12, 12),
      new THREE.MeshStandardMaterial({ color })
    );
    head.position.set(0, 24, 0);
    group.add(head);
  } else {
    // Fleet: a rectangle + a mast and sail
    const hull = new THREE.Mesh(
      new THREE.BoxGeometry(30, 8, 15),
      new THREE.MeshStandardMaterial({ color: 0x8B4513 })
    );
    hull.position.y = 4;
    group.add(hull);

    // Mast
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 30, 8),
      new THREE.MeshStandardMaterial({ color: 0x000000 })
    );
    mast.position.y = 15;
    group.add(mast);

    // Sail
    const sail = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 15),
      new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide })
    );
    sail.rotation.y = Math.PI / 2;
    sail.position.set(0, 15, 0);
    group.add(sail);
  }

  // Store metadata
  group.userData = {
    power: unitData.power,
    type: unitData.type,
    location: unitData.location
  };

  return group;
}

// --- EVENT HANDLERS ---
loadBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) {
    loadGame(file);
  }
});

prevBtn.addEventListener('click', () => {
  if (currentPhaseIndex > 0) {
    currentPhaseIndex--;
    displayPhase(currentPhaseIndex);
  }
});
nextBtn.addEventListener('click', () => {
  if (gameData && currentPhaseIndex < gameData.phases.length - 1) {
    currentPhaseIndex++;
    displayPhase(currentPhaseIndex);
  }
});

playBtn.addEventListener('click', togglePlayback);

speedSelector.addEventListener('change', e => {
  playbackSpeed = parseInt(e.target.value);
  // If we're currently playing, restart the timer with the new speed
  if (isPlaying && playbackTimer) {
    clearTimeout(playbackTimer);
    playbackTimer = setTimeout(() => advanceToNextPhase(), playbackSpeed);
  }
});

// --- BOOTSTRAP ON PAGE LOAD ---
window.addEventListener('load', initScene);

// Utility functions for color manipulation
function lightenColor(hex, percent) {
  return colorShift(hex, percent);
}

function darkenColor(hex, percent) {
  return colorShift(hex, -percent);
}

function colorShift(hex, percent) {
  // Convert hex to RGB
  let r = parseInt(hex.substr(1, 2), 16);
  let g = parseInt(hex.substr(3, 2), 16);
  let b = parseInt(hex.substr(5, 2), 16);

  // Shift color by percentage
  r = Math.min(255, Math.max(0, r + Math.floor(r * percent / 100)));
  g = Math.min(255, Math.max(0, g + Math.floor(g * percent / 100)));
  b = Math.min(255, Math.max(0, b + Math.floor(b * percent / 100)));

  // Convert back to hex
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// Create a naive adjacency list by distance - function that was previously removed
function buildAdjacencyList() {
  const adjacency = {};
  const threshold = 150; // Increased distance threshold for adjacency

  // Initialize empty adjacency lists
  for (const p1 of Object.keys(coordinateData.coordinates)) {
    if (p1.includes('_')) continue;
    adjacency[p1] = [];
  }

  // Compare each pair of provinces
  const keys = Object.keys(adjacency);
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = keys[i];
      const b = keys[j];
      const posA = coordinateData.coordinates[a];
      const posB = coordinateData.coordinates[b];
      const dx = posA.x - posB.x;
      const dz = posA.z - posB.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      // Use a dynamic threshold based on province names to handle special cases
      let dynamicThreshold = threshold;

      // If either province is a known coastal province, increase threshold slightly
      const coastalProvinces = ['spa', 'por', 'bre', 'gas', 'mar', 'pie', 'ven', 'rom', 'nap', 'apu', 'tus'];
      if (coastalProvinces.includes(a.toLowerCase()) || coastalProvinces.includes(b.toLowerCase())) {
        dynamicThreshold *= 1.1;
      }

      if (dist < dynamicThreshold) {
        adjacency[a].push(b);
        adjacency[b].push(a);
      }
    }
  }

  // Add some known adjacencies that might be missed due to distance
  const knownAdjacencies = {
    'stp': ['fin', 'nwy', 'lvn', 'mos'],
    'naf': ['tun'],
    'spa': ['por', 'gas', 'mar'],
    'swe': ['fin', 'nwy', 'den']
  };

  for (const [prov, neighbors] of Object.entries(knownAdjacencies)) {
    if (adjacency[prov]) {
      neighbors.forEach(n => {
        if (adjacency[n] && !adjacency[prov].includes(n)) {
          adjacency[prov].push(n);
          adjacency[n].push(prov);
        }
      });
    }
  }

  return adjacency;
}

// --- CHAT WINDOW FUNCTIONS ---
function createChatWindows() {
  // Clear existing chat windows
  const chatContainer = document.getElementById('chat-container');
  chatContainer.innerHTML = '';
  chatWindows = {};

  // Create a chat window for each power (except the current power)
  const powers = ['AUSTRIA', 'ENGLAND', 'GERMANY', 'ITALY', 'RUSSIA', 'TURKEY'];

  // Filter out the current power
  const otherPowers = powers.filter(power => power !== currentPower);

  // Add a GLOBAL chat window first
  createChatWindow('GLOBAL', true);

  // Create chat windows for each power
  otherPowers.forEach(power => {
    createChatWindow(power);
  });
}

// Modified to use 3D face icons properly
function createChatWindow(power, isGlobal = false) {
  const chatContainer = document.getElementById('chat-container');
  const chatWindow = document.createElement('div');
  chatWindow.className = 'chat-window';
  chatWindow.id = `chat-${power}`;

  // Create header with appropriate styling
  const header = document.createElement('div');
  header.className = 'chat-header';

  // Adjust header to accommodate larger face icons
  header.style.display = 'flex';
  header.style.alignItems = 'center';
  header.style.padding = '8px';

  // Create the title element
  const titleElement = document.createElement('span');
  if (isGlobal) {
    titleElement.style.color = '#ffffff';
    titleElement.textContent = 'GLOBAL';
  } else {
    titleElement.className = `power-${power.toLowerCase()}`;
    titleElement.textContent = power;
  }
  header.appendChild(titleElement);

  // Create container for 3D face icon - EVEN BIGGER NOW
  const faceHolder = document.createElement('div');
  faceHolder.style.width = '64px'; // Increased from 48px to 64px
  faceHolder.style.height = '64px'; // Increased from 48px to 64px
  faceHolder.style.marginLeft = 'auto';
  faceHolder.style.cursor = 'pointer';
  faceHolder.style.borderRadius = '50%'; // Make it circular
  faceHolder.style.overflow = 'hidden'; // Keep the image within the circle
  faceHolder.style.boxShadow = '0 2px 5px rgba(0,0,0,0.3)'; // Add some depth
  faceHolder.style.border = '2px solid #fff'; // White border for contrast
  faceHolder.id = `face-${power}`; // Add ID for animation targeting

  // Generate the face icon and add it to the header
  generateFaceIcon(power).then(dataURL => {
    const img = document.createElement('img');
    img.src = dataURL;
    img.style.width = '100%';
    img.style.height = '100%';
    img.id = `face-img-${power}`; // Add ID for animation targeting

    // Add subtle idle animation
    setInterval(() => {
      if (!img.dataset.animating && Math.random() < 0.1) { // Occasionally animate while idle
        idleAnimation(img);
      }
    }, 3000);

    faceHolder.appendChild(img);
  });

  header.appendChild(faceHolder);

  // Create messages container
  const messagesContainer = document.createElement('div');
  messagesContainer.className = 'chat-messages';
  messagesContainer.id = `messages-${power}`;

  // Add toggle functionality
  header.addEventListener('click', () => {
    chatWindow.classList.toggle('chat-collapsed');
  });

  // Assemble chat window
  chatWindow.appendChild(header);
  chatWindow.appendChild(messagesContainer);

  // Add to container
  chatContainer.appendChild(chatWindow);

  // Store reference
  chatWindows[power] = {
    element: chatWindow,
    messagesContainer: messagesContainer,
    isGlobal: isGlobal,
    seenMessages: new Set() // Track which messages we've already shown
  };
}

// Modified to accumulate messages instead of resetting
function updateChatWindows(phase, stepMessages = false) {
  if (!phase.messages || !phase.messages.length) {
    messagesPlaying = false;
    return;
  }

  // DO NOT clear existing messages - we'll check if they're new before adding

  // Filter messages relevant to the current power
  const relevantMessages = phase.messages.filter(msg => {
    return (msg.sender === currentPower ||
      msg.recipient === currentPower ||
      msg.recipient === 'GLOBAL');
  });

  // Sort messages by time
  relevantMessages.sort((a, b) => a.time_sent - b.time_sent);

  if (!stepMessages) {
    // Normal mode: add all messages at once
    relevantMessages.forEach(msg => {
      addMessageToChat(msg, phase.name);
    });
    messagesPlaying = false;
  } else {
    // Stepwise playback: show one message at a time
    messagesPlaying = true;
    let index = 0;

    const showNext = () => {
      if (index >= relevantMessages.length) {
        // Done with messages, allow advancing to next phase
        messagesPlaying = false;
        if (unitAnimations.length === 0 && isPlaying) {
          playbackTimer = setTimeout(() => advanceToNextPhase(), playbackSpeed);
        }
        return;
      }

      const msg = relevantMessages[index];
      addMessageToChat(msg, phase.name);
      animateHeadNod(msg);
      index++;
      setTimeout(showNext, 1000); // Show next message after 1 second
    };

    // Start the message sequence
    showNext();
  }
}

// Modified to check if message is already shown
function addMessageToChat(msg, phaseName) {
  // Determine which chat window to use
  let targetPower;
  if (msg.recipient === 'GLOBAL') {
    targetPower = 'GLOBAL';
  } else {
    targetPower = msg.sender === currentPower ? msg.recipient : msg.sender;
  }

  if (!chatWindows[targetPower]) return;

  // Create a unique ID for this message to avoid duplication
  const msgId = `${msg.sender}-${msg.recipient}-${msg.time_sent}-${msg.message}`;

  // Skip if we've already shown this message
  if (chatWindows[targetPower].seenMessages.has(msgId)) {
    return;
  }

  // Mark as seen
  chatWindows[targetPower].seenMessages.add(msgId);

  const messagesContainer = chatWindows[targetPower].messagesContainer;
  const messageElement = document.createElement('div');

  // Style based on sender/recipient
  if (targetPower === 'GLOBAL') {
    // Global chat shows sender info
    const senderColor = msg.sender.toLowerCase();
    messageElement.className = 'chat-message message-incoming';
    messageElement.innerHTML = `
      <span style="font-weight: bold;" class="power-${senderColor}">${msg.sender}:</span>
      ${msg.message}
      <div class="message-time">${phaseName}</div>
    `;
  } else {
    // Private chat - outgoing or incoming style
    const isOutgoing = msg.sender === currentPower;
    messageElement.className = `chat-message ${isOutgoing ? 'message-outgoing' : 'message-incoming'}`;
    messageElement.innerHTML = `
      ${msg.message}
      <div class="message-time">${phaseName}</div>
    `;
  }

  // Add to container
  messagesContainer.appendChild(messageElement);

  // Scroll to bottom
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Animate a head nod when a message appears
function animateHeadNod(msg) {
  // Determine which chat window's head to animate
  let targetPower;
  if (msg.recipient === 'GLOBAL') {
    targetPower = 'GLOBAL';
  } else {
    targetPower = msg.sender === currentPower ? msg.recipient : msg.sender;
  }

  const chatWindow = chatWindows[targetPower]?.element;
  if (!chatWindow) return;

  // Find the face image and animate it
  const img = chatWindow.querySelector(`#face-img-${targetPower}`);
  if (!img) return;

  img.dataset.animating = 'true';

  // Choose a random animation type for variety
  const animationType = Math.floor(Math.random() * 4);

  let animation;

  switch (animationType) {
    case 0: // Nod animation
      animation = img.animate([
        { transform: 'rotate(0deg) scale(1)' },
        { transform: 'rotate(15deg) scale(1.1)' },
        { transform: 'rotate(-10deg) scale(1.05)' },
        { transform: 'rotate(5deg) scale(1.02)' },
        { transform: 'rotate(0deg) scale(1)' }
      ], {
        duration: 600,
        easing: 'ease-in-out'
      });
      break;

    case 1: // Bounce animation
      animation = img.animate([
        { transform: 'translateY(0) scale(1)' },
        { transform: 'translateY(-8px) scale(1.15)' },
        { transform: 'translateY(3px) scale(0.95)' },
        { transform: 'translateY(-2px) scale(1.05)' },
        { transform: 'translateY(0) scale(1)' }
      ], {
        duration: 700,
        easing: 'ease-in-out'
      });
      break;

    case 2: // Shake animation
      animation = img.animate([
        { transform: 'translate(0, 0) rotate(0deg)' },
        { transform: 'translate(-5px, -3px) rotate(-5deg)' },
        { transform: 'translate(5px, 2px) rotate(5deg)' },
        { transform: 'translate(-5px, 1px) rotate(-3deg)' },
        { transform: 'translate(0, 0) rotate(0deg)' }
      ], {
        duration: 500,
        easing: 'ease-in-out'
      });
      break;

    case 3: // Pulse animation
      animation = img.animate([
        { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(255,255,255,0.7)' },
        { transform: 'scale(1.2)', boxShadow: '0 0 0 10px rgba(255,255,255,0)' },
        { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(255,255,255,0)' }
      ], {
        duration: 800,
        easing: 'ease-out'
      });
      break;
  }

  animation.onfinish = () => {
    img.dataset.animating = 'false';
  };
}

// Generate a 3D face icon for chat windows with higher contrast
async function generateFaceIcon(power) {
  if (faceIconCache[power]) {
    return faceIconCache[power];
  }

  // Even larger renderer size for better quality
  const offWidth = 192, offHeight = 192; // Increased from 128x128 to 192x192
  const offRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  offRenderer.setSize(offWidth, offHeight);
  offRenderer.setPixelRatio(1);

  // Scene
  const offScene = new THREE.Scene();
  offScene.background = null;

  // Camera
  const offCamera = new THREE.PerspectiveCamera(45, offWidth / offHeight, 0.1, 1000);
  offCamera.position.set(0, 0, 50);

  // Power-specific colors with higher contrast/saturation
  const colorMap = {
    'GLOBAL': 0xf5f5f5, // Brighter white
    'AUSTRIA': 0xff0000, // Brighter red
    'ENGLAND': 0x0000ff, // Brighter blue
    'FRANCE': 0x00bfff, // Brighter cyan
    'GERMANY': 0x1a1a1a, // Darker gray for better contrast
    'ITALY': 0x00cc00, // Brighter green
    'RUSSIA': 0xe0e0e0, // Brighter gray
    'TURKEY': 0xffcc00  // Brighter yellow
  };
  const headColor = colorMap[power] || 0x808080;

  // Larger head geometry
  const headGeom = new THREE.BoxGeometry(20, 20, 20); // Increased from 16x16x16
  const headMat = new THREE.MeshStandardMaterial({ color: headColor });
  const headMesh = new THREE.Mesh(headGeom, headMat);
  offScene.add(headMesh);

  // Create outline for better visibility (a slightly larger black box behind)
  const outlineGeom = new THREE.BoxGeometry(22, 22, 19);
  const outlineMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const outlineMesh = new THREE.Mesh(outlineGeom, outlineMat);
  outlineMesh.position.z = -2; // Place it behind the head
  offScene.add(outlineMesh);

  // Larger eyes with better contrast
  const eyeGeom = new THREE.BoxGeometry(3.5, 3.5, 3.5); // Increased from 2.5x2.5x2.5
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x000000 });
  const leftEye = new THREE.Mesh(eyeGeom, eyeMat);
  leftEye.position.set(-4.5, 2, 10); // Adjusted position
  offScene.add(leftEye);
  const rightEye = new THREE.Mesh(eyeGeom, eyeMat);
  rightEye.position.set(4.5, 2, 10); // Adjusted position
  offScene.add(rightEye);

  // Add a simple mouth
  const mouthGeom = new THREE.BoxGeometry(8, 1.5, 1);
  const mouthMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const mouth = new THREE.Mesh(mouthGeom, mouthMat);
  mouth.position.set(0, -3, 10);
  offScene.add(mouth);

  // Brighter lighting for better contrast
  const light = new THREE.DirectionalLight(0xffffff, 1.2); // Increased intensity
  light.position.set(0, 20, 30);
  offScene.add(light);

  // Add more lights for better definition
  const fillLight = new THREE.DirectionalLight(0xffffff, 0.5);
  fillLight.position.set(-20, 0, 20);
  offScene.add(fillLight);

  offScene.add(new THREE.AmbientLight(0xffffff, 0.4)); // Slightly brighter ambient

  // Slight head rotation
  headMesh.rotation.y = Math.PI / 6; // More pronounced angle

  // Render to a texture
  const renderTarget = new THREE.WebGLRenderTarget(offWidth, offHeight);
  offRenderer.setRenderTarget(renderTarget);
  offRenderer.render(offScene, offCamera);

  // Get pixels
  const pixels = new Uint8Array(offWidth * offHeight * 4);
  offRenderer.readRenderTargetPixels(renderTarget, 0, 0, offWidth, offHeight, pixels);

  // Convert to canvas
  const canvas = document.createElement('canvas');
  canvas.width = offWidth;
  canvas.height = offHeight;
  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(offWidth, offHeight);
  imageData.data.set(pixels);

  // Flip image (WebGL coordinate system is inverted)
  flipImageDataVertically(imageData, offWidth, offHeight);
  ctx.putImageData(imageData, 0, 0);

  // Get data URL
  const dataURL = canvas.toDataURL('image/png');
  faceIconCache[power] = dataURL;

  // Cleanup
  offRenderer.dispose();
  renderTarget.dispose();

  return dataURL;
}

// Add a subtle idle animation for faces
function idleAnimation(img) {
  if (img.dataset.animating === 'true') return;

  img.dataset.animating = 'true';

  const animation = img.animate([
    { transform: 'rotate(0deg) scale(1)' },
    { transform: 'rotate(-2deg) scale(0.98)' },
    { transform: 'rotate(0deg) scale(1)' }
  ], {
    duration: 1500,
    easing: 'ease-in-out'
  });

  animation.onfinish = () => {
    img.dataset.animating = 'false';
  };
}

// Helper to flip image data vertically
function flipImageDataVertically(imageData, width, height) {
  const bytesPerRow = width * 4;
  const temp = new Uint8ClampedArray(bytesPerRow);
  for (let y = 0; y < height / 2; y++) {
    const topOffset = y * bytesPerRow;
    const bottomOffset = (height - y - 1) * bytesPerRow;
    temp.set(imageData.data.slice(topOffset, topOffset + bytesPerRow));
    imageData.data.set(imageData.data.slice(bottomOffset, bottomOffset + bytesPerRow), topOffset);
    imageData.data.set(temp, bottomOffset);
  }
}
