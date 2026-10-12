"""The Pure Vegi menu, from the printed leaflet (October 2026). Prices in pence.

Everything is vegetarian (egg & meat free). (VE) dishes are vegan; most others have a vegan option.
Allergens are not on the leaflet: add them per dish in the staff app (Menu) before going live.
Load it with:  python -m app.menu_import
"""

# --- shared option groups -----------------------------------------------------------------

CANS = ["Coke", "Diet Coke", "Rubicon Mango", "7up", "Fanta Orange", "Fanta Fruit Twist"]
MEAL = "Fries + can of pop"


def meal_upgrade():
    """'ADD FRIES AND CAN OF POP FOR £2.49' (burgers, wraps, stir fried rice)."""
    return [
        {"name": "Make it a meal", "min": 0, "max": 1, "options": [(MEAL, 249)]},
        {"name": "Choose your can", "min": 1, "max": 1, "shown_if": MEAL, "options": [(c, 0) for c in CANS]},
    ]


TOPPINGS = ["Mushrooms", "Sweetcorn", "Red onion", "Mixed peppers", "Olives", "Pineapple", "Jalapeños",
            "Coriander", "Green chillies", "Extra cheese", "V-pepperoni", "V-chicken", "Paneer"]
SIZES = [('7" (4 slices)', "7"), ('10" (6 slices)', "10"), ('14" (10 slices)', "14")]
TOPPING_PRICE = {"7": 40, "10": 80, "14": 120}


def pizza_groups(p7, p10, p14):
    """Size sets the price; extra toppings cost 40p / 80p / £1.20 each depending on the size."""
    groups = [
        {"name": "Size", "min": 1, "max": 1,
         "options": [(SIZES[0][0], 0), (SIZES[1][0], p10 - p7), (SIZES[2][0], p14 - p7)]},
        {"name": "Vegan option", "min": 0, "max": 1, "options": [("Make it vegan (vegan cheese)", 100)]},
    ]
    for label, inch in SIZES:
        price = TOPPING_PRICE[inch]
        groups.append({"name": f"Extra toppings ({price}p each)" if price < 100 else "Extra toppings (£1.20 each)",
                       "min": 0, "max": len(TOPPINGS), "shown_if": label,
                       "options": [(t, price) for t in TOPPINGS]})
    return groups


def pizza(name, desc, p7, p10, p14, spice=0):
    return {"name": name, "description": desc, "price": p7, "spice": spice, "groups": pizza_groups(p7, p10, p14)}


def regular_large(reg, large):
    return [{"name": "Size", "min": 1, "max": 1, "options": [("Regular", 0), ("Large", large - reg)]}]


def wrap(name, tortilla, naan=None, desc="", vegan=False, spice=0):
    breads = [("Tortilla", 0)] + ([("Naan", naan - tortilla)] if naan else [])
    return {"name": f"{name} Wrap", "description": desc, "price": tortilla, "vegan": vegan, "spice": spice,
            "groups": [{"name": "Wrap", "min": 1, "max": 1, "options": breads}, *meal_upgrade()]}


def burger(name, price, desc, vegan_option=True):
    groups = ([{"name": "Vegan option", "min": 0, "max": 1, "options": [("Make it vegan", 0)]}] if vegan_option else [])
    return {"name": name, "description": desc, "price": price, "groups": groups + meal_upgrade()}


PIZZA_NAMES = ["Margarita", "Vegi Sweet", "Vegi Supreme", "Vegi Hot", "Vegi Deluxe", "Tandoori Paneer", "Vegi Sausage",
               "Soya Tandoori Chicken", "Vegi Pepperoni", "Vegi Meat Feast"]
DEAL_SIDES = ["Fries", "Masala Fries", "Curly Fries", "Wedges", "Garlic Bread (4 pieces)", "Curry Sauce"]

# --- the menu --------------------------------------------------------------------------------

