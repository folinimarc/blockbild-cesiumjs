export const state = {
  viewer: null,
  terrain: null,
  terrainProvider: null,
  wallEntities: [],
  map: null,
  vectorSource: null,
  drawInteraction: null,
  isGenerating: false,
  isDrawingActive: false,
  outsideCancelHandler: null,
  basemapLayers: {
    swissTopo: null,
    osm: null,
  },
  hasGeneratedBlock: false,
  currentExtent: null,
  shareOverlayOptions: {
    hideMap: false,
  },
  isPuzzleMode: false,
};
