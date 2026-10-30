import type * as maplibregl from "maplibre-gl";
import type { GeoJSONSource } from "maplibre-gl";
import { buildAirportRunwayGeoJson } from "../../domain/maps/runways";
import { getAirportPackageByIcao } from "../../domain/airports/packages";
import {
  getConflictSourceId,
  getDiscoverySourceId,
  getRunwayLabelLayerId,
  getRunwayLayerId,
  getRunwaySourceId,
  getRouteSourceId,
  getSurfaceFillLayerId,
  getSurfaceLineLayerId,
  getSurfaceSourceId,
  getTrafficSourceId
} from "./panelIds";
import type { ConflictAlert } from "../../domain/aircraft/conflicts";
import type { AirportDefinition } from "../../domain/airports/types";
import type { AircraftContact } from "../../domain/aircraft/types";
import type { MapPanelState } from "../../domain/maps/types";
import type { TaxiRoute } from "../../domain/airports/types";

export const registerPanelLayers = (map: maplibregl.Map, panel: MapPanelState, airport: AirportDefinition) => {
  if (!map.isStyleLoaded()) {
    return;
  }

  const airportPackage = getAirportPackageByIcao(airport.icao);
  const surfaceSourceId = getSurfaceSourceId(panel.id);
  const runwaySourceId = getRunwaySourceId(panel.id);

  if (!map.getSource(surfaceSourceId)) {
    map.addSource(surfaceSourceId, {
      type: "geojson",
      data: airportPackage?.surface.geojson ?? { type: "FeatureCollection", features: [] }
    });
  }
  if (!map.getSource(runwaySourceId)) {
    map.addSource(runwaySourceId, {
      type: "geojson",
      data: buildAirportRunwayGeoJson(airport)
    });
  }

  if (!map.getLayer(getSurfaceFillLayerId(panel.id))) {
    map.addLayer({
      id: getSurfaceFillLayerId(panel.id),
      type: "fill",
      source: surfaceSourceId,
      paint: {
        "fill-color": "#3ec7a1",
        "fill-opacity": panel.kind === "surface" ? 0.18 : 0.08
      },
      filter: ["==", ["get", "kind"], "terminal"]
    });
  }
  if (!map.getLayer(getSurfaceLineLayerId(panel.id))) {
    map.addLayer({
      id: getSurfaceLineLayerId(panel.id),
      type: "line",
      source: surfaceSourceId,
      paint: {
        "line-color": "#7cdfff",
        "line-width": 2
      }
    });
  }
  if (!map.getLayer(getRunwayLayerId(panel.id))) {
    map.addLayer({
      id: getRunwayLayerId(panel.id),
      type: "line",
      source: runwaySourceId,
      paint: {
        "line-color": "#f9c74f",
        "line-width": panel.kind === "surface" ? 4 : 3,
        "line-opacity": 0.9
      }
    });
  }
  if (!map.getLayer(getRunwayLabelLayerId(panel.id))) {
    map.addLayer({
      id: getRunwayLabelLayerId(panel.id),
      type: "symbol",
      source: runwaySourceId,
      layout: {
        "symbol-placement": "line-center",
        "text-field": ["get", "label"],
        "text-size": 11,
        "text-offset": [0, -0.2]
      },
      paint: {
        "text-color": "#f9c74f",
        "text-halo-color": "#081019",
        "text-halo-width": 1.2
      }
    });
  }
};

export const syncAirportLayers = (
  map: maplibregl.Map,
  panel: MapPanelState,
  airport: AirportDefinition
) => {
  if (!map.isStyleLoaded()) {
    return;
  }

  const runwaySource = map.getSource(getRunwaySourceId(panel.id)) as GeoJSONSource | undefined;
  if (runwaySource) {
    runwaySource.setData(buildAirportRunwayGeoJson(airport));
  }

  const surfaceSource = map.getSource(getSurfaceSourceId(panel.id)) as GeoJSONSource | undefined;
  const airportPackage = getAirportPackageByIcao(airport.icao);
  if (surfaceSource && airportPackage) {
    surfaceSource.setData(airportPackage.surface.geojson);
  }

  const runwayVisibility = panel.toggles.runways ? "visible" : "none";
  if (map.getLayer(getRunwayLayerId(panel.id))) {
    map.setLayoutProperty(getRunwayLayerId(panel.id), "visibility", runwayVisibility);
  }
  if (map.getLayer(getRunwayLabelLayerId(panel.id))) {
    map.setLayoutProperty(getRunwayLabelLayerId(panel.id), "visibility", runwayVisibility);
  }

  const surfaceVisibility = panel.toggles.surface ? "visible" : "none";
  if (map.getLayer(getSurfaceFillLayerId(panel.id))) {
    map.setLayoutProperty(getSurfaceFillLayerId(panel.id), "visibility", surfaceVisibility);
  }
  if (map.getLayer(getSurfaceLineLayerId(panel.id))) {
    map.setLayoutProperty(getSurfaceLineLayerId(panel.id), "visibility", surfaceVisibility);
  }
};

