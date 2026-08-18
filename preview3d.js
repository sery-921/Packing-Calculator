import * as THREE from "three";
import { OrbitControls } from "three/addons/OrbitControls.js";

let activePreview = null;

class CSS2DObject extends THREE.Object3D {
  constructor(element) {
    super();
    this.element = element;
    this.element.style.position = "absolute";
    this.element.style.pointerEvents = "none";
    this.element.style.transform = "translate(-50%, -50%)";
  }
}

class CSS2DRenderer {
  constructor() {
    this.domElement = document.createElement("div");
    this.domElement.className = "preview-3d-css2d";
    this.width = 0;
    this.height = 0;
  }

  setSize(width, height) {
    this.width = width;
    this.height = height;
    this.domElement.style.width = `${width}px`;
    this.domElement.style.height = `${height}px`;
  }

  render(scene, camera) {
    const vector = new THREE.Vector3();
    const viewProjection = new THREE.Matrix4().multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse
    );

    scene.traverse(object => {
      if (!(object instanceof CSS2DObject)) return;
      if (object.element.parentNode !== this.domElement) this.domElement.appendChild(object.element);
      vector.setFromMatrixPosition(object.matrixWorld).applyMatrix4(viewProjection);
      object.element.style.display = "";
      object.element.style.left = `${(vector.x * 0.5 + 0.5) * this.width}px`;
      object.element.style.top = `${(-vector.y * 0.5 + 0.5) * this.height}px`;
    });
  }
}

function disposeObject(object) {
  object.traverse(child => {
    if (child instanceof CSS2DObject) child.element.remove();
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach(material => material.dispose());
    }
  });
}

function makeLabel(html, className = "preview-3d-label") {
  const el = document.createElement("div");
  el.className = className;
  el.innerHTML = html;
  return new CSS2DObject(el);
}

function addEdges(group, mesh, color = 0x17324d) {
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.72 })
  );
  mesh.add(edges);
  return edges;
}

function addBox(group, size, position, material, edgeColor = 0x17324d) {
  if (Math.min(...size) <= 0) return null;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  if (edgeColor !== null) addEdges(group, mesh, edgeColor);
  return mesh;
}

function addHingedFlap(group, size, hinge, offset, rotation, material) {
  const pivot = new THREE.Group();
  pivot.position.set(...hinge);
  pivot.rotation.set(...rotation);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...offset);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  pivot.add(mesh);
  group.add(pivot);
  return pivot;
}

function addGridLine(group, a, b, color = 0x153c60) {
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(...a),
    new THREE.Vector3(...b)
  ]);
  const line = new THREE.Line(
    geometry,
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.86 })
  );
  group.add(line);
  return line;
}

function addDashedLine(group, a, b) {
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(...a),
    new THREE.Vector3(...b)
  ]);
  const line = new THREE.Line(
    geometry,
    new THREE.LineDashedMaterial({
      color: 0x1f7f63,
      dashSize: 18,
      gapSize: 10,
      linewidth: 1
    })
  );
  line.computeLineDistances();
  group.add(line);
  return line;
}

function addArrowHead(group, position, direction, color = 0x173f74) {
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(7, 18, 24),
    new THREE.MeshStandardMaterial({ color, roughness: 0.7 })
  );
  const dir = new THREE.Vector3(...direction).normalize();
  cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  cone.position.set(...position);
  group.add(cone);
  return cone;
}

function addDoubleArrow(group, start, end, label, labelOffset = [0, 18, 0]) {
  addGridLine(group, start, end, 0x173f74);
  const s = new THREE.Vector3(...start);
  const e = new THREE.Vector3(...end);
  const dir = e.clone().sub(s).normalize();
  addArrowHead(group, end, dir.toArray());
  addArrowHead(group, start, dir.clone().multiplyScalar(-1).toArray());
  const text = makeLabel(label, "preview-3d-dim-label");
  text.position.copy(s.lerp(e, 0.5).add(new THREE.Vector3(...labelOffset)));
  group.add(text);
}

function createFoamTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#bfe9de";
  ctx.fillRect(0, 0, 96, 96);
  ctx.strokeStyle = "rgba(255,255,255,.6)";
  ctx.lineWidth = 2;
  for (let i = 0; i <= 96; i += 16) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 96);
    ctx.moveTo(0, i);
    ctx.lineTo(96, i);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(255,255,255,.72)";
  for (let y = 8; y < 96; y += 16) {
    for (let x = 8; x < 96; x += 16) {
      ctx.beginPath();
      ctx.arc(x, y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 2);
  return texture;
}

function createCartonTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#c9965d";
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = "rgba(112,74,38,.22)";
  ctx.lineWidth = 1;
  for (let y = 4; y < 128; y += 8) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(128, y + 10);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2.5, 2.5);
  return texture;
}

