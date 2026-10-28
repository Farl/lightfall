/**
 * Frame pipeline:
 *   painted layers --(lighting.frag @ scene res)--> HDR lit scene
 *   lit scene --(downsample + H/V blur)--> blur (bloom + soft focus source)
 *   lit scene + blur + albedo --(final.frag @ output res)--> canvas
 */
import { LAMP_LIGHT, OUTPUT_SCALE, PRESETS, RENDER, SCENE_RES, SKY_GAIN, TV_LIGHT, CAMERA } from '../config';
import { depthRange, SCENE_CENTER } from '../camera';
import type { LightingState } from '../lighting';
import { scale } from '../math';
import type { RoomData } from '../scene/roomData';
import type { SceneLayers } from '../scene/layers';
import { atmosphereOf, type SceneDef } from '../scene/scenes';
import type { AppState } from '../state';
import { createTarget, createTexture, Pass, uploadCanvas, uploadLayers, type RenderTarget } from './gl';
import lightingSrc from './shaders/lighting.frag?raw';
import blurSrc from './shaders/blur.frag?raw';
import finalSrc from './shaders/final.frag?raw';

const VIEW_IDS = { final: 0, albedo: 1, depth: 2, normal: 3, direct: 4 } as const;
const MODE = { graded: 0, raw: 1, albedo: 2 } as const;

/** Replace __NAME__ tokens with RENDER values so array sizes come from config. */
function withDefines(src: string) {
  const defines: Record<string, number> = {
    MAX_PANES: RENDER.maxPanes,
    MAX_BOXES: RENDER.maxBoxes,
    MAX_LAMPS: RENDER.maxLamps,
    MAX_OCCLUDERS: RENDER.maxOccluders,
    MAX_SHADOW_SAMPLES: RENDER.maxShadowSamples,
    MAX_BEAM_STEPS: RENDER.maxBeamSteps,
  };
  return src.replace(/__([A-Z_]+)__/g, (_, k: string) => String(defines[k]));
}

const flat = <T>(items: T[], pick: (t: T) => number[]) => items.flatMap(pick);

export class Renderer {
  readonly outputSize = { width: SCENE_RES.width * OUTPUT_SCALE, height: SCENE_RES.height * OUTPUT_SCALE };
  private gl: WebGL2RenderingContext;
  private lighting: Pass;
  private blur: Pass;
  private final: Pass;
  private tex: { albedo: WebGLTexture; depth: WebGLTexture; normal: WebGLTexture; emissive: WebGLTexture; dust: WebGLTexture; occluders: WebGLTexture };
  /** SceneLayers.occluderVersion last uploaded; the mip chains are rebuilt only when it changes. */
  private occluderVersion = -1;
  private beamScale = 1;
  private lit: RenderTarget;
  private blurA: RenderTarget;
  private blurB: RenderTarget;
  private staticUniforms: Record<string, number | number[]>;
  /** Uniforms derived from the scene and its (editable) proxy data; refreshed by setScene. */
  private sceneUniforms: Record<string, number | number[]> = {};

