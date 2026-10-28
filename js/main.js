import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const $ = (id) => document.getElementById(id);
const sceneContainer = $("sceneContainer");
const sceneLoader = $("sceneLoader");

const state = {
  pitch: 0,
  roll: 0,
  yaw: 0,
  targetPitch: 0,
  targetRoll: 0,
  targetYaw: 0,
  smooth: true,
  propellers: true,
  cameraView: "orbit",
  startTime: performance.now(),
  lastTime: performance.now(),
  elapsed: 0,
};

let scene, camera, renderer, controls, drone, propellerRotors = [];
let animationFrameId = 0;
let resizeObserver;
const clock = new THREE.Clock();

const degToRad = THREE.MathUtils.degToRad;
const clamp = THREE.MathUtils.clamp;

function material(color, roughness = 0.72, metalness = 0.08) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function addBox(parent, size, position, mat, bevel = false) {
  const geometry = new THREE.BoxGeometry(...size);
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addCylinder(parent, radiusTop, radiusBottom, height, position, mat, radialSegments = 20) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments),
    mat
  );
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function makeDrone() {
  const root = new THREE.Group();
  const frame = new THREE.Group();
  root.add(frame);

  const graphite = material("#26343e", 0.42, 0.38);
  const graphiteLight = material("#43525d", 0.5, 0.28);
  const carbon = material("#17242d", 0.6, 0.22);
  const shell = material("#f6f8f8", 0.34, 0.14);
  const orange = material("#ef6d45", 0.38, 0.12);
  const rubber = material("#202b32", 0.9, 0.02);
  const glass = new THREE.MeshStandardMaterial({ color: "#d5e7ec", roughness: 0.18, metalness: 0.1, transparent: true, opacity: 0.92 });

  // Central body and top plate.
  addBox(frame, [0.7, 0.16, 0.52], [0, 0.03, 0], graphite, true);
  addBox(frame, [0.56, 0.075, 0.4], [0, 0.13, 0], shell, true);
  addBox(frame, [0.2, 0.035, 0.23], [0, 0.184, -0.025], orange, true);
  addBox(frame, [0.14, 0.015, 0.1], [0, 0.208, -0.025], graphite, true);

  // Small forward-facing camera housing.
  addBox(frame, [0.24, 0.12, 0.15], [0, -0.005, -0.29], graphiteLight, true);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.04, 24), glass);
  lens.rotation.x = Math.PI / 2;
  lens.position.set(0, -0.01, -0.375);
  frame.add(lens);
  const lensRing = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.009, 8, 24), graphite);
  lensRing.position.set(0, -0.01, -0.394);
  frame.add(lensRing);

  // Four arms and motor pods.
  const armPositions = [
    [-0.62, 0, -0.62], [0.62, 0, -0.62],
    [-0.62, 0, 0.62], [0.62, 0, 0.62],
  ];
  const rotorOffsets = [];
  armPositions.forEach(([x, y, z], index) => {
    const arm = addBox(frame, [0.82, 0.075, 0.12], [x * 0.5, 0.005, z * 0.5], carbon);
    arm.rotation.y = (x * z > 0) ? -Math.PI / 4 : Math.PI / 4;
    arm.rotation.z = x * z > 0 ? 0.015 : -0.015;

    const motor = addCylinder(frame, 0.12, 0.13, 0.1, [x, 0.09, z], graphiteLight, 24);
    addCylinder(frame, 0.065, 0.065, 0.025, [x, 0.15, z], orange, 20);
    addCylinder(frame, 0.03, 0.03, 0.03, [x, 0.174, z], graphite, 16);

    // Landing legs: dark, low-profile skids.
    const leg = addBox(frame, [0.055, 0.22, 0.055], [x * 0.72, -0.12, z * 0.72], graphite);
    leg.rotation.z = x < 0 ? -0.12 : 0.12;
    addBox(frame, [0.34, 0.035, 0.055], [x * 0.72, -0.23, z * 0.72], rubber);

    const rotor = new THREE.Group();
    rotor.position.set(x, 0.19, z);
    frame.add(rotor);
    addCylinder(rotor, 0.03, 0.03, 0.02, [0, 0, 0], orange, 16);
    const bladeMat = new THREE.MeshStandardMaterial({ color: "#53616b", roughness: 0.42, metalness: 0.22, transparent: true, opacity: 0.86, side: THREE.DoubleSide });
    for (let b = 0; b < 2; b++) {
      const blade = addBox(rotor, [0.54, 0.012, 0.075], [0, 0.014, 0], bladeMat);
      blade.rotation.y = b * Math.PI / 2;
      blade.rotation.z = b === 0 ? 0.025 : -0.025;
    }
    propellerRotors.push(rotor);
    rotorOffsets.push([x, z]);
  });

  // Tiny front status lights, so orientation is readable at a glance.
  const ledMat = new THREE.MeshStandardMaterial({ color: "#d9a18f", emissive: "#000000", emissiveIntensity: 0 });
  const led = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.025, 0.035), ledMat);
  led.position.set(0, 0.12, -0.24);
  frame.add(led);

  root.userData.frame = frame;
  root.scale.setScalar(1.12);
  return root;
}

