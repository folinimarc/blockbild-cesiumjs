import { normalizeExtent } from './extent.js';

/**
 * Creates the Cesium viewer controller responsible for rendering 3D blocks.
 * @param {{ dom: ReturnType<typeof import('./dom.js').queryDom>, state: typeof import('./state.js').state, onFirstBlockRendered?: Function, onBlockGenerated?: Function, onTerrainReady?: Function, onTerrainError?: Function }} context
 */
export function createViewerController({
  dom,
  state,
  onFirstBlockRendered,
  onBlockGenerated,
  onTerrainReady,
  onTerrainError,
}) {
  function initialize() {
    if (!window.Cesium) {
      throw new Error('CesiumJS failed to load.');
    }

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
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      navigationInstructionsInitiallyVisible: false,
      baseLayerPicker: false,
    });

    configureSceneAppearance();

    state.terrain.readyEvent.addEventListener((terrainProvider) => {
      state.terrainProvider = terrainProvider;
      onTerrainReady?.(terrainProvider);
    });

    state.terrain.errorEvent.addEventListener((error) => {
      console.error('Error loading terrain:', error);
      onTerrainError?.(error);
    });
  }

  async function generateBlock(extent, fidelity) {
    if (!state.terrainProvider) {
      console.error('generateBlock called before terrain was ready.');
      return null;
    }

    const normalizedExtent = normalizeExtent(extent);
    if (!normalizedExtent) {
      return null;
    }

    await hideViewer();

    try {
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
        revealScene();
        onFirstBlockRendered?.();
      }

      onBlockGenerated?.(normalizedExtent);
      return normalizedExtent;
    } finally {
      await showViewer();
    }
  }

  function configureSceneAppearance() {
    const { scene } = state.viewer;

    if (scene.globe) {
      scene.globe.depthTestAgainstTerrain = true;
      scene.globe.enableLighting = false;
      scene.globe.show = false;
      scene.globe.maximumScreenSpaceError = 1;
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
      const heading = Cesium.Math.toRadians(0);
      const pitch = Cesium.Math.toRadians(-45);

      state.viewer.camera.lookAt(
        targetPoint,
        new Cesium.HeadingPitchRange(heading, pitch, zoomRange)
      );

      const controller = state.viewer.scene.screenSpaceCameraController;
      controller.enablePan = false;
      controller.enableTilt = false;
      controller.minimumZoomDistance = 500;
      controller.maximumZoomDistance = zoomRange * 3;
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
    return minHeight - buffer;
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

  function revealScene() {
    if (!state.viewer) {
      return;
    }

    state.viewer.scene.globe.show = true;
  }

  function capitalize(value) {
    if (!value) {
      return value;
    }
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  function getViewerElement() {
    return dom.viewer;
  }

  function setViewerVisibility(visible) {
    const element = getViewerElement();

    const targetClass = 'is-visible';
    const isVisible = element.classList.contains(targetClass);

    if (visible === isVisible) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      let fallbackId = null;
      let resolved = false;

      function cleanup() {
        if (resolved) {
          return;
        }

        resolved = true;
        element.removeEventListener('transitionend', handleTransitionEnd);
        if (fallbackId !== null) {
          window.clearTimeout(fallbackId);
        }
        resolve();
      }

      function handleTransitionEnd(event) {
        if (event.propertyName !== 'opacity') {
          return;
        }

        cleanup();
      }

      element.addEventListener('transitionend', handleTransitionEnd);
      fallbackId = window.setTimeout(cleanup, 320);

      requestAnimationFrame(() => {
        element.classList.toggle(targetClass, visible);
      });
    });
  }

  function hideViewer() {
    return setViewerVisibility(false);
  }

  function showViewer() {
    return setViewerVisibility(true);
  }

  return {
    initialize,
    generateBlock,
  };
}
