import * as THREE from "three";

import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { addMapMouseEvents } from "./map/mouseMovement"
import { createBaseMap } from "./map/initMap"
import { loadCoordinateData } from "./data"

function initScene(mapView: HTMLElement) {
  let scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87CEEB);

  // Camera
  let camera = new THREE.PerspectiveCamera(
    60,
    mapView.clientWidth / mapView.clientHeight,
    1,
    3000
  );
  camera.position.set(800, 0, 800);

  // Renderer
  let renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(mapView.clientWidth, mapView.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  mapView.appendChild(renderer.domElement);

  // Controls
  let controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.screenSpacePanning = true;
  controls.minDistance = 100;
  controls.maxDistance = 1500;
  controls.maxPolarAngle = Math.PI / 2; // Limit so you don't flip under the map

  // Lighting (keep it simple)
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
  dirLight.position.set(300, 400, 300);
  scene.add(dirLight);



  // Load coordinate data, then build the fallback map
  loadCoordinateData()
    .then(() => {
      createBaseMap();  // Create the map plane from the start
      // target the center of the map
      controls.target = new THREE.Vector3(800, 0, 800)
    })
    .catch(err => {
      console.error("Error loading coordinates:", err);
    });

  // Kick off animation loop
  animate();

  // Handle resizing
  window.addEventListener('resize', onWindowResize);
  return { scene, camera, renderer, controls }
}
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


let { scene, camera, renderer, controls } = initScene()
export { scene, camera, renderer, controls }