function formatDim(dims, fallback) {
  if (Array.isArray(dims) && dims.length >= 3) {
    return dims.slice(0, 3).map(v => Number(v).toString()).join("×");
  }
  return String(fallback || "-").replace(/[脳xX*]/g, "×");
}

function createFaceMaterials() {
  return [
    new THREE.MeshStandardMaterial({ color: 0x8f8cff, roughness: 0.56 }),
    new THREE.MeshStandardMaterial({ color: 0xff86bd, roughness: 0.56 }),
    new THREE.MeshStandardMaterial({ color: 0xffe36d, roughness: 0.5 }),
    new THREE.MeshStandardMaterial({ color: 0xf4c45b, roughness: 0.62 }),
    new THREE.MeshStandardMaterial({ color: 0xf78ac0, roughness: 0.58 }),
    new THREE.MeshStandardMaterial({ color: 0x918fff, roughness: 0.58 })
  ];
}

function addInnerAssembly(group, data, dims) {
  const [L, W, H] = dims;
  const placedBoxes = Array.isArray(data.best.layout.boxes) ? data.best.layout.boxes : [];
  if (placedBoxes.length) {
    const mat0 = new THREE.MeshStandardMaterial({ color: 0xffb15f, roughness: 0.62 });
    const mat90 = new THREE.MeshStandardMaterial({ color: 0x7d91ff, roughness: 0.58 });
    const arrow0 = 0x9c4d13;
    const arrow90 = 0x223fae;
    placedBoxes.forEach(box => {
      const material = box.rotation === 90 ? mat90 : mat0;
      const mesh = addBox(
        group,
        [box.length, box.height, box.width],
        [
          box.x + box.length / 2 - L / 2,
          box.z + box.height / 2 - H / 2,
          box.y + box.width / 2 - W / 2
        ],
        material,
        box.rotation === 90 ? arrow90 : arrow0
      );
      if (!mesh) return;
      const y = box.z + box.height - H / 2 + 1.4;
      const cx = box.x + box.length / 2 - L / 2;
      const cz = box.y + box.width / 2 - W / 2;
      const half = Math.max(8, (box.rotation === 90 ? box.width : box.length) * 0.28);
      if (box.rotation === 90) addGridLine(group, [cx, y, cz - half], [cx, y, cz + half], arrow90);
      else addGridLine(group, [cx - half, y, cz], [cx + half, y, cz], arrow0);
    });
    return;
  }
  const [nx, ny, nz] = data.best.layout.counts.map(Number);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(L, H, W), createFaceMaterials());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  addEdges(group, mesh, 0x14395a);

  const x0 = -L / 2;
  const x1 = L / 2;
  const y0 = -H / 2;
  const y1 = H / 2;
  const z0 = -W / 2;
  const z1 = W / 2;
  const off = 0.7;

  for (let i = 1; i < nx; i++) {
    const x = x0 + (L * i) / nx;
    addGridLine(group, [x, y1 + off, z0], [x, y1 + off, z1]);
    addGridLine(group, [x, y0, z1 + off], [x, y1, z1 + off]);
  }
  for (let j = 1; j < ny; j++) {
    const z = z0 + (W * j) / ny;
    addGridLine(group, [x0, y1 + off, z], [x1, y1 + off, z]);
    addGridLine(group, [x1 + off, y0, z], [x1 + off, y1, z]);
  }
  for (let k = 1; k < nz; k++) {
    const y = y0 + (H * k) / nz;
    addGridLine(group, [x0, y, z1 + off], [x1, y, z1 + off]);
    addGridLine(group, [x1 + off, y, z0], [x1 + off, y, z1]);
    addGridLine(group, [x0 - off, y, z0], [x0 - off, y, z1]);
  }
}

