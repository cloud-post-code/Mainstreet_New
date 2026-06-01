# Personal Shopper

AI-powered personal shopping assistant built with FastAPI + React + Claude.

## Quick Start (Local)

### Prerequisites
- Python 3.11+
- Node 18+
- PostgreSQL 16 running locally

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# Edit .env: set DATABASE_URL, SECRET_KEY, ANTHROPIC_API_KEY

# Start the API
uvicorn main:app --reload --port 8000
```

The catalog starts empty. Add shops and products via the Admin portal (CSV import or the AI Listing Agent).


### Frontend

```bash
cd frontend
npm install

cp .env.example .env
# .env already points to http://localhost:8000 for local dev

npm run dev
```

Open http://localhost:5173

### Make yourself admin

After registering, run in psql:
```sql
UPDATE users SET is_admin = true WHERE email = 'your@email.com';
```

---

## Railway Deployment

### 1. Create a new Railway project
```
railway new
```

### 2. Add a Postgres database
In the Railway dashboard: **New Service → Database → PostgreSQL**

### 3. Deploy the backend

```bash
cd backend
railway up
```

Set environment variables in Railway dashboard:
| Variable | Value |
|---|---|
| `SECRET_KEY` | any long random string |
| `ANTHROPIC_API_KEY` | your Anthropic API key |
| `FRONTEND_URL` | your Railway frontend URL (set after deploying frontend) |
| `PUBLIC_API_URL` | *(optional)* override for image URLs; Railway sets `RAILWAY_PUBLIC_DOMAIN` automatically |

Railway auto-injects `DATABASE_URL` from the Postgres plugin.

**Listing images:** uploads are saved on the backend disk under `uploads/listings/` and served at `/uploads/…`. The URL is stored in Postgres on `products.image_url` — same as seed data. No Railway bucket or `RAILWAY_BUCKET_*` variables are required. (Uploaded files are lost on redeploy unless you add a [Railway volume](https://docs.railway.com/guides/volumes) mounted at `uploads/`.)

### 4. Deploy the frontend

```bash
cd frontend
railway up
```

Set environment variable:
| Variable | Value |
|---|---|
| `VITE_API_URL` | your Railway backend service URL |

Note: Because Vite bakes `VITE_*` vars at build time, you must set `VITE_API_URL` **before** the first build on Railway. If you change the backend URL later, trigger a redeploy of the frontend.

---

## CSV Import Format

Upload via Admin Portal → Import Products.

Required columns (header row must match exactly):
```
shop_name,product_name,price,quantity,image_url,description_json
```

- `description_json`: valid JSON string or plain text (becomes `{"summary": "..."}`)
- `image_url`: public image URL or leave blank
- `quantity`: integer, defaults to 0 if blank

---

## Architecture

- **Backend**: FastAPI + SQLAlchemy async + PostgreSQL (JSONB for product descriptions)
- **Agent**: Claude claude-sonnet-4-6, max 10 tool-call iterations, NDJSON streaming
- **Memory**: Short-term (DB session turns) + Long-term (user_memory table, 50-key cap)
- **Search**: PostgreSQL tsvector full-text search with ts_rank relevance
- **Auth**: JWT (email + password, bcrypt)
