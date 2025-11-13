import { PANEL_MESSAGE } from './config.js';
import { state } from './state.js';
import { queryDom, setPanelMessage, showInfoPanel, hideInfoPanel } from './dom.js';
import { createShareController } from './share.js';
import { createViewerController } from './viewer.js';
import { createMapController } from './map.js';

function initialize() {
  const dom = queryDom();

  showInfoPanel(dom);
  setPanelMessage(dom, PANEL_MESSAGE, 'idle');

  const shareController = createShareController({ dom, state });
  shareController.initialize();

  let viewerController = null;

  const shareConfig = shareController.getShareConfigFromUrl();
  const pendingSharedExtent = shareConfig?.extent ?? null;
  shareController.applyPuzzleMode(shareConfig?.hideMap ?? false);

  const mapController = createMapController({
    dom,
    setPanelMessage: (type) => setPanelMessage(dom, PANEL_MESSAGE, type),
    generateBlock: (extent, fidelity) => {
      if (!viewerController) {
        return Promise.resolve(null);
      }
      return viewerController.generateBlock(extent, fidelity);
    },
  });

  viewerController = createViewerController({
    dom,
    state,
    onFirstBlockRendered: () => hideInfoPanel(dom),
    onBlockGenerated: (normalizedExtent) => shareController.handleBlockGenerated(normalizedExtent),
    onTerrainReady: () => {
      mapController.initialize();

      if (pendingSharedExtent) {
        mapController.bootstrapExtent(pendingSharedExtent).catch((error) => {
          console.error('Error bootstrapping shared extent:', error);
          setPanelMessage(dom, PANEL_MESSAGE, 'error');
        });
      }
    },
    onTerrainError: () => setPanelMessage(dom, PANEL_MESSAGE, 'error'),
  });

  try {
    viewerController.initialize();
  } catch (error) {
    console.error('Failed to initialize viewer:', error);
    setPanelMessage(dom, PANEL_MESSAGE, 'error');
    return;
  }

  if (!state.viewer) {
    setPanelMessage(dom, PANEL_MESSAGE, 'error');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}
