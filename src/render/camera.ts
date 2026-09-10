import { PerspectiveCamera, Vector3 } from 'three';

const DEG = Math.PI / 180;

/** The visitor may tilt between these; below the floor or straight down reads badly. */
const MIN_PITCH = 6;
const MAX_PITCH = 86;

export type ShotName = 'gameplay' | 'follow' | 'attract' | 'vault' | 'wide' | 'facade';

interface Shot {
  azimuthDeg: number;
  pitchDeg: number;
  /** Multiplier on the fitted distance. */
  zoom: number;
  target: Vector3;
  fov: number;
}

/**
 * Drives one perspective camera between a fixed, readable gameplay angle and a
 * handful of cinematic shots. Gameplay always returns to the same angle so the
 * controls never change meaning under the visitor's hands.
 */
export class CameraDirector {
  readonly camera: PerspectiveCamera;
  private shot: Shot;
  private goal: Shot;
  private fitDistance = 60;
  private orbitSpeed = 0;
  private shakeAmp = 0;
  private shakeTime = 0;
  private blend = 1;
  private blendSpeed = 1;
  private halfW = 24;
  private halfD = 16;
  private userAz = 0;
  private userPitch = 0;
  private tmp = new Vector3();

  constructor() {
    this.camera = new PerspectiveCamera(42, 16 / 9, 0.5, 400);
    this.shot = {
      azimuthDeg: 45,
      pitchDeg: 52,
      zoom: 1,
      target: new Vector3(0, 0, 0),
      fov: 42,
    };
    this.goal = { ...this.shot, target: this.shot.target.clone() };
  }

  setBounds(halfWidth: number, halfDepth: number): void {
    this.halfW = halfWidth;
    this.halfD = halfDepth;
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.refit();
  }

  /** Shot angle plus whatever the visitor has dragged the view to. */
  private get azDeg(): number {
    return this.shot.azimuthDeg + this.userAz;
  }

  private get pitchDeg(): number {
    return clamp(this.shot.pitchDeg + this.userPitch, MIN_PITCH, MAX_PITCH);
  }

  private refit(): void {
    const vHalf = (this.camera.fov / 2) * DEG;
    const hHalf = Math.atan(Math.tan(vHalf) * this.camera.aspect);
    const pitch = this.pitchDeg * DEG;
    const az = this.azDeg * DEG;
    // Rotate the footprint into screen space so a 45-degree view still fits.
    const c = Math.abs(Math.cos(az));
    const s = Math.abs(Math.sin(az));
    const screenHalfW = this.halfW * s + this.halfD * c;
    const screenHalfD = (this.halfW * c + this.halfD * s) * Math.sin(pitch) + 5;
    const dh = screenHalfW / Math.tan(hHalf);
    const dv = screenHalfD / Math.tan(vHalf);
    this.fitDistance = Math.max(dh, dv) * 1.06;
  }

  cut(name: ShotName): void {
    this.goal = this.shotFor(name);
    this.userAz = 0;
    this.userPitch = 0;
    this.shot = { ...this.goal, target: this.goal.target.clone() };
    this.blend = 1;
    this.refit();
    this.apply();
  }

  moveTo(name: ShotName, seconds = 1.6): void {
    this.goal = this.shotFor(name);
    this.blend = 0;
    this.blendSpeed = 1 / Math.max(0.05, seconds);
  }

  private shotFor(name: ShotName): Shot {
    switch (name) {
      case 'attract':
        return { azimuthDeg: 55, pitchDeg: 30, zoom: 1.34, target: new Vector3(0, 2, 1), fov: 36 };
      case 'facade':
        return { azimuthDeg: 90, pitchDeg: 11, zoom: 1.05, target: new Vector3(0, 5, 14), fov: 38 };
      case 'vault':
        return { azimuthDeg: 45, pitchDeg: 42, zoom: 0.42, target: new Vector3(0, 2, -8), fov: 40 };
      case 'wide':
        return { azimuthDeg: 45, pitchDeg: 60, zoom: 1.08, target: new Vector3(0, 0, 0), fov: 44 };
      case 'follow':
        // Round 1 rides with the thief: closer, so one person reads as a person.
        return { azimuthDeg: 45, pitchDeg: 50, zoom: 0.7, target: new Vector3(0, 0, 0), fov: 42 };
      default:
        return { azimuthDeg: 45, pitchDeg: 50, zoom: 0.72, target: new Vector3(0, 0, -1), fov: 42 };
    }
  }

