import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import { Marker } from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { createDefaultChartOverlayState } from "../../domain/maps/chartOverlay";
import { getGeoreferenceSummary } from "../../domain/references/georeference";
import { detectTrafficConflicts } from "../../domain/aircraft/conflicts";
import { getAirportPackageByIcao } from "../../domain/airports/packages";
import {
  buildReferenceSelectionContext,
  resolveReferenceForContext,
  selectBestRenderableOverlayDocument
} from "../../domain/references/resolver";
import { BUNDLED_REFERENCE_DOCUMENTS } from "../../domain/references/registry";
import { PanelFrame } from "../layout/PanelFrame";
import {
  selectDiagnosticsState,
  useWorkspaceStore
} from "../store";
import { syncReferenceChartOverlay } from "../maps/chartOverlay";
import { registerPanelLayers, syncAirportLayers, syncTrafficLayer } from "../maps/panelLayers";
import type { MapPanelState } from "../../domain/maps/types";
import type { ReferenceViewRole } from "../../domain/references/types";

interface MapPanelProps {
  panel: MapPanelState;
}

const STYLE_URL = "https://demotiles.maplibre.org/style.json";

maplibregl.setWorkerUrl(maplibreWorkerUrl);

const defaultRoleForPanel = (kind: MapPanelState["kind"]): ReferenceViewRole =>
  kind === "surface" ? "ground_reference" : kind === "runway" ? "weather_reference" : "airspace_reference";

