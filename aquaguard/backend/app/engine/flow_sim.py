"""Hypothetical distribution-network simulation (every output is conceptual / simulated).

Network: reservoir -> pump station -> trunk main -> junction -> residential / agricultural / industrial / other.

    Head loss (Hazen-Williams, SI): hf = 10.67 L Q^1.852 / (C^1.852 D^4.87)   (Q m3/s, L, D in m)
    Leakage per pipe (pressure dependent, FAVAD): Q_leak = k_leak x P^N1      (P = mean pressure head, m)
    Mass balance: Q_pump = sum(Q_delivered) + sum(Q_leak)
    Water loss %  = sum(Q_leak) / Q_pump x 100

Background leakage is calibrated so that, with no burst leaks, the default set-point and the default
pump flow, the loss % equals the platform loss rate (parameters.yaml / scenario pipelineLossPct).

Optimisation = pressure management: isolate (repair) the burst leaks, then lower the pump set-point to the
minimum that still gives every destination its minimum service pressure.

Operating controls (all optional; the defaults give the normal operating point):
    pump on / off, pump capacity (the pump delivers min(requested, capacity, source limit)), source limit (water
    shortage), allocation of the junction flow between the branches (shares, renormalised over open branches),
    closed branch valves, demand factors per destination (demand = hypothetical demand x factor).
Accounting boundary: pump outlet -> destination delivery points, steady state.
    Inflow (pump flow) = delivered + leakage; storage change is not modelled (the reservoir level is illustrative).
Supply-demand balance = delivered - demand (balanced within 2 % of demand; surplus / deficit otherwise).
"""
from __future__ import annotations

from dataclasses import dataclass

from ..config.params import pentry, pval

KPA_PER_M = 9.80665  # 1 m of water head = 9.80665 kPa


def hazen_williams_hf(q_m3s: float, length_m: float, diameter_m: float, c: float) -> float:
    q = abs(q_m3s)
    return 10.67 * length_m * q ** 1.852 / (c ** 1.852 * diameter_m ** 4.87)


@dataclass(frozen=True)
class Pipe:
    id: str
    frm: str
    to: str
    length_m: float
    diameter_m: float


def network() -> tuple[list[Pipe], dict]:
    cfg = pentry("flow_sim")
    pipes = [Pipe(p["id"], p["from"], p["to"], float(p["length_m"]), float(p["diameter_m"])) for p in cfg["pipes"]]
    return pipes, cfg


BALANCE_TOLERANCE = 0.02  # supply within 2 % of demand counts as balanced
SERVED_PCT = 98.0          # a destination receiving at least 98 % of its demand is "served"


