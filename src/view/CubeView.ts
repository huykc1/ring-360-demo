// Three.js view of a level wrapped onto a cube. Used by the game (under the Phaser HUD) and by the editor.
import * as THREE from 'three';
import { FRAMES, to3D, type V3 } from '../core/cube';
import { isRing, ringGap, ringPoints } from '../core/geom';
import { Puzzle, type State } from '../core/rules';
import { COLORS, FACES, TUBE_RADIUS, type FaceId, type Level, type Vec2 } from '../core/types';

export interface PickResult {
    pieceId?: string;
    face?: FaceId;
    local?: Vec2;
}

interface Anim {
    obj: THREE.Object3D;
    t0: number;
    dur: number;
}

const CUBE_COLOR = 0xf3e9d8;

export class CubeView {
    readonly renderer: THREE.WebGLRenderer;
    readonly scene = new THREE.Scene();
    readonly camera = new THREE.PerspectiveCamera(32, 1, 10, 10000);
    readonly root = new THREE.Group();
    private pieces = new THREE.Group();
    private cube?: THREE.Mesh;
    private meshes = new Map<string, THREE.Group>();
    private anims: Anim[] = [];
    private raycaster = new THREE.Raycaster();
    /** Zoom factor on top of the distance that fits the whole cube. */
    private zoomK = 1;
    private frame = 0;
    private resizeObs: ResizeObserver;
    level?: Level;
    puzzle?: Puzzle;
    state?: State;
    selected: string | null = null;
    /** Called once per frame before rendering (the game uses it for drag inertia). */
    onFrame?: () => void;