MENU = [
    ("Pizzas", [
        pizza("Margarita", "Tomato sauce and mozzarella cheese", 450, 650, 999),
        pizza("Vegi Sweet", "Tomato sauce, mozzarella cheese, sweetcorn, pineapple & mixed peppers", 499, 699, 1099),
        pizza("Vegi Supreme", "Tomato sauce, mozzarella cheese, sweetcorn, olives, red onions, mushrooms, mixed peppers, herbs",
              499, 699, 1199),
        pizza("Vegi Hot", "Tomato sauce, mozzarella cheese, jalapeños, green chilli, red onions, mushrooms, mixed peppers, herbs",
              499, 699, 1199, spice=2),
        pizza("Vegi Deluxe", "Tomato sauce, mozzarella cheese, jalapeños, green chilli, red onions, mushrooms, sweetcorn, "
              "mixed peppers, coriander", 499, 699, 1199, spice=1),
        pizza("Tandoori Paneer", "Tomato sauce, mozzarella cheese, red onions, green chilli, mushrooms, mixed peppers, "
              "tandoori paneer, herbs", 650, 799, 1299, spice=1),
        pizza("Vegi Sausage", "Tomato sauce, mozzarella cheese, red onions, mushrooms, mixed peppers, veggie sausage, herbs",
              650, 799, 1299),
        pizza("Soya Tandoori Chicken", "Tomato sauce, mozzarella cheese, red onions, jalapeños, mushrooms, mixed peppers, "
              "tandoori chicken, herbs", 650, 799, 1299),
        pizza("Vegi Pepperoni", "Tomato sauce, mozzarella cheese, veg-pepperoni", 650, 799, 1299),
        pizza("Vegi Meat Feast", "Tomato sauce, mozzarella cheese, red onions, mushrooms, mixed peppers, vegi sausage, "
              "vegi tandoori chicken, vegi pepperoni, herbs", 650, 799, 1299),
        pizza("Create Your Own", "Tomato sauce and mozzarella cheese: pick your size, then add your toppings", 699, 899, 1299),
    ]),
    ("Burgers", [
        burger("Veggie Burger", 450, "Vegetable burger with cheese, lettuce and ketchup"),
        burger("Soya Chicken Style Burger", 450, "Soya chicken burger, lettuce and vegan mayo"),
        burger("Mexican Burger", 550, "Soya chicken burger, hash brown, cheese, lettuce, jalapeños and salsa"),
        burger("Halloumi Burger", 550, "Battered halloumi patty, lettuce, red onions and sweet chilli", vegan_option=False),
        burger("Crispy Soya Chicken", 599, "Shredded wheat-protein patty, melted cheese, lettuce, tomato and vegan mayo"),
        burger("Moving Mountain", 599, "Soya patty, melted cheese, grilled onions, lettuce and vegan mayo in a vegan brioche bun"),
        burger("Beyond Meat", 650, "Beyond Meat patty, melted cheese, tomato, grilled onions, lettuce and vegan mayo "
               "in a vegan brioche bun"),
        burger("Fully Loaded", 699, "Soya patty, hash brown, melted cheese, grilled onions, lettuce and mayo, "
               "all in a vegan brioche bun"),
    ]),
    ("Wraps", [
        wrap("Soya Chilli Chicken", 499, 599, vegan=True, spice=1),
        wrap("Kebab Strips", 499, 599, vegan=True),
        wrap("Soya Tandoori Chicken", 499, 599, vegan=True),
        wrap("Tandoori Paneer", 599, 699),
        wrap("Mix Naan", 599, 699, desc="Soya chicken, soya kebab and paneer"),
        wrap("Halloumi", 599),
    ]),
    ("Street Food", [
        {"name": "Sholey Bhature Meal", "price": 699, "description": "Channa curry, 2 bhature, salad and mixed pickle"},
        {"name": "Chinese Chilli Paneer", "price": 799},
        {"name": "Chilli Mushroom", "price": 699},
        {"name": "Veg Manchurian", "price": 699},
        {"name": "Aloo Tikki Chaat", "price": 499},
        {"name": "Samosa Chaat", "price": 499},
        {"name": "Papri Chaat", "price": 450},
        {"name": "Paneer Tikka (4 pieces)", "price": 499},
        {"name": "Naan", "price": 150},
    ]),
    ("Noodles", [
        {"name": "Veg Noodles", "price": 599, "vegan": True},
        {"name": "Paneer Noodles", "price": 699},
        {"name": "Soya Chicken Noodles", "price": 699, "vegan": True},
        {"name": "Soya Tandoori Chicken Noodles", "price": 699, "vegan": True},
    ]),
    ("Stir Fried Rice", [
        {"name": n, "price": p, "vegan": v, "description": "Served with curry sauce", "groups": meal_upgrade()}
        for n, p, v in [("Veg Fried Rice", 650, True), ("Soya Kebab Fried Rice", 750, True),
                        ("Soya Chicken Fried Rice", 750, True), ("Paneer Fried Rice", 750, False)]
    ]),
    ("Pasta", [
        {"name": n, "price": 750, "groups": [{"name": "Add extra (£1 each)", "min": 0, "max": 3,
                                             "options": [("Paneer", 100), ("Soya tandoori chicken", 100), ("Soya kebab", 100)]}]}
        for n in ("Tomato Pasta", "Creamy White Pasta")
    ]),
    ("Sides", [
        {"name": "Fries", "price": 249, "vegan": True, "groups": regular_large(249, 299)},
        {"name": "Masala Fries", "price": 279, "vegan": True, "groups": regular_large(279, 329)},
        {"name": "Curly Fries", "price": 299, "vegan": True, "groups": regular_large(299, 349)},
        {"name": "Loaded Fries", "price": 499, "description": "Cheese, jalapeños and 1 topping of your choice",
         "groups": [{"name": "Your topping", "min": 1, "max": 1, "options": [(t, 0) for t in TOPPINGS if t != "Extra cheese"]}]},
        {"name": "Chilli Fries", "price": 399},
        {"name": "Wedges", "price": 299},
        {"name": "Garlic Bread (4 pieces)", "price": 350},
        {"name": "Cheesy Garlic Bread (4 pieces)", "price": 399},
        {"name": "Pizza Garlic Bread", "price": 450},
        {"name": "Chilli Cheese Bites (10 pieces)", "price": 450},
        {"name": "Halloumi Bites (8 pieces)", "price": 450},
        {"name": "Popcorn Chicken (14 pieces)", "price": 450, "vegan": True},
        {"name": "Veggie Hot Dog", "price": 299, "groups": [{"name": "Sauce", "min": 1, "max": 1,
                                                             "options": [("Ketchup", 0), ("Hot chilli", 0)]}]},
        {"name": "Curry Sauce", "price": 150},
    ]),
    ("Deals", [
        {"name": "Medium Meal", "price": 999, "description": "Any medium (10\") pizza with fries and a can of pop",
         "groups": [
             {"name": "Choose your pizza", "min": 1, "max": 1, "options": [(p, 0) for p in PIZZA_NAMES]},
             {"name": "Vegan option", "min": 0, "max": 1, "options": [("Make it vegan (vegan cheese)", 100)]},
             {"name": "Choose your can", "min": 1, "max": 1, "options": [(c, 0) for c in CANS]},
         ]},
        {"name": "2 Large Pizzas + 2 Sides", "price": 2799,
         "description": "Any two large (14\") pizzas with two sides: fries, masala fries, curly fries, wedges, "
                        "garlic bread or curry sauce",
         "groups": [
             {"name": "First pizza", "min": 1, "max": 1, "options": [(p, 0) for p in PIZZA_NAMES]},
             {"name": "Second pizza", "min": 1, "max": 1, "options": [(p, 0) for p in PIZZA_NAMES]},
             {"name": "Choose 2 sides", "min": 2, "max": 2, "options": [(s, 0) for s in DEAL_SIDES]},
         ]},
    ]),
    ("Desserts", [
        {"name": "Chocolate Muffin or Concrete Cake", "price": 199,
         "groups": [{"name": "Choose", "min": 1, "max": 1, "options": [("Chocolate muffin", 0), ("Concrete cake", 0)]}]},
        {"name": "Chocolate Muffin or Concrete Cake with Custard", "price": 399,
         "groups": [{"name": "Choose", "min": 1, "max": 1, "options": [("Chocolate muffin", 0), ("Concrete cake", 0)]}]},
        {"name": "Cookie Dough", "price": 399, "description": "Served with a scoop of vanilla ice cream"},
    ]),
    ("Shakes & Lassi", [
        {"name": "Milkshake", "price": 299, "groups": [{"name": "Flavour", "min": 1, "max": 1, "options": [
            ("Vanilla", 0), ("Strawberry", 0), ("Oreo", 100), ("Kinder Bueno", 100), ("Mango", 100), ("Ferrero Rocher", 100)]}]},
        {"name": "Bring Your Own Chocolate Shake", "price": 399,
         "description": "Bring your favourite chocolate bar and we'll blend it"},
        {"name": "Mango Lassi", "price": 349},
    ]),
    ("Drinks", [
        {"name": "Can of Pop", "price": 100, "vegan": True,
         "groups": [{"name": "Choose", "min": 1, "max": 1, "options": [(c, 0) for c in CANS]}]},
        {"name": "1.25L Bottle", "price": 249, "vegan": True,
         "groups": [{"name": "Choose", "min": 1, "max": 1, "options": [("Coke", 0), ("Diet Coke", 0)]}]},
        {"name": "Fresh Orange Juice", "price": 299, "vegan": True},
    ]),
]
