import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import DxfParser from 'dxf-parser';

if (typeof window !== 'undefined') {
  window.THREE = THREE;
  window.OrbitControls = OrbitControls;
  window.STLLoader = STLLoader;
  window.OBJLoader = OBJLoader;
  window.DxfParser = DxfParser;
}

export { THREE, OrbitControls, STLLoader, OBJLoader, DxfParser };
