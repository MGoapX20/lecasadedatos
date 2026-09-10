import {
  ACESFilmicToneMapping,
  AmbientLight,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  PCFSoftShadowMap,
  PointLight,
  Scene,
  SRGBColorSpace,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
  HalfFloatType,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { PMREMGenerator } from 'three';
import { config, type Quality } from '../config';
import type { CameraDirector } from './camera';
import { PALETTE } from './palette';

/** Film grain plus a vignette; cheap, and it sells the heist-movie look. */
const GrainVignetteShader = {
  uniforms: {
    tDiffuse: { value: null as unknown },
    uTime: { value: 0 },
    uGrain: { value: 0.055 },
    uVignette: { value: 0.86 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uGrain;
    uniform float uVignette;
    varying vec2 vUv;
    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime) * 43758.5453);
    }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5;
      float vig = smoothstep(0.85, 0.18, length(d) * uVignette);
      c.rgb *= mix(0.68, 1.0, vig);
      float g = hash(vUv * 900.0) - 0.5;
      c.rgb += g * uGrain;
      gl_FragColor = c;
    }`,
};

export interface Stage {
  renderer: WebGLRenderer;
  scene: Scene;
  composer: EffectComposer | null;
  sun: DirectionalLight;
  vaultLight: PointLight;
  lobbyLight: PointLight;
  facadeLight: PointLight;
  setQuality: (q: Quality) => void;
  setNight: (night: boolean) => void;
  render: (director: CameraDirector, dtMs: number) => void;
  resize: (w: number, h: number, director: CameraDirector) => void;
  dispose: () => void;
}

export function createStage(canvas: HTMLCanvasElement, director: CameraDirector): Stage {
  const renderer = new WebGLRenderer({ canvas, antialias: true, stencil: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  // The building is white marble under a lot of point lights; at 1.0 the floor
  // clips and every lamp becomes a white hole. This is the single biggest dial
  // on how the place looks.
  renderer.toneMappingExposure = 0.86;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;

  const scene = new Scene();
  scene.background = new Color(PALETTE.night);
  // Metal needs something to reflect or it renders black; a neutral room does it.
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  // Enough for the brass and the steel to have something to reflect, not
  // enough to act as a second ambient light over the whole hall.
  scene.environmentIntensity = 0.32;
  pmrem.dispose();
  scene.fog = new Fog(PALETTE.night, 85, 330);

  const hemi = new HemisphereLight(0xbcd3ff, 0x2a2118, 0.55);
  scene.add(hemi);
  const ambient = new AmbientLight(0xffffff, 0.18);
  scene.add(ambient);

  const sun = new DirectionalLight(0xfff0d8, 1.5);
  sun.position.set(28, 46, 22);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -34;
  sun.shadow.camera.right = 34;
  sun.shadow.camera.top = 26;
  sun.shadow.camera.bottom = -26;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 140;
  sun.shadow.bias = -0.0009;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  scene.add(sun.target);

  const vaultLight = new PointLight(PALETTE.gold, 26, 34, 2);
  vaultLight.position.set(0, 4.2, -8);
  scene.add(vaultLight);
  const lobbyLight = new PointLight(0xffe9c4, 20, 38, 2);
  lobbyLight.position.set(0, 4.6, 8);
  scene.add(lobbyLight);

  const hallLight = new PointLight(0xffe0a8, 22, 38, 2);
  hallLight.position.set(-12, 4.0, -2);
  scene.add(hallLight);
  const corridorLight = new PointLight(0xffe0a8, 18, 40, 2);
  corridorLight.position.set(12, 3.6, 0);
  scene.add(corridorLight);

  // Uplighting on the front colonnade: the building has to look like a poster.
  const facadeLight = new PointLight(0xffbf6a, 12, 34, 2);
  facadeLight.position.set(-9, 2.2, 15.5);
  scene.add(facadeLight);
  const facadeLight2 = new PointLight(0xffbf6a, 12, 34, 2);
  facadeLight2.position.set(9, 2.2, 15.5);
  scene.add(facadeLight2);

  let composer: EffectComposer | null = null;
  let grainPass: ShaderPass | null = null;
  let bloomPass: UnrealBloomPass | null = null;
  let quality: Quality = config.quality;

  const buildComposer = () => {
    composer?.dispose();
    composer = null;
    grainPass = null;
    bloomPass = null;
    if (quality === 'low') return;
    // Objective silhouettes use stencil in the scene pass, on every quality.
    const size = renderer.getDrawingBufferSize(new Vector2());
    const target = new WebGLRenderTarget(size.x, size.y, { type: HalfFloatType, stencilBuffer: true });
    const c = new EffectComposer(renderer, target);
    const logicalSize = renderer.getSize(new Vector2());
    c.setSize(logicalSize.x, logicalSize.y);
    c.addPass(new RenderPass(scene, director.camera));
    bloomPass = new UnrealBloomPass(
      new Vector2(canvas.clientWidth || 1280, canvas.clientHeight || 720),
      quality === 'high' ? 0.48 : 0.34,
      0.72,
      // Only genuinely bright things bloom. Lower and the marble itself starts
      // glowing, which is what made the hall look fogged.
      0.9,
    );
    c.addPass(bloomPass);
    grainPass = new ShaderPass(GrainVignetteShader as never);
    c.addPass(grainPass);
    c.addPass(new OutputPass());
    composer = c;
  };

  const applyQuality = (q: Quality) => {
    quality = q;
    renderer.shadowMap.enabled = q !== 'low';
    sun.castShadow = q !== 'low';
    sun.shadow.mapSize.set(q === 'high' ? 2048 : 1024, q === 'high' ? 2048 : 1024);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q === 'high' ? 2 : 1.25));
    buildComposer();
  };
  applyQuality(quality);

  let time = 0;
  return {
    renderer,
    scene,
    get composer() {
      return composer;
    },
    sun,
    vaultLight,
    lobbyLight,
    facadeLight,
    setQuality: applyQuality,
    setNight(night: boolean) {
      // Both modes are night; play mode simply turns the building's lights up.
      // Both modes are night; play mode simply turns the building's lights up.
      sun.intensity = night ? 0.55 : 0.7;
      sun.color.setHex(night ? 0x7f97e8 : 0xa8bcf5);
      hemi.intensity = night ? 0.34 : 0.46;
      ambient.intensity = night ? 0.26 : 0.34;
      (scene.background as Color).setHex(night ? PALETTE.night : 0x0d0f18);
      // Play mode turns the building's lights up, but these fall off with the
      // square of the distance and the ceilings are low: past about 50 the
      // pool under each lamp is a white hole rather than a pool.
      // The night values are nudged up to hold the attract shot's punch after
      // the exposure came down; the play values are the ones that were blowing
      // out.
      vaultLight.intensity = night ? 56 : 52;
      lobbyLight.intensity = night ? 44 : 50;
      hallLight.intensity = night ? 32 : 44;
      corridorLight.intensity = night ? 27 : 40;
      facadeLight.intensity = night ? 62 : 28;
      facadeLight2.intensity = night ? 62 : 28;
    },
    render(dir, dtMs) {
      time += dtMs / 1000;
      if (grainPass) grainPass.uniforms.uTime.value = time;
      if (composer) composer.render();
      else renderer.render(scene, dir.camera);
    },
    resize(w, h, dir) {
      renderer.setSize(w, h, false);
      dir.resize(w / Math.max(1, h));
      composer?.setSize(w, h);
      bloomPass?.setSize(w, h);
    },
    dispose() {
      composer?.dispose();
      renderer.dispose();
    },
  } as Stage;
}
