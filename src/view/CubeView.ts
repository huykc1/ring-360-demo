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

/** One flying chunk of a broken piece. */
interface Shard {
    mesh: THREE.Mesh;
    home: THREE.Vector3;
    /** Direction away from the piece centre, used to open the cracks. */
    out: THREE.Vector3;
    vel: THREE.Vector3;
    spin: THREE.Vector3;
    t0: number;
    popped?: boolean;
}

// Break animation timing (ms): a short crack, then the chunks fly off and fade.
const CRACK_MS = 260;
/** Safety cap: chunks are removed once they drop below the screen, or after this long. */
const MAX_FLY_MS = 4000;
const GRAVITY = 1100;
const POP_UP = 260;

const CUBE_COLOR = 0xf3e9d8;

export class CubeView {
    readonly renderer: THREE.WebGLRenderer;
    readonly scene = new THREE.Scene();
    readonly camera = new THREE.PerspectiveCamera(32, 1, 10, 10000);
    readonly root = new THREE.Group();
    private pieces = new THREE.Group();
    private cube?: THREE.Mesh;
    private meshes = new Map<string, THREE.Group>();
    private shards: Shard[] = [];
    /** Chunks of broken pieces; kept apart from `pieces` so a redraw does not cut the animation short. */
    private debris = new THREE.Group();
    private lastTick = performance.now();
    /** Pieces already shattered in the current level, so a piece never breaks twice on screen. */
    private shattered = new Set<string>();
    /** Red "can't move" glows and shakes, by piece id. */
    private flashes = new Map<string, { t0: number; dur: number; shake: number }>();
    private sparks: { mesh: THREE.Mesh; vel: THREE.Vector3; t0: number; life: number }[] = [];
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
        this.root.add(this.pieces, this.debris);
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
        this.shattered.clear();
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

    /** Shatters pieces that just broke: they crack, split into chunks along the wire, and the chunks fly off. */
    breakPieces(ids: string[]) {
        const now = performance.now();
        ids.forEach((id, k) => {
            // The mesh may already be gone (a moved piece is redrawn, and a broken one is not), so
            // the chunks are built from the piece's data, not from its mesh.
            if (this.shattered.has(id)) return;
            this.shattered.add(id);
            const g = this.meshes.get(id);
            if (g) {
                this.meshes.delete(id);
                this.pieces.remove(g);
                disposeGroup(g);
            }
            this.shatter(id, now + k * 70);
        });
    }

    /** Glows a piece red and shakes it: "this one can't move". */
    flash(id: string, shake = 5, dur = 480) {
        this.flashes.set(id, { t0: performance.now(), dur, shake });
    }