function addCarton(group, data, productDims, materials) {
  const c = data.best.carton;
  const [outerL, outerW, outerH] = c.outer.map(Number);
  const wall = Math.max(Number(c.wall) || 3, 2);
  const [L, W, H] = productDims;
  const cartonH = Math.max(Math.min(outerH * 0.68, H + 38), Math.min(outerH, 120));
  const topY = -H / 2 - Math.max(H * 0.35, 90);
  const bottomY = topY - cartonH;
  const centerY = bottomY + cartonH / 2;

  addBox(group, [outerL, wall, outerW], [0, bottomY, 0], materials.carton, null);
  addBox(group, [wall, cartonH, outerW], [-outerL / 2, centerY, 0], materials.carton, null);
  addBox(group, [wall, cartonH, outerW], [outerL / 2, centerY, 0], materials.carton, null);
  addBox(group, [outerL, cartonH, wall], [0, centerY, -outerW / 2], materials.carton, null);
  addBox(group, [outerL, cartonH, wall], [0, centerY, outerW / 2], materials.carton, null);

  const flapL = Math.max(outerL * 0.46, outerL / 2 - wall);
  const flapW = Math.max(outerW * 0.46, outerW / 2 - wall);
  const flapT = Math.max(wall * 0.7, 2);
  const flapY = topY + wall / 2;
  const flapMat = materials.flap;
  const open = Math.PI / 4;
  addHingedFlap(group, [flapL, flapT, outerW], [-outerL / 2, flapY, 0], [-flapL / 2, 0, 0], [0, 0, open], flapMat);
  addHingedFlap(group, [flapL, flapT, outerW], [outerL / 2, flapY, 0], [flapL / 2, 0, 0], [0, 0, -open], flapMat);
  addHingedFlap(group, [outerL, flapT, flapW], [0, flapY, outerW / 2], [0, 0, flapW / 2], [open, 0, 0], flapMat);
  addHingedFlap(group, [outerL, flapT, flapW], [0, flapY, -outerW / 2], [0, 0, -flapW / 2], [-open, 0, 0], flapMat);

  return { topY, bottomY, outerL, outerW };
}

function foamGeometryFor(face, productDims, cartonInner, gap) {
  const [L, W, H] = productDims;
  const [innerL, innerW, innerH] = cartonInner;
  const dims = face.dims || [];
  const t = Math.max(Number(dims[2]) || 8, 3);
  const fitL = Math.min(dims[0] || L, innerL);
  const fitW = Math.min(dims[0] || W, innerW);
  const fitH = Math.min(dims[1] || H, innerH);
  const fitTopW = Math.min(dims[1] || W, innerW);
  if (face.key === "top") return { size: [fitL, t, fitTopW], pos: [0, H / 2 + gap + t / 2, 0] };
  if (face.key === "bottom") return { size: [fitL, t, fitTopW], pos: [0, -H / 2 - gap - t / 2, 0] };
  if (face.key === "left") return { size: [t, fitH, fitW], pos: [-L / 2 - gap - t / 2, 0, 0] };
  if (face.key === "right") return { size: [t, fitH, fitW], pos: [L / 2 + gap + t / 2, 0, 0] };
  if (face.key === "front") return { size: [fitL, fitH, t], pos: [0, 0, W / 2 + gap + t / 2] };
  return { size: [fitL, fitH, t], pos: [0, 0, -W / 2 - gap - t / 2] };
}

function addFoams(group, data, productDims, materials, cartonBounds) {
  const [outerL, outerW] = data.best.carton.outer.map(Number);
  const [innerL, innerW] = data.best.carton.inner.map(Number);
  const maxInset = Math.max(10, Math.min((outerL - innerL) / 2, (outerW - innerW) / 2) + 8);
  const gap = Math.max(...productDims) * 0.1 + maxInset;
  const faces = Array.isArray(data.previewFoams) ? data.previewFoams : [];
  faces.filter(face => Number(face.count) > 0 && face.sku).forEach(face => {
    const geom = foamGeometryFor(face, productDims, data.best.carton.inner.map(Number), gap);
    geom.pos[0] = THREE.MathUtils.clamp(geom.pos[0], -innerL / 2 - gap, innerL / 2 + gap);
    geom.pos[2] = THREE.MathUtils.clamp(geom.pos[2], -innerW / 2 - gap, innerW / 2 + gap);
    const panel = addBox(group, geom.size, geom.pos, materials.foam, 0x277c6e);
    if (!panel) return;

    const dim = formatDim(face.dims, face.dimensionText);
    panel.userData.foamInfo = {
      title: face.pairLabel,
      sku: face.sku,
      detail: `${dim} mm · ${face.countText}`
    };
  });
}