function createEnvironment() {
  // Large matte test pad and a subtle grid that fades into the environment.
  const groundMat = new THREE.MeshStandardMaterial({ color: "#d8e2dc", roughness: 0.96, metalness: 0 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.62;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(180, 90, "#a9bcb7", "#c3d1cc");
  grid.position.y = -0.605;
  grid.material.transparent = true;
  grid.material.opacity = 0.28;
  scene.add(grid);

  // A runway-like rectangular pad gives the scene a clear scale and visual anchor.
  const padMat = new THREE.MeshStandardMaterial({ color: "#e8ece9", roughness: 0.92 });
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(19, 13), padMat);
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(0, -0.6, 0);
  pad.receiveShadow = true;
  scene.add(pad);

  const markingMat = new THREE.MeshBasicMaterial({ color: "#c4d0ca", transparent: true, opacity: 0.75 });
  const addMark = (w, h, x, z) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), markingMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, -0.589, z);
    scene.add(m);
  };
  addMark(0.045, 8.4, 0, 0);
  addMark(4.5, 0.045, 0, 0);
  addMark(2.8, 0.045, 0, -4.2);
  addMark(2.8, 0.045, 0, 4.2);

  // A few low-contrast range markers in the far distance.
  const markerMat = material("#c1d0ca", 0.9, 0);
  for (let i = -4; i <= 4; i++) {
    if (i === 0) continue;
    const marker = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.08, 0.85, 8), markerMat);
    marker.position.set(i * 7.2, -0.18, -13.5);
    marker.castShadow = true;
    scene.add(marker);
  }

  // Horizon silhouettes: soft low hills, deliberately understated.
  const hillMat = new THREE.MeshStandardMaterial({ color: "#c9d9d1", roughness: 1 });
  const hillData = [
    [-25, -0.6, -35, 23, 4.2, 10],
    [4, -0.5, -42, 28, 6.5, 11],
    [35, -0.6, -37, 24, 4.8, 12],
    [-47, -0.5, -55, 28, 7, 14],
    [54, -0.6, -58, 35, 9, 15],
  ];
  hillData.forEach(([x, y, z, sx, sy, sz]) => {
    const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), hillMat);
    hill.position.set(x, y + sy * 0.42, z);
    hill.scale.set(sx, sy, sz);
    hill.receiveShadow = true;
    scene.add(hill);
  });
}