  constructor(canvas: HTMLCanvasElement, layers: SceneLayers, room: RoomData, scene: SceneDef) {
    canvas.width = this.outputSize.width;
    canvas.height = this.outputSize.height;
    const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: false });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    const hdr = !!gl.getExtension('EXT_color_buffer_float');

    this.lighting = new Pass(gl, withDefines(lightingSrc));
    this.blur = new Pass(gl, blurSrc);
    this.final = new Pass(gl, finalSrc);

    this.tex = {
      albedo: createTexture(gl, gl.NEAREST),
      depth: createTexture(gl, gl.NEAREST),
      normal: createTexture(gl, gl.NEAREST),
      emissive: createTexture(gl, gl.NEAREST),
      dust: createTexture(gl, gl.NEAREST),
      occluders: gl.createTexture()!,
    };

    this.lit = createTarget(gl, SCENE_RES.width, SCENE_RES.height, gl.NEAREST, hdr);
    const bw = Math.round(SCENE_RES.width / RENDER.blurDownscale);
    const bh = Math.round(SCENE_RES.height / RENDER.blurDownscale);
    this.blurA = createTarget(gl, bw, bh, gl.LINEAR, hdr);
    this.blurB = createTarget(gl, bw, bh, gl.LINEAR, hdr);

    this.staticUniforms = {
      uRes: [SCENE_RES.width, SCENE_RES.height],
      uCenter: [...SCENE_CENTER],
      uCam: [CAMERA.x, CAMERA.y, CAMERA.dist, CAMERA.focal],
      uShadowSamples: RENDER.shadowSamples,
      uNormalBias: RENDER.normalBias,
      uBeamSteps: RENDER.beamSteps,
      uLampFalloff: LAMP_LIGHT.falloff,
      uTvFlicker: TV_LIGHT.flickerSpeed,
    };
    this.setScene(layers, room, scene);
  }

  /** Upload the painted layers and the proxy geometry. Call again after an edit or a scene switch. */
  setScene(layers: SceneLayers, room: RoomData, scene: SceneDef) {
    const aperture = room.aperture;
    const panes = aperture.panes;
    if (room.occluders.length > RENDER.maxOccluders || panes.length > RENDER.maxPanes || room.boxes.length > RENDER.maxBoxes || room.lamps.length > RENDER.maxLamps) {
      throw new Error('Room data exceeds RENDER.max* shader array sizes');
    }
    const gl = this.gl;
    uploadCanvas(gl, this.tex.albedo, layers.albedo.canvas);
    uploadCanvas(gl, this.tex.depth, layers.depth.canvas);
    uploadCanvas(gl, this.tex.normal, layers.normal.canvas);
    uploadCanvas(gl, this.tex.emissive, layers.emissive.canvas);
    if (layers.occluderVersion !== this.occluderVersion) uploadLayers(gl, this.tex.occluders, layers.occluders, RENDER.occluderResolution);
    this.occluderVersion = layers.occluderVersion;

    this.beamScale = scene.beamScale;
    const range = depthRange(room.bounds);
    const atmosphere = atmosphereOf(scene);
    const [texW, texH] = RENDER.occluderResolution;
    this.sceneUniforms = {
      uDepthRange: [range.far, range.near],
      uRoomNear: room.bounds.near,
      uApertureAxis: aperture.axis,
      uApertureAt: aperture.at,
      uPaneCount: panes.length,
      uPanes: flat(panes, (p) => p),
      // Sky seen through a wall window spans the panes' height; through a canopy or a far plane, the scene's.
      uSkyRange: aperture.axis === 0 ? [Math.min(...panes.map((p) => p[1])), Math.max(...panes.map((p) => p[3]))] : [0, room.bounds.height],
      uOccluderCount: room.occluders.length,
      uOccluderPlane: flat(room.occluders, (l) => [l.axis, l.at]),
      uOccluderRect: flat(room.occluders, (l) => l.rect),
      // Blur in texels per unit distance, from the denser texture axis so thin bars stay sharp up close.
      uOccluderBlur: flat(room.occluders, (l) => {
        const texelsPerUnit = Math.max(texW / (l.rect[2] - l.rect[0]), texH / (l.rect[3] - l.rect[1]));
        return [l.softness * texelsPerUnit, l.wind?.amplitude ?? 0, l.wind?.speed ?? 0];
      }),
      uSunSoftness: scene.sunSoftness ?? RENDER.sunSoftness,
      uPhaseG: atmosphere.phaseG,
      uSun: [scene.sun.disc, scene.sun.sharpness, scene.sun.halo],
      uShaftScale: atmosphere.shaftScale,
      uShaftAmount: atmosphere.shaftAmount,
      uFogDensity: atmosphere.fogDensity,
      uFogHeightFalloff: atmosphere.fogHeightFalloff,
      uFogDrift: atmosphere.fogDrift,
      uDustLitGain: atmosphere.dustLitGain,
      uDustAmbientGain: atmosphere.dustAmbientGain,
      uBoxCount: room.boxes.length,
      uBoxMin: flat(room.boxes, (b) => b.min),
      uBoxMax: flat(room.boxes, (b) => b.max),
      uLampCount: room.lamps.length,
      uLampPos: flat(room.lamps, (l) => l),
    };
  }

  render(state: AppState, light: LightingState, dustCanvas: HTMLCanvasElement) {
    const gl = this.gl;
    const preset = PRESETS[state.preset];
    const t = state.toggles;
    const lamps = t.lamps ? light.lamps : 0;

    if (t.dust) uploadCanvas(gl, this.tex.dust, dustCanvas);

    const view = preset.lit ? state.view : 'albedo';
    if (view !== 'albedo') {
      this.lighting.run(this.lit, SCENE_RES, {
        ...this.staticUniforms,
        ...this.sceneUniforms,
        uAlbedo: this.tex.albedo,
        uDepth: this.tex.depth,
        uNormal: this.tex.normal,
        uEmissive: this.tex.emissive,
        uDust: this.tex.dust,
        uOccluders: this.tex.occluders,
        uToLight: light.toLight,
        uLightColor: light.lightColor,
        uAmbientSky: light.ambientSky,
        uAmbientGround: light.ambientGround,
        uBounce: light.bounce,
        uFogColor: light.fogColor,
        uSkyTop: scale(light.skyTop, SKY_GAIN),
        uSkyBottom: scale(light.skyBottom, SKY_GAIN),
        uLampColor: scale(LAMP_LIGHT.color, LAMP_LIGHT.intensity * lamps),
        uLampEmit: scale(LAMP_LIGHT.color, LAMP_LIGHT.emissive * lamps),
        uTvEmit: scale(TV_LIGHT.color, TV_LIGHT.emissive * light.tv),
        uTime: state.clock,
        uDirect: t.direct,
        uBeam: t.beam,
        uFog: t.fog,
        uDustOn: t.dust,
        uBeamDensity: state.sliders.beamDensity * this.beamScale,
        uView: VIEW_IDS[view],
      });

      const step = (target: RenderTarget, src: WebGLTexture, dir: [number, number]) =>
        this.blur.run(target, target, { uSrc: src, uRes: [target.width, target.height], uDir: dir });
      step(this.blurA, this.lit.tex, [0, 0]);
      step(this.blurB, this.blurA.tex, [1 / this.blurA.width, 0]);
      step(this.blurA, this.blurB.tex, [0, 1 / this.blurA.height]);
    }

    const g = preset.grade;
    this.final.run(null, this.outputSize, {
      uScene: this.lit.tex,
      uBlur: this.blurA.tex,
      uAlbedo: this.tex.albedo,
      uRes: [this.outputSize.width, this.outputSize.height],
      uSceneRes: [SCENE_RES.width, SCENE_RES.height],
      uMode: view === 'albedo' ? MODE.albedo : view === 'final' ? MODE.graded : MODE.raw,
      uIntensity: state.sliders.intensity,
      uTime: state.clock,
      uExposure: g.exposure,
      uContrast: g.contrast,
      uSaturation: g.saturation,
      uLift: g.lift,
      uGain: g.gain,
      uTemperature: g.temperature,
      uVignette: g.vignette,
      uBloom: t.softFocus ? g.bloom : 0,
      uBloomThreshold: g.bloomThreshold,
      uSoftFocus: t.softFocus ? g.softFocus : 0,
      uChromatic: t.chromatic ? state.sliders.chromaticAmount : 0,
      uGrain: t.grain ? state.sliders.grainAmount : 0,
    });
  }
}
