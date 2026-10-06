/**
 * Components import from 'react-native' (typed by the react-native package). Only the web
 * entry imports react-native-web directly, for the DOM-mounting AppRegistry.
 */
declare module 'react-native-web' {
  import type { ComponentType } from 'react';

  export const AppRegistry: {
    registerComponent(appKey: string, getComponent: () => ComponentType): string;
    runApplication(appKey: string, parameters: { rootTag: HTMLElement; initialProps?: object }): void;
  };
}
