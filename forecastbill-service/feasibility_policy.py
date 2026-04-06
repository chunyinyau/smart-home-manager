from typing import Any


def _conservative_factor(appliance: dict[str, Any]) -> float:
    appliance_type = str(appliance.get("type") or "").strip().lower()
    priority = int(appliance.get("priority") or 99)

    base_by_type = {
        "cooling": 0.45,
        "entertainment": 0.8,
        "lighting": 0.75,
        "essential": 0.0,
        "infrastructure": 0.0,
    }
    base = base_by_type.get(appliance_type, 0.65)

    if priority <= 1:
        return max(0.0, min(base * 0.7, 1.0))
    if priority == 2:
        return max(0.0, min(base * 0.85, 1.0))

    return max(0.0, min(base, 1.0))


def _is_easy_action(appliance: dict[str, Any]) -> bool:
    appliance_type = str(appliance.get("type") or "").strip().lower()
    return appliance_type in {"entertainment", "lighting"}


def _max_savings_for_action(
    watts: float,
    price_per_kwh: float,
    max_duration_minutes: int,
) -> float:
    if watts <= 0 or price_per_kwh <= 0 or max_duration_minutes <= 0:
        return 0.0

    saved_kwh = (watts * (max_duration_minutes / 60.0)) / 1000.0
    return max(saved_kwh * price_per_kwh, 0.0)


def classify_feasibility(
    projected_cost: float,
    budget_cap: float,
    safe_threshold_ratio: float,
    required_savings_for_safe: float,
    price_per_kwh: float,
    recommendable_active: list[dict[str, Any]],
    max_duration_minutes: int,
    target_threshold_ratio: float | None = None,
    required_savings_for_target: float | None = None,
) -> dict[str, Any]:
    max_potential = 0.0
    conservative_potential = 0.0
    easy_potential = 0.0

    for appliance in recommendable_active:
        watts = max(0.0, float(appliance.get("currentWatts") or 0.0))
        potential = _max_savings_for_action(watts, price_per_kwh, max_duration_minutes)
        if potential <= 0:
            continue

        max_potential += potential

        conservative = potential * _conservative_factor(appliance)
        conservative_potential += conservative

        if _is_easy_action(appliance):
            easy_potential += potential

    if easy_potential <= 0:
        easy_potential = min(conservative_potential, max_potential)

    safe_ratio = safe_threshold_ratio if safe_threshold_ratio > 0 else 0.85
    recommendation_ratio = (
        target_threshold_ratio
        if isinstance(target_threshold_ratio, (int, float)) and target_threshold_ratio > 0
        else safe_ratio
    )
    required_for_target = (
        required_savings_for_target
        if isinstance(required_savings_for_target, (int, float)) and required_savings_for_target >= 0
        else required_savings_for_safe
    )

    # Lowest cap likely achievable with conservative savings.
    feasible_min_budget_cap = max((projected_cost - conservative_potential) / recommendation_ratio, 0.0)
    # Lowest cap achievable with aggressive but still valid actions.
    cap_with_max_potential = max((projected_cost - max_potential) / recommendation_ratio, 0.0)

    # Practical cap window: aggressive floor -> conservative ceiling.
    recommended_low = min(cap_with_max_potential, feasible_min_budget_cap)
    recommended_high = max(cap_with_max_potential, feasible_min_budget_cap)

    # Keep a visible span so UI does not collapse into a single identical number.
    min_visible_band = 0.5
    if projected_cost > 0 and (recommended_high - recommended_low) < min_visible_band:
        midpoint = (recommended_low + recommended_high) / 2.0
        recommended_low = max(midpoint - (min_visible_band / 2.0), 0.0)
        recommended_high = recommended_low + min_visible_band

    if required_for_target <= 0:
        status = "achievable"
        gap = 0.0
        nearest_feasible_cap = max(budget_cap, 0.0)
    elif conservative_potential >= required_for_target:
        status = "achievable"
        gap = 0.0
        nearest_feasible_cap = max(budget_cap, 0.0)
    elif max_potential >= required_for_target:
        status = "stretch"
        gap = required_for_target - conservative_potential
        nearest_feasible_cap = max(budget_cap, feasible_min_budget_cap)
    else:
        status = "not_achievable"
        gap = required_for_target - max_potential
        nearest_feasible_cap = max((projected_cost - max_potential) / recommendation_ratio, 0.0)

    return {
        "status": status,
        "feasibleWithCurrentBudget": status != "not_achievable",
        "maxPotentialSavingsSgd": round(max_potential, 4),
        "conservativePotentialSavingsSgd": round(conservative_potential, 4),
        "easyPotentialSavingsSgd": round(easy_potential, 4),
        "feasibilityGapSgd": round(max(gap, 0.0), 4),
        "feasibleMinBudgetCap": round(feasible_min_budget_cap, 2),
        "nearestFeasibleBudgetCap": round(nearest_feasible_cap, 2),
        "recommendedBudgetCapRange": {
            "low": round(recommended_low, 2),
            "high": round(recommended_high, 2),
        },
    }