    /** A burst of sparks where a moving piece bumped into another one. */
    sparkAt(face: FaceId, at: Vec2) {
        const size = this.level?.cubeSize ?? 400;
        const { p, n } = to3D(face, at.x, at.y, size, TUBE_RADIUS + 2);
        const normal = new THREE.Vector3(...n);
        const now = performance.now();
        // Bright core flash, then a spray of sparks.
        const core = new THREE.Mesh(new THREE.SphereGeometry(9, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true }));
        core.position.set(...p);
        this.debris.add(core);
        this.sparks.push({ mesh: core, vel: new THREE.Vector3(), t0: now, life: 160 });
        for (let i = 0; i < 22; i++) {
            const hot = Math.random() < 0.5 ? 0xfff3a0 : 0xff8a1a;
            const mesh = new THREE.Mesh(new THREE.SphereGeometry(2.6 + Math.random() * 2.4, 6, 4), new THREE.MeshBasicMaterial({ color: hot, transparent: true }));
            mesh.position.set(...p);
            const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
            const vel = dir.multiplyScalar(160 + Math.random() * 220).addScaledVector(normal, 100 + Math.random() * 140);
            this.debris.add(mesh);
            this.sparks.push({ mesh, vel, t0: now, life: 320 + Math.random() * 220 });
        }
    }

    private shatter(id: string, t0: number) {
        const pz = this.puzzle!;
        const s = this.state!;
        const p = pz.byId.get(id)!;
        const size = this.level!.cubeSize;
        const lift = TUBE_RADIUS + 0.6;
        const base = new THREE.Color(COLORS[p.color] ?? p.color ?? '#999999');
        const ps = s.p[id];
        const centre = v3(p.face, p, size, lift);
        const normal = new THREE.Vector3(...to3D(p.face, p.x, p.y, size).n);
        const chunks: { pts: Vec2[]; r: number; color: THREE.Color }[] = [];
        const cut = (pts: Vec2[], r: number, color: THREE.Color, every: number) => {
            const dense = densify(pts, 5);
            for (let i = 0; i < dense.length - 1; i += every) chunks.push({ pts: dense.slice(i, Math.min(dense.length, i + every + 1)), r, color });
        };
        if (isRing(p)) {
            const gap = ringGap(p);
            const pts = ringPoints(p, p.radius ?? 48, ps.rot, gap, 4);
            if (gap === 0) pts.push(pts[0]);
            cut(pts, TUBE_RADIUS, base, 6 + Math.floor(Math.random() * 3));
            for (const st of pz.stems(s, id)) {
                if (Math.hypot(st.to.x - st.from.x, st.to.y - st.from.y) > 1) cut([st.from, st.to], TUBE_RADIUS * 0.62, base.clone().multiplyScalar(0.82), 3);
                chunks.push({ pts: [st.to, { x: st.to.x + 0.5, y: st.to.y }], r: 7, color: base.clone().multiplyScalar(0.62) });
            }
        } else {
            for (const c of barChunks(pz.barPts(s, id))) chunks.push({ pts: c, r: TUBE_RADIUS, color: base });
            // A screw's metal joint falls off too.
            if (ps.joint || p.type === 'rolling-elbow') chunks.push({ pts: [p, { x: p.x + 0.5, y: p.y }], r: 9, color: new THREE.Color(0xb8bcc4) });
        }
        // Gravity points down on screen whatever way the cube is turned.
        for (const c of chunks) {
            const world = densify(c.pts, 5).map((q) => v3(p.face, q, size, lift));
            const mid = world.reduce((a, b) => a.add(b), new THREE.Vector3()).multiplyScalar(1 / world.length);
            const geo =
                world.length > 1 && world[0].distanceTo(world[world.length - 1]) > 1
                    ? new THREE.TubeGeometry(new THREE.CatmullRomCurve3(world.map((w) => w.clone().sub(mid))), Math.max(4, world.length * 2), c.r, 8, false)
                    : new THREE.BoxGeometry(c.r * 2, c.r * 2, c.r * 2);
            const mat = new THREE.MeshStandardMaterial({ color: c.color, roughness: 0.32, metalness: 0.05, emissive: new THREE.Color(0xffffff), emissiveIntensity: 0 });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.copy(mid);
            this.debris.add(mesh);
            const out = mid.clone().sub(centre).normalize();
            const vel = normal
                .clone()
                .multiplyScalar(90 + Math.random() * 70)
                .add(out.clone().multiplyScalar(60 + Math.random() * 60))
                .add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(40));
            const spin = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(6);
            this.shards.push({ mesh, home: mid.clone(), out, vel, spin, t0 });
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

    /** The face pointing most towards the camera. */
    frontFace(): FaceId {
        let best: FaceId = 'front';
        let bestZ = -Infinity;
        for (const f of FACES) {
            const z = new THREE.Vector3(...FRAMES[f].n).applyQuaternion(this.root.quaternion).z;
            if (z > bestZ) {
                bestZ = z;
                best = f;
            }
        }
        return best;
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
        const dt = Math.min(0.05, (now - this.lastTick) / 1000);
        this.lastTick = now;
        const down = new THREE.Vector3(0, -1, 0).applyQuaternion(this.root.quaternion.clone().invert());
        this.shards = this.shards.filter((sh) => {
            const t = now - sh.t0;
            const mat = sh.mesh.material as THREE.MeshStandardMaterial;
            if (t < 0) return true;
            if (t < CRACK_MS) {
                // Crack: a flash, a slight tremble, and the chunks easing apart so the breaks show.
                const k = t / CRACK_MS;
                mat.emissiveIntensity = 0.3 * (1 - k);
                const j = 1.2 * (1 - k);
                sh.mesh.position
                    .copy(sh.home)
                    .addScaledVector(sh.out, 5 * k * k)
                    .add(new THREE.Vector3((Math.random() - 0.5) * j, (Math.random() - 0.5) * j, (Math.random() - 0.5) * j));
                return true;
            }
            const flying = t - CRACK_MS;
            mat.emissiveIntensity = 0;
            if (!sh.popped) {
                // Kick the chunk up a little (on screen) before gravity takes over.
                sh.vel.addScaledVector(down, -POP_UP * (0.7 + Math.random() * 0.6));
                sh.popped = true;
            }
            sh.vel.addScaledVector(down, GRAVITY * dt);
            sh.vel.multiplyScalar(1 - 0.6 * dt);
            sh.mesh.position.addScaledVector(sh.vel, dt);
            sh.mesh.rotation.x += sh.spin.x * dt;
            sh.mesh.rotation.y += sh.spin.y * dt;
            sh.mesh.rotation.z += sh.spin.z * dt;
            const below = sh.mesh.getWorldPosition(new THREE.Vector3()).project(this.camera).y < -1.25;
            if (below || flying > MAX_FLY_MS) {
                this.debris.remove(sh.mesh);
                sh.mesh.geometry.dispose();
                mat.dispose();
                return false;
            }
            return true;
        });
        this.tickFlashes(now);
        this.sparks = this.sparks.filter((sp) => {
            const k = (now - sp.t0) / sp.life;
            const mat = sp.mesh.material as THREE.MeshBasicMaterial;
            if (k >= 1) {
                this.debris.remove(sp.mesh);
                sp.mesh.geometry.dispose();
                mat.dispose();
                return false;
            }
            sp.vel.addScaledVector(down, GRAVITY * 0.5 * dt);
            sp.mesh.position.addScaledVector(sp.vel, dt);
            mat.opacity = 1 - k;
            sp.mesh.scale.setScalar(1 - k * 0.6);
            return true;
        });
        this.renderer.render(this.scene, this.camera);
    }

    private tickFlashes(now: number) {
        for (const [id, f] of this.flashes) {
            const g = this.meshes.get(id);
            const k = (now - f.t0) / f.dur;
            const done = k >= 1 || !g;
            if (g) {
                const sel = id === this.selected;
                g.traverse((o) => {
                    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
                    if (!m || !('emissive' in m)) return;
                    if (done) {
                        m.emissive.set(sel ? 0xff8a1f : 0x000000);
                        m.emissiveIntensity = sel ? 0.45 : 0;
                    } else {
                        m.emissive.set(0xff2a1a);
                        m.emissiveIntensity = 0.85 * (1 - k);
                    }
                });
                const p = this.puzzle?.byId.get(id);
                if (p && !done) {
                    const u = new THREE.Vector3(...FRAMES[p.face].u);
                    g.position.copy(u.multiplyScalar(Math.sin(k * Math.PI * 7) * f.shake * (1 - k)));
                } else g.position.set(0, 0, 0);
            }
            if (done) this.flashes.delete(id);
        }
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

/**
 * Splits a bar's path for the break animation: each bend stays as a small L-shaped chunk, and each
 * straight leg between bends breaks into one to three pieces depending on its length.
 */
function barChunks(pts: Vec2[]): Vec2[][] {
    const CORNER = 14;
    const along = (a: Vec2, b: Vec2, d: number): Vec2 => {
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        return { x: a.x + ((b.x - a.x) * d) / len, y: a.y + ((b.y - a.y) * d) / len };
    };
    const out: Vec2[][] = [];
    for (let i = 0; i < pts.length - 1; i++) {
        let a = pts[i];
        let b = pts[i + 1];
        const full = Math.hypot(b.x - a.x, b.y - a.y);
        const trim = Math.min(CORNER, full / 3);
        if (i > 0) a = along(a, b, trim);
        if (i < pts.length - 2) b = along(b, a, trim);
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const n = Math.max(1, Math.min(5, Math.round(len / 28)));
        for (let k = 0; k < n; k++) {
            // Uneven cuts look more like a real break.
            const t0 = k === 0 ? 0 : (k + (Math.random() - 0.5) * 0.3) / n;
            const t1 = k === n - 1 ? 1 : (k + 1 + (Math.random() - 0.5) * 0.3) / n;
            out.push([along(a, b, len * t0), along(a, b, len * t1)]);
        }
        if (i < pts.length - 2) {
            const c = pts[i + 1];
            const next = pts[i + 2];
            out.push([along(c, pts[i], Math.min(CORNER, full / 3)), c, along(c, next, Math.min(CORNER, Math.hypot(next.x - c.x, next.y - c.y) / 3))]);
        }
    }
    return out;
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
