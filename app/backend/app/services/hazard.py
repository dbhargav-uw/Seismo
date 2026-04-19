"""Site -> hazard proxy translator.

Conceptual screening only. Distances use a flat-earth approximation valid
within a few hundred km — fine for a single SoCal map view.
"""

from __future__ import annotations

import math

from ..models.scenario import ScenarioReceiverTrace
from ..models.site import ReceiverRef, SiteCoord, SiteHazardSummary
from .data_loader import DataLoader

EARTH_RADIUS_KM = 6371.0
NEAREST_N = 4


def _haversine_km(a: SiteCoord, lat: float, lon: float) -> float:
    phi1 = math.radians(a.lat)
    phi2 = math.radians(lat)
    d_phi = math.radians(lat - a.lat)
    d_lam = math.radians(lon - a.lon)
    h = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lam / 2) ** 2
    return 2.0 * EARTH_RADIUS_KM * math.asin(math.sqrt(h))


def nearest_receivers(loader: DataLoader, site: SiteCoord, limit: int = NEAREST_N) -> list[ReceiverRef]:
    receivers = loader.receivers()
    refs: list[ReceiverRef] = []
    for r in receivers:
        rid_raw = r.get("id")
        lat_raw = r.get("lat")
        lon_raw = r.get("lon")
        vs30_raw = r.get("vs30_proxy_mps")
        label_raw = r.get("label")
        if not (
            isinstance(rid_raw, int)
            and isinstance(lat_raw, (int, float))
            and isinstance(lon_raw, (int, float))
            and isinstance(vs30_raw, (int, float))
            and isinstance(label_raw, str)
        ):
            continue
        refs.append(
            ReceiverRef(
                receiver_id=rid_raw,
                label=label_raw,
                lat=float(lat_raw),
                lon=float(lon_raw),
                distance_km=_haversine_km(site, float(lat_raw), float(lon_raw)),
                vs30_proxy_mps=float(vs30_raw),
            )
        )
    refs.sort(key=lambda x: x.distance_km)
    return refs[:limit]


def _idw_weights(distances_km: list[float], power: float = 2.0, eps: float = 1e-3) -> list[float]:
    raw = [1.0 / max(d, eps) ** power for d in distances_km]
    total = sum(raw)
    return [w / total for w in raw] if total > 0 else [1.0 / len(raw)] * len(raw)


def site_hazard_summary(
    loader: DataLoader,
    site: SiteCoord,
    pgv_per_receiver_for_scenario: dict[int, float] | None = None,
) -> SiteHazardSummary:
    nearest = nearest_receivers(loader, site)
    if not nearest:
        raise ValueError("No receivers available — check receiver_metadata.json")

    weights = _idw_weights([n.distance_km for n in nearest])
    vs30 = sum(w * n.vs30_proxy_mps for w, n in zip(weights, nearest, strict=True))

    pgv_estimate = 0.0
    notes: list[str] = []
    if pgv_per_receiver_for_scenario:
        pgv_estimate = sum(
            w * pgv_per_receiver_for_scenario.get(n.receiver_id, 0.0)
            for w, n in zip(weights, nearest, strict=True)
        )
    else:
        notes.append("PGV estimate requires a scenario_id; returning 0.0.")

    return SiteHazardSummary(
        site=site,
        nearest_receivers=nearest,
        vs30_proxy_mps=vs30,
        pgv_estimate_mps=pgv_estimate,
        synthetic_for_demo=True,
        notes=notes,
    )


def per_receiver_pgv_map(traces: list[ScenarioReceiverTrace]) -> dict[int, float]:
    return {t.receiver_id: t.pgv for t in traces}
