import * as fs from 'fs';
import { PCDLoader } from 'three/addons/loaders/PCDLoader.js';

const buffer = fs.readFileSync('public/session_20260929_191909/lidar_3d/lidar_3d_0000000020_360000000.pcd');
const loader = new PCDLoader();
try {
  const pcd = loader.parse(buffer.buffer);
  pcd.geometry.computeBoundingBox();
  pcd.geometry.computeBoundingSphere();
  console.log("Radius:", pcd.geometry.boundingSphere.radius);
  console.log("Center:", pcd.geometry.boundingSphere.center);
  console.log("Color attr?", pcd.geometry.hasAttribute('color'));
} catch (e) {
  console.error(e);
}