function addDimensionGuides(group, productDims) {
  const [L, W, H] = productDims;
  const gap = Math.max(L, W, H) * 0.28 + 70;
  const topY = H / 2 + gap * 0.55;
  addDoubleArrow(group, [-L / 2, topY, -W / 2 - gap * 0.4], [L / 2, topY, -W / 2 - gap * 0.4], "<b>L</b> 长向");
  addDoubleArrow(group, [-L / 2 - gap * 0.35, topY - 28, -W / 2], [-L / 2 - gap * 0.35, topY - 28, W / 2], "<b>W</b> 宽向");
  addDoubleArrow(group, [L / 2 + gap * 0.68, -H / 2, W / 2], [L / 2 + gap * 0.68, H / 2, W / 2], "<b>H</b> 高向", [38, 0, 0]);
}

function formulaText(data) {
  const layout = data.best.layout;
  const d = layout.orientationDistribution || { rotation0: 0, rotation90: 0 };
  const isTrueMixedFlat = layout.mode === "mixedOrientationFlat" && Number(d.rotation0) > 0 && Number(d.rotation90) > 0;
  const gridCounts = () => {
    const boxes = Array.isArray(layout.boxes) ? layout.boxes : [];
    if (!boxes.length) return layout.counts.map(Number);
    const uniqueCount = key => new Set(boxes.map(box => Math.round(Number(box[key]) * 1000) / 1000)).size;
    return [uniqueCount("x"), uniqueCount("y"), uniqueCount("z")];
  };
  if (isTrueMixedFlat) {
    return `装配方案: 平放混排 ${layout.quantity} pcs · 0° ${d.rotation0} / 90° ${d.rotation90}`;
  }
  const [nx, ny, nz] = gridCounts();
  return `装配方案: 统一朝向平放 ${layout.quantity} pcs 长${nx}*宽${ny}*高${nz}`;
}

function layoutProductDims(layout) {
  const boxes = Array.isArray(layout.boxes) ? layout.boxes : [];
  if (boxes.length) {
    return [
      Math.max(...boxes.map(box => box.x + box.length)),
      Math.max(...boxes.map(box => box.y + box.width)),
      Math.max(...boxes.map(box => box.z + box.height))
    ];
  }
  const [boxL, boxW, boxH] = layout.orientation.map(Number);
  const [nx, ny, nz] = layout.counts.map(Number);
  return [boxL * nx, boxW * ny, boxH * nz];
}

function fitCamera(camera, controls, data, productDims) {
  const c = data.best.carton;
  const [L, W, H] = productDims;
  const span = Math.max(L, W, H, ...(c.outer || productDims).map(Number));
  const target = new THREE.Vector3(0, -H * 0.1, 0);
  camera.position.copy(target).add(new THREE.Vector3(span * 1.05, span * 0.86, span * 1.05));
  camera.lookAt(target);
  controls.target.copy(target);
  controls.update();
}

