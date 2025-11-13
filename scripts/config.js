export const APP_CONFIG = Object.freeze({
  fidelity: 100,
  maxSquareSize: 15_000,
  defaultCenter: [8.2275, 46.8182],
  defaultZoom: 8,
  mapPanel: {
    minWidth: 220,
    maxWidth: 880,
    minHeight: 140,
    maxHeight: 880,
  },
});

export const PANEL_MESSAGE = Object.freeze({
  idle: 'Draw Area <span>(Tap or click and drag)</span>',
  drawing: 'Release to build the block <span>Tap outside the map to cancel</span>',
  generating: '<span>Generating 3D Block...</span>',
  error: '<span>Something went wrong. Refresh the page.</span>',
});

export const URL_PARAM_SHARE = 'share';

export const DRAW_MIN_SIZE = 25;
