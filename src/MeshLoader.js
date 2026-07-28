import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { cachedArrayBuffer } from './modelCache.js';

export class MeshLoader {
  constructor(scene) {
    this.scene = scene;
    
    // Setup DRACO loader for compressed geometry
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/');
    
    const gltfLoader = new GLTFLoader();
    gltfLoader.setDRACOLoader(dracoLoader);
    
    this.loaders = {
      obj: new OBJLoader(),
      mtl: new MTLLoader(),
      gltf: gltfLoader,
      glb: gltfLoader,
      ply: new PLYLoader(),
      stl: new STLLoader()
    };
  }

  async loadFiles(files) {
    // Sort files by type
    const objFile = files.find(f => f.name.endsWith('.obj'));
    const mtlFile = files.find(f => f.name.endsWith('.mtl'));
    const textureFiles = files.filter(f => 
      f.name.endsWith('.png') || 
      f.name.endsWith('.jpg') || 
      f.name.endsWith('.jpeg')
    );

    if (objFile) {
      // Create URLs for all files
      const objUrl = URL.createObjectURL(objFile);
      const textureUrls = {};
      
      textureFiles.forEach(file => {
        textureUrls[file.name] = URL.createObjectURL(file);
      });

      try {
        let mesh;
        
        if (mtlFile) {
          // Load with MTL
          const mtlUrl = URL.createObjectURL(mtlFile);
          mesh = await this.loadOBJWithMTL(objUrl, mtlUrl, textureUrls);
          URL.revokeObjectURL(mtlUrl);
        } else {
          // Load OBJ only
          mesh = await this.loadOBJ(objUrl);
        }

        // Clean up URLs
        URL.revokeObjectURL(objUrl);
        Object.values(textureUrls).forEach(url => URL.revokeObjectURL(url));
        
        return mesh;
      } catch (error) {
        // Clean up URLs on error
        URL.revokeObjectURL(objUrl);
        Object.values(textureUrls).forEach(url => URL.revokeObjectURL(url));
        throw error;
      }
    } else if (files.length === 1) {
      return this.loadFile(files[0]);
    } else {
      throw new Error('Please select an OBJ file with its associated files');
    }
  }

  async loadFromUrl(url, onProgress, onStatus) {
    const extension = url.split('.').pop().toLowerCase().split('?')[0];
    
    try {
      let mesh;
      
      switch (extension) {
        case 'obj':
          mesh = await this.loadOBJ(url);
          break;
        case 'gltf':
        case 'glb':
          mesh = await this.loadGLTF(url, onProgress, onStatus);
          break;
        case 'ply':
          mesh = await this.loadPLY(url);
          break;
        case 'stl':
          mesh = await this.loadSTL(url);
          break;
        default:
          // If no extension, assume GLB (for URLs without extensions)
          mesh = await this.loadGLTF(url, onProgress, onStatus);
      }

      return mesh;
    } catch (error) {
      throw error;
    }
  }

