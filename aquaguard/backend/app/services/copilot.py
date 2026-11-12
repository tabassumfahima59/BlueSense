"""AquaGuard AI Copilot — answers only from platform data.

Context = a list of facts assembled from the same services the modules use (overview totals, risk,
forecasts, budget, scenario, GRACE, alerts, irrigation default estimate). Each fact carries its value,
unit, provenance and module.

Modes
  llm      : LLM_API_KEY set. Claude (Anthropic SDK) receives the facts and a system prompt that forbids any
             number not in them. A guard then checks every number in the answer against the facts; if one
             is not found (or the model refuses / errors) the fallback answer is returned instead.
  fallback : rule-based intent matching (English + Bangla keywords) with templates over the same facts.
The whole platform works in fallback mode.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from ..schemas.common import Measure, ScenarioParams
from ..settings import get_settings
from . import alerts as alertsvc
from . import ml_artifacts as mla
from . import regional
from .measure import engine, m


@dataclass
class Fact:
    key: str
    label: str
    text: str          # human-readable value with unit, e.g. "8.3%"
    module: str
    measure: Measure | None


def _fmt(v: float, unit: str, digits: int = 0) -> str:
    if unit == "ratio":
        return f"{v * 100:.{digits}f}%"
    return f"{v:,.{digits}f} {unit}".strip()


def build_facts(region_id: str, params: ScenarioParams) -> tuple[str, list[Fact]]:
    run = regional.run(region_id, params)
    sc, smp = run.is_scenario, run.is_sample
    name = run.region["name"]
    ann, dry = run.totals("annual"), run.totals("dry")
    facts: list[Fact] = []

    def add(key, label, value, unit, module, digits=0, measure=None):
        meas = measure or engine(value, unit, sc, smp, 4)
        facts.append(Fact(key, label, _fmt(value, unit, digits), module, meas))

    add("availability", "annual water availability (supply)", ann["supply"], "MCM", "command-center")
    add("demand", "annual consumptive demand (agriculture + domestic + industry)", ann["consumptiveDemand"], "MCM",
        "command-center")
    add("stress", "annual stress ratio", ann["stressRatio"], "ratio", "command-center", 1)
    add("dry_stress", "dry-season (Dec-Apr) stress ratio", dry["stressRatio"], "ratio", "command-center", 0)
    add("dry_unmet", "dry-season unmet demand", dry["unmetTotal"], "MCM", "water-budget")
    for s in ("agriculture", "domestic", "industry", "environment"):
        add(f"demand_{s}", f"annual {s} demand", ann["demand"][s], "MCM", "water-budget")
    add("losses", "annual distribution losses", ann["losses"], "MCM", "water-budget")
    add("loss_rate", "distribution loss rate", run.loss_rate, "ratio", "water-flow")
    add("irr_eff", "irrigation efficiency", run.irrigation_efficiency, "ratio", "what-if")
    rk = regional.region_risk(run, 1)
    facts.append(Fact("risk", "scarcity risk class", rk["label"], "command-center", None))
    facts.append(Fact("risk_rule", "risk rule", rk["rule"], "command-center", None))
    f = rk["forecast"]
    if f:
        prov = "simulated" if f.get("simulated") else "predicted"
        facts.append(Fact("forecast", f"forecast climatic water balance (P - ET0) for {f['targetMonth']}",
                          f"{f['value']:.0f} mm (90% interval {f['low']:.0f} to {f['high']:.0f} mm)",
                          "prediction-lab", m(f["value"], "mm", prov, "aquaguard_ml", sample=smp,
                                              low=f["low"], high=f["high"])))
        facts.append(Fact("forecast_normal", "training-period normal for that month", f"{f['climMean']:.0f} mm",
                          "prediction-lab", None))
        if f.get("drynessClass"):
            facts.append(Fact("dryness", "forecast dryness class", str(f["drynessClass"]), "prediction-lab", None))
    met = mla.metrics()
    if met:
        h1 = met["horizons"]["1"]
        r = h1["regression"]
        facts.append(Fact("metrics", "1-month model test RMSE vs climatology baseline",
                          f"{r[h1['selectedModel']]['rmse']:.0f} mm vs {r['climatology']['rmse']:.0f} mm "
                          f"({h1['testPeriod']})", "prediction-lab", None))
    else:
        facts.append(Fact("metrics", "model evaluation", "Not evaluated yet", "prediction-lab", None))
    g = mla.grace_trend()
    if g:
        facts.append(Fact("grace", "GRACE regional storage trend (Bangladesh-wide, roughly 300 km resolution, not well depth)",
                          f"{g['trendCmPerYr']:.2f} cm/yr (95% CI {g['trendCi95'][0]:.2f} to {g['trendCi95'][1]:.2f})",
                          "prediction-lab", None))
    for a in alertsvc.evaluate(run)[:4]:
        facts.append(Fact(f"alert_{a['id']}", f"alert: {a['title']}", f"{a['message']} Recommendation: "
                          f"{a['recommendation']}", a["module"], None))
    if sc:
        p = params
        facts.append(Fact("scenario", "active scenario",
                          f"rainfall {p.rainfallChangePct:+.0f}%, temperature {p.temperatureChangeC:+.1f} °C, "
                          f"demand {p.demandChangePct:+.0f}%, groundwater {p.groundwaterAvailabilityPct:+.0f}%"
                          + (f", irrigation efficiency {p.irrigationEfficiency:.2f}" if p.irrigationEfficiency else "")
                          + (f", pipeline loss {p.pipelineLossPct:.0f}%" if p.pipelineLossPct is not None else ""),
                          "what-if", None))
        base = regional.run(region_id, ScenarioParams())
        bd = base.totals("dry")
        add("base_dry_stress", "baseline dry-season stress ratio", bd["stressRatio"], "ratio", "what-if", 0,
            engine(bd["stressRatio"], "ratio", False, smp, 4))
        add("base_dry_unmet", "baseline dry-season unmet demand", bd["unmetTotal"], "MCM", "what-if", 0,
            engine(bd["unmetTotal"], "MCM", False, smp, 1))
    facts.append(Fact("scope", "data scope", run.scope_note, "command-center", None))
    facts.append(Fact("irrigation_method", "irrigation method",
                      "FAO-56 (ETc = Kc x ET0, USDA-SCS effective rainfall, GIR = NIR / efficiency); run the Smart "
                      "Irrigation Advisor for a crop- and date-specific estimate", "irrigation", None))
    facts.append(Fact("aquastat_reference", "AQUASTAT reference year for withdrawals",
                      "2008 values carried forward by AQUASTAT", "data-sources", None))
    return name, facts


# ---------------------------------------------------------------- fallback (rule-based)

INTENTS: list[tuple[str, tuple[str, ...]]] = [
    ("greeting", ("hello", "hi ", "hey", "salam", "হ্যালো", "আসসালামু")),
    ("scenario", ("scenario", "what if", "what-if", "simulate", "dry year", "পরিস্থিতি", "যদি")),
    ("forecast", ("forecast", "predict", "prediction", "next month", "পূর্বাভাস", "ভবিষ্যদ্বাণী")),
    ("groundwater", ("groundwater", "grace", "aquifer", "storage", "well", "ভূগর্ভস্থ", "নলকূপ")),
    ("irrigation", ("irrigat", "crop", "rice", "boro", "wheat", "maize", "potato", "সেচ", "ধান", "ফসল")),
    ("budget", ("sankey", "budget", "allocation", "sector", "loss", "বাজেট", "বরাদ্দ")),
    ("metrics", ("accuracy", "rmse", "mae", "metric", "reliable", "model", "নির্ভুল")),
    ("recommend", ("recommend", "should", "advice", "what to do", "সুপারিশ", "পরামর্শ", "করণীয়")),
    ("risk", ("risk", "scarcity", "stress", "shortage", "ঝুঁকি", "সংকট", "ঘাটতি")),
    ("summary", ("summar", "overview", "status", "situation", "সারসংক্ষেপ", "অবস্থা")),
]
UNAVAILABLE = ("rainfall today", "real-time", "real time", "live sensor", "pipe pressure now", "water level",
               "well depth", "depth", "water table", "গভীরতা", "পানির স্তর",
               "arsenic", "salinity", "water quality", "tomorrow's rain", "price")


def detect_intent(message: str) -> str:
    q = message.lower()
    if any(k in q for k in UNAVAILABLE):
        return "unavailable"
    for intent, keys in INTENTS:
        if any(k in q for k in keys):
            return intent
    return "summary"


def is_bangla(text: str) -> bool:
    return bool(re.search(r"[ঀ-৿]", text))


def _f(facts: list[Fact], key: str) -> Fact | None:
    return next((x for x in facts if x.key == key), None)


def fallback_answer(intent: str, name: str, facts: list[Fact], bangla: bool) -> tuple[str, list[str]]:
    F = {x.key: x.text for x in facts}
    used: list[str] = []

    def g(k: str) -> str:
        used.append(k)
        return F.get(k, "not available")

    if intent == "unavailable":
        txt = ("I don't have that data. AquaGuard has no real-time sensors, well-depth, water-quality or live "
               "pipe measurements; it uses reanalysis, AQUASTAT, GRACE and model outputs (see Data Sources).")
    elif intent == "greeting":
        txt = (f"Hello. I can explain water availability, scarcity risk, forecasts, the water budget, scenarios and "
               f"irrigation estimates for {name}, using only AquaGuard's data.")
    elif intent == "forecast":
        txt = (f"{name}: the {g('forecast')} — compare with the {g('forecast_normal')} normal. Dryness class: "
               f"{g('dryness')}. Model check: {g('metrics')} (Prediction Lab). Monthly rainfall is only weakly "
               "predictable, so treat this as indicative.")
    elif intent == "groundwater":
        txt = (f"GRACE shows a regional storage trend of {g('grace')}. This is a ~300 km regional signal, not well "
               "depth; AquaGuard has no measured groundwater levels. Groundwater supply in the budget uses "
               "AQUASTAT renewable groundwater.")
    elif intent == "irrigation":
        txt = (f"Irrigation estimates use {g('irrigation_method')}. Agricultural demand for {name} is "
               f"{g('demand_agriculture')} per year at irrigation efficiency {g('irr_eff')}. For rice, Alternate "
               "Wetting and Drying can reduce water use. Estimates must be validated locally.")
    elif intent == "budget":
        txt = (f"{name} water budget: annual demand by sector — agriculture {g('demand_agriculture')}, domestic "
               f"{g('demand_domestic')}, industry {g('demand_industry')}, environmental reserve "
               f"{g('demand_environment')}. Distribution losses are {g('losses')} (loss rate {g('loss_rate')}). "
               f"Dry-season unmet demand is {g('dry_unmet')}. Open the Water Budget Sankey to compare the optimized "
               "allocation (domestic first, environmental minimum protected).")
    elif intent == "metrics":
        txt = (f"Model evaluation on held-out years: {g('metrics')}. Metrics come from ml/artifacts/metrics.json "
               "and are shown with the climatology and persistence baselines in the Prediction Lab.")
    elif intent == "scenario":
        if "scenario" in F:
            txt = (f"Active scenario for {name}: {g('scenario')}. Dry-season stress moves from "
                   f"{g('base_dry_stress')} (baseline) to {g('dry_stress')}, and dry-season unmet demand from "
                   f"{g('base_dry_unmet')} to {g('dry_unmet')}. Scarcity risk is now {g('risk')}. All values are "
                   "Simulated.")
        else:
            txt = ("No scenario is active (baseline). Use the What-if Simulator to change rainfall, temperature, "
                   "demand, groundwater, irrigation efficiency or pipeline loss, then 'Apply across platform'.")
    elif intent == "recommend":
        recs = [x.text for x in facts if x.key.startswith("alert_")]
        used += [x.key for x in facts if x.key.startswith("alert_")]
        txt = (f"Recommendations for {name}: " + " ".join(recs)) if recs else (
            f"No alert thresholds are crossed for {name}. Keep monitoring the dry season (stress {g('dry_stress')}).")
    elif intent == "risk":
        txt = (f"{name} scarcity risk is {g('risk')}. The dry-season stress ratio is {g('dry_stress')} "
               f"(annual {g('stress')}); rule: {g('risk_rule')}.")
    else:
        txt = (f"{name} summary: annual availability {g('availability')}, consumptive demand {g('demand')}, annual "
               f"stress {g('stress')}, dry-season stress {g('dry_stress')}, scarcity risk {g('risk')}, dry-season "
               f"unmet demand {g('dry_unmet')}. {g('scope')}")
    if bangla:
        txt = ("(স্বয়ংক্রিয় টেমপ্লেট উত্তর — বাংলা অনুবাদের জন্য LLM মোড প্রয়োজন; সংখ্যাগুলি AquaGuard ডেটা থেকে।) "
               + txt)
    return txt, used


# ---------------------------------------------------------------- number guard

NUM = re.compile(r"[-+]?\d[\d,]*(?:\.\d+)?")
BN_DIGITS = str.maketrans("০১২৩৪৫৬৭৮৯", "0123456789")


def numbers_in(text: str) -> list[float]:
    out = []
    for tok in NUM.findall(text.translate(BN_DIGITS)):
        try:
            out.append(float(tok.replace(",", "")))
        except ValueError:
            pass
    return out


def grounded(answer: str, context_text: str) -> tuple[bool, list[float]]:
    """Every number in the answer must appear in the context (allowing sign and rounding to the
    displayed precision), or be a small ordinal/list number (<= 12) or a year."""
    allowed = numbers_in(context_text)
    bad = []
    for x in numbers_in(answer):
        if abs(x) <= 12 or (1900 <= x <= 2100 and float(x).is_integer()):
            continue
        ok = any(abs(abs(x) - abs(a)) <= max(0.51, abs(a) * 0.005) for a in allowed)
        if not ok:
            bad.append(x)
    return (not bad), bad


# ---------------------------------------------------------------- LLM mode

SYSTEM_PROMPT = """You are the AquaGuard Copilot, an assistant inside a water decision-support prototype for Bangladesh.
Answer ONLY from the FACTS block supplied with each question.
Rules:
- Use only numbers that appear in FACTS, exactly as written there. Do not calculate new numbers, convert units or estimate.
- If the FACTS do not contain what is asked, say plainly "I don't have that data" and name the AquaGuard
  module or dataset that would be needed.
