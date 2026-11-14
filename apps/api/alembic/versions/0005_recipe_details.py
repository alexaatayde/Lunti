"""Recipe details: cooking time, numbered steps and basic staples (Phase 8C).

Revision ID: 0005_recipe_details
Revises: 0004_idempotency_keys
Create Date: 2026-11-14

Additive. Adds to `recipes`:
- `cook_time_minutes` (NOT NULL, default 0): until now `prep_time_minutes` held the whole
  time. Total time = prep + cook, so rows without a split keep the same total.
- `steps text[]` (default empty): numbered cooking steps, in order.
- `staples text[]` (default empty): basics the steps use that aren't matched against the
  pantry (water, salt, cooking oil…), shown separately so ingredient matching is unchanged.

Then fills them in for the 20 seeded recipes of 0003 (matched by their fixed ids; admin-added
recipes are not touched). Each recipe keeps its total time from 0003, split into preparation
and cooking. Ingredient rows are not changed. The content is PROVISIONAL like 0003: practical
home-cooking steps written for the MVP, subject to team review; no nutrition or health claims.

Downgrade folds cooking time back into `prep_time_minutes` (prep + cook) for every recipe,
then drops the three columns, so 0003's data comes back exactly.
"""

# ruff: noqa: E501  (recipe steps are prose; one string per step reads best)
import importlib.util
from collections.abc import Sequence
from pathlib import Path

from alembic import op