    constructor(readonly container: HTMLElement) {
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        container.appendChild(this.renderer.domElement);
        Object.assign(this.renderer.domElement.style, { display: 'block', width: '100%', height: '100%' });

        this.scene.add(this.camera);
        this.scene.add(new THREE.HemisphereLight(0xffffff, 0xb8a98f, 1.5));
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.45));
        const key = new THREE.DirectionalLight(0xffffff, 1.5);
        key.position.set(0.6, 1, 1.2);
        this.camera.add(key);
        this.scene.add(this.root);
        this.root.add(this.pieces);
        this.resetView();

        this.resizeObs = new ResizeObserver(() => this.resize());
        this.resizeObs.observe(container);
        this.resize();
        const loop = () => {
            this.frame = requestAnimationFrame(loop);
            this.tick();
        };
        loop();
    }

    dispose() {
        cancelAnimationFrame(this.frame);
        this.resizeObs.disconnect();
        this.renderer.dispose();
        this.renderer.domElement.remove();
    }

    resize() {
        const w = Math.max(1, this.container.clientWidth);
        const h = Math.max(1, this.container.clientHeight);
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.placeCamera();
    }

    resetView() {
        this.root.quaternion.setFromEuler(new THREE.Euler(0.42, -0.62, 0, 'XYZ'));
        this.zoomK = 1;
        this.placeCamera();
    }

    private placeCamera() {
        // Distance at which the cube's bounding sphere fits the narrower field of view.
        const r = (this.level?.cubeSize ?? 400) * 0.82;
        const half = (this.camera.fov * Math.PI) / 360;
        const halfH = Math.atan(Math.tan(half) * this.camera.aspect);
        const fit = r / Math.sin(Math.min(half, halfH));
        this.camera.position.set(0, 0, fit * this.zoomK);
        this.camera.lookAt(0, 0, 0);
    }

    orbit(dx: number, dy: number) {
        const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), dx * 0.006);
        const qx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), dy * 0.006);
        this.root.quaternion.premultiply(qy).premultiply(qx);
    }

    zoom(factor: number) {
        this.zoomK = Math.max(0.45, Math.min(2.5, this.zoomK * factor));
        this.placeCamera();
    }

    /** Shows a level. Without a state, pieces are drawn as authored (the editor). */
    setLevel(level: Level, puzzle?: Puzzle, state?: State) {
        const sizeChanged = this.level?.cubeSize !== level.cubeSize;
        this.level = level;
        this.puzzle = puzzle ?? new Puzzle(level);
        this.state = state ?? this.puzzle.initial();
        if (sizeChanged || !this.cube) {
            this.buildCube();
            this.placeCamera();
        }
        this.rebuildAll();
    }

    setSelected(id: string | null) {
        this.selected = id;
        this.rebuildAll();
    }

    rebuildAll() {
        for (const g of this.meshes.values()) disposeGroup(g);
        this.meshes.clear();
        this.pieces.clear();
        if (!this.level || !this.puzzle || !this.state) return;
        for (const p of this.level.pieces) if (!this.state.p[p.id]?.broken) this.buildPiece(p.id);
        this.buildFixedBombs();
    }

    /** Redraws one piece after it moved. */
    updatePiece(id: string) {
        const old = this.meshes.get(id);
        if (old) {
            this.pieces.remove(old);
            disposeGroup(old);
            this.meshes.delete(id);
        }
        if (this.state && !this.state.p[id]?.broken) this.buildPiece(id);
    }

    /** Pops pieces that just broke. */
    breakPieces(ids: string[]) {
        for (const id of ids) {
            const g = this.meshes.get(id);
            if (!g) continue;
            this.meshes.delete(id);
            this.anims.push({ obj: g, t0: performance.now(), dur: 260 });
        }
    }

    pick(clientX: number, clientY: number): PickResult {
        this.setRay(clientX, clientY);
        const hits = this.raycaster.intersectObjects(this.pieces.children, true);
        for (const h of hits) {
            const id = findPieceId(h.object);
            if (id) return { pieceId: id, ...this.faceHit() };
        }
        return this.faceHit();
    }

    /** Point under the cursor on the (infinite) plane of `face`, in that face's coordinates. */
    facePoint(face: FaceId, clientX: number, clientY: number): Vec2 | null {
        this.setRay(clientX, clientY);
        const f = FRAMES[face];
        const inv = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
        const ray = this.raycaster.ray.clone().applyMatrix4(inv);
        const n = new THREE.Vector3(...f.n);
        const plane = new THREE.Plane(n, -(this.level?.cubeSize ?? 400) / 2);
        const p = ray.intersectPlane(plane, new THREE.Vector3());
        if (!p) return null;
        return { x: p.dot(new THREE.Vector3(...f.u)), y: p.dot(new THREE.Vector3(...f.v)) };
    }

    /** Screen position (CSS pixels relative to the canvas) of a face-local point. */
    project(face: FaceId, pt: Vec2): Vec2 {
        const { p } = to3D(face, pt.x, pt.y, this.level?.cubeSize ?? 400);
        const v = new THREE.Vector3(...p).applyMatrix4(this.root.matrixWorld).project(this.camera);
        const r = this.renderer.domElement.getBoundingClientRect();
        return { x: ((v.x + 1) / 2) * r.width, y: ((1 - v.y) / 2) * r.height };
    }

    // ---------- internals ----------

    private setRay(clientX: number, clientY: number) {
        const r = this.renderer.domElement.getBoundingClientRect();
        const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
        this.root.updateMatrixWorld();
        this.raycaster.setFromCamera(ndc, this.camera);
    }

    private faceHit(): PickResult {
        if (!this.cube) return {};
        const hit = this.raycaster.intersectObject(this.cube, false)[0];
        if (!hit || !hit.face) return {};
        const n = hit.face.normal;
        const face = FACES.find((f) => {
            const fn = FRAMES[f].n;
            return Math.round(n.x) === fn[0] && Math.round(n.y) === fn[1] && Math.round(n.z) === fn[2];
        });
        if (!face) return {};
        const local = this.root.worldToLocal(hit.point.clone());
        const f = FRAMES[face];
        return { face, local: { x: local.dot(new THREE.Vector3(...f.u)), y: local.dot(new THREE.Vector3(...f.v)) } };
    }

    private tick() {
        this.onFrame?.();
        const now = performance.now();
        this.anims = this.anims.filter((a) => {
            const t = Math.min(1, (now - a.t0) / a.dur);
            const s = t < 0.3 ? 1 + t * 0.6 : (1.18 * (1 - t)) / 0.7;
            a.obj.scale.setScalar(Math.max(0.001, s));
            if (t >= 1) {
                this.pieces.remove(a.obj);
                disposeGroup(a.obj as THREE.Group);
                return false;
            }
            return true;
        });
        this.renderer.render(this.scene, this.camera);
    }

    private buildCube() {
        if (this.cube) {
            this.root.remove(this.cube);
            this.cube.geometry.dispose();
        }
        const s = this.level?.cubeSize ?? 400;
        const geo = new THREE.BoxGeometry(s, s, s);
        this.cube = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: CUBE_COLOR, roughness: 0.85 }));
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0xcdbfa6 }));
        this.cube.add(edges);
        this.root.add(this.cube);
    }

    private buildPiece(id: string) {
        const pz = this.puzzle!;
        const s = this.state!;
        const p = pz.byId.get(id)!;
        const size = this.level!.cubeSize;
        const g = new THREE.Group();
        g.userData.pieceId = id;
        const base = new THREE.Color(COLORS[p.color] ?? p.color ?? '#999999');
        const mat = plastic(base, id === this.selected);
        const lift = TUBE_RADIUS + 0.6;
        const ps = s.p[id];

        if (isRing(p)) {
            const gap = ringGap(p);
            const pts = ringPoints(p, p.radius ?? 48, ps.rot, gap, 4);
            g.add(tube(pts, p.face, size, lift, TUBE_RADIUS, mat, gap === 0));
            if (gap > 0) for (const end of [pts[0], pts[pts.length - 1]]) g.add(ball(end, p.face, size, lift, TUBE_RADIUS, mat));
            const stemMat = plastic(base.clone().multiplyScalar(0.82), id === this.selected);
            const sleeveMat = plastic(base.clone().multiplyScalar(0.62), false);
            for (const st of pz.stems(s, id)) {
                if (Math.hypot(st.to.x - st.from.x, st.to.y - st.from.y) > 1) g.add(tube([st.from, st.to], p.face, size, lift, TUBE_RADIUS * 0.62, stemMat, false));
                g.add(sleeve(st.to, p.face, size, lift, sleeveMat));
            }
        } else {
            const pts = densify(pz.barPts(s, id), 6);
            g.add(tube(pts, p.face, size, lift, TUBE_RADIUS, mat, false));
            for (const end of [pts[0], pts[pts.length - 1]]) g.add(ball(end, p.face, size, lift, TUBE_RADIUS, mat));
            if (ps.joint) {
                const metal = new THREE.MeshStandardMaterial({ color: 0xb8bcc4, metalness: 0.85, roughness: 0.25 });
                g.add(sleeve(p, p.face, size, lift, metal, 1.25));
            }
        }
        const b = pz.bombPoint(s, id);
        if (b) g.add(bomb(b, p.face, size, lift));
        this.meshes.set(id, g);
        this.pieces.add(g);
    }

    private buildFixedBombs() {
        const lv = this.level!;
        lv.fixedBombs.forEach((fb, i) => {
            if (this.state?.fixedUsed[i]) return;
            this.pieces.add(bomb(fb, fb.face, lv.cubeSize, TUBE_RADIUS + 0.6));
        });
    }
}

