import type * as maplibregl from "maplibre-gl";
import { resolveGeoreferenceQuad } from "../../domain/references/georeference";
import type { MapChartOverlayState } from "../../domain/maps/types";
import type { ReferenceDocument } from "../../domain/references/types";

const getOverlaySourceId = (panelId: string) => `${panelId}-chart-overlay`;
const getOverlayLayerId = (panelId: string) => `${panelId}-chart-overlay`;

export const clearReferenceChartOverlay = (map: maplibregl.Map, panelId: string) => {
  const layerId = getOverlayLayerId(panelId);
  const sourceId = getOverlaySourceId(panelId);

  if (map.getLayer(layerId)) {
    map.removeLayer(layerId);
  }

  if (map.getSource(sourceId)) {
    map.removeSource(sourceId);
  }
};

export const syncReferenceChartOverlay = (
  map: maplibregl.Map,
  panelId: string,
  document: ReferenceDocument | null,
  overlay: MapChartOverlayState | undefined,
  beforeLayerId?: string
) => {
  if (!map.isStyleLoaded()) {
    return;
  }

  clearReferenceChartOverlay(map, panelId);

  if (!document || document.type !== "image" || !overlay?.enabled) {
    return;
  }

  const quad = resolveGeoreferenceQuad(document);
  if (!quad) {
    return;
  }

  const sourceId = getOverlaySourceId(panelId);
  const layerId = getOverlayLayerId(panelId);

  map.addSource(sourceId, {
    type: "image",
    url: document.sourcePath,
    coordinates: [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft]
  });

  map.addLayer(
    {
      id: layerId,
      type: "raster",
      source: sourceId,
      paint: {
        "raster-opacity": overlay.opacity,
        "raster-fade-duration": 0,
        "raster-resampling": "linear"
      }
    },
    beforeLayerId
  );
};