  async loadFile(file) {
    const extension = file.name.split('.').pop().toLowerCase();
    const url = URL.createObjectURL(file);

    try {
      let mesh;
      
      switch (extension) {
        case 'obj':
          mesh = await this.loadOBJ(url);
          break;
        case 'gltf':
        case 'glb':
          mesh = await this.loadGLTF(url);
          break;
        case 'ply':
          mesh = await this.loadPLY(url);
          break;
        case 'stl':
          mesh = await this.loadSTL(url);
          break;
        default:
          throw new Error(`Unsupported file format: ${extension}`);
      }

      URL.revokeObjectURL(url);
      return mesh;
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
  }

  loadOBJWithMTL(objUrl, mtlUrl, textureUrls) {
    return new Promise((resolve, reject) => {
      this.loaders.mtl.load(
        mtlUrl,
        (materials) => {
          materials.preload();
          
          // Replace texture URLs with our blob URLs
          Object.keys(materials.materials).forEach(matKey => {
            const material = materials.materials[matKey];
            if (material.map && material.map.image) {
              const textureName = material.map.image.src.split('/').pop();
              if (textureUrls[textureName]) {
                const textureLoader = new THREE.TextureLoader();
                material.map = textureLoader.load(textureUrls[textureName]);
              }
            }
          });
          
          this.loaders.obj.setMaterials(materials);
          this.loaders.obj.load(
            objUrl,
            (object) => {
              object.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                  child.castShadow = true;
                  child.receiveShadow = true;
                  if (child.material) {
                    child.material.side = THREE.DoubleSide;
                  }
                }
              });
              this.scene.add(object);
              resolve(object);
            },
            (progress) => {
              console.log('Loading progress:', (progress.loaded / progress.total * 100) + '%');
            },
            (error) => reject(error)
          );
        },
        (progress) => {
          console.log('Loading MTL:', (progress.loaded / progress.total * 100) + '%');
        },
        (error) => reject(error)
      );
    });
  }

  loadOBJ(url) {
    return new Promise((resolve, reject) => {
      this.loaders.obj.load(
        url,
        (object) => {
          object.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              child.material = new THREE.MeshPhongMaterial({
                color: 0x888888,
                side: THREE.DoubleSide
              });
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });
          // Don't add to scene yet - let main.js handle it after processing
          // this.scene.add(object);
          resolve(object);
        },
        (progress) => {
          console.log('Loading progress:', (progress.loaded / progress.total * 100) + '%');
        },
        (error) => reject(error)
      );
    });
  }

  async loadGLTF(url, onProgress, onStatus) {
    console.log('Starting GLTF load from URL:', url);
    // Fetch bytes through the IndexedDB cache (survives HMR reloads), then
    // parse — the GLB is self-contained (Draco decoder is set on the loader),
    // so no resource path is needed.
    const buffer = await cachedArrayBuffer(url, onProgress, undefined, onStatus);
    return new Promise((resolve, reject) => {
      this.loaders.gltf.parse(
        buffer,
        "",
        (gltf) => {
          console.log('GLTF parsed successfully:', gltf);
          const object = gltf.scene;
          object.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              child.castShadow = true;
              child.receiveShadow = true;
              if (!child.material) {
                child.material = new THREE.MeshPhongMaterial({
                  color: 0x888888,
                  side: THREE.DoubleSide
                });
              } else if (child.material) {
                // Ensure double-sided rendering for ODM models
                child.material.side = THREE.DoubleSide;
              }
            }
          });
          resolve(object);
        },
        (error) => {
          console.error('GLTF parse error:', error);
          reject(error);
        }
      );
    });
  }

  loadPLY(url) {
    return new Promise((resolve, reject) => {
      this.loaders.ply.load(
        url,
        (geometry) => {
          geometry.computeVertexNormals();
          const material = new THREE.MeshPhongMaterial({
            color: 0x888888,
            side: THREE.DoubleSide,
            vertexColors: geometry.hasAttribute('color')
          });
          const mesh = new THREE.Mesh(geometry, material);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          
          const object = new THREE.Group();
          object.add(mesh);
          // Don't add to scene yet - let main.js handle it after processing
          // this.scene.add(object);
          resolve(object);
        },
        (progress) => {
          console.log('Loading progress:', (progress.loaded / progress.total * 100) + '%');
        },
        (error) => reject(error)
      );
    });
  }

  loadSTL(url) {
    return new Promise((resolve, reject) => {
      this.loaders.stl.load(
        url,
        (geometry) => {
          geometry.computeVertexNormals();
          const material = new THREE.MeshPhongMaterial({
            color: 0x888888,
            side: THREE.DoubleSide
          });
          const mesh = new THREE.Mesh(geometry, material);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          
          const object = new THREE.Group();
          object.add(mesh);
          // Don't add to scene yet - let main.js handle it after processing
          // this.scene.add(object);
          resolve(object);
        },
        (progress) => {
          console.log('Loading progress:', (progress.loaded / progress.total * 100) + '%');
        },
        (error) => reject(error)
      );
    });
  }
}