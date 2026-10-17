using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace B2B.Erp.Api.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "CashAccounts",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Code = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    LastCarryDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValue: new DateTime(1970, 1, 1, 0, 0, 0, 0, DateTimeKind.Utc)),
                    LastCarryAmount = table.Column<double>(type: "double precision", nullable: false, defaultValue: 0.0),
                    CurrencyTypeId = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    CreateUser = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    CreateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    EditUser = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    EditTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CashAccounts", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Pages",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ModuleKey = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Key = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    DisplayName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Pages", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "PriceGroups",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Code = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PriceGroups", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Products",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    StockCode = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Barcode = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    GroupCode = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    SubGroupCode = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    Unit = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    TaxRate = table.Column<int>(type: "integer", nullable: false),
                    IsOfficial = table.Column<bool>(type: "boolean", nullable: false),
                    Stock = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    ImageUrl = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Products", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Roles",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Code = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    DisplayName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Description = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    IsSuperAdmin = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "NOW()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Roles", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Salesmen",
                columns: table => new
                {
                    SalesmanCode = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Description = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    CreateUser = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    CreateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    EditUser = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    EditTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Salesmen", x => x.SalesmanCode);
                });

            migrationBuilder.CreateTable(
                name: "StockGroups",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    GroupCode = table.Column<string>(type: "character varying(400)", maxLength: 400, nullable: false),
                    GroupType = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Description = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    B2BOrder = table.Column<bool>(type: "boolean", nullable: false),
                    CreateUser = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    CreateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    EditUser = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    EditTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StockGroups", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Warehouses",
                columns: table => new
                {
                    WarehouseCode = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    NegativeBalanceControl = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    CreateUser = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    CreateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    EditUser = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    EditTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Warehouses", x => x.WarehouseCode);
                });

            migrationBuilder.CreateTable(
                name: "Customers",
                columns: table => new
                {
                    CustomerCode = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    Address = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    City = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    District = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    Phone = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    Fax = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    Email = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    TaxOffice = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    TaxNumber = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    IdentityNumber = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    CustomerType = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false, defaultValue: ""),
                    InvoiceType = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false, defaultValue: ""),
                    ProductCategory = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    PriceGroupId = table.Column<Guid>(type: "uuid", nullable: true),
                    DiscountRate = table.Column<double>(type: "double precision", nullable: false, defaultValue: 0.0),
                    SalesmanCode = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    CreditLimit = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false, defaultValue: 0m),
                    ParentCustomerCode = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    CurrencyTypeId = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    CreateUser = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    CreateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    EditUser = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    EditTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Customers", x => x.CustomerCode);
                    table.ForeignKey(
                        name: "FK_Customers_Customers_ParentCustomerCode",
                        column: x => x.ParentCustomerCode,
                        principalTable: "Customers",
                        principalColumn: "CustomerCode",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Customers_PriceGroups_PriceGroupId",
                        column: x => x.PriceGroupId,
                        principalTable: "PriceGroups",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ProductPrices",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ProductId = table.Column<Guid>(type: "uuid", nullable: false),
                    PriceGroupId = table.Column<Guid>(type: "uuid", nullable: false),
                    Price = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    Currency = table.Column<string>(type: "character varying(3)", maxLength: 3, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProductPrices", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ProductPrices_PriceGroups_PriceGroupId",
                        column: x => x.PriceGroupId,
                        principalTable: "PriceGroups",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ProductPrices_Products_ProductId",
                        column: x => x.ProductId,
                        principalTable: "Products",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "RolePagePermissions",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    RoleId = table.Column<int>(type: "integer", nullable: false),
                    PageId = table.Column<int>(type: "integer", nullable: false),
                    CanAccess = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RolePagePermissions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_RolePagePermissions_Pages_PageId",
                        column: x => x.PageId,
                        principalTable: "Pages",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_RolePagePermissions_Roles_RoleId",
                        column: x => x.RoleId,
                        principalTable: "Roles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Users",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Username = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Password = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    Mail = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    Gsm = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    Unvan = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Departman = table.Column<int>(type: "integer", nullable: true),
                    Subekodu = table.Column<int>(type: "integer", nullable: true),
                    Carikodu = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    Plasiyerkodu = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    Stokgrup = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Stokgrup2 = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Depokodu = table.Column<int>(type: "integer", nullable: true),
                    UstCariKodu = table.Column<string>(type: "text", nullable: true),
                    Durum = table.Column<bool>(type: "boolean", nullable: true),
                    YetkiAck = table.Column<string>(type: "text", nullable: true),
                    Bakim = table.Column<bool>(type: "boolean", nullable: true),
                    Avatar = table.Column<byte[]>(type: "bytea", nullable: true),
                    KasaKodu = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    Dogumtarihi = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    MagazaKasa = table.Column<bool>(type: "boolean", nullable: true),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    LastLoginAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    RoleId = table.Column<int>(type: "integer", nullable: false),
                    CreateUser = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    CreateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    EditUser = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    EditTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Users", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Users_Roles_RoleId",
                        column: x => x.RoleId,
                        principalTable: "Roles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "RefreshTokens",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Token = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    ExpiresAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "NOW()"),
                    CreatedByIp = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    RevokedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    RevokedByIp = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    ReplacedByToken = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    IsRevoked = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    UserId = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RefreshTokens", x => x.Id);
                    table.ForeignKey(
                        name: "FK_RefreshTokens_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.InsertData(
                table: "Pages",
                columns: new[] { "Id", "DisplayName", "IsActive", "Key", "ModuleKey", "SortOrder" },
                values: new object[,]
                {
                    { 1, "Sipariş", true, "siparis", "invoice", 1 },
                    { 2, "Satış Faturası", true, "satisFatura", "invoice", 2 },
                    { 3, "Kampanya Tanım", true, "kampanya", "invoice", 3 },
                    { 4, "Fatura Dökümü", true, "faturaDokum", "invoice", 4 },
                    { 5, "Fatura Dökümü (2024)", true, "faturaDokum2024", "invoice", 5 },
                    { 6, "Etiket Basım Fiyatları", true, "etiket", "invoice", 6 },
                    { 7, "Proforma", true, "proforma", "invoice", 7 },
                    { 8, "Mağaza Sipariş", true, "magaza", "invoice", 8 },
                    { 9, "Alış Faturaları", true, "alis", "invoice", 9 },
                    { 10, "Depo Transfer", true, "depoTransfer", "invoice", 10 },
                    { 11, "Stok Hareket Dökümü", true, "stokHareket", "invoice", 11 },
                    { 12, "Satış Faturaları", true, "satis", "invoice", 12 },
                    { 13, "Depo Bakiye Listesi", true, "depoBakiye", "invoice", 13 },
                    { 14, "Kasa Giriş/Çıkış", true, "kasaGirisCikis", "cash", 1 },
                    { 15, "Kasalar Arası Transfer", true, "kasalarArasiTransfer", "cash", 2 },
                    { 16, "Kredi Kartı ile Ödeme", true, "posPayment", "pos", 1 },
                    { 17, "Kredi Kartı Çekim Raporu", true, "posReport", "pos", 2 },
                    { 18, "Müşteri Çeki", true, "customerCheck", "check", 1 },
                    { 19, "Borç Çeki", true, "debtCheck", "check", 2 },
                    { 20, "Borç Seneti", true, "debtNote", "check", 3 },
                    { 21, "Havale/EFT", true, "havaleEft", "bank", 1 },
                    { 22, "Banka Hesapları", true, "bankaHesaplari", "bank", 2 },
                    { 23, "Banka Maaş Bordrosu", true, "bankaMaasBordrosu", "bank", 3 },
                    { 24, "Kabul Listesi", true, "kabulListesi", "service", 1 },
                    { 25, "Montaj Listesi", true, "montajListesi", "service", 2 },
                    { 26, "Montaj Rapor", true, "montajRapor", "service", 3 },
                    { 27, "Montaj Analiz", true, "montajAnaliz", "service", 4 },
                    { 28, "Cari Ekstre", true, "cariEkstre", "reports", 1 },
                    { 29, "Cari Borç Alacak", true, "cariBorcAlacak", "reports", 2 },
                    { 30, "Yaşlandırma", true, "yaslandirma", "reports", 3 },
                    { 31, "Yaşlandırma (2024)", true, "yaslandirma2024", "reports", 4 },
                    { 32, "Cari Satış Raporu", true, "cariSatisRaporu", "reports", 5 },
                    { 33, "Banka Raporları", true, "bankaRaporlari", "reports", 6 },
                    { 34, "Kasa Raporları", true, "kasaRaporlari", "reports", 7 },
                    { 35, "Ürün Satış Raporu Detaylı", true, "urunSatisRaporuDetayli", "reports", 8 },
                    { 36, "Ürün Satış Raporu (Aylık)", true, "urunSatisRaporuAylik", "reports", 9 },
                    { 37, "Sipariş Raporu", true, "siparisRaporu", "reports", 10 },
                    { 38, "Aktif Sepet Raporu", true, "aktifSepetRaporu", "reports", 11 },
                    { 39, "Limit Risk Satış Raporu", true, "limitRiskSatisRaporu", "reports", 12 },
                    { 40, "Muhasebe Stok Giriş/Çıkış Raporu", true, "muhasebeStokGirisCikisRaporu", "reports", 13 },
                    { 41, "Satış Pazarlama Raporu", true, "satisPazarlamaRaporu", "reports", 14 },
                    { 42, "Fiyat Listesi", true, "fiyatListesi", "reports", 15 },
                    { 43, "Kullanıcı Listesi", true, "kullaniciListesi", "users", 1 },
                    { 44, "Stok Listesi", true, "stokListesi", "users", 2 },
                    { 45, "Banka Hesap Tanım", true, "bankaHesapTanim", "users", 3 },
                    { 46, "Rol Yetkileri", true, "rolYetkileri", "users", 4 },
                    { 47, "Kategori Yönetimi", true, "kategoriYonetimi", "users", 5 },
                    { 48, "Ürün Yönetimi", true, "urunYonetimi", "users", 6 },
                    { 49, "Atılı Fiyatlandırma", true, "atiliFiyatlandirma", "users", 7 },
                    { 50, "Cari Ekle", true, "cariEkle", "users", 8 }
                });

            migrationBuilder.InsertData(
                table: "PriceGroups",
                columns: new[] { "Id", "Code", "Name" },
                values: new object[,]
                {
                    { new Guid("11111111-1111-1111-1111-111111111111"), "F1", "Peşin" },
                    { new Guid("22222222-2222-2222-2222-222222222222"), "F2", "30 Gün" },
                    { new Guid("33333333-3333-3333-3333-333333333333"), "F3", "45 Gün" },
                    { new Guid("44444444-4444-4444-4444-444444444444"), "F4", "60 Gün" },
                    { new Guid("55555555-5555-5555-5555-555555555555"), "F5", "90 Gün" },
                    { new Guid("66666666-6666-6666-6666-666666666666"), "F6", "Plasiyer" }
                });

            migrationBuilder.InsertData(
                table: "Roles",
                columns: new[] { "Id", "Code", "CreatedAt", "Description", "DisplayName", "IsActive", "IsSuperAdmin", "Name" },
                values: new object[] { 1, "SuperAdmin", new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Utc), "Süper yönetici - Tüm yetkiler", "Süper Admin", true, true, "SuperAdmin" });

            migrationBuilder.InsertData(
                table: "Roles",
                columns: new[] { "Id", "Code", "CreatedAt", "Description", "DisplayName", "IsActive", "Name" },
                values: new object[,]
                {
                    { 2, "Yonetim", new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Utc), "Üst düzey yönetim", "Yönetim", true, "Yonetim" },
                    { 3, "Mudur", new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Utc), "Genel müdür", "Müdür", true, "Mudur" },
                    { 4, "MontajMudur", new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Utc), "Montaj operasyonları yöneticisi", "Montaj Müdürü", true, "MontajMudur" },
                    { 5, "ServisMudur", new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Utc), "Servis operasyonları yöneticisi", "Servis Müdürü", true, "ServisMudur" },
                    { 6, "Admin", new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Utc), "Sistem yöneticisi", "Admin", true, "Admin" },
                    { 7, "Muhasebe", new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Utc), "Finansal işlemler", "Muhasebe", true, "Muhasebe" },
                    { 8, "Bayi", new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Utc), "Ana bayi", "Bayi", true, "Bayi" },
                    { 9, "AltBayi", new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Utc), "Alt bayi", "Alt Bayi", true, "AltBayi" },
                    { 10, "Plasiyer", new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Utc), "Saha satış elemanı", "Plasiyer", true, "Plasiyer" },
                    { 11, "ServisPersonel", new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Utc), "Teknik servis elemanı", "Servis Personeli", true, "ServisPersonel" },
                    { 12, "Kurumsal", new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Utc), "Kurumsal müşteri", "Kurumsal", true, "Kurumsal" }
                });

            migrationBuilder.InsertData(
                table: "RolePagePermissions",
                columns: new[] { "Id", "CanAccess", "PageId", "RoleId" },
                values: new object[,]
                {
                    { 1, true, 1, 1 },
                    { 2, true, 2, 1 },
                    { 3, true, 3, 1 },
                    { 4, true, 4, 1 },
                    { 5, true, 5, 1 },
                    { 6, true, 6, 1 },
                    { 7, true, 7, 1 },
                    { 8, true, 8, 1 },
                    { 9, true, 9, 1 },
                    { 10, true, 10, 1 },
                    { 11, true, 11, 1 },
                    { 12, true, 12, 1 },
                    { 13, true, 13, 1 },
                    { 14, true, 14, 1 },
                    { 15, true, 15, 1 },
                    { 16, true, 16, 1 },
                    { 17, true, 17, 1 },
                    { 18, true, 18, 1 },
                    { 19, true, 19, 1 },
                    { 20, true, 20, 1 },
                    { 21, true, 21, 1 },
                    { 22, true, 22, 1 },
                    { 23, true, 23, 1 },
                    { 24, true, 24, 1 },
                    { 25, true, 25, 1 },
                    { 26, true, 26, 1 },
                    { 27, true, 27, 1 },
                    { 28, true, 28, 1 },
                    { 29, true, 29, 1 },
                    { 30, true, 30, 1 },
                    { 31, true, 31, 1 },
                    { 32, true, 32, 1 },
                    { 33, true, 33, 1 },
                    { 34, true, 34, 1 },
                    { 35, true, 35, 1 },
                    { 36, true, 36, 1 },
                    { 37, true, 37, 1 },
                    { 38, true, 38, 1 },
                    { 39, true, 39, 1 },
                    { 40, true, 40, 1 },
                    { 41, true, 41, 1 },
                    { 42, true, 42, 1 },
                    { 43, true, 43, 1 },
                    { 44, true, 44, 1 },
                    { 45, true, 45, 1 },
                    { 46, true, 46, 1 },
                    { 47, true, 47, 1 },
                    { 48, true, 48, 1 },
                    { 49, true, 49, 1 },
                    { 50, true, 50, 1 },
                    { 51, true, 21, 6 },
                    { 52, true, 22, 6 },
                    { 53, true, 23, 6 },
                    { 54, true, 21, 3 },
                    { 55, true, 22, 3 },
                    { 56, true, 23, 3 },
                    { 57, true, 21, 2 },
                    { 58, true, 22, 2 },
                    { 59, true, 23, 2 },
                    { 60, true, 1, 6 },
                    { 61, true, 2, 6 },
                    { 62, true, 3, 6 },
                    { 63, true, 4, 6 },
                    { 64, true, 5, 6 },
                    { 65, true, 6, 6 },
                    { 66, true, 7, 6 },
                    { 67, true, 8, 6 },
                    { 68, true, 9, 6 },
                    { 69, true, 10, 6 },
                    { 70, true, 11, 6 },
                    { 71, true, 12, 6 },
                    { 72, true, 13, 6 },
                    { 73, true, 1, 9 },
                    { 74, true, 2, 9 },
                    { 75, true, 3, 9 },
                    { 76, true, 4, 9 },
                    { 77, true, 5, 9 },
                    { 78, true, 6, 9 },
                    { 79, true, 7, 9 },
                    { 80, true, 8, 9 },
                    { 81, true, 9, 9 },
                    { 82, true, 10, 9 },
                    { 83, true, 11, 9 },
                    { 84, true, 12, 9 },
                    { 85, true, 13, 9 },
                    { 86, true, 1, 8 },
                    { 87, true, 2, 8 },
                    { 88, true, 3, 8 },
                    { 89, true, 4, 8 },
                    { 90, true, 5, 8 },
                    { 91, true, 6, 8 },
                    { 92, true, 7, 8 },
                    { 93, true, 8, 8 },
                    { 94, true, 9, 8 },
                    { 95, true, 10, 8 },
                    { 96, true, 11, 8 },
                    { 97, true, 12, 8 },
                    { 98, true, 13, 8 },
                    { 99, true, 1, 12 },
                    { 100, true, 2, 12 },
                    { 101, true, 3, 12 },
                    { 102, true, 4, 12 },
                    { 103, true, 5, 12 },
                    { 104, true, 6, 12 },
                    { 105, true, 7, 12 },
                    { 106, true, 8, 12 },
                    { 107, true, 9, 12 },
                    { 108, true, 10, 12 },
                    { 109, true, 11, 12 },
                    { 110, true, 12, 12 },
                    { 111, true, 13, 12 },
                    { 112, true, 1, 3 },
                    { 113, true, 2, 3 },
                    { 114, true, 3, 3 },
                    { 115, true, 4, 3 },
                    { 116, true, 5, 3 },
                    { 117, true, 6, 3 },
                    { 118, true, 7, 3 },
                    { 119, true, 8, 3 },
                    { 120, true, 9, 3 },
                    { 121, true, 10, 3 },
                    { 122, true, 11, 3 },
                    { 123, true, 12, 3 },
                    { 124, true, 13, 3 },
                    { 125, true, 1, 10 },
                    { 126, true, 2, 10 },
                    { 127, true, 3, 10 },
                    { 128, true, 4, 10 },
                    { 129, true, 5, 10 },
                    { 130, true, 6, 10 },
                    { 131, true, 7, 10 },
                    { 132, true, 8, 10 },
                    { 133, true, 9, 10 },
                    { 134, true, 10, 10 },
                    { 135, true, 11, 10 },
                    { 136, true, 12, 10 },
                    { 137, true, 13, 10 },
                    { 138, true, 1, 2 },
                    { 139, true, 2, 2 },
                    { 140, true, 3, 2 },
                    { 141, true, 4, 2 },
                    { 142, true, 5, 2 },
                    { 143, true, 6, 2 },
                    { 144, true, 7, 2 },
                    { 145, true, 8, 2 },
                    { 146, true, 9, 2 },
                    { 147, true, 10, 2 },
                    { 148, true, 11, 2 },
                    { 149, true, 12, 2 },
                    { 150, true, 13, 2 },
                    { 151, true, 14, 6 },
                    { 152, true, 15, 6 },
                    { 153, true, 14, 9 },
                    { 154, true, 15, 9 },
                    { 155, true, 14, 8 },
                    { 156, true, 15, 8 },
                    { 157, true, 14, 3 },
                    { 158, true, 15, 3 },
                    { 159, true, 14, 10 },
                    { 160, true, 15, 10 },
                    { 161, true, 14, 2 },
                    { 162, true, 15, 2 },
                    { 163, true, 18, 6 },
                    { 164, true, 19, 6 },
                    { 165, true, 20, 6 },
                    { 166, true, 18, 3 },
                    { 167, true, 19, 3 },
                    { 168, true, 20, 3 },
                    { 169, true, 18, 2 },
                    { 170, true, 19, 2 },
                    { 171, true, 20, 2 },
                    { 172, true, 28, 6 },
                    { 173, true, 29, 6 },
                    { 174, true, 30, 6 },
                    { 175, true, 31, 6 },
                    { 176, true, 32, 6 },
                    { 177, true, 33, 6 },
                    { 178, true, 34, 6 },
                    { 179, true, 35, 6 },
                    { 180, true, 36, 6 },
                    { 181, true, 37, 6 },
                    { 182, true, 38, 6 },
                    { 183, true, 39, 6 },
                    { 184, true, 40, 6 },
                    { 185, true, 41, 6 },
                    { 186, true, 42, 6 },
                    { 187, true, 28, 7 },
                    { 188, true, 29, 7 },
                    { 189, true, 30, 7 },
                    { 190, true, 31, 7 },
                    { 191, true, 32, 7 },
                    { 192, true, 33, 7 },
                    { 193, true, 34, 7 },
                    { 194, true, 35, 7 },
                    { 195, true, 36, 7 },
                    { 196, true, 37, 7 },
                    { 197, true, 38, 7 },
                    { 198, true, 39, 7 },
                    { 199, true, 40, 7 },
                    { 200, true, 41, 7 },
                    { 201, true, 42, 7 },
                    { 202, true, 28, 3 },
                    { 203, true, 29, 3 },
                    { 204, true, 30, 3 },
                    { 205, true, 31, 3 },
                    { 206, true, 32, 3 },
                    { 207, true, 33, 3 },
                    { 208, true, 34, 3 },
                    { 209, true, 35, 3 },
                    { 210, true, 36, 3 },
                    { 211, true, 37, 3 },
                    { 212, true, 38, 3 },
                    { 213, true, 39, 3 },
                    { 214, true, 40, 3 },
                    { 215, true, 41, 3 },
                    { 216, true, 42, 3 },
                    { 217, true, 28, 10 },
                    { 218, true, 29, 10 },
                    { 219, true, 30, 10 },
                    { 220, true, 31, 10 },
                    { 221, true, 32, 10 },
                    { 222, true, 33, 10 },
                    { 223, true, 34, 10 },
                    { 224, true, 35, 10 },
                    { 225, true, 36, 10 },
                    { 226, true, 37, 10 },
                    { 227, true, 38, 10 },
                    { 228, true, 39, 10 },
                    { 229, true, 40, 10 },
                    { 230, true, 41, 10 },
                    { 231, true, 42, 10 },
                    { 232, true, 28, 2 },
                    { 233, true, 29, 2 },
                    { 234, true, 30, 2 },
                    { 235, true, 31, 2 },
                    { 236, true, 32, 2 },
                    { 237, true, 33, 2 },
                    { 238, true, 34, 2 },
                    { 239, true, 35, 2 },
                    { 240, true, 36, 2 },
                    { 241, true, 37, 2 },
                    { 242, true, 38, 2 },
                    { 243, true, 39, 2 },
                    { 244, true, 40, 2 },
                    { 245, true, 41, 2 },
                    { 246, true, 42, 2 },
                    { 247, true, 24, 6 },
                    { 248, true, 25, 6 },
                    { 249, true, 26, 6 },
                    { 250, true, 27, 6 },
                    { 251, true, 24, 9 },
                    { 252, true, 25, 9 },
                    { 253, true, 26, 9 },
                    { 254, true, 27, 9 },
                    { 255, true, 24, 8 },
                    { 256, true, 25, 8 },
                    { 257, true, 26, 8 },
                    { 258, true, 27, 8 },
                    { 259, true, 24, 4 },
                    { 260, true, 25, 4 },
                    { 261, true, 26, 4 },
                    { 262, true, 27, 4 },
                    { 263, true, 24, 3 },
                    { 264, true, 25, 3 },
                    { 265, true, 26, 3 },
                    { 266, true, 27, 3 },
                    { 267, true, 24, 10 },
                    { 268, true, 25, 10 },
                    { 269, true, 26, 10 },
                    { 270, true, 27, 10 },
                    { 271, true, 24, 5 },
                    { 272, true, 25, 5 },
                    { 273, true, 26, 5 },
                    { 274, true, 27, 5 },
                    { 275, true, 24, 11 },
                    { 276, true, 25, 11 },
                    { 277, true, 26, 11 },
                    { 278, true, 27, 11 },
                    { 279, true, 24, 2 },
                    { 280, true, 25, 2 },
                    { 281, true, 26, 2 },
                    { 282, true, 27, 2 },
                    { 283, true, 16, 6 },
                    { 284, true, 17, 6 },
                    { 285, true, 16, 9 },
                    { 286, true, 17, 9 },
                    { 287, true, 16, 8 },
                    { 288, true, 17, 8 },
                    { 289, true, 16, 3 },
                    { 290, true, 17, 3 },
                    { 291, true, 16, 10 },
                    { 292, true, 17, 10 },
                    { 293, true, 16, 2 },
                    { 294, true, 17, 2 },
                    { 295, true, 43, 6 },
                    { 296, true, 44, 6 },
                    { 297, true, 45, 6 },
                    { 298, true, 46, 6 },
                    { 299, true, 47, 6 },
                    { 300, true, 48, 6 },
                    { 301, true, 49, 6 },
                    { 302, true, 50, 6 },
                    { 303, true, 43, 2 },
                    { 304, true, 44, 2 },
                    { 305, true, 45, 2 },
                    { 306, true, 46, 2 },
                    { 307, true, 47, 2 },
                    { 308, true, 48, 2 },
                    { 309, true, 49, 2 },
                    { 310, true, 50, 2 }
                });

            migrationBuilder.InsertData(
                table: "Users",
                columns: new[] { "Id", "Avatar", "Bakim", "Carikodu", "CreateTime", "CreateUser", "Departman", "Depokodu", "Dogumtarihi", "Durum", "EditTime", "EditUser", "Gsm", "IsActive", "KasaKodu", "LastLoginAt", "MagazaKasa", "Mail", "Password", "Plasiyerkodu", "RoleId", "Stokgrup", "Stokgrup2", "Subekodu", "Unvan", "UpdatedAt", "Username", "UstCariKodu", "YetkiAck" },
                values: new object[] { 1, null, null, null, new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Utc), "System", null, null, null, null, null, null, "+905551234567", true, null, null, null, "superadmin@b2berp.com", "password123", null, 1, null, null, null, "Sistem Yöneticisi", null, "superadmin", null, null });

            migrationBuilder.CreateIndex(
                name: "IX_CashAccounts_Code",
                table: "CashAccounts",
                column: "Code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Customers_ParentCustomerCode",
                table: "Customers",
                column: "ParentCustomerCode");

            migrationBuilder.CreateIndex(
                name: "IX_Customers_PriceGroupId",
                table: "Customers",
                column: "PriceGroupId");

            migrationBuilder.CreateIndex(
                name: "IX_Pages_ModuleKey_Key",
                table: "Pages",
                columns: new[] { "ModuleKey", "Key" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PriceGroups_Code",
                table: "PriceGroups",
                column: "Code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ProductPrices_PriceGroupId",
                table: "ProductPrices",
                column: "PriceGroupId");

            migrationBuilder.CreateIndex(
                name: "IX_ProductPrices_ProductId_PriceGroupId",
                table: "ProductPrices",
                columns: new[] { "ProductId", "PriceGroupId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Products_StockCode",
                table: "Products",
                column: "StockCode",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_RefreshTokens_Token",
                table: "RefreshTokens",
                column: "Token",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_RefreshTokens_UserId",
                table: "RefreshTokens",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_RolePagePermissions_PageId",
                table: "RolePagePermissions",
                column: "PageId");

            migrationBuilder.CreateIndex(
                name: "IX_RolePagePermissions_RoleId_PageId",
                table: "RolePagePermissions",
                columns: new[] { "RoleId", "PageId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Roles_Code",
                table: "Roles",
                column: "Code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Roles_Name",
                table: "Roles",
                column: "Name",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Users_Mail",
                table: "Users",
                column: "Mail",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Users_RoleId",
                table: "Users",
                column: "RoleId");

            migrationBuilder.CreateIndex(
                name: "IX_Users_Username",
                table: "Users",
                column: "Username",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CashAccounts");

            migrationBuilder.DropTable(
                name: "Customers");

            migrationBuilder.DropTable(
                name: "ProductPrices");

            migrationBuilder.DropTable(
                name: "RefreshTokens");

            migrationBuilder.DropTable(
                name: "RolePagePermissions");

            migrationBuilder.DropTable(
                name: "Salesmen");

            migrationBuilder.DropTable(
                name: "StockGroups");

            migrationBuilder.DropTable(
                name: "Warehouses");

            migrationBuilder.DropTable(
                name: "PriceGroups");

            migrationBuilder.DropTable(
                name: "Products");

            migrationBuilder.DropTable(
                name: "Users");

            migrationBuilder.DropTable(
                name: "Pages");

            migrationBuilder.DropTable(
                name: "Roles");
        }
    }
}
