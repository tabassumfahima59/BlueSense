# Methods

Every equation below is implemented once in `backend/app/engine/` (water balance, scenario, FAO-56, flow simulation, risk, optimizer) and every parameter lives in `backend/app/config/parameters.yaml` with its value, unit, source and an assumption flag.

## 1. Water balance (`engine/water_balance.py`)

Per division, per month of a climatological year (1991–2020 normals), volumes in MCM:

```
Supply_total    = Surface_supply + Groundwater_supply
Surface_supply  = Inflow_component + Local_runoff
Inflow_component= AQUASTAT external surface inflow (1,122 km³/yr) × area share × GloFAS monthly share
Local_runoff    = runoff_coefficient × rainfall × area          (mm × km² × 10⁻³ = MCM)
Groundwater     = AQUASTAT renewable groundwater (21.12 km³/yr) × area share,
                  usable in each month in proportion to that month's consumptive need (aquifer buffer)
Demand_agriculture = Σ_crops irrigated area × GIR (FAO-56, §3)
Demand_domestic    = population × per-capita demand × days
Demand_industry    = AQUASTAT industrial withdrawal × population share × days/365
Demand_environment = environmental reserve share × surface supply
Need_s          = Demand_s / (1 − loss_rate) for piped sectors (domestic, industry); Demand_s otherwise
Allocation      = Need_s if Σ Need ≤ Supply, else pro-rata (current-practice proxy)
Delivered_s     = Allocation_s × (1 − loss_rate) for piped sectors; Allocation_s otherwise
Losses          = Σ_piped Allocation_s × loss_rate
ΔStorage        = Supply − Σ Allocation      (unallocated: retained in storage or flowing out)
Balance check:  Supply = Σ Delivered + Losses + ΔStorage   (|error| ≤ 0.01 MCM; unit-tested)
Unmet_s         = max(0, Demand_s − Delivered_s)
Stress_ratio    = (Agriculture + Domestic + Industry demand) / (Supply − environmental reserve)
```

National and division values are sums over divisions; districts show their parent division. Annual and dry-season (Dec–Apr) values are sums of months.

**Stress ratio form.** The specification wrote ΣDemand/Supply including the environment. Including the environmental reserve in the numerator double-counts it (it is ~50% of surface supply), so AquaGuard uses the SDG 6.4.2 / WRI Aqueduct form — consumptive demand over renewable supply minus environmental flow requirements (see ASSUMPTIONS A-10). The Command Center shows the result next to FAO's SDG 6.4.2 value for Bangladesh as a check.

**Stress classes** (WRI Aqueduct 4.0 baseline water stress; Kuzma et al., 2023): < 10% Low, 10–20% Low-medium, 20–40% Medium-high, 40–80% High, > 80% Extremely high.

## 2. Scenario engine (`engine/scenario.py`)

| Input | Effect |
|---|---|
| Rainfall change % | P × (1 + r) → local runoff and FAO-56 effective rainfall |
| Temperature change °C | ET0 × (Tmean + ΔT + 17.8)/(Tmean + 17.8) (Hargreaves temperature term) → ETc → agricultural demand |
| Demand change % | domestic and industrial demand × (1 + d) |
| Groundwater availability % | groundwater supply × (1 + g) |
| Irrigation efficiency | GIR = NIR / efficiency |
| Pipeline loss % | loss_rate in the water balance and the flow-simulation background leakage |

All scenario outputs are labelled Simulated. All-zero changes reproduce the baseline exactly (tested).

## 3. FAO-56 irrigation (`engine/fao56.py`)

```
ETc = Kc × ET0                    (ET0 = Open-Meteo et0_fao_evapotranspiration, FAO-56 Penman–Monteith)
Kc  : Kc_ini through the initial stage, linear to Kc_mid through development, Kc_mid in mid-season,
      linear to Kc_end in the late stage (FAO-56 Table 12 values; Fig. 25 shape)
Pe  : USDA-SCS monthly method   P ≤ 250 mm: Pe = P(125 − 0.2P)/125 ;  P > 250 mm: Pe = 125 + 0.1P
      (for periods other than a month the rule is applied to the 30.4-day-equivalent total and scaled back)
NIR = max(0, ETc − Pe) + rice land preparation + percolation/seepage
GIR = NIR / irrigation_efficiency
Volume (m³) = GIR (mm) × area (ha) × 10
TAW = 1000 (θFC − θWP) Zr ;  RAW = p × TAW   (θ from FAO-56 Table 19 midpoints; Zr, p from Table 22)
Interval ≈ trigger / daily loss; trigger = RAW (upland crops) or the AWD ponding depth (rice)
```

Advisor: a daily root-zone depletion balance over the next 16 days. Starting depletion comes from Open-Meteo model soil moisture (3–9 cm) when present, Dr0 = (θFC − θ) × 1000 × Zr; otherwise RAW/2 (assumption). Rice is assumed flooded at the start (AWD). Outputs are Estimated ("validate locally").

## 4. Flow simulation (`engine/flow_sim.py`)