revision: str = "0005_recipe_details"
down_revision: str | None = "0004_idempotency_keys"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _catalog_module():  # noqa: ANN202
    """0003's module, for its fixed recipe ids (one source of truth for the ids)."""
    path = Path(__file__).with_name("0003_recipe_catalog.py")
    spec = importlib.util.spec_from_file_location("lunti_m0003", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


# name (as seeded in 0003) → (prep minutes, cook minutes, staples, steps)
DETAILS: dict[str, tuple[int, int, list[str], list[str]]] = {
    "Chicken adobo": (15, 45, ["Cooking oil", "Water", "Ground black pepper",
        "Bay leaves (optional)"], [
        "Cut the chicken into serving pieces. Peel and crush the garlic, and slice the onion.",
        "Heat 1 tablespoon of oil in a pot over medium heat. Sauté the garlic until light golden, then add the onion and cook until soft.",
        "Add the chicken and cook for about 5 minutes, turning, until lightly browned.",
        "Pour in the soy sauce and 1 cup of water. Add pepper (and bay leaves, if using). Bring to a boil, then cover and simmer for 20 minutes.",
        "Add the vinegar and let it boil for 2 minutes without stirring. Stir, cover and simmer for another 15 minutes, until the chicken is tender.",
        "Uncover and simmer until the sauce thickens to your liking. Serve hot with rice.",
    ]),
    "Pork sinigang": (15, 60, ["Water (about 2 liters)", "Salt"], [
        "Cut the pork into cubes. Quarter the tomatoes and the onion. Peel the radish and slice it into rounds. Pick the kangkong leaves and cut the stems into 5 cm pieces.",
        "Put the pork in a large pot with about 2 liters of water. Bring to a boil and skim off the scum that rises.",
        "Add the onion and tomatoes. Cover and simmer over low heat for about 45 minutes, until the pork is tender.",
        "Stir in the sinigang mix and add the radish. Simmer for 5 minutes, until the radish is just tender.",
        "Add the kangkong stems, then the leaves, and cook for 1 to 2 minutes. Season with salt and serve hot.",
    ]),
    "Tortang talong": (5, 20, ["Salt", "Ground black pepper"], [
        "Grill or broil the eggplants, turning, until the skin is charred and the flesh is soft, about 10 minutes. Let them cool a little.",
        "Peel off the skin, keeping the stems on. Flatten each eggplant on a plate with a fork.",
        "Beat the eggs with a pinch of salt and pepper in a shallow dish.",
        "Heat the oil in a pan over medium heat. Dip each eggplant in the egg to coat both sides, lay it in the pan and spoon any leftover egg on top.",
        "Fry for 2 to 3 minutes per side, until golden. Drain on paper towels and serve.",
    ]),
    "Ginisang monggo": (10, 40, ["Water (about 1.5 liters)", "Cooking oil", "Salt",
        "Ground black pepper"], [
        "Rinse the mung beans. Boil them in about 1.5 liters of water for 25 to 30 minutes, until soft, adding more water if needed.",
        "Mince the garlic, chop the onion and dice the tomatoes. Strip the malunggay leaves from the stems.",
        "In another pot, heat 1 tablespoon of oil. Sauté the garlic, onion and tomatoes until the tomatoes are soft.",
        "Add the cooked mung beans with their liquid. Simmer for 5 minutes, stirring now and then, and season with salt and pepper.",
        "Stir in the malunggay leaves, cook for 1 minute and serve.",
    ]),
    "Pancit canton": (15, 20, ["Cooking oil", "Water (about 2 cups)",
        "Ground black pepper"], [
        "Slice the chicken into thin strips. Shred the cabbage, cut the carrot into thin strips and mince the garlic.",
        "Heat 2 tablespoons of oil in a wok or large pan. Sauté the garlic until fragrant, then add the chicken and cook until it is no longer pink.",
        "Add the carrot and cook for 2 minutes, then the cabbage for 1 minute more. Move the chicken and vegetables to a plate.",
        "Pour 2 cups of water and the soy sauce into the pan and bring to a boil. Add the noodles and toss until they soak up the liquid and soften.",
        "Return the chicken and vegetables, toss everything together, season with pepper and serve.",
    ]),
    "Arroz caldo": (10, 40, ["Cooking oil", "Water (about 2 liters)",
        "Ground black pepper"], [
        "Cut the chicken into small pieces. Peel the ginger and cut it into thin strips. Mince the garlic. Rinse the rice.",
        "Heat 2 tablespoons of oil in a pot. Fry half of the garlic until golden and crisp, and set it aside for the topping.",
        "In the same pot, sauté the rest of the garlic with the ginger. Add the chicken and the fish sauce and cook for 5 minutes.",
        "Add the rice and stir for 2 minutes. Pour in about 2 liters of water and bring to a boil.",
        "Simmer over low heat for about 30 minutes, stirring often so the rice doesn't stick, until thick and the rice is very soft. Add water if it gets too thick.",
        "Season with pepper, top with the fried garlic and serve hot.",
    ]),
    "Chicken tinola": (10, 40, ["Cooking oil", "Water (about 1.5 liters)",
        "Ground black pepper"], [
        "Cut the chicken into serving pieces. Peel the papaya, remove the seeds and cut it into wedges. Slice the ginger and the onion. Strip the malunggay leaves from the stems.",
        "Heat 1 tablespoon of oil in a pot. Sauté the ginger and onion until fragrant.",
        "Add the chicken and the fish sauce and cook for 5 minutes, stirring.",
        "Pour in about 1.5 liters of water. Bring to a boil, then simmer for about 25 minutes, until the chicken is tender.",
        "Add the papaya and cook for 5 to 7 minutes, until tender.",
        "Stir in the malunggay leaves, season with pepper and serve.",
    ]),
    "Pork menudo": (15, 55, ["Cooking oil", "Water (1 cup)", "Salt",
        "Ground black pepper"], [
        "Cut the pork into small cubes. Peel and dice the potatoes and the carrot. Dice the bell pepper and mince the garlic.",
        "Heat 2 tablespoons of oil in a pot. Lightly fry the potatoes and carrot for 5 minutes, then set them aside.",
        "In the same pot, sauté the garlic, then add the pork and cook until lightly browned.",
        "Add the tomato sauce and 1 cup of water. Bring to a boil, then cover and simmer for about 30 minutes, until the pork is tender.",
        "Add the potatoes and carrot and simmer for 10 minutes, until soft.",
        "Add the bell pepper and cook for 2 minutes. Season with salt and pepper and serve.",
    ]),
    "Sinangag (garlic fried rice)": (5, 10, ["Salt"], [
        "Use cooked rice, ideally a day old and cold. Break up any clumps with your hands.",
        "Peel and mince the garlic.",
        "Heat the oil in a pan over medium-low heat. Fry the garlic, stirring, until light golden, and take out half of it for the topping.",
        "Turn the heat to medium-high. Add the rice and a pinch of salt and stir-fry for about 5 minutes, until heated through.",
        "Top with the garlic you set aside and serve.",
    ]),
    "Beef tapa with egg": (10, 20, ["Cooking oil", "Sugar (1 teaspoon)",
        "Ground black pepper"], [
        "Slice the beef thinly across the grain. Mince the garlic.",
        "Mix the beef with the soy sauce, half of the garlic, 1 teaspoon of sugar and some pepper. Cover and marinate in the fridge for at least 30 minutes (not included in the time above).",
        "Heat 1 tablespoon of oil in a pan. Fry the beef in batches over medium-high heat for 3 to 4 minutes per batch, until browned and cooked.",
        "In another pan, fry the rest of the garlic in a little oil, then add the cooked rice and stir-fry until hot.",
        "Fry the eggs the way you like them. Serve the beef with the garlic rice and the eggs.",
    ]),
    "Ginataang kalabasa at sitaw": (15, 25, ["Cooking oil", "Salt",
        "Ground black pepper"], [
        "Peel and seed the squash and cut it into cubes. Cut the string beans into 5 cm pieces. Peel and devein the shrimp. Mince the garlic and chop the onion.",
        "Heat 1 tablespoon of oil in a pot. Sauté the garlic and onion until soft.",
        "Pour in the coconut milk and bring to a gentle boil. Add the squash, cover and simmer for about 10 minutes, until almost tender.",
        "Add the string beans and simmer for 5 minutes.",
        "Add the shrimp and cook for 2 to 3 minutes, until pink. Season with salt and pepper and serve.",
    ]),
    "Chopsuey": (15, 15, ["Cooking oil", "Water (½ cup)", "Salt",
        "Ground black pepper"], [
        "Slice the chicken thinly. Cut the cabbage into squares, slice the carrot and cut the broccoli into florets. Mince the garlic.",
        "Heat 2 tablespoons of oil in a wok. Sauté the garlic, then add the chicken and cook until it is no longer pink.",
        "Add the carrot and broccoli with ½ cup of water. Cover and cook for 3 minutes.",
        "Add the cabbage and the oyster sauce and stir-fry for 2 minutes, until the vegetables are tender-crisp.",
        "Season with salt and pepper and serve.",
    ]),
    "Bistek Tagalog": (15, 25, ["Cooking oil", "Water (½ cup)",
        "Ground black pepper"], [
        "Slice the beef thinly. Squeeze the calamansi and remove the seeds. Slice the onions into rings.",
        "Marinate the beef in the soy sauce, the calamansi juice and some pepper for at least 30 minutes (not included in the time above).",
        "Heat 2 tablespoons of oil in a pan. Fry the onion rings until just soft and set them aside.",
        "Lift the beef out of the marinade, keeping the marinade. Fry the beef in the same pan until browned.",
        "Add the marinade and ½ cup of water. Simmer for 15 to 20 minutes, until the beef is tender and the sauce has reduced.",
        "Top with the onion rings and serve.",
    ]),
    "Pinakbet": (15, 30, ["Cooking oil", "Water (1 cup)"], [
        "Cut the pork into small pieces. Cube the squash and slice the eggplants. Cut the okra and string beans into 5 cm pieces. Halve the ampalaya, scoop out the seeds and slice it.",
        "Heat 1 tablespoon of oil in a pot and cook the pork until browned.",
        "Stir in the shrimp paste and cook for 1 minute.",
        "Add the squash and 1 cup of water. Cover and simmer for 8 minutes.",
        "Add the string beans, eggplants, okra and ampalaya. Cover and cook for 7 to 8 minutes, shaking the pot now and then instead of stirring, until all the vegetables are tender. Serve.",
    ]),
    "Paksiw na isda": (10, 25, ["Water (½ cup)", "Salt",
        "Whole or ground black pepper"], [
        "Clean and scale the fish, and cut it into serving pieces if it is large. Slice the ginger, crush the garlic and slice the eggplant.",
        "Arrange the ginger, garlic and eggplant in a pan and lay the fish on top.",
        "Pour in the vinegar and ½ cup of water, and add salt and pepper.",
        "Bring to a boil without stirring, then cover and simmer over low heat for 15 to 20 minutes, until the fish flakes easily. Serve with rice.",
    ]),
    "Lugaw": (10, 35, ["Water (about 2 liters)", "Cooking oil", "Salt"], [
        "Hard-boil the eggs for 10 minutes. Cool, peel and halve them.",
        "Cut the ginger into strips and mince the garlic. Fry half of the garlic in 2 tablespoons of oil until golden and set it aside. Rinse the rice.",
        "Sauté the rest of the garlic and the ginger in a pot. Add the rice and stir for 1 minute.",
        "Pour in about 2 liters of water and bring to a boil. Simmer for about 30 minutes, stirring often, until thick and creamy. Add water if needed.",
        "Season with salt, top with the eggs and fried garlic, and serve.",
    ]),
    "Corned beef with potatoes": (5, 15, ["Cooking oil", "Water (¼ cup)",
        "Ground black pepper"], [
        "Peel and dice the potatoes. Chop the onion and mince the garlic.",
        "Heat 1 tablespoon of oil in a pan. Fry the potatoes for 5 to 7 minutes, until golden and almost tender.",
        "Add the garlic and onion and cook until soft.",
        "Add the corned beef and ¼ cup of water. Break it up and cook for about 5 minutes, until the potatoes are tender. Season with pepper and serve.",
    ]),
    "Sardinas with misua": (5, 10, ["Cooking oil", "Water (about 3 cups)", "Salt",
        "Ground black pepper"], [
        "Chop the onion and mince the garlic.",
        "Heat 1 tablespoon of oil in a pot and sauté the garlic and onion until soft.",
        "Add the sardines with their sauce and about 3 cups of water. Bring to a boil.",
        "Add the misua and cook for 1 to 2 minutes, until soft. Season with salt and pepper and serve.",
    ]),
    "Scrambled eggs with tomatoes": (3, 7, ["Cooking oil", "Salt",
        "Ground black pepper"], [
        "Dice the tomatoes and the onion. Beat the eggs with a pinch of salt and pepper.",
        "Heat 1 tablespoon of oil in a pan. Sauté the onion until soft, then add the tomatoes and cook for 2 minutes.",
        "Pour in the eggs and stir gently over low heat until just set. Serve.",
    ]),
    "Champorado": (5, 25, ["Water (about 1.5 liters)"], [
        "Rinse the glutinous rice. Bring about 1.5 liters of water to a boil in a pot and add the rice.",
        "Simmer for 15 to 20 minutes, stirring often so it doesn't stick, until the rice is soft and the mixture is thick.",
        "Stir in the cocoa and sugar until dissolved and cook for 5 more minutes. Add water if it gets too thick.",
        "Serve hot, with the evaporated milk poured on top.",
    ]),
}  # fmt: skip


def _q(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _array(values: list[str]) -> str:
    return "array[" + ", ".join(_q(v) for v in values) + "]::text[]" if values else "'{}'"


UPGRADE = """
alter table public.recipes
  add column cook_time_minutes smallint not null default 0,
  add column steps text[] not null default '{}'::text[],
  add column staples text[] not null default '{}'::text[],
  add constraint ck_recipes_cook_time_non_negative check (cook_time_minutes >= 0),
  add constraint ck_recipes_steps_count check (cardinality(steps) <= 30),
  add constraint ck_recipes_staples_count check (cardinality(staples) <= 20);
"""

DOWNGRADE = """
update public.recipes set prep_time_minutes = prep_time_minutes + cook_time_minutes;
alter table public.recipes
  drop constraint ck_recipes_staples_count,
  drop constraint ck_recipes_steps_count,
  drop constraint ck_recipes_cook_time_non_negative,
  drop column staples,
  drop column steps,
  drop column cook_time_minutes;
"""


def upgrade() -> None:
    # Existing grants and RLS policies on recipes are table-level, so they cover the new
    # columns; nothing else changes.
    op.execute(UPGRADE)
    # Literal SQL (static, reviewed data), so `alembic upgrade --sql` can print it for review.
    catalog = _catalog_module()
    seeded = {name for name, *_ in catalog.CATALOG}
    assert set(DETAILS) == seeded, "DETAILS must cover exactly the 0003 recipes"
    for name, (prep, cook, staples, steps) in DETAILS.items():
        op.execute(
            "update public.recipes set"
            f" prep_time_minutes = {prep}, cook_time_minutes = {cook},"
            f" staples = {_array(staples)}, steps = {_array(steps)}"
            f" where id = {_q(str(catalog.recipe_id(name)))};"
        )


def downgrade() -> None:
    op.execute(DOWNGRADE)
