import * as fs from 'fs';
import { PCDLoader } from 'three/addons/loaders/PCDLoader.js';
import * as THREE from 'three';

const buffer = fs.readFileSync('public/session_20260929_191909/lidar_3d/lidar_3d_0000000020_360000000.pcd');
const loader = new PCDLoader();
const pcd = loader.parse(buffer.buffer);
pcd.geometry.computeBoundingBox();
const box = pcd.geometry.boundingBox;
console.log("Min:", box.min);
console.log("Max:", box.max);
const size = new THREE.Vector3();
box.getSize(size);
console.log("Size:", size);
