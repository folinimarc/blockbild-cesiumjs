import { APP_CONFIG, DRAW_MIN_SIZE } from './config.js';
import { state } from './state.js';

const SWISS_EXTENT_LONLAT = [5.96, 45.82, 10.49, 47.81];

/**
 * Creates the OpenLayers map controller handling drawing and basemap switching.
 * @param {{ dom: ReturnType<typeof import('./dom.js').queryDom>, setPanelMessage: Function, generateBlock: Function }} context
 */
export function createMapController({
  dom,
  setPanelMessage,
  generateBlock,
}) {
  let mapSizeUpdatePending = false;

  function initialize() {
    if (!window.ol) {
      throw new Error('OpenLayers failed to load.');
    }

    state.vectorSource = new ol.source.Vector();

    const drawStyle = new ol.style.Style({
      fill: new ol.style.Fill({
        color: 'rgba(78, 166, 222, 0.25)',
      }),
      stroke: new ol.style.Stroke({
        color: 'rgba(78, 166, 222, 0.85)',
        width: 3,
      }),
    });

    const swissTopoLayer = new ol.layer.Tile({
      source: new ol.source.XYZ({
        url: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg',
        crossOrigin: 'anonymous',
      }),
      visible: false,
    });

    const osmLayer = new ol.layer.Tile({
      source: new ol.source.OSM(),
      visible: true,
    });

    state.basemapLayers.swissTopo = swissTopoLayer;
    state.basemapLayers.osm = osmLayer;

    const swissExtent3857 = ol.proj.transformExtent(
      SWISS_EXTENT_LONLAT,
      'EPSG:4326',
      'EPSG:3857'
    );

    const shouldUseSwissTopo = (coordinate) =>
      Array.isArray(coordinate) && ol.extent.containsCoordinate(swissExtent3857, coordinate);

    const updateBasemap = () => {
      const center = state.map.getView().getCenter();
      const useSwiss = shouldUseSwissTopo(center);

      swissTopoLayer.setVisible(useSwiss);
      osmLayer.setVisible(!useSwiss);
    };

    state.map = new ol.Map({
      target: 'map-2d',
      layers: [
        swissTopoLayer,
        osmLayer,
        new ol.layer.Vector({
          source: state.vectorSource,
          style: drawStyle,
        }),
      ],
      view: new ol.View({
        center: ol.proj.fromLonLat(APP_CONFIG.defaultCenter),
        zoom: APP_CONFIG.defaultZoom,
      }),
      controls: [],
    });

    const drawInteraction = new ol.interaction.Draw({
      source: state.vectorSource,
      type: 'Circle',
      geometryFunction: createSquareGeometryFunction(),
      maxPoints: 2,
      stopClick: true,
    });

    drawInteraction.on('drawstart', handleDrawStart);
    drawInteraction.on('drawend', handleDrawEnd);
    drawInteraction.on('drawabort', handleDrawAbort);

    state.drawInteraction = drawInteraction;
    state.map.addInteraction(drawInteraction);

    updateBasemap();
    state.map.on('moveend', updateBasemap);
    requestMapSizeUpdate();

    setupMapPanelResizer();
  }

  async function bootstrapExtent(extent) {
    if (!extent) {
      return;
    }

    if (!state.vectorSource || !state.map || !state.drawInteraction) {
      console.warn('Map not ready to bootstrap extent.');
      return;
    }

    state.vectorSource.clear();
    state.vectorSource.addFeature(createFeatureFromExtent(extent));

    try {
      const extentArray = [extent.west, extent.south, extent.east, extent.north];
      const extent3857 = ol.proj.transformExtent(extentArray, 'EPSG:4326', 'EPSG:3857');
      state.map.getView().fit(extent3857, {
        duration: 0,
        padding: [32, 32, 32, 32],
        maxZoom: 14,
      });
    } catch (error) {
      console.error('Error fitting map view for extent:', error);
    }

    state.isGenerating = true;
    setPanelMessage('generating');
    state.drawInteraction.setActive(false);

    try {
      await generateAndHandleBlock(extent);
      setPanelMessage('idle');
    } catch (error) {
      console.error('Error generating block from shared extent:', error);
      setPanelMessage('error');
    } finally {
      state.isGenerating = false;
      state.drawInteraction.setActive(true);
    }
  }

  function handleDrawStart() {
    if (!state.drawInteraction) {
      return;
    }

    if (state.isGenerating) {
      state.drawInteraction.abortDrawing();
      return;
    }

    state.vectorSource.clear();
    state.isDrawingActive = true;
    registerOutsideCancelListener();
    setPanelMessage('drawing');
  }

  async function handleDrawEnd(event) {
    if (!state.drawInteraction) {
      return;
    }

    finalizeDrawingSession();

    const feature = event.feature;
    const geometry = feature.getGeometry();
    const extent3857 = geometry.getExtent();
    const width = extent3857[2] - extent3857[0];
    const height = extent3857[3] - extent3857[1];
    const maxDimension = Math.max(width, height);

    if (maxDimension < DRAW_MIN_SIZE) {
      state.vectorSource.removeFeature(feature);
      setPanelMessage('idle');
      return;
    }

    const extent4326 = toGeographicExtent(extent3857);

    state.isGenerating = true;
    setPanelMessage('generating');
    state.drawInteraction.setActive(false);

    try {
      await generateAndHandleBlock(extent4326);
      setPanelMessage('idle');
    } catch (error) {
      console.error('Error generating block:', error);
      setPanelMessage('error');
    } finally {
      state.isGenerating = false;
      state.drawInteraction.setActive(true);
    }
  }

  function handleDrawAbort() {
    finalizeDrawingSession({ aborted: true });
  }

  function finalizeDrawingSession({ aborted = false } = {}) {
    state.isDrawingActive = false;
    detachOutsideCancelListener();

    if (aborted && !state.isGenerating) {
      state.vectorSource.clear();
      setPanelMessage('idle');
    }
  }

  async function generateAndHandleBlock(extent) {
    await generateBlock(extent, APP_CONFIG.fidelity);
  }

  function registerOutsideCancelListener() {
    if (state.outsideCancelHandler) {
      return;
    }

    const handler = (event) => {
      if (!state.isDrawingActive || !state.drawInteraction) {
        return;
      }

      const target = event.target;
      if (target instanceof Node && dom.mapPanel.contains(target)) {
        return;
      }

      detachOutsideCancelListener();
      state.drawInteraction.abortDrawing();
    };

    document.addEventListener('pointerdown', handler);
    state.outsideCancelHandler = handler;
  }

  function detachOutsideCancelListener() {
    if (!state.outsideCancelHandler) {
      return;
    }

    document.removeEventListener('pointerdown', state.outsideCancelHandler);
    state.outsideCancelHandler = null;
  }

  function requestMapSizeUpdate() {
    if (!state.map || mapSizeUpdatePending) {
      return;
    }

    mapSizeUpdatePending = true;
    requestAnimationFrame(() => {
      mapSizeUpdatePending = false;
      state.map.updateSize();
    });
  }

  function setupMapPanelResizer() {
    dom.mapResizer.addEventListener('pointerdown', handlePanelResizeStart);
  }

  const panelResizeState = {
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    startWidth: 0,
    startHeight: 0,
  };

  function handlePanelResizeStart(event) {
    if (event.button !== undefined && event.button !== 0) {
      return;
    }

    event.preventDefault();

    panelResizeState.active = true;
    panelResizeState.pointerId = event.pointerId;
    panelResizeState.startX = event.clientX;
    panelResizeState.startY = event.clientY;
    panelResizeState.startWidth = dom.mapPanel.offsetWidth;
    panelResizeState.startHeight = dom.mapPanel.offsetHeight;

    dom.mapPanel.classList.add('map-panel--resizing');
    dom.mapResizer.setPointerCapture(event.pointerId);
    dom.mapResizer.addEventListener('pointermove', handlePanelResizeMove);
    dom.mapResizer.addEventListener('pointerup', handlePanelResizeEnd);
    dom.mapResizer.addEventListener('pointercancel', handlePanelResizeEnd);
  }

  function handlePanelResizeMove(event) {
    if (!panelResizeState.active) {
      return;
    }

    const constraints = getMapPanelConstraints();

    const deltaX = panelResizeState.startX - event.clientX;
    const deltaY = event.clientY - panelResizeState.startY;

    const nextWidth = clamp(
      panelResizeState.startWidth + deltaX,
      constraints.minWidth,
      constraints.maxWidth
    );

    const nextHeight = clamp(
      panelResizeState.startHeight + deltaY,
      constraints.minHeight,
      constraints.maxHeight
    );

    dom.mapPanel.style.width = `${nextWidth}px`;
    dom.mapPanel.style.height = `${nextHeight}px`;

    requestMapSizeUpdate();
  }

  function handlePanelResizeEnd(event) {
    if (!panelResizeState.active || panelResizeState.pointerId !== event.pointerId) {
      return;
    }

    panelResizeState.active = false;

    dom.mapResizer.releasePointerCapture(event.pointerId);
    dom.mapResizer.removeEventListener('pointermove', handlePanelResizeMove);
    dom.mapResizer.removeEventListener('pointerup', handlePanelResizeEnd);
    dom.mapResizer.removeEventListener('pointercancel', handlePanelResizeEnd);
    dom.mapPanel.classList.remove('map-panel--resizing');

    requestMapSizeUpdate();
  }

  function createSquareGeometryFunction() {
    return (coordinates, geometry) => {
      const start = coordinates[0];
      const end = coordinates[1] ?? coordinates[0];

      const { coordinates: squareCoords } = buildSquare(start, end);

      if (!geometry) {
        geometry = new ol.geom.Polygon([]);
      }

      geometry.setCoordinates([squareCoords]);
      return geometry;
    };
  }

  function buildSquare(first, second) {
    const width = Math.abs(second[0] - first[0]);
    const height = Math.abs(second[1] - first[1]);
    const side = Math.min(Math.max(width, height), APP_CONFIG.maxSquareSize);

    const directionX = Math.sign(second[0] - first[0]) || 1;
    const directionY = Math.sign(second[1] - first[1]) || 1;

    const secondX = first[0] + side * directionX;
    const secondY = first[1] + side * directionY;

    const coordinates = [
      [first[0], first[1]],
      [secondX, first[1]],
      [secondX, secondY],
      [first[0], secondY],
      [first[0], first[1]],
    ];

    const extent = ol.extent.boundingExtent([
      [first[0], first[1]],
      [secondX, secondY],
    ]);

    return { coordinates, extent };
  }

  function toGeographicExtent(extent) {
    const [minX, minY, maxX, maxY] = ol.proj.transformExtent(
      extent,
      'EPSG:3857',
      'EPSG:4326'
    );

    return {
      west: minX,
      south: minY,
      east: maxX,
      north: maxY,
    };
  }

  function createFeatureFromExtent(extent) {
    const extentArray = [extent.west, extent.south, extent.east, extent.north];
    const extent3857 = ol.proj.transformExtent(extentArray, 'EPSG:4326', 'EPSG:3857');
    const polygon = ol.geom.Polygon.fromExtent(extent3857);
    return new ol.Feature(polygon);
  }

  function getMapPanelConstraints() {
    const config = APP_CONFIG.mapPanel;
    const maxWidth = Math.min(config.maxWidth, window.innerWidth - 32);
    const maxHeight = Math.min(config.maxHeight, window.innerHeight - 32);

    return {
      minWidth: config.minWidth,
      minHeight: config.minHeight,
      maxWidth: Math.max(config.minWidth, maxWidth),
      maxHeight: Math.max(config.minHeight, maxHeight),
    };
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  return {
    initialize,
    bootstrapExtent,
  };
}
