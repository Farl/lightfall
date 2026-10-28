#!/usr/bin/env node
/**
 * Repaint the flat proxy render into richer pixel art with an Atlas Cloud image-edit model.
 *
 *   node scripts/ai-repaint.mjs [room|forest]
 *
 * The input is the scene's flat proxy render (the 原始 / albedo view, 1280x720).
 * The output keeps its exact layout/perspective, so the authored proxy geometry
 * (scene/*Data.ts) still lines up and keeps driving the lighting.
 *
 * The API key is read from the macOS Keychain (service `atlascloud-api-key`) at run
 * time and only ever lives in this process' memory. Store it once with:
 *   security add-generic-password -U -a "$USER" -s atlascloud-api-key -w
 */
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';

const CONFIG = {
  apiBase: 'https://api.atlascloud.ai/api/v1',
  keychainService: 'atlascloud-api-key',
  model: 'google/nano-banana-pro/edit',
  aspectRatio: '16:9',
  resolution: '2k',
  pollIntervalMs: 3000,
  pollTimeoutMs: 5 * 60 * 1000,
  defaultScene: 'room',
};

// Shared tail of every prompt. Flat lighting on purpose: the renderer adds sun, shadows and atmosphere on top.
const FLAT_LIGHTING = [
  'IMPORTANT: flat, even, neutral lighting like an albedo/base-color texture: no cast shadows, no light beams, no sunlight patches, no glow, no vignette, no dramatic contrast.',
  'Crisp pixel art, no text, no characters.',
];

/** Per scene: the flat proxy render to repaint, where the result goes, and what is in the picture. */
const SCENES = {
  room: {
    input: 'art/flat-source.png',
    output: 'art/ai-albedo.png',
    prompt: [
      'Repaint this image as a detailed, cozy hand-made pixel art illustration of a Japanese apartment living room.',
      'Keep the exact same composition, camera, perspective and the position, size and silhouette of every object:',
      'window with curtains on the left wall, potted plant under it, small TV on a low stand, sofa with a red cushion against the back wall,',
      'picture frames, kitchen doorway with a noren curtain, wall clock, low cabinet with a vase, bathroom door, white shoe cabinet, red entrance door on the right wall, wooden plank floor, rug, two round ceiling lights.',
      'Add texture and small props (wood grain, fabric folds, books, small decorations) but do not move or resize anything.',
      'Limited warm pastel palette.',
    ],
  },
  forest: {
    input: 'art/forest-flat-source.png',
    output: 'art/forest-ai-albedo.png',
    prompt: [
      'Repaint this image as a detailed hand-made pixel art illustration of a misty broadleaf forest, seen from a small dirt path.',
      'Keep the exact same composition, camera, perspective and the position, size and silhouette of every element:',
      'the two dark near trees framing the view with their branches across the top, the row of middle trees, the hazy far tree line with round crowns,',
      'the pale sky showing between the trees in exactly the same gaps, the low undergrowth, the two bushes, the two grey rocks and the dirt path.',
      'Add texture (bark, leaf clusters, ferns, grass tufts, pebbles) inside the existing shapes but do not move, resize or fill in the sky gaps.',
      'Muted deep green and earthy brown palette.',
    ],
  },
};

function apiKey() {
  try {
    return execFileSync('security', ['find-generic-password', '-a', process.env.USER ?? '', '-s', CONFIG.keychainService, '-w'], { encoding: 'utf8' }).trim();
  } catch {
    throw new Error(`No Keychain item '${CONFIG.keychainService}'. Add it with: security add-generic-password -U -a "$USER" -s ${CONFIG.keychainService} -w`);
  }
}

async function call(path, init, key) {
  const res = await fetch(`${CONFIG.apiBase}${path}`, { ...init, headers: { Authorization: `Bearer ${key}`, ...init.headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || (body.code && body.code !== 200)) throw new Error(`${path} -> ${res.status} ${body.msg ?? body.message ?? JSON.stringify(body)}`);
  return body.data ?? body;
}

async function upload(file, key) {
  const form = new FormData();
  form.append('file', new Blob([await readFile(file)], { type: 'image/png' }), basename(file));
  const data = await call('/model/uploadMedia', { method: 'POST', body: form }, key);
  return data.download_url ?? data.url ?? data;
}

async function waitFor(id, key) {
  const deadline = Date.now() + CONFIG.pollTimeoutMs;
  while (Date.now() < deadline) {
    const p = await call(`/model/prediction/${id}`, { method: 'GET' }, key);
    if (['completed', 'succeeded'].includes(p.status)) return p;
    if (['failed', 'timeout', 'canceled'].includes(p.status)) throw new Error(`prediction ${id} ${p.status}: ${p.error ?? ''}`);
    await new Promise((r) => setTimeout(r, CONFIG.pollIntervalMs));
  }
  throw new Error(`prediction ${id} did not finish in time`);
}

const sceneName = process.argv[2] ?? CONFIG.defaultScene;
const scene = SCENES[sceneName];
if (!scene) throw new Error(`Unknown scene '${sceneName}'. Use one of: ${Object.keys(SCENES).join(', ')}`);
const { input, output } = scene;
const prompt = [...scene.prompt, ...FLAT_LIGHTING].join(' ');
const key = apiKey();
const imageUrl = await upload(input, key);
console.log('uploaded', input);
const { id } = await call('/model/generateImage', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: CONFIG.model, prompt, images: [imageUrl], aspect_ratio: CONFIG.aspectRatio, resolution: CONFIG.resolution, output_format: 'png' }),
}, key);
console.log('prediction', id);
const done = await waitFor(id, key);
const res = await fetch(done.outputs[0]);
await writeFile(output, Buffer.from(await res.arrayBuffer()));
console.log('saved', output);
