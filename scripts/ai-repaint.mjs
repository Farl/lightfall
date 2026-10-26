#!/usr/bin/env node
/**
 * Repaint the flat proxy render into richer pixel art with an Atlas Cloud image-edit model.
 *
 *   node scripts/ai-repaint.mjs [input.png] [output.png]
 *
 * The output keeps the exact layout/perspective of the input, so the authored proxy
 * geometry (roomData.ts) still lines up and keeps driving the lighting.
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
  input: 'art/flat-source.png',
  output: 'art/ai-albedo.png',
  aspectRatio: '16:9',
  resolution: '2k',
  pollIntervalMs: 3000,
  pollTimeoutMs: 5 * 60 * 1000,
  // Flat lighting on purpose: the renderer adds sun, shadows and atmosphere on top.
  prompt: [
    'Repaint this image as a detailed, cozy hand-made pixel art illustration of a Japanese apartment living room.',
    'Keep the exact same composition, camera, perspective and the position, size and silhouette of every object:',
    'window with curtains on the left wall, potted plant under it, small TV on a low stand, sofa with a red cushion against the back wall,',
    'picture frames, kitchen doorway with a noren curtain, wall clock, low cabinet with a vase, bathroom door, white shoe cabinet, red entrance door on the right wall, wooden plank floor, rug, two round ceiling lights.',
    'Add texture and small props (wood grain, fabric folds, books, small decorations) but do not move or resize anything.',
    'IMPORTANT: flat, even, neutral lighting like an albedo/base-color texture: no cast shadows, no light beams, no sunlight patches, no glow, no vignette, no dramatic contrast.',
    'Crisp pixel art, limited warm pastel palette, no text, no characters.',
  ].join(' '),
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

const [input = CONFIG.input, output = CONFIG.output] = process.argv.slice(2);
const key = apiKey();
const imageUrl = await upload(input, key);
console.log('uploaded', input);
const { id } = await call('/model/generateImage', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: CONFIG.model, prompt: CONFIG.prompt, images: [imageUrl], aspect_ratio: CONFIG.aspectRatio, resolution: CONFIG.resolution, output_format: 'png' }),
}, key);
console.log('prediction', id);
const done = await waitFor(id, key);
const res = await fetch(done.outputs[0]);
await writeFile(output, Buffer.from(await res.arrayBuffer()));
console.log('saved', output);
