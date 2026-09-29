import * as fs from 'fs';
import { PCDLoader } from 'three/addons/loaders/PCDLoader.js';

const loader = new PCDLoader();

const buf1 = fs.readFileSync('public/session_20260929_191909/lidar_3d/lidar_3d_0000000020_360000000.pcd');
const buf2 = fs.readFileSync('public/session_20260929_191909/lidar_3d/lidar_3d_0000000020_900000000.pcd');

const p1 = loader.parse(buf1.buffer);
const p2 = loader.parse(buf2.buffer);

p1.geometry.computeBoundingBox();
p2.geometry.computeBoundingBox();

console.log("P1 BB:", p1.geometry.boundingBox);
console.log("P2 BB:", p2.geometry.boundingBox);