function initThree() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color("#eaf1f3");
  scene.fog = new THREE.Fog("#eaf1f3", 32, 110);

  const width = sceneContainer.clientWidth || 800;
  const height = sceneContainer.clientHeight || 500;
  camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 250);
  camera.position.set(8.5, 6.3, 10.5);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.16;
  sceneContainer.prepend(renderer.domElement);

  const hemi = new THREE.HemisphereLight("#f8fcff", "#aab8af", 2.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight("#fff7e9", 3.1);
  sun.position.set(-7, 13, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -18;
  sun.shadow.camera.right = 18;
  sun.shadow.camera.top = 18;
  sun.shadow.camera.bottom = -18;
  sun.shadow.bias = -0.00025;
  sun.shadow.normalBias = 0.025;
  scene.add(sun);

  const fill = new THREE.DirectionalLight("#d4e7f4", 0.9);
  fill.position.set(9, 7, -10);
  scene.add(fill);

  createEnvironment();
  drone = makeDrone();
  drone.position.set(0, 2.1, 0);
  scene.add(drone);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.8, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.minDistance = 5.5;
  controls.maxDistance = 24;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minPolarAngle = 0.18;
  controls.enablePan = false;
  controls.update();

  $("webglState").textContent = "READY";
  sceneLoader.classList.add("hidden");

  resizeObserver = new ResizeObserver(onResize);
  resizeObserver.observe(sceneContainer);
}

function onResize() {
  if (!camera || !renderer) return;
  const width = sceneContainer.clientWidth;
  const height = sceneContainer.clientHeight;
  if (!width || !height) return;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

function setTarget(axis, value) {
  const number = Number(value);
  if (axis === "pitch") state.targetPitch = number;
  if (axis === "roll") state.targetRoll = number;
  if (axis === "yaw") state.targetYaw = number;
  updateControlLabels();
}

function updateControlLabels() {
  $("pitchValue").textContent = `${state.targetPitch.toFixed(1)}°`;
  $("rollValue").textContent = `${state.targetRoll.toFixed(1)}°`;
  $("yawValue").textContent = `${Math.round(state.targetYaw)}°`;
}

function syncSliders() {
  $("pitchSlider").value = state.targetPitch;
  $("rollSlider").value = state.targetRoll;
  $("yawSlider").value = state.targetYaw;
  updateControlLabels();
}

function signed(value, digits = 1) {
  const rounded = Number(value).toFixed(digits);
  return `${Number(value) >= 0 ? "+" : ""}${rounded}`;
}

function updateHUD() {
  $("hudPitch").innerHTML = `${signed(state.pitch)}<span>°</span>`;
  $("hudRoll").innerHTML = `${signed(state.roll)}<span>°</span>`;
  $("hudYaw").innerHTML = `${String(Math.round(state.yaw)).padStart(3, "0")}<span>°</span>`;
  $("coordX").textContent = signed(drone.position.x, 2);
  $("coordY").textContent = signed(drone.position.y, 2);
  $("coordZ").textContent = signed(drone.position.z, 2);
  $("altitudeMetric").innerHTML = `${drone.position.y.toFixed(1)} <small>m</small>`;
  $("verticalMetric").innerHTML = `${(Math.sin(clock.elapsedTime * 0.5) * 0.02).toFixed(1)} <small>m/s</small>`;
}

function setCameraView(view) {
  state.cameraView = view;
  document.querySelectorAll(".view-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  if (view === "orbit") {
    camera.position.set(8.5, 6.3, 10.5);
    controls.target.set(0, 1.8, 0);
    controls.enabled = true;
  } else if (view === "pilot") {
    camera.position.set(0, 3.5, 8.8);
    controls.target.set(0, 1.7, -3);
    controls.enabled = true;
  } else if (view === "top") {
    camera.position.set(0.01, 15, 0.01);
    controls.target.set(0, 1.5, 0);
    controls.enabled = true;
  }
  controls.update();
}

function resetAttitude() {
  state.targetPitch = 0;
  state.targetRoll = 0;
  state.targetYaw = 0;
  state.pitch = 0;
  state.roll = 0;
  state.yaw = 0;
  syncSliders();
  if (drone) drone.rotation.set(0, 0, 0, "YXZ");
}

function openHelp() {
  $("helpModal").classList.add("open");
  $("helpModal").setAttribute("aria-hidden", "false");
}
function closeHelp() {
  $("helpModal").classList.remove("open");
  $("helpModal").setAttribute("aria-hidden", "true");
}

function bindUI() {
  $("pitchSlider").addEventListener("input", (event) => setTarget("pitch", event.target.value));
  $("rollSlider").addEventListener("input", (event) => setTarget("roll", event.target.value));
  $("yawSlider").addEventListener("input", (event) => setTarget("yaw", event.target.value));
  $("smoothToggle").addEventListener("change", (event) => { state.smooth = event.target.checked; });
  $("propToggle").addEventListener("change", (event) => { state.propellers = event.target.checked; });
  $("resetButton").addEventListener("click", resetAttitude);
  $("centerCameraButton").addEventListener("click", () => setCameraView("orbit"));
  document.querySelectorAll(".view-button").forEach((button) => {
    button.addEventListener("click", () => setCameraView(button.dataset.view));
  });
  $("helpButton").addEventListener("click", openHelp);
  $("closeHelp").addEventListener("click", closeHelp);
  $("doneHelp").addEventListener("click", closeHelp);
  $("modalBackdrop").addEventListener("click", closeHelp);

  window.addEventListener("keydown", (event) => {
    if (["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
    const key = event.key.toLowerCase();
    const step = event.shiftKey ? 10 : 3;
    let handled = true;
    switch (key) {
      case "w": setTarget("pitch", clamp(state.targetPitch - step, -45, 45)); break;
      case "s": setTarget("pitch", clamp(state.targetPitch + step, -45, 45)); break;
      case "a": setTarget("roll", clamp(state.targetRoll - step, -45, 45)); break;
      case "d": setTarget("roll", clamp(state.targetRoll + step, -45, 45)); break;
      case "q": setTarget("yaw", clamp(state.targetYaw - step * 2, -180, 180)); break;
      case "e": setTarget("yaw", clamp(state.targetYaw + step * 2, -180, 180)); break;
      case "r": resetAttitude(); break;
      case "?": openHelp(); break;
      case "escape": closeHelp(); break;
      default: handled = false;
    }
    if (handled) {
      syncSliders();
      if (["w", "s", "a", "d", "q", "e", "r"].includes(key)) event.preventDefault();
    }
  });
}

function animate() {
  animationFrameId = requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  state.elapsed += dt;

  const easing = state.smooth ? 1 - Math.exp(-dt * 6.5) : 1;
  state.pitch += (state.targetPitch - state.pitch) * easing;
  state.roll += (state.targetRoll - state.roll) * easing;
  // Interpolate yaw along the shortest direction around the circle.
  let yawDelta = state.targetYaw - state.yaw;
  while (yawDelta > 180) yawDelta -= 360;
  while (yawDelta < -180) yawDelta += 360;
  state.yaw += yawDelta * easing;

  if (drone) {
    drone.rotation.order = "YXZ";
    drone.rotation.y = degToRad(state.yaw);
    drone.rotation.x = degToRad(state.pitch);
    drone.rotation.z = degToRad(-state.roll);
    // Very subtle idle hover; attitude remains the user-controlled input.
    drone.position.y = 2.1 + Math.sin(state.elapsed * 1.4) * 0.025;
  }
  propellerRotors.forEach((rotor, index) => {
    rotor.visible = state.propellers;
    if (state.propellers) rotor.rotation.y += dt * (index % 2 === 0 ? 36 : -36);
  });

  controls?.update();
  renderer?.render(scene, camera);
  updateHUD();

  const seconds = Math.floor(state.elapsed);
  const hh = String(Math.floor(seconds / 3600)).padStart(2, "0");
  const mm = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  $("sessionClock").textContent = `${hh}:${mm}:${ss}`;
}

function showError(message) {
  sceneLoader.classList.remove("hidden");
  sceneLoader.innerHTML = `<div class="loader-ring" style="animation:none;border-color:#ef6d45"></div><span>${message}</span><small style="letter-spacing:0;font-size:10px;color:#9aa4ac">Try opening this project through a local web server.</small>`;
  $("webglState").textContent = "ERROR";
}

try {
  bindUI();
  initThree();
  animate();
} catch (error) {
  console.error("Unable to initialize the 3D simulator:", error);
  showError("COULD NOT INITIALIZE 3D VIEW");
}

window.addEventListener("beforeunload", () => {
  cancelAnimationFrame(animationFrameId);
  resizeObserver?.disconnect();
  renderer?.dispose();
});
