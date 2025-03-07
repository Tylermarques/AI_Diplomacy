import * as THREE from "three";
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { createLabel } from "./labels"


export function createBaseMap() {
  const loader = new SVGLoader();
  loader.load('assets/maps/standard/standard.svg',
    function (data) {
      fetch('assets/maps/standard/standard_styles.json')
        .then(resp => resp.json())
        .then(map_styles => {
          const paths = data.paths;
          const group = new THREE.Group();
          const textGroup = new THREE.Group();

          for (let i = 0; i < paths.length; i++) {
            let fillColor = ""

            const path = paths[i];
            if (map_styles[path.userData.node.classList[0]] === undefined) {
              // If there is no style in the map_styles, skip drawing the shape
              continue
            } else {
              fillColor = map_styles[path.userData.node.classList[0]].fill;
            }

            const material = new THREE.MeshBasicMaterial({
              color: fillColor,
              side: THREE.DoubleSide,
              depthWrite: false
            });

            const shapes = SVGLoader.createShapes(path);

            for (let j = 0; j < shapes.length; j++) {

              const shape = shapes[j];
              const geometry = new THREE.ShapeGeometry(shape);
              const mesh = new THREE.Mesh(geometry, material);

              mesh.rotation.x = Math.PI / 2;
              group.add(mesh);


              // Create an edges geometry from the shape geometry.
              const edges = new THREE.EdgesGeometry(geometry);
              // Create a line material with black color for the border.
              const lineMaterial = new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 2 });
              // Create the line segments object to display the border.
              const line = new THREE.LineSegments(edges, lineMaterial);
              // Add the border as a child of the mesh.
              mesh.add(line);
            }
          }

          // Load all the labels for each map position
          const fontLoader = new FontLoader();
          fontLoader.load('assets/fonts/helvetiker_regular.typeface.json', function (font) {
            for (const [key, value] of Object.entries(coordinateData.provinces)) {

              textGroup.add(createLabel(font, key, value))
            }
          })
          // This rotates the SVG the "correct" way round, and scales it down
          group.scale.set(0.5, -0.5, 0.5)
          textGroup.rotation.x = Math.PI / 2;
          textGroup.scale.set(0.5, -0.5, 0.5)

          // After adding all meshes to the group, update its matrix:
          group.updateMatrixWorld(true);
          textGroup.updateMatrixWorld(true);

          // Compute the bounding box of the group:
          const box = new THREE.Box3().setFromObject(group);
          const center = new THREE.Vector3();
          box.getCenter(center);

          scene.add(group);
          scene.add(textGroup);

          // Set the camera's target to the center of the map
          controls.target = center
          camera.position.set(center.x, 800, 800)
        })
        .catch(error => {
          console.error('Error loading map styles:', error);
        });
    },
    // Progress function
    undefined,
    function (error) { console.log(error) })


  return
}