export const syncTrafficLayer = (
  map: maplibregl.Map,
  panel: MapPanelState,
  contacts: AircraftContact[],
  discoveryContacts: AircraftContact[],
  conflicts: ConflictAlert[],
  routes: TaxiRoute[],
  onSelectAircraft: (aircraftId: string) => void
) => {
  if (!map.isStyleLoaded()) {
    return;
  }

  const sourceId = getTrafficSourceId(panel.id);
  const discoverySourceId = getDiscoverySourceId(panel.id);
  const conflictSourceId = getConflictSourceId(panel.id);
  const routeSourceId = getRouteSourceId(panel.id);
  const features = contacts.map((contact) => ({
    type: "Feature" as const,
    properties: {
      id: contact.id,
      callsign: contact.callsign,
      altitude: Math.round(contact.altitudeFeet)
    },
    geometry: {
      type: "Point" as const,
      coordinates: [contact.longitude, contact.latitude]
    }
  }));
  const discoveryFeatures = discoveryContacts.map((contact) => ({
    type: "Feature" as const,
    properties: {
      id: contact.id,
      callsign: contact.callsign,
      altitude: Math.round(contact.altitudeFeet)
    },
    geometry: {
      type: "Point" as const,
      coordinates: [contact.longitude, contact.latitude]
    }
  }));
  const conflictFeatures = conflicts.flatMap((conflict) =>
    conflict.involvedContactIds
      .map((id) => [...contacts, ...discoveryContacts].find((contact) => contact.id === id))
      .filter((contact): contact is AircraftContact => Boolean(contact))
      .map((contact) => ({
        type: "Feature" as const,
        properties: { id: contact.id, severity: conflict.severity, summary: conflict.summary },
        geometry: { type: "Point" as const, coordinates: [contact.longitude, contact.latitude] }
      }))
  );
  const routeFeatures = routes.map((route) => ({
    type: "Feature" as const,
    properties: { id: route.id, label: route.label },
    geometry: {
      type: "MultiLineString" as const,
      coordinates: route.segments.map((segment) => segment.coordinates)
    }
  }));

  if (!map.getSource(sourceId)) {
    map.addSource(sourceId, {
      type: "geojson",
      data: { type: "FeatureCollection", features }
    });
    map.addLayer({
      id: sourceId,
      type: "circle",
      source: sourceId,
      paint: {
        "circle-color": panel.kind === "surface" ? "#f9c74f" : "#3ec7a1",
        "circle-radius": 4,
        "circle-stroke-width": 1,
        "circle-stroke-color": "#081019"
      }
    });
    map.addSource(discoverySourceId, {
      type: "geojson",
      data: { type: "FeatureCollection", features: discoveryFeatures }
    });
    map.addLayer({
      id: discoverySourceId,
      type: "circle",
      source: discoverySourceId,
      paint: {
        "circle-color": "#5dade2",
        "circle-radius": 3,
        "circle-opacity": 0.65
      }
    });
    map.addSource(conflictSourceId, {
      type: "geojson",
      data: { type: "FeatureCollection", features: conflictFeatures }
    });
    map.addLayer({
      id: conflictSourceId,
      type: "circle",
      source: conflictSourceId,
      paint: {
        "circle-color": "#ff6b6b",
        "circle-radius": 7,
        "circle-opacity": 0.25,
        "circle-stroke-width": 1,
        "circle-stroke-color": "#ffc2c2"
      }
    });
    map.addSource(routeSourceId, {
      type: "geojson",
      data: { type: "FeatureCollection", features: routeFeatures }
    });
    map.addLayer({
      id: routeSourceId,
      type: "line",
      source: routeSourceId,
      layout: { visibility: panel.kind === "surface" ? "visible" : "none" },
      paint: {
        "line-color": "#9df0d8",
        "line-width": 2,
        "line-dasharray": [2, 1]
      }
    });
    map.on("click", sourceId, (event) => {
      const featureId = event.features?.[0]?.properties?.id;
      if (typeof featureId === "string") {
        onSelectAircraft(featureId);
      }
    });
    return;
  }

  (map.getSource(sourceId) as GeoJSONSource).setData({
    type: "FeatureCollection",
    features
  });
  (map.getSource(discoverySourceId) as GeoJSONSource | undefined)?.setData({
    type: "FeatureCollection",
    features: discoveryFeatures
  });
  (map.getSource(conflictSourceId) as GeoJSONSource | undefined)?.setData({
    type: "FeatureCollection",
    features: conflictFeatures
  });
  (map.getSource(routeSourceId) as GeoJSONSource | undefined)?.setData({
    type: "FeatureCollection",
    features: routeFeatures
  });
};