def _solve(pump_q: float, setpoint_m: float, k: dict[str, float], n1: float, c: float,
           split: dict[str, float] | None = None) -> dict:
    pipes, cfg = network()
    elev = cfg["elevations_m"]
    split = split if split is not None else cfg["demand_split"]
    trunk = next(p for p in pipes if p.frm == "pump")
    branches = [p for p in pipes if p.frm == "junction"]
    leak = {p.id: 0.0 for p in pipes}
    for _ in range(100):
        prev = dict(leak)
        head_pump = elev["pump"] + setpoint_m
        q_trunk_mean = pump_q - leak[trunk.id] / 2
        hf_t = hazen_williams_hf(q_trunk_mean, trunk.length_m, trunk.diameter_m, c)
        head_j = head_pump - hf_t
        p_j = head_j - elev["junction"]
        p_mid_t = (setpoint_m + p_j) / 2
        leak[trunk.id] = k[trunk.id] * max(p_mid_t, 0.0) ** n1
        leak[trunk.id] = min(leak[trunk.id], pump_q)
        q_j = pump_q - leak[trunk.id]
        res = {}
        for b in branches:
            q_in = q_j * split[b.to]
            hf_b = hazen_williams_hf(q_in - leak[b.id] / 2, b.length_m, b.diameter_m, c)
            head_d = head_j - hf_b
            p_d = head_d - elev[b.to]
            leak[b.id] = min(k[b.id] * max((p_j + p_d) / 2, 0.0) ** n1, q_in)
            res[b.id] = {"q_in": q_in, "hf": hf_b, "p_end": p_d}
        if max(abs(leak[i] - prev[i]) for i in leak) < 1e-10:
            break
    pipes_out = [{
        "id": trunk.id, "from": trunk.frm, "to": trunk.to, "lengthM": trunk.length_m, "diameterM": trunk.diameter_m,
        "flowM3s": pump_q - leak[trunk.id] / 2, "headLossM": hf_t, "pressureStartM": setpoint_m,
        "pressureEndM": p_j, "leakM3s": leak[trunk.id],
        "velocityMs": (pump_q - leak[trunk.id] / 2) / (3.14159265 * trunk.diameter_m ** 2 / 4),
    }]
    destinations = []
    for b in branches:
        r = res[b.id]
        delivered = r["q_in"] - leak[b.id]
        pipes_out.append({
            "id": b.id, "from": b.frm, "to": b.to, "lengthM": b.length_m, "diameterM": b.diameter_m,
            "flowM3s": r["q_in"] - leak[b.id] / 2, "headLossM": r["hf"], "pressureStartM": p_j,
            "pressureEndM": r["p_end"], "leakM3s": leak[b.id],
            "velocityMs": (r["q_in"] - leak[b.id] / 2) / (3.14159265 * b.diameter_m ** 2 / 4),
        })
        min_p = cfg["min_service_pressure_m"][b.to]
        destinations.append({"id": b.to, "deliveredM3s": delivered, "pressureM": r["p_end"],
                             "minServicePressureM": min_p, "serviceOk": r["p_end"] >= min_p})
    total_leak = sum(leak.values())
    delivered_total = sum(d["deliveredM3s"] for d in destinations)
    return {
        "pumpFlowM3s": pump_q, "setpointM": setpoint_m, "pipes": pipes_out, "destinations": destinations,
        "leakTotalM3s": total_leak, "deliveredTotalM3s": delivered_total,
        "lossPct": 100.0 * total_leak / pump_q if pump_q > 0 else 0.0,
        "massBalanceErrorM3s": pump_q - delivered_total - total_leak,
    }


def background_coefficients(loss_rate: float, n1: float, c: float) -> dict[str, float]:
    """Per-metre background leakage coefficient calibrated (bisection) to give `loss_rate` at defaults."""
    pipes, cfg = network()
    q0 = pval("flow_sim", "default_pump_flow_m3s")
    s0 = pval("flow_sim", "default_setpoint_m")
    if loss_rate <= 0:
        return {p.id: 0.0 for p in pipes}
    lo, hi = 0.0, 1e-4
    for _ in range(80):
        while _solve(q0, s0, {p.id: hi * p.length_m for p in pipes}, n1, c)["lossPct"] / 100 < loss_rate and hi < 1:
            hi *= 2
        mid = (lo + hi) / 2
        lp = _solve(q0, s0, {p.id: mid * p.length_m for p in pipes}, n1, c)["lossPct"] / 100
        if lp < loss_rate:
            lo = mid
        else:
            hi = mid
        if hi - lo < 1e-14:
            break
    kb = (lo + hi) / 2
    return {p.id: kb * p.length_m for p in pipes}


def destinations() -> list[str]:
    pipes, _ = network()
    return [p.to for p in pipes if p.frm == "junction"]


def _split(cfg: dict, pipes: list[Pipe], allocation: dict[str, float] | None, closed: set[str]) -> dict | None:
    """Fractions of the junction flow per destination over open branches (sum 1), or None if no branch is open."""
    base = allocation if allocation is not None else cfg["demand_split"]
    shares = {}
    for p in pipes:
        if p.frm == "junction":
            shares[p.to] = 0.0 if p.id in closed else max(0.0, float(base.get(p.to, 0.0)))
    total = sum(shares.values())
    if total <= 0:
        return None
    return {d: v / total for d, v in shares.items()}