// ---------- mesh helpers ----------

function plastic(color: THREE.Color, highlight: boolean) {
    return new THREE.MeshStandardMaterial({
        color,
        roughness: 0.32,
        metalness: 0.05,
        emissive: highlight ? new THREE.Color(0xff8a1f) : new THREE.Color(0x000000),
        emissiveIntensity: highlight ? 0.45 : 0
    });
}

function v3(face: FaceId, pt: Vec2, size: number, lift: number) {
    const { p } = to3D(face, pt.x, pt.y, size, lift);
    return new THREE.Vector3(...p);
}

function densify(pts: Vec2[], step: number): Vec2[] {
    const out: Vec2[] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
        for (let k = 1; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
    }
    return out;
}

function tube(pts2: Vec2[], face: FaceId, size: number, lift: number, r: number, mat: THREE.Material, closed: boolean) {
    const pts = densify(pts2, 5).map((q) => v3(face, q, size, lift));
    if (pts.length < 2) pts.push(pts[0].clone().add(new THREE.Vector3(0.01, 0, 0)));
    const curve = new THREE.CatmullRomCurve3(pts, closed, 'centripetal');
    return new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(8, pts.length * 2), r, 10, closed), mat);
}

function ball(pt: Vec2, face: FaceId, size: number, lift: number, r: number, mat: THREE.Material) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), mat);
    m.position.copy(v3(face, pt, size, lift));
    return m;
}

function sleeve(pt: Vec2, face: FaceId, size: number, lift: number, mat: THREE.Material, scale = 1) {
    const { p, n } = to3D(face, pt.x, pt.y, size, lift);
    const m = new THREE.Mesh(new THREE.BoxGeometry(15 * scale, 15 * scale, 13 * scale), mat);
    m.position.set(...p);
    m.lookAt(new THREE.Vector3(...add(p, n)));
    return m;
}

function bomb(pt: Vec2, face: FaceId, size: number, lift: number) {
    const g = new THREE.Group();
    const { p, n } = to3D(face, pt.x, pt.y, size, lift + 4);
    const body = new THREE.Mesh(new THREE.SphereGeometry(10, 18, 14), new THREE.MeshStandardMaterial({ color: 0x2c2c2a, roughness: 0.4 }));
    const fuse = new THREE.Mesh(new THREE.SphereGeometry(3.2, 10, 8), new THREE.MeshStandardMaterial({ color: 0xff5a3c, emissive: 0xff3a1c, emissiveIntensity: 0.8 }));
    fuse.position.set(n[0] * 10, n[1] * 10, n[2] * 10);
    g.add(body, fuse);
    g.position.set(...p);
    return g;
}

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

function findPieceId(o: THREE.Object3D | null): string | undefined {
    while (o) {
        if (o.userData.pieceId) return o.userData.pieceId as string;
        o = o.parent;
    }
    return undefined;
}

function disposeGroup(g: THREE.Object3D) {
    g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
    });
}
