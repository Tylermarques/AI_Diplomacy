import * as THREE from "three";
import { UnitData, UnitTypeENUM } from "../types/units";
import { PowerENUM } from "../types/map";
import { gameState } from "../gameState";
import { getProvincePosition } from "../map/utils";
import { cleanProvince } from "../types/unitOrders";

// Get color for a power
export function getPowerHexColor(power: PowerENUM | undefined): string {
  let defaultColor = '#ddd2af'
  if (power === undefined) return defaultColor
  const powerColors = {
    'AUSTRIA': '#c40000',
    'ENGLAND': '#00008B',
    'FRANCE': '#0fa0d0',
    'GERMANY': '#666666',
    'ITALY': '#008000',
    'RUSSIA': '#cccccc',
    'TURKEY': '#e0c846',
  };
  return powerColors[power.toUpperCase() as keyof typeof PowerENUM] || defaultColor; // fallback to neutral
}

function createArmy(color: string): THREE.Group {
  let group = new THREE.Group();
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
  return group
}

function createFleet(color: string): THREE.Group {

  let group = new THREE.Group();
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
  return group
}

export function createSupplyCenters() {
  if (!gameState.boardState || !gameState.boardState.provinces) throw new Error("Game not initialized, cannot create SCs");
  for (const [province, data] of Object.entries(gameState.boardState.provinces)) {
    if (data.isSupplyCenter && gameState.boardState.provinces[province]) {

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

      const pos = getProvincePosition(province);
      scGroup.position.set(pos.x, 2, pos.z);
      gameState.scene.add(scGroup)
    }
  }
}
export function createUnitMesh(unitData: UnitData): THREE.Group {
  const color = getPowerHexColor(unitData.power);
  let group: THREE.Group | null;

  // Minimal shape difference for armies vs fleets
  if (unitData.type === 'A') {
    group = createArmy(color)
  } else {
    group = createFleet(color)
  }
  let pos = getProvincePosition(unitData.province)
  group.position.set(pos.x, pos.y, pos.z)

  // Store metadata
  group.userData = {
    power: unitData.power,
    type: unitData.type,
    province: unitData.province
  };

  return group;
}

function _removeUnitsFromBoard() {

  gameState.unitMeshes.map((mesh) => gameState.scene.remove(mesh))
}

/*
  * Given a phaseIndex, Add the units for that phase to the board, in the province specified in the game.json file.
  */
function _addUnitsToBoard(phaseIndex: number) {
  _removeUnitsFromBoard()
  for (const [power, unitArr] of Object.entries(gameState.gameData.phases[phaseIndex].state.units)) {
    unitArr.forEach(unitStr => {
      const match = unitStr.match(/^([AF])\s+(.+)$/);
      if (match) {
        let newUnit = createUnitMesh({
          power: PowerENUM[power.toUpperCase() as keyof typeof PowerENUM],
          type: UnitTypeENUM[match[1] as keyof typeof UnitTypeENUM],
          province: cleanProvince(match[2]),
        });
        gameState.scene.add(newUnit);
        gameState.unitMeshes.push(newUnit);
      }
    });
  }
}
// Creates the units for the current gameState.phaseIndex.
export function initUnits(phaseIndex: number) {
  if (phaseIndex === undefined) throw new Error("Cannot pass undefined phaseIndex");
  createSupplyCenters()
  _addUnitsToBoard(phaseIndex)
}
