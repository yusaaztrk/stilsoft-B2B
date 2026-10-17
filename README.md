# Stilsoft B2B

Stilsoft B2B — bayi/B2B, ERP, servis-montaj, personel ve e-ticaret modüllerinden oluşan ürün paketi (demo sürümü).

Demo kurulumunda firma kodu `DEMO` (test için `DEMOTEST`), örnek firma bilgileri "Demo Ticaret Ltd.", alan adları `example.com` olarak ayarlıdır.
Bir müşteriye kurulum yaparken: logo dosyaları (`*/public/stilsoft-logo.png`, `backend/B2B.Erp.Api/Assets/`), kaşe/antet görselleri, `appsettings.json` anahtarları ve vitrin firma bilgileri (`shop/storefront/lib/companyInfo.ts`) müşteriye göre değiştirilmelidir.

This repository contains:

- `backend/` .NET 8 Web API
- `frontend/` React + Vite
- PostgreSQL via `docker-compose.yml`

## Backend

Path:
- `backend/B2B.Erp.Api`

Run:
- `dotnet restore`
- `dotnet run`

API:
- Swagger: `http://localhost:5200/swagger`
- Health: `http://localhost:5200/health`

## Frontend

Path:
- `frontend`

Install & run:
- `npm install`
- `npm run dev`

## Database (PostgreSQL)

From repo root:
- `docker compose up -d`

Default connection string (backend `appsettings.json`):
- `Host=localhost;Port=5432;Database=b2b_erp;Username=b2b;Password=b2b`

## Products API (Filtering)

List & filter products:

- `GET http://localhost:5200/api/products?main=BEYAZ_ESYA&sub=ANKASTRE&q=aspirator&page=1&pageSize=20`
- `GET http://localhost:5200/api/products?main=BEYAZ_ESYA&sub=ANKASTRE&dealerBranchId=1&dealerCode=120-01-000000`
- `GET http://localhost:5200/api/products?id=00000000-0000-0000-0000-000000000000`
- `GET http://localhost:5200/api/products?ids=guid1,guid2,guid3`

Sorting:

- `sort=name` (default)
- `sort=-name` (descending)
- `sort=createdAt` / `sort=-createdAt`
- `sort=stockCode` / `sort=-stockCode`
