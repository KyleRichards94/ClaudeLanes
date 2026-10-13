import type { CitySceneProps } from './CityScene.types';

/**
 * Native fallback: Code City depends on CSS 3D transforms, so a native target renders nothing here (the layout
 * slider is hidden there and Flight deck is always used). The web build picks `CityScene.web.tsx`.
 */
export function CityScene(_props: CitySceneProps): null {
  return null;
}