- You have no real-time access, no sensors, no well depths, no water-quality data. Never claim otherwise.
- Name the module behind each number in brackets, e.g. [Command Center], [Prediction Lab], [Water Budget],
  [What-if], [Irrigation].
- Mention provenance where it matters: forecasts are Predicted, engine values Estimated, scenario values Simulated.
- Keep answers under 150 words. Give concise, practical recommendations when asked.
- Reply in Bangla if the user writes in Bangla, otherwise in English. Keep digits as in FACTS."""

MODULE_NAMES = {"command-center": "Command Center", "explorer": "3D Water Explorer", "prediction-lab": "Prediction Lab",
                "water-flow": "3D Water Flow", "water-budget": "Water Budget", "what-if": "What-if",
                "irrigation": "Irrigation", "data-sources": "Data Sources"}


def facts_block(name: str, facts: list[Fact]) -> str:
    lines = [f"Region: {name}"]
    for x in facts:
        lines.append(f"- {x.label}: {x.text} [{MODULE_NAMES.get(x.module, x.module)}]")
    return "\n".join(lines)


def llm_answer(message: str, history: list[dict], name: str, facts: list[Fact]) -> str | None:
    s = get_settings()
    if not s.llm_api_key:
        return None
    import anthropic

    client = anthropic.Anthropic(api_key=s.llm_api_key, timeout=30.0, max_retries=1)
    model = s.llm_model or "claude-opus-5-5"
    msgs = [{"role": t["role"], "content": t["content"]} for t in history[-6:]]
    msgs.append({"role": "user", "content": f"FACTS:\n{facts_block(name, facts)}\n\nQUESTION: {message}"})
    try:
        resp = client.beta.messages.create(
            model=model, max_tokens=2000, system=SYSTEM_PROMPT, messages=msgs,
            output_config={"effort": "low"},
            betas=["server-side-fallback-2026-07-01"], fallbacks="default",
        )
    except anthropic.APIError:
        return None
    if resp.stop_reason == "refusal":
        return None
    text = "".join(b.text for b in resp.content if b.type == "text").strip()
    return text or None


def answer(message: str, region_id: str, params: ScenarioParams, history: list[dict]) -> dict:
    name, facts = build_facts(region_id, params)
    intent = detect_intent(message)
    bangla = is_bangla(message)
    fb_text, used = fallback_answer(intent, name, facts, bangla)
    refs = [{"module": x.module, "label": x.label, "measure": x.measure} for x in facts
            if x.key in used and x.measure is not None]
    if intent != "unavailable":
        llm = llm_answer(message, history, name, facts)
        if llm:
            ok, _bad = grounded(llm, facts_block(name, facts))
            if ok:
                cited = [{"module": x.module, "label": x.label, "measure": x.measure} for x in facts
                         if x.measure is not None and x.text.split(" ")[0] in llm]
                return {"answer": llm, "mode": "llm", "references": cited or refs, "intent": intent}
    return {"answer": fb_text, "mode": "fallback", "references": refs, "intent": intent}


