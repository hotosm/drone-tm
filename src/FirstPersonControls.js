import * as THREE from "three";

export class FirstPersonControls {
  constructor(camera, domElement) {
    this.camera = camera;
    this.domElement = domElement;

    // When false (review mode drives the camera via OrbitControls) all input
    // is ignored and update() is a no-op that keeps prevTime fresh.
    this.enabled = true;

    // paintMode: a tagging tool (brush/lasso) owns single-finger / mouse
    // input, so we ignore look from those and keep ONLY two-finger nav.
    this.paintMode = false;

    // orbitTarget: when set (a selection exists), drag orbits AROUND this
    // world point instead of first-person free-look.
    this.orbitTarget = null;

    this.baseMoveSpeed = 1.5; // Slower base speed
    this.fastMoveSpeed = 10; // Fast mode speed
    this.movementSpeed = this.baseMoveSpeed;
    this.lookSpeed = 0.002;

    this.moveForward = false;
    this.moveBackward = false;
    this.moveLeft = false;
    this.moveRight = false;
    this.isShiftPressed = false;

    this.lat = 0;
    this.lon = 0;

    this.mouseX = 0;
    this.mouseY = 0;
    this.isMouseDown = false;

    // Touch controls
    this.touches = new Map();
    this.lastPinchDistance = 0;
    this.lastTwoFingerCenter = { x: 0, y: 0 };
    this.lastThreeFingerCenter = { x: 0, y: 0 };

    // Collision: host assigns the current mesh; navigation is then clamped so
    // the camera can't cross geometry in the direction of travel (retreating
    // is always free — the ray only looks the way you're going).
    this.collider = null;
    this.collideRay = new THREE.Raycaster();
    this.collideMargin = 0.7; // scene units to keep off surfaces (> near plane 0.3)

    this.velocity = new THREE.Vector3();
    this.direction = new THREE.Vector3();

    this.prevTime = performance.now();

    this.init();
  }

  init() {
    this.isMouseDown = false; // Click and hold to look

    document.addEventListener("keydown", (e) => this.onKeyDown(e));
    document.addEventListener("keyup", (e) => this.onKeyUp(e));
    document.addEventListener("mousemove", (e) => this.onMouseMove(e));
    document.addEventListener("mousedown", (e) => this.onMouseDown(e));
    document.addEventListener("mouseup", (e) => this.onMouseUp(e));

    // Touch events
    this.domElement.addEventListener("touchstart", (e) => this.onTouchStart(e));
    this.domElement.addEventListener("touchmove", (e) => this.onTouchMove(e));
    this.domElement.addEventListener("touchend", (e) => this.onTouchEnd(e));
  }

  onKeyDown(event) {
    if (!this.enabled) return;
    switch (event.code) {
      case "KeyW":
      case "ArrowUp":
        this.moveForward = true;
        break;
      case "KeyS":
      case "ArrowDown":
        this.moveBackward = true;
        break;
      case "KeyA":
      case "ArrowLeft":
        this.moveLeft = true;
        break;
      case "KeyD":
      case "ArrowRight":
        this.moveRight = true;
        break;
      case "ShiftLeft":
      case "ShiftRight":
        this.isShiftPressed = true;
        this.movementSpeed = this.fastMoveSpeed;
        break;
    }
  }

  onKeyUp(event) {
    if (!this.enabled) return;
    switch (event.code) {
      case "KeyW":
      case "ArrowUp":
        this.moveForward = false;
        break;
      case "KeyS":
      case "ArrowDown":
        this.moveBackward = false;
        break;
      case "KeyA":
      case "ArrowLeft":
        this.moveLeft = false;
        break;
      case "KeyD":
      case "ArrowRight":
        this.moveRight = false;
        break;
      case "ShiftLeft":
      case "ShiftRight":
        this.isShiftPressed = false;
        this.movementSpeed = this.baseMoveSpeed;
        break;
    }
  }

  onMouseMove(event) {
    if (!this.enabled || this.paintMode) return;
    if (this.isMouseDown) {
      const deltaX = event.clientX - this.mouseX;
      const deltaY = event.clientY - this.mouseY;

      if (this.orbitTarget) {
        this.orbitDrag(deltaX, deltaY);
      } else {
        this.lon += deltaX * this.lookSpeed * 50;
        this.lat -= deltaY * this.lookSpeed * 50;
        this.lat = Math.max(-85, Math.min(85, this.lat));
      }

      this.mouseX = event.clientX;
      this.mouseY = event.clientY;
    }
  }