  /**
   * Visitor-driven rotation (middle-drag), layered on top of the current shot so
   * the scripted framing still owns the base angle. A cut clears it and a move
   * eases it away, so every stage transition restores the canonical view.
   */
  orbitBy(deltaAzDeg: number, deltaPitchDeg: number): void {
    if (deltaAzDeg === 0 && deltaPitchDeg === 0) return;
    this.userAz = (this.userAz + deltaAzDeg) % 360;
    const wanted = this.shot.pitchDeg + this.userPitch + deltaPitchDeg;
    this.userPitch = clamp(wanted, MIN_PITCH, MAX_PITCH) - this.shot.pitchDeg;
    this.refit();
    this.apply();
  }

  setOrbit(degPerSecond: number): void {
    this.orbitSpeed = degPerSecond;
  }

  shake(amplitude = 0.55): void {
    this.shakeAmp = Math.max(this.shakeAmp, amplitude);
  }

  /** Nudge the framing toward a point of interest without leaving the shot. */
  lookNear(x: number, z: number, weight = 0.35): void {
    this.goal.target.x = x * weight;
    this.goal.target.z = z * weight - 1;
  }

  update(dt: number): void {
    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt * this.blendSpeed);
      const k = easeInOut(this.blend);
      this.shot.azimuthDeg += (this.goal.azimuthDeg - this.shot.azimuthDeg) * k * 0.2;
      this.shot.pitchDeg += (this.goal.pitchDeg - this.shot.pitchDeg) * k * 0.2;
      this.shot.zoom += (this.goal.zoom - this.shot.zoom) * k * 0.2;
      this.shot.fov += (this.goal.fov - this.shot.fov) * k * 0.2;
      this.shot.target.lerp(this.goal.target, k * 0.2);
      this.userAz -= this.userAz * k * 0.2;
      this.userPitch -= this.userPitch * k * 0.2;
      this.camera.fov = this.shot.fov;
      this.camera.updateProjectionMatrix();
      this.refit();
    } else {
      this.shot.target.lerp(this.goal.target, Math.min(1, dt * 1.5));
    }
    if (this.orbitSpeed !== 0) {
      this.shot.azimuthDeg = (this.shot.azimuthDeg + this.orbitSpeed * dt) % 360;
      this.goal.azimuthDeg = this.shot.azimuthDeg;
      this.refit();
    }
    if (this.shakeAmp > 0.001) {
      this.shakeTime += dt * 24;
      this.shakeAmp *= Math.pow(0.02, dt);
    } else {
      this.shakeAmp = 0;
    }
    this.apply();
  }

  private apply(): void {
    const az = this.azDeg * DEG;
    const pitch = this.pitchDeg * DEG;
    const d = this.fitDistance * this.shot.zoom;
    const t = this.shot.target;
    this.tmp.set(
      Math.cos(az) * Math.cos(pitch),
      Math.sin(pitch),
      Math.sin(az) * Math.cos(pitch),
    );
    this.camera.position.copy(t).addScaledVector(this.tmp, d);
    if (this.shakeAmp > 0) {
      this.camera.position.x += Math.sin(this.shakeTime * 1.7) * this.shakeAmp;
      this.camera.position.y += Math.sin(this.shakeTime * 2.3) * this.shakeAmp * 0.6;
      this.camera.position.z += Math.cos(this.shakeTime) * this.shakeAmp;
    }
    this.camera.lookAt(t);
  }

  /** Screen-relative movement rotated into world axes for the current angle. */
  screenToWorldDir(ix: number, iy: number, out: { x: number; y: number }): void {
    const az = this.azDeg * DEG;
    // Screen up (-iy) points away from the camera along the ground.
    const fx = -Math.cos(az);
    const fz = -Math.sin(az);
    const rx = -fz;
    const rz = fx;
    out.x = fx * -iy + rx * ix;
    out.y = fz * -iy + rz * ix;
    const m = Math.hypot(out.x, out.y);
    if (m > 1e-5) {
      out.x /= m;
      out.y /= m;
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
