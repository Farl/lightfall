/**
 * Frame pipeline:
 *   painted layers --(lighting.frag @ scene res)--> HDR lit scene
 *   lit scene --(downsample + H/V blur)--> blur (bloom + soft focus source)
 *   lit scene + blur + albedo --(final.frag @ output res)--> canvas
 */
import { ATMOSPHERE, LAMP_LIGHT, OUTPUT_SCALE, PRESETS, RENDER, SCENE_RES, SKY_GAIN, TV_LIGHT, CAMERA } from '../config';
import { DEPTH_RANGE, SCENE_CENTER } from '../camera';
import type { LightingState } from '../lighting';
import { scale } from '../math';
import { ROOM, type RoomData } from '../scene/roomData';
import type { SceneLayers } from '../scene/layers';
import type { AppState } from '../state';
import { createTarget, createTexture, Pass, uploadCanvas, type RenderTarget } from './gl';
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
  private tex: { albedo: WebGLTexture; depth: WebGLTexture; normal: WebGLTexture; emissive: WebGLTexture; dust: WebGLTexture };
  private lit: RenderTarget;
  private blurA: RenderTarget;
  private blurB: RenderTarget;
  private staticUniforms: Record<string, number | number[]>;

  constructor(canvas: HTMLCanvasElement, layers: SceneLayers, private room: RoomData) {
    canvas.width = this.outputSize.width;
    canvas.height = this.outputSize.height;
    const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: false });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    const hdr = !!gl.getExtension('EXT_color_buffer_float');

    if (room.panes.length > RENDER.maxPanes || room.boxes.length > RENDER.maxBoxes || room.lamps.length > RENDER.maxLamps) {
      throw new Error('Room data exceeds RENDER.max* shader array sizes');
    }

    this.lighting = new Pass(gl, withDefines(lightingSrc));
    this.blur = new Pass(gl, blurSrc);
    this.final = new Pass(gl, finalSrc);

    this.tex = {
      albedo: createTexture(gl, gl.NEAREST),
      depth: createTexture(gl, gl.NEAREST),
      normal: createTexture(gl, gl.NEAREST),
      emissive: createTexture(gl, gl.NEAREST),
      dust: createTexture(gl, gl.NEAREST),
    };
    uploadCanvas(gl, this.tex.albedo, layers.albedo.canvas);
    uploadCanvas(gl, this.tex.depth, layers.depth.canvas);
    uploadCanvas(gl, this.tex.normal, layers.normal.canvas);
    uploadCanvas(gl, this.tex.emissive, layers.emissive.canvas);

    this.lit = createTarget(gl, SCENE_RES.width, SCENE_RES.height, gl.NEAREST, hdr);
    const bw = Math.round(SCENE_RES.width / RENDER.blurDownscale);
    const bh = Math.round(SCENE_RES.height / RENDER.blurDownscale);
    this.blurA = createTarget(gl, bw, bh, gl.LINEAR, hdr);
    this.blurB = createTarget(gl, bw, bh, gl.LINEAR, hdr);

    const panes = room.panes;
    this.staticUniforms = {
      uRes: [SCENE_RES.width, SCENE_RES.height],
      uCenter: [...SCENE_CENTER],
      uCam: [CAMERA.x, CAMERA.y, CAMERA.dist, CAMERA.focal],
      uDepthRange: [DEPTH_RANGE.far, DEPTH_RANGE.near],
      uRoomNear: ROOM.near,
      uSunSoftness: RENDER.sunSoftness,
      uShadowSamples: RENDER.shadowSamples,
      uNormalBias: RENDER.normalBias,
      uBeamSteps: RENDER.beamSteps,
      uWindowX: room.windowX,
      uPaneCount: panes.length,
      uPanes: flat(panes, (p) => [p.zMin, p.yMin, p.zMax, p.yMax]),
      uSkyRange: [Math.min(...panes.map((p) => p.yMin)), Math.max(...panes.map((p) => p.yMax))],
      uBoxCount: room.boxes.length,
      uBoxMin: flat(room.boxes, (b) => b.min),
      uBoxMax: flat(room.boxes, (b) => b.max),
      uLampCount: room.lamps.length,
      uLampPos: flat(room.lamps, (l) => l),
      uLampFalloff: LAMP_LIGHT.falloff,
      uTvFlicker: TV_LIGHT.flickerSpeed,
      uShaftScale: ATMOSPHERE.shaftScale,
      uShaftAmount: ATMOSPHERE.shaftAmount,
      uFogDensity: ATMOSPHERE.fogDensity,
      uFogHeightFalloff: ATMOSPHERE.fogHeightFalloff,
      uFogDrift: ATMOSPHERE.fogDrift,
      uDustLitGain: ATMOSPHERE.dustLitGain,
      uDustAmbientGain: ATMOSPHERE.dustAmbientGain,
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
        uAlbedo: this.tex.albedo,
        uDepth: this.tex.depth,
        uNormal: this.tex.normal,
        uEmissive: this.tex.emissive,
        uDust: this.tex.dust,
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
        uBeamDensity: state.sliders.beamDensity,
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
