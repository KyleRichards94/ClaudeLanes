// The entry is web-only, so it takes AppRegistry straight from react-native-web, whose
// runApplication mounts into a DOM element. Components import from 'react-native'.
import { AppRegistry } from 'react-native-web';
import '@agent-lanes/tokens/agent-lanes-tokens.css';
import './app/styles/fonts.css';
import './app/styles/global.css';
import { App } from './app';
// Imported here rather than through app/index.tsx so that file stays a Fast Refresh boundary.
import { startEventHub } from './app/entrypoint/EventHub';

const rootTag = document.getElementById('root');
if (!rootTag) throw new Error('index.html is missing #root');

// One bridge subscription per event channel for the renderer's lifetime, made before the first render.
startEventHub();

AppRegistry.registerComponent('AgentLanes', () => App);
AppRegistry.runApplication('AgentLanes', { rootTag });