class PackingExplodedPreview {
  constructor(mount) {
    this.mount = mount;
    this.mount.innerHTML = "";
    this.mount.classList.add("preview-3d");

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf4f7fb);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10000);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.labelRenderer = new CSS2DRenderer();

    this.mount.appendChild(this.renderer.domElement);
    this.mount.appendChild(this.labelRenderer.domElement);
    this.formulaEl = document.createElement("div");
    this.formulaEl.className = "preview-3d-formula-fixed";
    this.mount.appendChild(this.formulaEl);
    this.hintEl = document.createElement("div");
    this.hintEl.className = "preview-3d-hint";
    this.hintEl.textContent = "含有配套棉时，点击泡棉任意处可查看泡棉信息";
    this.mount.appendChild(this.hintEl);
    this.detailEl = document.createElement("div");
    this.detailEl.className = "preview-3d-foam-detail";
    this.mount.appendChild(this.detailEl);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = true;
    this.foamMeshes = [];
    this.hideFoamDetail = () => {
      this.detailEl.classList.remove("visible");
      this.detailEl.innerHTML = "";
    };
    this.showFoamDetail = info => {
      this.detailEl.innerHTML = `<strong>${info.title}</strong><span>${info.sku}</span><small>${info.detail}</small>`;
      this.detailEl.classList.add("visible");
    };
    this.onPreviewClick = event => {
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hit = this.raycaster.intersectObjects(this.foamMeshes, false)[0];
      if (hit?.object?.userData?.foamInfo) this.showFoamDetail(hit.object.userData.foamInfo);
      else this.hideFoamDetail();
    };
    this.onPreviewPointerMove = event => {
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.pointer, this.camera);
      this.renderer.domElement.style.cursor = this.raycaster.intersectObjects(this.foamMeshes, false).length ? "pointer" : "grab";
    };
    this.renderer.domElement.addEventListener("click", this.onPreviewClick);
    this.renderer.domElement.addEventListener("pointermove", this.onPreviewPointerMove);
    this.controls.addEventListener("start", this.hideFoamDetail);

    this.model = new THREE.Group();
    this.scene.add(this.model);
    this.clock = new THREE.Clock();
    this.running = true;

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.55));
    const key = new THREE.DirectionalLight(0xffffff, 2.35);
    key.position.set(500, 780, 420);
    key.castShadow = true;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xaec8ff, 0.8);
    fill.position.set(-420, 260, -500);
    this.scene.add(fill);

    this.materials = {
      foamTexture: createFoamTexture(),
      cartonTexture: createCartonTexture()
    };
    this.materials.foam = new THREE.MeshStandardMaterial({
      color: 0xc4eee5,
      map: this.materials.foamTexture,
      transparent: true,
      opacity: 0.72,
      roughness: 0.92
    });
    this.materials.carton = new THREE.MeshStandardMaterial({
      color: 0xc9965d,
      map: this.materials.cartonTexture,
      roughness: 0.86
    });
    this.materials.flap = new THREE.MeshStandardMaterial({
      color: 0xdcb271,
      map: this.materials.cartonTexture,
      roughness: 0.84
    });

    this.resize = this.resize.bind(this);
    this.animate = this.animate.bind(this);
    window.addEventListener("resize", this.resize);
    this.resize();
    this.animate();
  }

  update(data) {
    this.hideFoamDetail();
    this.foamMeshes = [];
    disposeObject(this.model);
    this.scene.remove(this.model);
    this.model = new THREE.Group();
    this.model.scale.setScalar(0.96);
    this.scene.add(this.model);

    const productDims = layoutProductDims(data.best.layout);

    const cartonBounds = addCarton(this.model, data, productDims, this.materials);
    addFoams(this.model, data, productDims, this.materials, cartonBounds);
    this.foamMeshes = [];
    this.model.traverse(child => {
      if (child.userData?.foamInfo) this.foamMeshes.push(child);
    });
    addInnerAssembly(this.model, data, productDims);
    addDimensionGuides(this.model, productDims);
    this.formulaEl.textContent = formulaText(data);
    fitCamera(this.camera, this.controls, data, productDims);
    this.resize();
  }

  resize() {
    const width = Math.max(320, this.mount.clientWidth || 800);
    const height = Math.max(560, Math.min(760, width * 0.74));
    const aspect = width / height;
    const size = 1300;
    this.camera.left = (-size * aspect) / 2;
    this.camera.right = (size * aspect) / 2;
    this.camera.top = size / 2;
    this.camera.bottom = -size / 2;
    this.camera.near = 0.1;
    this.camera.far = 10000;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.labelRenderer.setSize(width, height);
  }

  animate() {
    if (!this.running) return;
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (this.model) {
      const next = THREE.MathUtils.damp(this.model.scale.x, 1, 8, dt);
      this.model.scale.setScalar(next);
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
    requestAnimationFrame(this.animate);
  }

  stop() {
    this.running = false;
    window.removeEventListener("resize", this.resize);
    this.renderer.domElement.removeEventListener("click", this.onPreviewClick);
    this.renderer.domElement.removeEventListener("pointermove", this.onPreviewPointerMove);
    this.controls.removeEventListener("start", this.hideFoamDetail);
    disposeObject(this.model);
    Object.values(this.materials).forEach(value => {
      if (value && value.dispose) value.dispose();
    });
    this.renderer.dispose();
    this.mount.classList.remove("preview-3d");
    this.mount.innerHTML = "";
  }
}

export function renderPacking3D(data, mount) {
  if (!activePreview || activePreview.mount !== mount) {
    if (activePreview) activePreview.stop();
    activePreview = new PackingExplodedPreview(mount);
  }
  activePreview.update(data);
  return activePreview;
}

export function disposePacking3D(){if(activePreview){activePreview.stop();activePreview=null;}}

export function update(params) {
  if (activePreview) activePreview.update(params);
}

window.renderPacking3D = renderPacking3D;
window.dispatchEvent(new Event("packing3d-ready"));
window.updatePacking3DPreview = update;
window.disposePacking3D = disposePacking3D;
