(function () {
  'use strict';

  const APP_CONFIG = Object.freeze({
    fidelity: 100,
    maxSquareSize: 30_000,
    defaultCenter: [8.2275, 46.8182],
    defaultZoom: 8,
    mapPanel: {
      minWidth: 240,
      maxWidth: 560,
      minHeight: 220,
      maxHeight: 520,
    },
  });

  const PANEL_MESSAGE = Object.freeze({
    idle: 'Draw Area <span>(Tap or click and drag)</span>',
    drawing: 'Release to build the block <span>Tap outside the map to cancel</span>',
    generating: '<span>Generating 3D Block...</span>',
    error: '<span>Something went wrong. Refresh the page.</span>',
  });

  const dom = {
    header: null,
    infoPanel: null,
    mapPanel: null,
    mapResizer: null,
  };

  const state = {
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
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    initialize();
  }

  const panelResizeState = {
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    startWidth: 0,
    startHeight: 0,
  };

  let mapSizeUpdatePending = false;

  function initialize() {
    dom.header = document.getElementById('map-panel-header');
    dom.infoPanel = document.getElementById('info-panel');
    dom.mapPanel = document.getElementById('map-panel');
    dom.mapResizer = document.getElementById('map-panel-resizer');

    showInfoPanel();
    setPanelMessage('idle');

    if (!window.Cesium) {
      console.error('CesiumJS failed to load.');
      setPanelMessage('error');
      return;
    }

    if (!window.ol) {
      console.error('OpenLayers failed to load.');
      setPanelMessage('error');
      return;
    }

    setupMapPanelResizer();
    initializeCesium();
  }

  function setPanelMessage(type) {
    if (!dom.header) {
      return;
    }
    const message = PANEL_MESSAGE[type] ?? PANEL_MESSAGE.idle;
    dom.header.innerHTML = message;
  }

  function showInfoPanel() {
    if (!dom.infoPanel) {
      return;
    }
    dom.infoPanel.classList.remove('is-hidden');
  }

  function hideInfoPanel() {
    if (!dom.infoPanel) {
      return;
    }
    dom.infoPanel.remove();
    dom.infoPanel = null;
  }

  function revealCesiumScene() {
    if (!state.viewer) {
      return;
    }

    state.viewer.scene.globe.show = true;
    hideInfoPanel();
  }

  function initializeCesium() {
    Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI5ZGMyODE0Zi0wMmVjLTQyNDItOWNlOS0yMGFjNTRlYmY2MjUiLCJpZCI6MjQ5NTkwLCJpYXQiOjE3NjI4OTk0NTJ9.70gVwunSU7jxhAcgt4yKlrSGHlNUp7eSALxjMJeASUw';

    state.terrain = Cesium.Terrain.fromWorldTerrain();

    state.viewer = new Cesium.Viewer('cesiumContainer', {
      terrain: state.terrain,
      skyAtmosphere: false,
      skyBox: false,
      geocoder: false,
      shadows: false,
      animation: false,
      timeline: false,
      baseLayerPicker: false,
    });

    configureSceneAppearance();

    state.terrain.readyEvent.addEventListener(onTerrainReady);
    state.terrain.errorEvent.addEventListener(onTerrainError);
  }

  function configureSceneAppearance() {
    const { scene } = state.viewer;

    if (scene.globe) {
      scene.globe.depthTestAgainstTerrain = true;
      scene.globe.enableLighting = false;
      scene.globe.show = false;
    }

    scene.skyBox = undefined;
    scene.skyAtmosphere = undefined;

    if (Cesium.defined(scene.sun)) {
      scene.sun.show = false;
    } else {
      scene.sun = new Cesium.Sun();
      scene.sun.show = false;
    }

    if (Cesium.defined(scene.moon)) {
      scene.moon.show = false;
    }

    scene.backgroundColor = Cesium.Color.fromCssColorString('#0f1115');
  }

  function onTerrainReady(terrainProvider) {
    state.terrainProvider = terrainProvider;
    initializeMap();
  }

  function onTerrainError(error) {
    console.error('Error loading terrain:', error);
    alert('A critical error occurred loading terrain. Please refresh.');
    setPanelMessage('error');
  }

  function initializeMap() {
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

    const SWISS_EXTENT_LONLAT = [5.96, 45.82, 10.49, 47.81];
    const swissExtent3857 = ol.proj.transformExtent(
      SWISS_EXTENT_LONLAT,
      'EPSG:4326',
      'EPSG:3857'
    );

    const shouldUseSwissTopo = (coordinate) =>
      Array.isArray(coordinate) && ol.extent.containsCoordinate(swissExtent3857, coordinate);

    const updateBasemap = () => {
      const center = state.map?.getView().getCenter();
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

    const geometryFunction = createSquareGeometryFunction();

    const drawInteraction = new ol.interaction.Draw({
      source: state.vectorSource,
      type: 'Circle',
      geometryFunction,
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
  }

  function handleDrawStart(event) {
    if (!state.drawInteraction || state.isGenerating) {
      if (state.drawInteraction) {
        state.drawInteraction.abortDrawing();
      }
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

    if (maxDimension < 25) {
      state.vectorSource.removeFeature(feature);
      setPanelMessage('idle');
      return;
    }

    state.isGenerating = true;
    setPanelMessage('generating');
    state.drawInteraction.setActive(false);

    try {
      const extent4326 = toGeographicExtent(extent3857);
      await generateBlock(extent4326, APP_CONFIG.fidelity);
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

  function registerOutsideCancelListener() {
    if (state.outsideCancelHandler || !dom.mapPanel) {
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

  function finalizeDrawingSession({ aborted = false } = {}) {
    state.isDrawingActive = false;
    detachOutsideCancelListener();

    if (aborted && !state.isGenerating) {
      if (state.vectorSource) {
        state.vectorSource.clear();
      }
      setPanelMessage('idle');
    }
  }

  function setupMapPanelResizer() {
    if (!dom.mapPanel || !dom.mapResizer) {
      return;
    }

    dom.mapResizer.addEventListener('pointerdown', handlePanelResizeStart);
  }

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

  async function generateBlock(extent, fidelity) {
    if (!state.terrainProvider) {
      console.error('generateBlock called before terrain was ready.');
      return;
    }

    const { west, south, east, north } = extent;
    console.log(`Generating block for: ${west}, ${south}, ${east}, ${north}`);

    clearExistingGeometry();
    applyTerrainClipping(extent);
    await orientCamera(extent);

    const interpolatedSegments = createInterpolatedWallSegments(extent, fidelity);
    const sampledSegments = await sampleTerrainForSegments(interpolatedSegments);

    const baseAltitude = deriveBaseAltitude(sampledSegments);

    Object.entries(sampledSegments).forEach(([direction, segment]) => {
      createSidePolygon(segment, direction, baseAltitude);
    });

    if (!state.hasGeneratedBlock) {
      state.hasGeneratedBlock = true;
      revealCesiumScene();
    }
  }

  function clearExistingGeometry() {
    state.wallEntities.forEach((entity) => {
      state.viewer.entities.remove(entity);
    });

    state.wallEntities = [];

    if (state.viewer.scene.globe.clippingPolygons) {
      state.viewer.scene.globe.clippingPolygons.removeAll();
    }
  }

  function applyTerrainClipping(extent) {
    const { west, south, east, north } = extent;

    const positions = Cesium.Cartesian3.fromDegreesArray([
      west,
      south,
      east,
      south,
      east,
      north,
      west,
      north,
    ]);

    state.viewer.scene.globe.clippingPolygons = new Cesium.ClippingPolygonCollection({
      polygons: [new Cesium.ClippingPolygon({ positions })],
      edgeColor: Cesium.Color.WHITE,
      edgeWidth: 2.0,
      inverse: true,
    });

    state.viewer.scene.globe.clippingPolygons.enabled = true;
  }

  async function orientCamera(extent) {
    const { west, south, east, north } = extent;

    try {
      const rectangle = Cesium.Rectangle.fromDegrees(west, south, east, north);
      const center = Cesium.Rectangle.center(rectangle);

      const [sampledCenter] = await Cesium.sampleTerrainMostDetailed(
        state.terrainProvider,
        [center]
      );
      const targetPoint = Cesium.Cartographic.toCartesian(sampledCenter);

      const diagonal = Cesium.Cartesian3.distance(
        Cesium.Cartesian3.fromDegrees(west, south),
        Cesium.Cartesian3.fromDegrees(east, north)
      );

      const zoomRange = diagonal * 1.5;

      state.viewer.camera.flyTo({
        destination: targetPoint,
        orientation: {
          heading: Cesium.Math.toRadians(0),
          pitch: Cesium.Math.toRadians(-45),
          roll: 0,
        },
        duration: 1.5,
      });

      setTimeout(() => {
        state.viewer.camera.lookAt(
          targetPoint,
          new Cesium.HeadingPitchRange(
            Cesium.Math.toRadians(0),
            Cesium.Math.toRadians(-45),
            zoomRange
          )
        );

        const controller = state.viewer.scene.screenSpaceCameraController;
        controller.enablePan = false;
        controller.enableTilt = false;
        controller.minimumZoomDistance = 500;
        controller.maximumZoomDistance = zoomRange * 3;
      }, 1600);
    } catch (error) {
      console.error('Error setting camera view:', error);
    }
  }

  function createInterpolatedWallSegments(extent, fidelity) {
    const { west, south, east, north } = extent;

    const lerp = (start, end, t) => start + (end - start) * t;

    const createSegment = (startLon, startLat, endLon, endLat) => {
      const points = [];

      for (let i = 0; i <= fidelity; i += 1) {
        const factor = i / fidelity;
        points.push(
          Cesium.Cartographic.fromDegrees(
            lerp(startLon, endLon, factor),
            lerp(startLat, endLat, factor)
          )
        );
      }

      return points;
    };

    return {
      south: createSegment(west, south, east, south),
      east: createSegment(east, south, east, north),
      north: createSegment(east, north, west, north),
      west: createSegment(west, north, west, south),
    };
  }

  async function sampleTerrainForSegments(segments) {
    const entries = Object.entries(segments);

    const sampled = await Promise.all(
      entries.map(([, points]) => Cesium.sampleTerrainMostDetailed(state.terrainProvider, points))
    );

    return entries.reduce((accumulator, [direction], index) => {
      accumulator[direction] = sampled[index];
      return accumulator;
    }, {});
  }

  function deriveBaseAltitude(sampledSegments) {
    let minHeight = Infinity;
    let maxHeight = -Infinity;

    Object.values(sampledSegments).forEach((segment) => {
      segment.forEach((point) => {
        const height = typeof point.height === 'number' ? point.height : 0;
        if (height < minHeight) minHeight = height;
        if (height > maxHeight) maxHeight = height;
      });
    });

    const delta = maxHeight - minHeight;
    const buffer = delta * 0.2;
    const baseAltitude = minHeight - buffer;

    console.log(
      `Min/Max/Delta: ${minHeight.toFixed(2)}m / ${maxHeight.toFixed(2)}m / ${delta.toFixed(2)}m`
    );
    console.log(`New block base altitude set to: ${baseAltitude.toFixed(2)}m`);

    return baseAltitude;
  }

  function createSidePolygon(segment, direction, baseAltitude) {
    const material = new Cesium.Color(0.5, 0.45, 0.3, 1);

    try {
      const positions = segment.map((point) =>
        Cesium.Cartesian3.fromRadians(
          point.longitude,
          point.latitude,
          typeof point.height === 'number' ? point.height : baseAltitude
        )
      );

      for (let i = segment.length - 1; i >= 0; i -= 1) {
        const point = segment[i];
        positions.push(
          Cesium.Cartesian3.fromRadians(point.longitude, point.latitude, baseAltitude)
        );
      }

      const entity = state.viewer.entities.add({
        name: `Blockbild Wall ${capitalize(direction)}`,
        polygon: {
          hierarchy: positions,
          material,
          perPositionHeight: true,
        },
      });

      state.wallEntities.push(entity);
    } catch (error) {
      console.error(`Error creating polygon for ${direction} wall:`, error);
    }
  }

  function capitalize(value) {
    if (!value) {
      return value;
    }
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  function requestMapSizeUpdate() {
    if (!state.map || mapSizeUpdatePending) {
      return;
    }

    mapSizeUpdatePending = true;
    requestAnimationFrame(() => {
      mapSizeUpdatePending = false;
      if (state.map) {
        state.map.updateSize();
      }
    });
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
})();
