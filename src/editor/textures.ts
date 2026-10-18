import { useEffect, useState } from 'react';
import * as THREE from 'three';

type Loader = (url: string) => Promise<TexImageSource>;

const loadImage: Loader = (url) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${url}`));
    img.src = url;
  });

function pixelTexture(source: TexImageSource | HTMLCanvasElement): THREE.Texture {
  const tex = new THREE.Texture(source as never);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function createTextureCache(load: Loader = loadImage, base = '/textures/') {
  const images = new Map<string, Promise<TexImageSource | null>>();
  const textures = new Map<string, Promise<THREE.Texture | null>>();

  function image(rel: string) {
    if (!images.has(rel)) {
      images.set(rel, load(base + rel).catch((err) => {
        console.warn(`Texture unavailable (run "npm run textures"): ${rel}`, err);
        return null;
      }));
    }
    return images.get(rel)!;
  }

  function get(rel?: string): Promise<THREE.Texture | null> {
    if (!rel) return Promise.resolve(null);
    if (!textures.has(rel)) textures.set(rel, image(rel).then((img) => (img ? pixelTexture(img) : null)));
    return textures.get(rel)!;
  }

  /** Base texture with an overlay drawn on top (machine front faces). Animated strips use their first frame. */
  function composite(baseRel?: string, overlayRel?: string): Promise<THREE.Texture | null> {
    if (!baseRel) return Promise.resolve(null);
    if (!overlayRel) return get(baseRel);
    const key = `${baseRel}+${overlayRel}`;
    if (!textures.has(key)) {
      textures.set(key, Promise.all([image(baseRel), image(overlayRel)]).then(([b, o]) => {
        if (!b) return null;
        const size = (b as HTMLImageElement).width || 16;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d')!;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(b as CanvasImageSource, 0, 0, size, size, 0, 0, size, size);
        if (o) ctx.drawImage(o as CanvasImageSource, 0, 0, size, size, 0, 0, size, size);
        return pixelTexture(canvas);
      }));
    }
    return textures.get(key)!;
  }

  return { get, composite };
}

export const textureCache = createTextureCache();

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): T | undefined {
  const [value, setValue] = useState<T>();
  useEffect(() => {
    let live = true;
    fn().then((v) => live && setValue(v));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}