```
Hazen–Williams (SI): hf = 10.67 L Q^1.852 / (C^1.852 D^4.87)
Leakage (FAVAD):     Q_leak = k × P^N1     (N1 default 1.0, 0.5–1.5)
Mass balance:        Q_pump = Σ Q_delivered + Σ Q_leak
Loss %               = Σ Q_leak / Q_pump × 100
```

Steady state solved by fixed-point iteration on pipe-mean pressures. Background k (per metre of pipe) is calibrated by bisection so that loss % equals the platform loss rate at the default set-point and pump flow. Burst leaks add k = 2.5×10⁻⁴ × severity. **Optimisation** = pressure management: burst leaks isolated for repair, then the minimum set-point meeting each destination's minimum service pressure is found by bisection (+0.05 m margin). Everything is Simulated.

**Operating controls (3D Water Flow).** Pump flow = min(requested, capacity, water available at the source), 0 when the pump is off or no path is open. The junction flow is split by the allocation shares, renormalised over open branches (a closed valve takes its branch out). Demand per zone = hypothetical demand × demand factor. Zone status: no supply (0 delivered), valve closed, low pressure (below its minimum service pressure), under-supplied (< 98 % of demand) or served. Efficiency = delivered ÷ pumped. Balance status compares delivered with demand (±2 % = balanced, otherwise surplus or deficit). Accounting boundary pump outlet → delivery points: pumped = delivered + leakage (storage change not modelled, steady state); the residual is reported and must be ~0.

## 5. Risk and alerts (`engine/risk.py`, `services/alerts.py`)

```
z = (D_pred − mean_D(month)) / sd_D(month)             (training-period climatology)
dryness: z ≤ −2 Extremely dry, ≤ −1.5 Severely dry, ≤ −1 Moderately dry (McKee et al., 1993; SPEI classes,
         Vicente-Serrano et al., 2010)
risk level = max(stress level of the dry-season stress ratio, dryness level)
             dryness levels: moderately 2, severely 3, extremely 4
```

Alerts are rules over these outputs with thresholds in `parameters.yaml` (`alerts.*`); each alert returns the rule text and the Measures that fired it.

## 6. Allocation optimizer (`engine/optimizer.py`)

Per month, `scipy.optimize.linprog` (HiGHS): maximise Σ w_s × delivered_s subject to Σ allocation ≤ supply, allocation ≤ need, environment ≥ its reserve. Weights: domestic 100, agriculture 10, industry 5 (domestic first). Custom shares are normalised to 100% and capped at need. Every proposal is re-settled by the water-balance engine and passes the 0.01 MCM check.

## 7. Machine learning (section 8 of the specification)

See `docs/MODEL_CARD.md` (generated from `ml/artifacts/metrics.json`). Target D = P − ET0 at t + h, h ∈ {1, 3, 6}; time split train ≤ 2016, validation 2017–2020, test 2021–latest; baselines climatology and persistence; Random Forest and XGBoost; 90% intervals from per-month validation residual quantiles; SHAP TreeExplainer.

**Demand** is a transparent projection (Estimated): domestic scaled by World Bank projected population, agriculture held at the FAO-56 requirement, industry constant.

**GRACE trend**: area-weighted (cos φ) mean of CSR RL06.3 mascon cells inside Bangladesh; OLS with annual + semi-annual harmonics; 95% CI from the OLS standard error (autocorrelation ignored → CI likely too narrow); 12-month projection with a 95% prediction interval, labelled Predicted.

## References

- Allen, R.G., Pereira, L.S., Raes, D., Smith, M. (1998). *Crop evapotranspiration*. FAO Irrigation and Drainage Paper 56.
- USDA Soil Conservation Service (1970/1993). Effective rainfall method, as implemented in FAO CROPWAT.
- Brouwer, C., Heibloem, M. (1986). *Irrigation Water Management: Irrigation Water Needs*. FAO Training Manual No. 3.
- Williams, G.S., Hazen, A. (1905). *Hydraulic Tables*. Hazen–Williams equation (SI form).
- Thornton, J., Lambert, A. (2005). Progress in practical prediction of pressure: leakage... (FAVAD N1).
- Kuzma, S. et al. (2023). *Aqueduct 4.0: Updated decision-relevant global water risk indicators*. WRI Technical Note.
- McKee, T.B., Doesken, N.J., Kleist, J. (1993). The relationship of drought frequency and duration to time scales.
- Vicente-Serrano, S.M., Beguería, S., López-Moreno, J.I. (2010). A multiscalar drought index sensitive to global warming: SPEI. *J. Climate*.
- Save, H., Bettadpur, S., Tapley, B.D. (2016). High-resolution CSR GRACE RL05 mascons. *JGR Solid Earth*, doi:10.1002/2016JB013007.
- Pekel, J.-F. et al. (2016). High-resolution mapping of global surface water and its long-term changes. *Nature* 540.
- Lundberg, S.M., Lee, S.-I. (2017). A unified approach to interpreting model predictions (SHAP). *NeurIPS*.