def _zero_state(pipes: list[Pipe], cfg: dict, setpoint_m: float) -> dict:
    """No flow (pump off, a closed trunk or no open branch): nothing moves, the network is depressurised."""
    out = [{"id": p.id, "from": p.frm, "to": p.to, "lengthM": p.length_m, "diameterM": p.diameter_m, "flowM3s": 0.0,
            "headLossM": 0.0, "pressureStartM": 0.0, "pressureEndM": 0.0, "leakM3s": 0.0, "velocityMs": 0.0}
           for p in pipes]
    dests = [{"id": p.to, "deliveredM3s": 0.0, "pressureM": 0.0, "minServicePressureM": cfg["min_service_pressure_m"][p.to],
              "serviceOk": False} for p in pipes if p.frm == "junction"]
    return {"pumpFlowM3s": 0.0, "setpointM": setpoint_m, "pipes": out, "destinations": dests, "leakTotalM3s": 0.0,
            "deliveredTotalM3s": 0.0, "lossPct": 0.0, "massBalanceErrorM3s": 0.0}


def simulate(pump_flow_m3s: float, setpoint_m: float, leaks: dict[str, float], loss_rate: float,
             n1: float | None = None, *, pump_on: bool = True, capacity_m3s: float | None = None,
             source_limit_m3s: float | None = None, allocation: dict[str, float] | None = None,
             closed: list[str] | tuple[str, ...] = (), demand_factors: dict[str, float] | None = None) -> dict:
    """leaks: pipe id -> burst severity (0 = off, up to 3). allocation: destination -> share (any positive scale;
    renormalised over open branches). closed: pipe ids whose valve is closed. demand_factors: destination -> x."""
    pipes, cfg = network()
    n1 = n1 if n1 is not None else pval("flow_sim", "leakage_exponent_n1")
    c = pval("flow_sim", "hazen_williams_c")
    ids = {p.id for p in pipes}
    dest_ids = [p.to for p in pipes if p.frm == "junction"]
    unknown = (set(leaks) | set(closed)) - ids
    if unknown:
        raise ValueError(f"unknown pipe ids: {sorted(unknown)}")
    bad = (set(allocation or {}) | set(demand_factors or {})) - set(dest_ids)
    if bad:
        raise ValueError(f"unknown destinations: {sorted(bad)}")
    capacity = float(capacity_m3s if capacity_m3s is not None else pval("flow_sim", "pump_capacity_m3s"))
    closed_set = set(closed)
    trunk = next(p for p in pipes if p.frm == "pump")
    split = _split(cfg, pipes, allocation, closed_set)
    limits = {"requested": pump_flow_m3s, "capacity": capacity}
    if source_limit_m3s is not None:
        limits["source"] = source_limit_m3s
    if not pump_on:
        q, limiting = 0.0, "pump_off"
    elif trunk.id in closed_set or split is None:
        q, limiting = 0.0, "valve_closed"
    else:
        q = max(0.0, min(limits.values()))
        smallest = min(limits, key=limits.get)
        limiting = None if smallest == "requested" or q >= pump_flow_m3s else {
            "capacity": "pump_capacity", "source": "source_limit"}[smallest]
    kb = background_coefficients(loss_rate, n1, c)
    k_burst = pval("flow_sim", "leak_k_per_severity")
    k = {p.id: kb[p.id] + k_burst * max(0.0, leaks.get(p.id, 0.0)) for p in pipes}
    state = _solve(q, setpoint_m, k, n1, c, split) if q > 0 else _zero_state(pipes, cfg, setpoint_m)
    for pipe in state["pipes"]:  # a closed branch carries nothing and is not pressurised past its valve
        if pipe["id"] in closed_set:
            pipe.update(flowM3s=0.0, velocityMs=0.0, leakM3s=0.0, headLossM=0.0, pressureEndM=0.0)
    state["leakTotalM3s"] = sum(pp["leakM3s"] for pp in state["pipes"])
    for d in state["destinations"]:
        if f"{d['id']}" in {p.to for p in pipes if p.id in closed_set}:
            d.update(deliveredM3s=0.0, pressureM=0.0, serviceOk=False)
    state["deliveredTotalM3s"] = sum(d["deliveredM3s"] for d in state["destinations"])
    state["massBalanceErrorM3s"] = state["pumpFlowM3s"] - state["deliveredTotalM3s"] - state["leakTotalM3s"]
    state["lossPct"] = 100.0 * state["leakTotalM3s"] / state["pumpFlowM3s"] if state["pumpFlowM3s"] > 0 else 0.0

    demand = cfg["destination_demand_m3s"]
    factors = demand_factors or {}
    pipe_by_dest = {p.to: p.id for p in pipes if p.frm == "junction"}
    q_junction = q - next(pp["leakM3s"] for pp in state["pipes"] if pp["id"] == trunk.id) if q > 0 else 0.0
    demand_total = 0.0
    for d in state["destinations"]:
        dem = float(demand[d["id"]]) * max(0.0, float(factors.get(d["id"], 1.0)))
        demand_total += dem
        share = (split or {}).get(d["id"], 0.0)
        supply_pct = 100.0 * d["deliveredM3s"] / dem if dem > 0 else None
        if pipe_by_dest[d["id"]] in closed_set:
            status = "closed"
        elif d["deliveredM3s"] <= 1e-9:
            status = "no_supply"
        elif not d["serviceOk"]:
            status = "low_pressure"
        elif supply_pct is not None and supply_pct < SERVED_PCT:
            status = "under_supplied"
        else:
            status = "served"
        d.update(demandM3s=dem, allocatedM3s=share * q_junction, sharePct=100.0 * share, supplyPct=supply_pct,
                 status=status)
    balance = state["deliveredTotalM3s"] - demand_total
    tol = BALANCE_TOLERANCE * demand_total
    state.update(
        requestedPumpFlowM3s=pump_flow_m3s, pumpOn=pump_on, pumpCapacityM3s=capacity, sourceLimitM3s=source_limit_m3s,
        limitingFactor=limiting, pumpUtilizationPct=100.0 * q / capacity if capacity > 0 else 0.0,
        efficiencyPct=100.0 * state["deliveredTotalM3s"] / q if q > 0 else None, demandTotalM3s=demand_total,
        supplyBalanceM3s=balance,
        balanceStatus="balanced" if abs(balance) <= tol else ("surplus" if balance > 0 else "deficit"),
        closedPipes=sorted(closed_set), burstLeaks={p.id: leaks.get(p.id, 0.0) for p in pipes},
        backgroundLossRate=loss_rate)
    return state