  onMouseDown(event) {
    if (!this.enabled || this.paintMode) return;
    if (event.button === 0) {
      this.isMouseDown = true;
      this.mouseX = event.clientX;
      this.mouseY = event.clientY;
    }
  }

  onMouseUp(event) {
    if (event.button === 0) {
      this.isMouseDown = false;
    }
  }

  onTouchStart(event) {
    if (!this.enabled) return;
    event.preventDefault();

    for (let i = 0; i < event.changedTouches.length; i++) {
      const touch = event.changedTouches[i];
      this.touches.set(touch.identifier, {
        x: touch.clientX,
        y: touch.clientY,
        startX: touch.clientX,
        startY: touch.clientY,
      });
    }

    if (this.touches.size >= 2) {
      const a = Array.from(this.touches.values());
      const dx = a[0].x - a[1].x;
      const dy = a[0].y - a[1].y;
      this.lastPinchDistance = Math.sqrt(dx * dx + dy * dy);
      this.lastTwoFingerCenter.x = (a[0].x + a[1].x) / 2;
      this.lastTwoFingerCenter.y = (a[0].y + a[1].y) / 2;
    }
  }

  onTouchMove(event) {
    if (!this.enabled) return;
    event.preventDefault();

    const n = this.touches.size;

    if (n === 1) {
      // one finger = look (unless a tag tool owns it — then it's painting)
      const touch = event.changedTouches[0];
      const st = this.touches.get(touch.identifier);
      if (!st) return;
      if (!this.paintMode) {
        if (this.orbitTarget) {
          this.orbitDrag(touch.clientX - st.x, touch.clientY - st.y);
        } else {
          this.lon -= (touch.clientX - st.x) * this.lookSpeed * 100;
          this.lat += (touch.clientY - st.y) * this.lookSpeed * 100;
          this.lat = Math.max(-85, Math.min(85, this.lat));
        }
      }
      st.x = touch.clientX;
      st.y = touch.clientY;
      return;
    }

    // two (or more) fingers = pinch-zoom AND pan together
    for (let i = 0; i < event.changedTouches.length; i++) {
      const touch = event.changedTouches[i];
      const st = this.touches.get(touch.identifier);
      if (st) {
        st.x = touch.clientX;
        st.y = touch.clientY;
      }
    }
    const a = Array.from(this.touches.values()).slice(0, 2);
    if (a.length < 2) return;
    const dist = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
    const cx = (a[0].x + a[1].x) / 2;
    const cy = (a[0].y + a[1].y) / 2;

    if (this.lastPinchDistance > 0) {
      const forward = new THREE.Vector3();
      this.camera.getWorldDirection(forward);
      // pinch: dolly along view direction (collision-clamped)
      this.moveBy(forward.clone().multiplyScalar((dist - this.lastPinchDistance) * 0.06));
      // two-finger drag: pan (grab-the-world — strafe on X, lift on Y)
      const panX = cx - this.lastTwoFingerCenter.x;
      const panY = cy - this.lastTwoFingerCenter.y;
      const right = new THREE.Vector3().crossVectors(forward, this.camera.up).normalize();
      const panDelta = right.multiplyScalar(-panX * 0.025);
      panDelta.y += panY * 0.025;
      this.moveBy(panDelta);
    }
    this.lastPinchDistance = dist;
    this.lastTwoFingerCenter.x = cx;
    this.lastTwoFingerCenter.y = cy;
  }

  onTouchEnd(event) {
    if (!this.enabled) return;
    event.preventDefault();

    for (let i = 0; i < event.changedTouches.length; i++) {
      const touch = event.changedTouches[i];
      this.touches.delete(touch.identifier);
    }

    // Reset movement flags when touches end
    if (this.touches.size < 2) {
      this.moveForward = false;
      this.moveBackward = false;
      this.lastPinchDistance = 0;
    }
  }

