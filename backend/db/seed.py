"""
Seed script: 10 fake shops + 50 products each = 500 products.
Run: python -m db.seed
"""
import asyncio
import random
from decimal import Decimal
from faker import Faker
from sqlalchemy import select
from .database import AsyncSessionLocal, engine, create_tables
from .models import Shop, Product

fake = Faker()
random.seed(42)
Faker.seed(42)

SHOP_CATEGORIES = [
    ("TechNova", "Electronics", ["laptops", "phones", "tablets", "headphones", "cameras"]),
    ("GreenLeaf", "Organic Food", ["organic", "vegan", "gluten-free", "superfoods", "supplements"]),
    ("UrbanThreads", "Clothing", ["streetwear", "casual", "activewear", "shoes", "accessories"]),
    ("HomeHaven", "Home & Garden", ["furniture", "decor", "lighting", "garden", "storage"]),
    ("SportsPeak", "Sports", ["running", "cycling", "yoga", "gym", "outdoor"]),
    ("BookNook", "Books", ["fiction", "non-fiction", "textbooks", "children", "comics"]),
    ("PetPalace", "Pet Supplies", ["dogs", "cats", "birds", "fish", "small-pets"]),
    ("BeautyBliss", "Beauty", ["skincare", "makeup", "haircare", "fragrance", "tools"]),
    ("ToyTrove", "Toys", ["educational", "outdoor", "puzzles", "action-figures", "arts-crafts"]),
    ("KitchenKing", "Kitchen", ["cookware", "appliances", "bakeware", "utensils", "storage"]),
]

PRODUCT_ADJECTIVES = ["Premium", "Deluxe", "Essential", "Pro", "Classic", "Elite", "Compact", "Advanced", "Ultra", "Smart"]


def make_product(shop_id: int, category: str, tags: list[str]) -> dict:
    tag_sample = random.sample(tags, k=random.randint(1, min(3, len(tags))))
    adj = random.choice(PRODUCT_ADJECTIVES)
    name = f"{adj} {fake.word().title()} {category.split()[0]}"
    price = round(random.uniform(5.99, 499.99), 2)
    qty = random.randint(0, 200)

    specs = {
        "weight": f"{round(random.uniform(0.1, 10.0), 1)} kg",
        "dimensions": f"{random.randint(5,50)}x{random.randint(5,50)}x{random.randint(2,30)} cm",
        "color": fake.color_name(),
        "material": random.choice(["plastic", "metal", "wood", "fabric", "glass", "composite"]),
    }
    if category == "Electronics":
        specs["battery"] = f"{random.choice([2000, 3000, 5000, 10000])} mAh"
        specs["warranty"] = f"{random.choice([1, 2, 3])} years"
    elif category == "Clothing":
        specs["sizes"] = random.sample(["XS", "S", "M", "L", "XL", "XXL"], k=random.randint(3, 6))
        del specs["weight"]

    description = {
        "summary": fake.paragraph(nb_sentences=3),
        "tags": tag_sample,
        "specs": specs,
        "features": [fake.sentence() for _ in range(random.randint(2, 5))],
        "brand": fake.company(),
    }

    return {
        "shop_id": shop_id,
        "name": name,
        "price": Decimal(str(price)),
        "quantity": qty,
        "image_url": f"https://picsum.photos/seed/{random.randint(1,1000)}/400/400",
        "description": description,
    }


async def seed():
    await create_tables()
    async with AsyncSessionLocal() as session:
        # Check if already seeded
        result = await session.execute(select(Shop).limit(1))
        if result.scalars().first():
            print("Database already seeded. Skipping.")
            return

        shops = []
        for shop_name, category, tags in SHOP_CATEGORIES:
            shop = Shop(
                name=shop_name,
                logo_url=f"https://ui-avatars.com/api/?name={shop_name}&size=200&background=random",
                description=f"Your premier destination for {category.lower()} products. {fake.sentence()}",
                website_url=f"https://www.{shop_name.lower()}.example.com",
            )
            session.add(shop)
            shops.append((shop, category, tags))

        await session.flush()

        product_count = 0
        for shop, category, tags in shops:
            for _ in range(50):
                product_data = make_product(shop.id, category, tags)
                product = Product(**product_data)
                session.add(product)
                product_count += 1

        await session.commit()
        print(f"Seeded {len(shops)} shops and {product_count} products.")


if __name__ == "__main__":
    asyncio.run(seed())