def optimise(pump_flow_m3s: float, setpoint_m: float, leaks: dict[str, float], loss_rate: float,
             n1: float | None = None, **options) -> dict:
    """Isolate/repair burst leaks, then find the minimum set-point meeting every minimum service pressure
    (over the destinations that are supplied; closed branches are ignored)."""
    after_leaks = {k: 0.0 for k in leaks}
    closed_dest = {p.to for p in network()[0] if p.id in set(options.get("closed", ()))}

    def ok(s: float) -> bool:
        st = simulate(pump_flow_m3s, s, after_leaks, loss_rate, n1, **options)
        return all(d["serviceOk"] for d in st["destinations"] if d["id"] not in closed_dest)

    if not ok(setpoint_m):
        best = setpoint_m  # current set-point cannot meet service pressure; do not lower it
        note = "Current set-point does not meet every minimum service pressure; set-point not lowered."
    else:
        lo, hi = 0.0, setpoint_m
        for _ in range(40):
            mid = (lo + hi) / 2
            if ok(mid):
                hi = mid
            else:
                lo = mid
        best = round(hi + 0.05, 2)  # small safety margin above the exact minimum
        best = min(best, setpoint_m)
        note = "Burst leaks isolated for repair; set-point lowered to the minimum meeting all service pressures."
    return {"setpointM": best, "leaks": after_leaks, "note": note,
            "state": simulate(pump_flow_m3s, best, after_leaks, loss_rate, n1, **options)}