  update() {
    if (!this.enabled) {
      // Keep the clock fresh so re-enabling doesn't integrate a huge delta.
      this.prevTime = performance.now();
      return;
    }
    const time = performance.now();
    const delta = (time - this.prevTime) / 1000;

    this.velocity.x -= this.velocity.x * 10.0 * delta;
    this.velocity.z -= this.velocity.z * 10.0 * delta;
    this.velocity.y -= this.velocity.y * 10.0 * delta;

    this.direction.z = Number(this.moveForward) - Number(this.moveBackward);
    this.direction.x = Number(this.moveRight) - Number(this.moveLeft); // Fixed: swapped left and right
    this.direction.normalize();

    if (this.moveForward || this.moveBackward) {
      this.velocity.z -= this.direction.z * this.movementSpeed * delta;
    }
    if (this.moveLeft || this.moveRight) {
      this.velocity.x -= this.direction.x * this.movementSpeed * delta;
    }

    const forward = new THREE.Vector3();
    if (this.orbitTarget) {
      // Orbit mode: only single-finger DRAG orbits (orbitDrag sets the view).
      // update() must NOT re-lock lookAt every frame, or two-finger pan/zoom
      // would snap back to the selection. Just apply WASD along the current
      // orientation and leave the view where the user put it.
      this.camera.getWorldDirection(forward);
      const right = new THREE.Vector3().crossVectors(forward, this.camera.up).normalize();
      this.moveBy(
        forward.clone().multiplyScalar(-this.velocity.z).addScaledVector(right, -this.velocity.x)
      );
      this.prevTime = time;
      return;
    }

    const phi = THREE.MathUtils.degToRad(90 - this.lat);
    const theta = THREE.MathUtils.degToRad(this.lon);

    const lookAt = new THREE.Vector3();
    lookAt.x = this.camera.position.x + Math.sin(phi) * Math.cos(theta);
    lookAt.y = this.camera.position.y + Math.cos(phi);
    lookAt.z = this.camera.position.z + Math.sin(phi) * Math.sin(theta);

    this.camera.lookAt(lookAt);

    this.camera.getWorldDirection(forward);

    const right = new THREE.Vector3();
    right.crossVectors(forward, this.camera.up);
    right.normalize();

    this.moveBy(
      forward.clone().multiplyScalar(-this.velocity.z).addScaledVector(right, -this.velocity.x)
    );

    this.prevTime = time;
  }

  // Move the camera by a world-space delta, clamped by the collider so nav
  // can't cross geometry in the direction of travel. Retreating is always free
  // (the ray only looks the way you're going). No collider set → move freely.
  moveBy(delta) {
    const len = delta.length();
    if (!this.collider || len < 1e-6) {
      this.camera.position.add(delta);
      return;
    }
    const dir = delta.clone().multiplyScalar(1 / len);
    this.collideRay.set(this.camera.position, dir);
    const hits = this.collideRay.intersectObject(this.collider, true);
    if (hits.length && hits[0].distance < len + this.collideMargin) {
      const allowed = Math.max(0, hits[0].distance - this.collideMargin);
      this.camera.position.addScaledVector(dir, allowed);
    } else {
      this.camera.position.add(delta);
    }
  }

  // Orbit the camera around orbitTarget by drag deltas (screen px).
  orbitDrag(dx, dy) {
    const t = this.orbitTarget;
    if (!t) return;
    const offset = this.camera.position.clone().sub(t);
    const s = new THREE.Spherical().setFromVector3(offset);
    s.theta -= dx * 0.006;
    s.phi -= dy * 0.006;
    s.phi = Math.max(0.15, Math.min(Math.PI - 0.15, s.phi));
    offset.setFromSpherical(s);
    this.camera.position.copy(t).add(offset);
    this.camera.lookAt(t);
  }

  reset() {
    this.lat = 0;
    this.lon = 0;
    this.velocity.set(0, 0, 0);
  }

  // Adopt whatever orientation the camera currently has (another controller
  // may have moved it) so re-enabling doesn't snap the view back. Inverse of
  // the lookAt math in update().
  syncFromCamera() {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const phi = Math.acos(THREE.MathUtils.clamp(dir.y, -1, 1));
    this.lat = 90 - THREE.MathUtils.radToDeg(phi);
    this.lon = THREE.MathUtils.radToDeg(Math.atan2(dir.z, dir.x));
    this.velocity.set(0, 0, 0);
    this.moveForward = false;
    this.moveBackward = false;
    this.moveLeft = false;
    this.moveRight = false;
  }
}