export const MapPanel = ({ panel }: MapPanelProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const mountCountRef = useRef(0);
  const airportEffectRunsRef = useRef(0);
  const trafficEffectRunsRef = useRef(0);
  const referenceEffectRunsRef = useRef(0);
  const [mapReady, setMapReady] = useState(false);
  const contacts = useWorkspaceStore((state) => state.contacts);
  const discoveryContacts = useWorkspaceStore((state) => state.discoveryContacts);
  const airport = useWorkspaceStore((state) => state.activeAirport);
  const weather = useWorkspaceStore((state) => state.weather);
  const pinnedByRole = useWorkspaceStore((state) => state.referenceShelf.pinnedByRole);
  const focusTargets = useWorkspaceStore((state) => state.focusTargets);
  const selectedAircraftId = useWorkspaceStore((state) => state.selectedAircraftId);
  const sessionDocuments = useWorkspaceStore((state) => state.sessionDocuments);
  const setSelectedAircraft = useWorkspaceStore((state) => state.setSelectedAircraft);
  const openBestReferenceForRole = useWorkspaceStore((state) => state.openBestReferenceForRole);
  const saveMapPanels = useWorkspaceStore((state) => state.saveMapPanels);
  const diagnostics = useWorkspaceStore(selectDiagnosticsState);
  const defaultPanelRole: ReferenceViewRole =
    defaultRoleForPanel(panel.kind);
  const panelRole = panel.referenceRole ?? defaultPanelRole;
  const chartOverlay = panel.chartOverlay ?? createDefaultChartOverlayState(panel.kind);
  const allReferenceDocuments = useMemo(
    () => [...BUNDLED_REFERENCE_DOCUMENTS, ...sessionDocuments],
    [sessionDocuments]
  );
  const selectedAircraft = useMemo(
    () =>
      [...contacts, ...discoveryContacts].find((contact) => contact.id === selectedAircraftId) ?? null,
    [contacts, discoveryContacts, selectedAircraftId]
  );
  const referenceContext = useMemo(
    () =>
      buildReferenceSelectionContext({
        airportIcao: airport.icao,
        selectedAircraftGrounded: Boolean(selectedAircraft?.grounded),
        hasSelectedAircraft: Boolean(selectedAircraft),
        focusModes: focusTargets.map((target) => target.mode),
        hasWeather: Boolean(weather),
        destinationIcao:
          focusTargets.find((target) => target.aircraftId === selectedAircraftId)?.destinationIcao ?? null,
        role: panelRole
      }),
    [airport.icao, focusTargets, panelRole, selectedAircraft?.grounded, selectedAircraftId, weather]
  );
  const panelResolution = useMemo(
    () => resolveReferenceForContext(allReferenceDocuments, referenceContext, pinnedByRole),
    [allReferenceDocuments, pinnedByRole, referenceContext]
  );
  const overlayReference = useMemo(
    () => selectBestRenderableOverlayDocument(allReferenceDocuments, referenceContext, pinnedByRole),
    [allReferenceDocuments, pinnedByRole, referenceContext]
  );
  const routes = useMemo(
    () => getAirportPackageByIcao(airport.icao)?.routes ?? [],
    [airport.icao]
  );
  const conflicts = useMemo(
    () => detectTrafficConflicts([...contacts, ...discoveryContacts], airport),
    [airport, contacts, discoveryContacts]
  );
  const panelReference = panelResolution?.document ?? null;
  const overlaySummary = overlayReference ? getGeoreferenceSummary(overlayReference) : null;
  const debugMode = typeof navigator !== "undefined" && navigator.webdriver;

  const updatePanel = async (patch: Partial<MapPanelState>) => {
    const nextPanels = useWorkspaceStore.getState().mapPanels.map((item) =>
      item.id === panel.id ? { ...item, ...patch } : item
    );
    await saveMapPanels(nextPanels);
  };

  useEffect(() => {
    mountCountRef.current += 1;
    if (debugMode) {
      console.debug(`[MapPanel:${panel.id}] mount attempt ${mountCountRef.current}`, {
        kind: panel.kind,
        role: panelRole
      });
    }
    if (!containerRef.current || mapRef.current) {
      return;
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      center: panel.viewport.center,
      zoom: panel.viewport.zoom,
      bearing: panel.viewport.bearing
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => {
      registerPanelLayers(map, panel, airport);
      setMapReady(true);
      if (debugMode) {
        console.debug(`[MapPanel:${panel.id}] map ready`);
      }
    });

    mapRef.current = map;
    return () => {
      setMapReady(false);
      map.remove();
      mapRef.current = null;
      if (debugMode) {
        console.debug(`[MapPanel:${panel.id}] unmounted`);
      }
    };
  }, [
    debugMode,
    airport.icao,
    panel.id,
    panel.kind,
    panelRole,
    panel.viewport.bearing,
    panel.viewport.center[0],
    panel.viewport.center[1],
    panel.viewport.zoom
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) {
      return;
    }

    airportEffectRunsRef.current += 1;
    if (debugMode) {
      console.debug(`[MapPanel:${panel.id}] syncAirportLayers run ${airportEffectRunsRef.current}`);
    }
    syncAirportLayers(map, panel, airport);
  }, [
    airport.icao,
    airport.latitude,
    airport.longitude,
    mapReady,
    panel.id,
    panel.kind,
    panel.toggles.runways,
    panel.toggles.surface
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) {
      return;
    }

    referenceEffectRunsRef.current += 1;
    if (debugMode) {
      console.debug(`[MapPanel:${panel.id}] syncReferenceChartOverlay run ${referenceEffectRunsRef.current}`, {
        overlayReference: overlayReference?.id ?? null
      });
    }
    syncReferenceChartOverlay(
      map,
      panel.id,
      panel.kind === "surface" ? overlayReference : null,
      panel.kind === "surface" ? chartOverlay : undefined,
      `${panel.id}-surface-fill`
    );
  }, [
    chartOverlay.enabled,
    chartOverlay.opacity,
    mapReady,
    overlayReference?.id,
    overlayReference?.sourcePath,
    panel.id,
    panel.kind
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) {
      return;
    }

    trafficEffectRunsRef.current += 1;
    if (debugMode) {
      console.debug(`[MapPanel:${panel.id}] syncTrafficLayer run ${trafficEffectRunsRef.current}`, {
        contacts: contacts.length,
        discoveryContacts: discoveryContacts.length,
        conflicts: conflicts.length,
        routes: routes.length
      });
    }
    syncTrafficLayer(map, panel, contacts, discoveryContacts, conflicts, routes, setSelectedAircraft);

    const markerNode = document.createElement("div");
    markerNode.className = "airport-marker";
    markerNode.textContent =
      panel.kind === "runway"
        ? `${airport.icao} ${weather?.windDirectionDegrees ?? "---"}/${weather?.windSpeedKnots ?? "--"}`
        : airport.icao;
    const marker = new Marker({ element: markerNode })
      .setLngLat([airport.longitude, airport.latitude])
      .addTo(map);

    return () => {
      marker.remove();
    };
  }, [
    airport.icao,
    airport.latitude,
    airport.longitude,
    contacts,
    conflicts,
    discoveryContacts,
    mapReady,
    panel.id,
    panel.kind,
    panel.toggles.headingVectors,
    panel.toggles.labels,
    panel.toggles.surface,
    panel.toggles.trails,
    panel.toggles.wind,
    panel.toggles.runways,
    routes,
    setSelectedAircraft,
    weather?.windDirectionDegrees,
    weather?.windSpeedKnots
  ]);

  return (
    <PanelFrame
      title={panel.title}
      status={
        panel.kind === "surface"
          ? `${routes.length} routes`
          : `${conflicts.length} conflicts`
      }
      actions={
        <div className="map-panel-actions">
          <select
            className="filter-input compact-select"
            value={panelRole}
            onChange={(event) => {
              const nextRole = event.target.value as ReferenceViewRole;
              void updatePanel({ referenceRole: nextRole });
            }}
          >
            <option value="ground_reference">Ground Ref</option>
            <option value="airspace_reference">Airspace Ref</option>
            <option value="weather_reference">Weather Ref</option>
            <option value="procedure_reference">Procedure Ref</option>
            <option value="reading_reference">Chart Reading</option>
          </select>
          <button className="chip-button" onClick={() => void openBestReferenceForRole(panelRole)}>
            {panelReference ? `Ref: ${panelReference.title}` : "Open best ref"}
          </button>
        </div>
      }
    >
      <div className="map-panel-shell">
        {diagnostics.activeFallbacks.length ? (
          <div className="map-reference-stack">
            <div className="inline-status">
              {diagnostics.foregroundBlocked
                ? "GeoFS is not focused. Live traffic layers may stall; airport, route, and reference layers remain available."
                : `Active fallback: ${diagnostics.activeFallbacks.join(", ")}`}
            </div>
          </div>
        ) : null}
        {panelReference ? (
          <div className="map-reference-stack">
            <button className="map-reference-overlay" onClick={() => void openBestReferenceForRole(panelRole)}>
              {panel.kind === "surface" ? "Surface reference ready" : "Context reference ready"}
            </button>
            {panelResolution?.reasons?.[0] ? (
              <div className="map-reference-reason">{panelResolution.reasons[0]}</div>
            ) : null}
            {panel.kind === "surface" && overlayReference ? (
              <div className="map-overlay-controls">
                <div className="map-reference-reason">
                  <strong>{overlayReference.title}</strong>
                  <br />
                  {overlaySummary ?? "Manual overlay metadata available."}
                </div>
                <label className="field-label inline">
                  <input
                    type="checkbox"
                    checked={chartOverlay.enabled}
                    onChange={(event) => {
                      void updatePanel({
                        chartOverlay: {
                          ...chartOverlay,
                          enabled: event.target.checked
                        }
                      });
                    }}
                  />
                  Show aligned overlay
                </label>
                <label className="field-label">
                  Overlay opacity
                  <input
                    type="range"
                    min="0.15"
                    max="0.9"
                    step="0.05"
                    value={chartOverlay.opacity}
                    onChange={(event) => {
                      void updatePanel({
                        chartOverlay: {
                          ...chartOverlay,
                          opacity: Number(event.target.value)
                        }
                      });
                    }}
                  />
                </label>
                <div className="map-panel-actions">
                  <button
                    className="chip-button"
                    onClick={() =>
                      void updatePanel({
                        chartOverlay: createDefaultChartOverlayState(panel.kind)
                      })
                    }
                  >
                    Reset overlay
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        <div ref={containerRef} className="map-panel" />
      </div>
    </PanelFrame>
  );
};
