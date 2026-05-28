import csv
import io
import json
from decimal import Decimal, InvalidOperation
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from db.database import get_db
from db.models import Shop, Product, User
from db.schemas import ImportResult, ShopOut, ProductOut
from auth import get_admin_user

router = APIRouter(prefix="/api/admin", tags=["admin"])

EXPECTED_COLUMNS = {"shop_name", "product_name", "price", "quantity", "image_url", "description_json"}


@router.post("/import", response_model=ImportResult)
async def import_csv(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="File must be a .csv")

    content = await file.read()
    text = content.decode("utf-8-sig")  # handle BOM
    reader = csv.DictReader(io.StringIO(text))

    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="Empty CSV")

    missing_cols = EXPECTED_COLUMNS - set(reader.fieldnames)
    if missing_cols:
        raise HTTPException(status_code=400, detail=f"Missing columns: {missing_cols}")

    rows_added = 0
    rows_updated = 0
    errors = []

    shop_cache: dict[str, Shop] = {}

    for i, row in enumerate(reader, start=2):  # row 1 = header
        try:
            shop_name = row["shop_name"].strip()
            if not shop_name:
                raise ValueError("shop_name is empty")

            # Upsert shop
            if shop_name not in shop_cache:
                result = await db.execute(select(Shop).where(Shop.name == shop_name))
                shop = result.scalars().first()
                if not shop:
                    shop = Shop(name=shop_name)
                    db.add(shop)
                    await db.flush()
                shop_cache[shop_name] = shop
            shop = shop_cache[shop_name]

            product_name = row["product_name"].strip()
            if not product_name:
                raise ValueError("product_name is empty")

            try:
                price = Decimal(row["price"].strip())
            except InvalidOperation:
                raise ValueError(f"Invalid price: {row['price']}")

            try:
                quantity = int(row["quantity"].strip() or "0")
            except ValueError:
                raise ValueError(f"Invalid quantity: {row['quantity']}")

            image_url = row["image_url"].strip() or None

            description = None
            raw_desc = row["description_json"].strip()
            if raw_desc:
                try:
                    description = json.loads(raw_desc)
                except json.JSONDecodeError:
                    description = {"summary": raw_desc}

            # Check if product exists (match by shop + name)
            result = await db.execute(
                select(Product).where(Product.shop_id == shop.id, Product.name == product_name)
            )
            existing = result.scalars().first()
            if existing:
                existing.price = price
                existing.quantity = quantity
                existing.image_url = image_url
                existing.description = description
                rows_updated += 1
            else:
                db.add(Product(
                    shop_id=shop.id,
                    name=product_name,
                    price=price,
                    quantity=quantity,
                    image_url=image_url,
                    description=description,
                ))
                rows_added += 1

        except Exception as e:
            errors.append({"row": i, "error": str(e)})

    await db.commit()
    return ImportResult(rows_added=rows_added, rows_updated=rows_updated, errors=errors)


@router.get("/shops", response_model=list[ShopOut])
async def admin_list_shops(db: AsyncSession = Depends(get_db), _: User = Depends(get_admin_user)):
    from sqlalchemy import func
    result = await db.execute(
        select(Shop, func.count(Product.id).label("product_count"))
        .outerjoin(Product, Product.shop_id == Shop.id)
        .group_by(Shop.id)
        .order_by(Shop.name)
    )
    shops = []
    for shop, count in result.all():
        out = ShopOut.model_validate(shop)
        out.product_count = count
        shops.append(out)
    return shops


@router.delete("/shops/{shop_id}", status_code=204)
async def delete_shop(shop_id: int, db: AsyncSession = Depends(get_db), _: User = Depends(get_admin_user)):
    result = await db.execute(select(Shop).where(Shop.id == shop_id))
    shop = result.scalars().first()
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")
    await db.delete(shop)
    await db.commit()


@router.get("/products", response_model=list[ProductOut])
async def admin_list_products(
    shop_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    stmt = select(Product, Shop.name.label("shop_name")).join(Shop, Shop.id == Product.shop_id)
    if shop_id:
        stmt = stmt.where(Product.shop_id == shop_id)
    stmt = stmt.order_by(Product.name).limit(200)
    result = await db.execute(stmt)
    products = []
    for product, shop_name in result.all():
        out = ProductOut.model_validate(product)
        out.shop_name = shop_name
        products.append(out)
    return products


@router.delete("/products/{product_id}", status_code=204)
async def delete_product(product_id: int, db: AsyncSession = Depends(get_db), _: User = Depends(get_admin_user)):
    result = await db.execute(select(Product).where(Product.id == product_id))
    product = result.scalars().first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    await db.delete(product)
    await db.commit()


@router.post("/seed")
async def run_seed(db: AsyncSession = Depends(get_db), _: User = Depends(get_admin_user)):
    """Run the seed script to populate shops and products if the database is empty."""
    from db.seed import seed
    result = await db.execute(select(Shop).limit(1))
    if result.scalars().first():
        return {"status": "already_seeded", "message": "Database already has shops. Skipping seed."}
    await seed()
    return {"status": "seeded", "message": "Shops and products seeded successfully."}
