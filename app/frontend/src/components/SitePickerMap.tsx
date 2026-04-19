import 'maplibre-gl/dist/maplibre-gl.css';

import maplibregl, {
  type LngLatBoundsLike,
  type LngLatLike,
  type Map as MapLibreMap,
  type Marker,
} from 'maplibre-gl';
import { type ChangeEvent, useEffect, useRef, useState } from 'react';

import { ApiClientError, api } from '../api/client';
import type { ReceiverInfo } from '../api/types';
import { useViabilityStore } from '../features/viability/store';
import { env } from '../utils/env';
import { logger } from '../utils/logger';

const LA_CENTER: LngLatLike = [-118.25, 34.05];
const DEFAULT_ZOOM = 9;

const useReceivers = (): {
  receivers: ReceiverInfo[];
  status: 'idle' | 'loading' | 'success' | 'error';
  error: string | null;
} => {
  const [receivers, setReceivers] = useState<ReceiverInfo[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    api
      .listReceivers()
      .then((res) => {
        if (cancelled) return;
        setReceivers(res.receivers);
        setStatus('success');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof ApiClientError ? err.message : 'Failed to load receivers';
        logger.error('listReceivers failed', err);
        setError(msg);
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { receivers, status, error };
};

const computeBounds = (receivers: ReceiverInfo[]): LngLatBoundsLike | null => {
  if (receivers.length === 0) return null;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const r of receivers) {
    if (r.lat < minLat) minLat = r.lat;
    if (r.lat > maxLat) maxLat = r.lat;
    if (r.lon < minLon) minLon = r.lon;
    if (r.lon > maxLon) maxLon = r.lon;
  }
  return [
    [minLon, minLat],
    [maxLon, maxLat],
  ];
};

const buildReceiverMarkerEl = (label: string): HTMLElement => {
  const el = document.createElement('div');
  el.className =
    'flex items-center justify-center w-5 h-5 rounded-full ' +
    'bg-accent/80 border-2 border-ink shadow ' +
    'text-[9px] font-semibold text-ink select-none';
  el.style.cursor = 'pointer';
  el.textContent = label.replace(/^R0?/, '');
  return el;
};

const buildSiteMarkerEl = (): HTMLElement => {
  const el = document.createElement('div');
  el.className =
    'w-7 h-7 rounded-full bg-warn border-4 border-ink shadow-lg ' +
    'ring-2 ring-warn/40';
  el.style.cursor = 'grab';
  return el;
};

const formatCoord = (n: number): string => n.toFixed(4);

interface CoordOverlayProps {
  lat: number;
  lon: number;
  onSubmit: (lat: number, lon: number) => void;
}

const CoordOverlay = ({ lat, lon, onSubmit }: CoordOverlayProps): JSX.Element => {
  const [latStr, setLatStr] = useState<string>(formatCoord(lat));
  const [lonStr, setLonStr] = useState<string>(formatCoord(lon));

  useEffect(() => {
    setLatStr(formatCoord(lat));
    setLonStr(formatCoord(lon));
  }, [lat, lon]);

  const apply = (): void => {
    const la = Number.parseFloat(latStr);
    const lo = Number.parseFloat(lonStr);
    if (Number.isFinite(la) && Number.isFinite(lo)) onSubmit(la, lo);
  };

  return (
    <div className="absolute top-3 left-3 z-10 bg-ink/85 backdrop-blur border border-line rounded-lg p-3 shadow-lg w-60">
      <div className="label mb-2">Site coordinates</div>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[10px] text-muted">Lat</span>
          <input
            className="input"
            value={latStr}
            inputMode="decimal"
            onChange={(e: ChangeEvent<HTMLInputElement>) => setLatStr(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') apply();
            }}
          />
        </label>
        <label className="block">
          <span className="text-[10px] text-muted">Lon</span>
          <input
            className="input"
            value={lonStr}
            inputMode="decimal"
            onChange={(e: ChangeEvent<HTMLInputElement>) => setLonStr(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') apply();
            }}
          />
        </label>
      </div>
      <button type="button" className="btn-primary w-full mt-2 py-1 text-xs" onClick={apply}>
        Use coordinates
      </button>
      <p className="text-[10px] text-muted mt-2">
        Or click anywhere on the map. Drag the orange marker to fine-tune.
      </p>
    </div>
  );
};

export const SitePickerMap = (): JSX.Element => {
  const { receivers, status, error } = useReceivers();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const siteMarkerRef = useRef<Marker | null>(null);
  const receiverMarkersRef = useRef<Marker[]>([]);

  const site = useViabilityStore((s) => s.site);
  const setSite = useViabilityStore((s) => s.setSite);

  // Mount the map once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const map = new maplibregl.Map({
      container,
      style: env.mapStyle,
      center: LA_CENTER,
      zoom: DEFAULT_ZOOM,
      attributionControl: { compact: true },
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric', maxWidth: 100 }), 'bottom-right');

    map.on('click', (e) => {
      setSite({ lat: e.lngLat.lat, lon: e.lngLat.lng });
    });

    // MapLibre's built-in trackResize relies on an internal ResizeObserver,
    // which misses size changes caused by CSS flex reflow in a few edge cases
    // (parent flex-1 shrinks without an explicit size change event). Belt +
    // suspenders: observe the container ourselves and call map.resize() on
    // every dimension change. Cheap — `resize()` is a no-op when unchanged.
    const ro = new ResizeObserver(() => {
      map.resize();
    });
    ro.observe(container);
    const onWindowResize = (): void => {
      map.resize();
    };
    window.addEventListener('resize', onWindowResize);

    mapRef.current = map;
    return () => {
      window.removeEventListener('resize', onWindowResize);
      ro.disconnect();
      receiverMarkersRef.current.forEach((m) => m.remove());
      receiverMarkersRef.current = [];
      siteMarkerRef.current?.remove();
      siteMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [setSite]);

  // Plot receivers + auto-fit bounds whenever the receiver list changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || receivers.length === 0) return;

    receiverMarkersRef.current.forEach((m) => m.remove());
    receiverMarkersRef.current = receivers.map((r) =>
      new maplibregl.Marker({ element: buildReceiverMarkerEl(r.label) })
        .setLngLat([r.lon, r.lat])
        .setPopup(
          new maplibregl.Popup({ offset: 14, closeButton: false }).setHTML(
            `<div style="font-size:11px;color:#0b0f17;line-height:1.3">
               <div style="font-weight:600;margin-bottom:2px">${r.label}</div>
               <div>Vs30 ${r.vs30_proxy_mps.toFixed(0)} m/s</div>
               <div>Elev ${r.elevation_m.toFixed(0)} m</div>
             </div>`,
          ),
        )
        .addTo(map),
    );

    const bounds = computeBounds(receivers);
    if (bounds) {
      map.fitBounds(bounds, { padding: 60, duration: 400, maxZoom: 11 });
    }
  }, [receivers]);

  // Render / update the orange site marker whenever the site changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!site) {
      siteMarkerRef.current?.remove();
      siteMarkerRef.current = null;
      return;
    }
    if (siteMarkerRef.current) {
      siteMarkerRef.current.setLngLat([site.lon, site.lat]);
      return;
    }
    const marker = new maplibregl.Marker({
      element: buildSiteMarkerEl(),
      draggable: true,
    })
      .setLngLat([site.lon, site.lat])
      .addTo(map);
    marker.on('dragend', () => {
      const ll = marker.getLngLat();
      setSite({ lat: ll.lat, lon: ll.lng });
    });
    siteMarkerRef.current = marker;
  }, [site, setSite]);

  return (
    <div className="h-full relative">
      <div ref={containerRef} className="absolute inset-0" />
      {(status === 'loading' || status === 'error' || receivers.length === 0) && (
        <div className="absolute inset-0 flex items-center justify-center bg-ink/70 text-sm text-center px-6 z-20">
          {status === 'loading' && <span className="text-muted">Loading receivers…</span>}
          {status === 'error' && (
            <span className="text-bad">{error ?? 'Failed to load receivers.'}</span>
          )}
          {status === 'success' && receivers.length === 0 && (
            <span className="text-muted">No receivers — run the data pipeline scripts.</span>
          )}
        </div>
      )}
      {status === 'success' && receivers.length > 0 && (
        <>
          <CoordOverlay
            lat={site?.lat ?? 34.05}
            lon={site?.lon ?? -118.25}
            onSubmit={(lat, lon) => setSite({ lat, lon })}
          />
          <div className="absolute bottom-3 left-3 z-10 bg-ink/85 backdrop-blur border border-line rounded px-3 py-1.5 text-[11px] text-muted">
            Click anywhere to drop a site marker · drag to fine-tune ·{' '}
            <span className="text-warn">conceptual screening</span>
          </div>
        </>
      )}
    </div>
  );
};
