"""Copilot: the 10-question test — no invented numbers, unavailable data acknowledged, in both modes."""
import pytest

from app.schemas.common import ScenarioParams
from app.services import copilot

QUESTIONS = [
    ("What is the water scarcity risk in Rajshahi?", "rajshahi", {}),
    ("Summarize the water situation in Bangladesh", "bd", {}),
    ("What does the forecast say for next month?", "dhaka", {}),
    ("Explain the Sankey water budget", "khulna", {}),
    ("Explain the current scenario", "bd", {"rainfallChangePct": -20}),
    ("How much irrigation does Boro rice need?", "rangpur", {}),
    ("Is groundwater declining?", "bd", {}),
    ("How accurate is the prediction model?", "bd", {}),
    ("What is the groundwater depth in my village well right now?", "sylhet", {}),
    ("আমার এলাকায় পানির ঝুঁকি কেমন?", "mymensingh", {}),
]


@pytest.mark.parametrize("question,region,scen", QUESTIONS)
def test_fallback_answers_are_grounded(question, region, scen):
    params = ScenarioParams(**scen)
    out = copilot.answer(question, region, params, [])
    assert out["mode"] == "fallback"
    name, facts = copilot.build_facts(region, params)
    ok, bad = copilot.grounded(out["answer"], copilot.facts_block(name, facts))
    assert ok, f"invented numbers {bad} in: {out['answer']}"


def test_unavailable_data_is_acknowledged():
    out = copilot.answer("What is the groundwater depth in my village well right now?", "sylhet", ScenarioParams(), [])
    assert "don't have that data" in out["answer"]


def test_bangla_detected():
    assert copilot.is_bangla("পানির ঝুঁকি")
    assert not copilot.is_bangla("water risk")


def test_guard_rejects_invented_numbers():
    ctx = "- annual stress ratio: 8.3%\n- dry-season unmet demand: 2,303 MCM"
    assert copilot.grounded("Stress is 8.3% and unmet demand is 2,303 MCM.", ctx)[0]
    ok, bad = copilot.grounded("Unmet demand will reach 9,999 MCM by 2030.", ctx)
    assert not ok and 9999.0 in bad


@pytest.mark.parametrize("question,region,scen", QUESTIONS)
def test_llm_mode_guarded(monkeypatch, question, region, scen):
    """Simulate an LLM that invents a number: the guard must fall back to the template answer."""
    monkeypatch.setattr(copilot, "llm_answer", lambda *a, **k: "The deficit is 123,456 MCM [Command Center].")
    out = copilot.answer(question, region, ScenarioParams(**scen), [])
    assert out["mode"] == "fallback"
    assert "123,456" not in out["answer"]


def test_llm_mode_accepts_grounded_answer(monkeypatch):
    name, facts = copilot.build_facts("bd", ScenarioParams())
    risk = next(f for f in facts if f.key == "risk").text
    stress = next(f for f in facts if f.key == "dry_stress").text
    monkeypatch.setattr(copilot, "llm_answer", lambda *a, **k: f"Risk is {risk}; dry-season stress {stress} [Command Center].")
    out = copilot.answer("What is the risk?", "bd", ScenarioParams(), [])
    assert out["mode"] == "llm"
