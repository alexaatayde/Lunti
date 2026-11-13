"""Insight wording and the number check (AGENTS.md §4.3): pure functions."""

from app.modules.insights.writer import TemplateWriter, numbers_check

SPENDING = {
    "month_total": "1610.00",
    "previous_total": "1500.00",
    "change_pct": 7,
    "period_start": "2026-10-01",
    "period_end": "2026-10-21",
    "top_category": "Groceries",
    "top_category_total": "1300.00",
    "top_category_share_pct": 81,
}


def test_template_uses_only_the_figures() -> None:
    text = TemplateWriter().write("spending", SPENDING)
    assert text == (
        "You've spent ₱1,610.00 so far this month, 7% more than the same days last month "
        "(₱1,500.00). Groceries is your biggest category at ₱1,300.00 (81%)."
    )
    assert numbers_check(text, SPENDING)
    less = TemplateWriter().write("spending", {**SPENDING, "change_pct": -12})
    assert "12% less than" in less


def test_budget_template() -> None:
    figures = {
        "budget_label": "Groceries",
        "budget_level": "near",
        "budget_spent": "920.00",
        "budget_limit": "1000.00",
        "budget_remaining": "80.00",
        "budget_percent_used": 92,
    }
    assert (
        TemplateWriter().write("budget", figures) == "Your Groceries budget is at 92%: ₱80.00 left."
    )
    exceeded = TemplateWriter().write("budget", {**figures, "budget_level": "exceeded"})
    assert exceeded == "Your Groceries budget is exceeded: ₱920.00 spent of ₱1,000.00."


def test_number_check_rejects_invented_numbers() -> None:
    assert numbers_check("You spent ₱1,610 this month, up 7% since Oct 1.", SPENDING)
    assert numbers_check("Spending between October 1 and 21 rose 7%.", SPENDING)
    assert not numbers_check("You could save ₱200.00 next month.", SPENDING)
    assert not numbers_check("You spent ₱1,611.00.", SPENDING)
    assert not numbers_check("That's 8% more.", SPENDING)
    assert numbers_check("Your spending is a little higher than last month.", SPENDING)
