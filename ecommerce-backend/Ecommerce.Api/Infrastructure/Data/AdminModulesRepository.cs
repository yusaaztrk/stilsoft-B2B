using Npgsql;
using System.Text.Json;

namespace Ecommerce.Api.Infrastructure.Data;

public sealed class AdminModulesRepository
{
    private readonly string _connStr;

    public AdminModulesRepository(IConfiguration config)
    {
        _connStr = config.GetConnectionString("EcommerceDb") ?? string.Empty;
        if (string.IsNullOrWhiteSpace(_connStr))
            throw new InvalidOperationException("ConnectionStrings:EcommerceDb must be configured.");
    }

    public async Task EnsureCreatedAsync(CancellationToken cancellationToken)
    {
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
        -- Invoices Table
        CREATE TABLE IF NOT EXISTS admin_invoices (
          id uuid PRIMARY KEY,
          invoice_no text NOT NULL UNIQUE,
          order_no text NOT NULL,
          customer_name text NOT NULL,
          total numeric(18,2) NOT NULL,
          tax numeric(18,2) NOT NULL,
          status text NOT NULL,
          created_at_utc timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
        );

        -- Payments Table
        CREATE TABLE IF NOT EXISTS admin_payments (
          id uuid PRIMARY KEY,
          txn_id text NOT NULL UNIQUE,
          order_no text NOT NULL,
          customer_name text NOT NULL,
          amount numeric(18,2) NOT NULL,
          method text NOT NULL,
          status text NOT NULL,
          created_at_utc timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
        );

        -- Shipping Table
        CREATE TABLE IF NOT EXISTS admin_shipping (
          id uuid PRIMARY KEY,
          order_no text NOT NULL UNIQUE,
          customer_name text NOT NULL,
          carrier text NOT NULL,
          tracking_no text NOT NULL,
          shipped_at timestamptz NOT NULL,
          delivery_date timestamptz NULL,
          status text NOT NULL
        );

        -- Returns Table
        CREATE TABLE IF NOT EXISTS admin_returns (
          id uuid PRIMARY KEY,
          return_no text NOT NULL UNIQUE,
          order_no text NOT NULL,
          customer_name text NOT NULL,
          product_name text NOT NULL,
          reason text NOT NULL,
          amount numeric(18,2) NOT NULL,
          status text NOT NULL,
          created_at_utc timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
        );

        -- Reviews Table
        CREATE TABLE IF NOT EXISTS admin_reviews (
          id uuid PRIMARY KEY,
          product_id uuid NOT NULL,
          product_name text NOT NULL,
          customer_name text NOT NULL,
          rating integer NOT NULL,
          comment text NOT NULL,
          status text NOT NULL,
          created_at_utc timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
        );

        ALTER TABLE admin_reviews ADD COLUMN IF NOT EXISTS customer_email text NOT NULL DEFAULT '';
        ALTER TABLE admin_reviews ADD COLUMN IF NOT EXISTS admin_reply text;
        ALTER TABLE admin_shipping ADD COLUMN IF NOT EXISTS history_json text;

        -- Affiliates Table
        CREATE TABLE IF NOT EXISTS admin_affiliates (
          id uuid PRIMARY KEY,
          name text NOT NULL,
          email text NOT NULL,
          code text NOT NULL UNIQUE,
          clicks integer NOT NULL DEFAULT 0,
          sales integer NOT NULL DEFAULT 0,
          conversion_rate numeric(5,2) NOT NULL DEFAULT 0,
          earnings numeric(18,2) NOT NULL DEFAULT 0,
          status text NOT NULL
        );

        -- Integrations Table
        CREATE TABLE IF NOT EXISTS admin_integrations (
          key text PRIMARY KEY,
          value_json text NOT NULL
        );

        -- Notifications Table
        CREATE TABLE IF NOT EXISTS admin_notifications (
          id uuid PRIMARY KEY,
          type text NOT NULL,
          title text NOT NULL,
          message text NOT NULL,
          is_read boolean NOT NULL DEFAULT false,
          link text NOT NULL,
          created_at_utc timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
        );

        -- Member Addresses Table
        CREATE TABLE IF NOT EXISTS member_addresses (
          id uuid PRIMARY KEY,
          user_id uuid NOT NULL REFERENCES ecommerce_users(id) ON DELETE CASCADE,
          title text NOT NULL,
          full_name text NOT NULL,
          phone text NOT NULL,
          city text NOT NULL,
          district text NOT NULL,
          details text NOT NULL,
          created_at_utc timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
        );

        ALTER TABLE member_addresses ADD COLUMN IF NOT EXISTS region text NOT NULL DEFAULT '';
        ALTER TABLE member_addresses ADD COLUMN IF NOT EXISTS mahalle text NOT NULL DEFAULT '';
        ALTER TABLE member_addresses ADD COLUMN IF NOT EXISTS bina_no text NOT NULL DEFAULT '';
        ALTER TABLE member_addresses ADD COLUMN IF NOT EXISTS daire_no text NOT NULL DEFAULT '';
        ALTER TABLE member_addresses ADD COLUMN IF NOT EXISTS kat_no text NOT NULL DEFAULT '';

        -- Technical Service Requests Table
        CREATE TABLE IF NOT EXISTS technical_service_requests (
          id uuid PRIMARY KEY,
          user_id uuid NOT NULL REFERENCES ecommerce_users(id) ON DELETE CASCADE,
          full_name text NOT NULL,
          phone text NOT NULL,
          product_group text NOT NULL,
          model_no text NOT NULL,
          description text NOT NULL,
          status text NOT NULL DEFAULT 'Bekliyor',
          created_at_utc timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
        );

        ALTER TABLE technical_service_requests ALTER COLUMN user_id DROP NOT NULL;

        -- Sold Product Warranties Table
        CREATE TABLE IF NOT EXISTS sold_product_warranties (
          id uuid PRIMARY KEY,
          user_id uuid NULL REFERENCES ecommerce_users(id) ON DELETE SET NULL,
          customer_name text NOT NULL,
          customer_email text NOT NULL,
          product_id uuid NOT NULL,
          product_name text NOT NULL,
          warranty_code text NOT NULL UNIQUE,
          warranty_months integer NOT NULL,
          sold_date timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
          status text NOT NULL DEFAULT 'Active'
        );

        -- Coupons Table
        CREATE TABLE IF NOT EXISTS coupons (
          id uuid PRIMARY KEY,
          code text NOT NULL UNIQUE,
          user_id uuid NULL REFERENCES ecommerce_users(id) ON DELETE SET NULL,
          discount_type text NOT NULL,
          discount_value numeric(18,2) NOT NULL,
          min_order_amount numeric(18,2) NOT NULL DEFAULT 0,
          max_discount_amount numeric(18,2) NULL,
          applicable_product_id uuid NULL,
          applicable_category_id uuid NULL,
          valid_from timestamptz NOT NULL,
          valid_until timestamptz NOT NULL,
          usage_limit integer NOT NULL DEFAULT 1,
          used_count integer NOT NULL DEFAULT 0,
          is_active boolean NOT NULL DEFAULT true,
          description text NULL,
          created_at_utc timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
        );

        -- Coupon Usages Table
        CREATE TABLE IF NOT EXISTS coupon_usages (
          id uuid PRIMARY KEY,
          coupon_id uuid NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
          user_id uuid NOT NULL REFERENCES ecommerce_users(id) ON DELETE CASCADE,
          order_id uuid NOT NULL,
          used_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
        );

        -- Coupon Customers Table
        CREATE TABLE IF NOT EXISTS coupon_customers (
          coupon_id uuid NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
          user_id uuid NOT NULL REFERENCES ecommerce_users(id) ON DELETE CASCADE,
          PRIMARY KEY (coupon_id, user_id)
        );

        -- Registered Products Table
        CREATE TABLE IF NOT EXISTS registered_products (
          id uuid PRIMARY KEY,
          user_id uuid NOT NULL REFERENCES ecommerce_users(id) ON DELETE CASCADE,
          product_id uuid NOT NULL,
          product_name text NOT NULL,
          serial_number text NOT NULL,
          created_at_utc timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
        );

        -- Pending Registrations Table
        CREATE TABLE IF NOT EXISTS pending_registrations (
          id uuid PRIMARY KEY,
          email text NOT NULL UNIQUE,
          full_name text NOT NULL,
          phone text NOT NULL,
          password_hash text NOT NULL,
          code text NOT NULL,
          created_at_utc timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
        );

        -- Password Resets Table
        CREATE TABLE IF NOT EXISTS password_resets (
          id uuid PRIMARY KEY,
          email text NOT NULL,
          token text NOT NULL UNIQUE,
          created_at_utc timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
        );

        -- Blog Posts Table
        CREATE TABLE IF NOT EXISTS blog_posts (
          id uuid PRIMARY KEY,
          title text NOT NULL,
          slug text NOT NULL UNIQUE,
          content text NOT NULL,
          image_url text NOT NULL DEFAULT '',
          meta_title text NOT NULL DEFAULT '',
          meta_description text NOT NULL DEFAULT '',
          read_time_minutes integer NOT NULL DEFAULT 5,
          is_published boolean NOT NULL DEFAULT true,
          created_at_utc timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
          updated_at_utc timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
        );
        ";
        await cmd.ExecuteNonQueryAsync(cancellationToken);

        // Delete mock reviews if any exist
        cmd.CommandText = "DELETE FROM admin_reviews WHERE id IN ('6f8e71b2-1323-4554-b586-778809090ee1', '6f8e71b2-1323-4554-b586-778809090ee2', '6f8e71b2-1323-4554-b586-778809090ee3', '6f8e71b2-1323-4554-b586-778809090ee4', '6f8e71b2-1323-4554-b586-778809090ee5', '6f8e71b2-1323-4554-b586-778809090ee6');";
        await cmd.ExecuteNonQueryAsync(cancellationToken);

        // Seed data if tables are empty
        await SeedDataAsync(conn, cancellationToken);
    }

    private async Task SeedDataAsync(NpgsqlConnection conn, CancellationToken cancellationToken)
    {
        // 1. Seed Invoices
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT COUNT(*) FROM admin_invoices";
            var count = Convert.ToInt64(await cmd.ExecuteScalarAsync(cancellationToken));
            if (count == 0)
            {
                cmd.CommandText = @"
                INSERT INTO admin_invoices (id, invoice_no, order_no, customer_name, total, tax, status, created_at_utc) VALUES
                ('6f8e71b2-1323-4554-b586-778809090aa1', 'FTR-2025-10234', '#10234', 'Ahmet Yılmaz', 76462.00, 11664.00, 'Paid', '2025-06-06 14:20:00+00'),
                ('6f8e71b2-1323-4554-b586-778809090aa2', 'FTR-2025-10233', '#10233', 'Selin Demir', 890.50, 134.99, 'Paid', '2025-06-06 13:45:00+00'),
                ('6f8e71b2-1323-4554-b586-778809090aa3', 'FTR-2025-10232', '#10232', 'Mehmet Can', 3420.00, 521.69, 'Paid', '2025-06-06 11:10:00+00'),
                ('6f8e71b2-1323-4554-b586-778809090aa4', 'FTR-2025-10231', '#10231', 'Fatma Şahin', 540.00, 82.37, 'Pending', '2025-06-06 10:05:00+00'),
                ('6f8e71b2-1323-4554-b586-778809090aa5', 'FTR-2025-10229', '#10229', 'Zeynep Arslan', 2499.00, 380.36, 'Paid', '2025-06-05 18:15:00+00');";
                await cmd.ExecuteNonQueryAsync(cancellationToken);
            }
        }

        // 2. Seed Payments
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT COUNT(*) FROM admin_payments";
            var count = Convert.ToInt64(await cmd.ExecuteScalarAsync(cancellationToken));
            if (count == 0)
            {
                cmd.CommandText = @"
                INSERT INTO admin_payments (id, txn_id, order_no, customer_name, amount, method, status, created_at_utc) VALUES
                ('6f8e71b2-1323-4554-b586-778809090bb1', 'TXN-2025-10234', '#10234', 'Ahmet Yılmaz', 76462.00, 'Kredi Kartı', 'Success', '2025-06-06 14:20:00+00'),
                ('6f8e71b2-1323-4554-b586-778809090bb2', 'TXN-2025-10233', '#10233', 'Selin Demir', 890.50, 'Kredi Kartı', 'Success', '2025-06-06 13:45:00+00'),
                ('6f8e71b2-1323-4554-b586-778809090bb3', 'TXN-2025-10232', '#10232', 'Mehmet Can', 3420.00, 'Havale/EFT', 'Success', '2025-06-06 11:10:00+00'),
                ('6f8e71b2-1323-4554-b586-778809090bb4', 'TXN-2025-10231', '#10231', 'Fatma Şahin', 540.00, 'Kredi Kartı', 'Failed', '2025-06-06 10:05:00+00');";
                await cmd.ExecuteNonQueryAsync(cancellationToken);
            }
        }

        // 3. Seed Shipping
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT COUNT(*) FROM admin_shipping";
            var count = Convert.ToInt64(await cmd.ExecuteScalarAsync(cancellationToken));
            if (count == 0)
            {
                cmd.CommandText = @"
                INSERT INTO admin_shipping (id, order_no, customer_name, carrier, tracking_no, shipped_at, delivery_date, status) VALUES
                ('6f8e71b2-1323-4554-b586-778809090cc1', '#10233', 'Selin Demir', 'Yurtiçi Kargo', 'YK4421889', '2025-06-05 10:00:00+00', '2025-06-07 18:00:00+00', 'InTransit'),
                ('6f8e71b2-1323-4554-b586-778809090cc2', '#10230', 'Ali Koç', 'Aras Kargo', 'AR9912345', '2025-06-04 10:00:00+00', '2025-06-06 18:00:00+00', 'Delayed'),
                ('6f8e71b2-1323-4554-b586-778809090cc3', '#10226', 'Hasan Çelik', 'Yurtiçi Kargo', 'YK3318776', '2025-06-04 10:00:00+00', '2025-06-06 18:00:00+00', 'InTransit'),
                ('6f8e71b2-1323-4554-b586-778809090cc4', '#10220', 'Elif Yılmaz', 'MNG Kargo', 'MNG7712', '2025-06-03 10:00:00+00', '2025-06-05 18:00:00+00', 'Delivered'),
                ('6f8e71b2-1323-4554-b586-778809090cc5', '#10218', 'Caner Doğan', 'PTT Kargo', 'PT9921', '2025-06-03 10:00:00+00', '2025-06-07 18:00:00+00', 'Shipped');";
                await cmd.ExecuteNonQueryAsync(cancellationToken);
            }
        }

        // 4. Seed Returns
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT COUNT(*) FROM admin_returns";
            var count = Convert.ToInt64(await cmd.ExecuteScalarAsync(cancellationToken));
            if (count == 0)
            {
                cmd.CommandText = @"
                INSERT INTO admin_returns (id, return_no, order_no, customer_name, product_name, reason, amount, status, created_at_utc) VALUES
                ('6f8e71b2-1323-4554-b586-778809090dd1', '#IAD-089', '#10228', 'Burak Güneş', 'Sony WH-1000XM5', 'Arızalı', 8499.00, 'Requested', '2025-06-05 11:20:00+00'),
                ('6f8e71b2-1323-4554-b586-778809090dd2', '#IAD-088', '#10221', 'Deniz Aydın', 'Nike Air Max 270', 'Beden Uygunsuz', 4299.00, 'Reviewing', '2025-06-05 10:15:00+00'),
                ('6f8e71b2-1323-4554-b586-778809090dd3', '#IAD-087', '#10215', 'Hüseyin Demir', 'Philips Airfryer XXL', 'Hasarlı', 6799.00, 'Approved', '2025-06-04 09:30:00+00'),
                ('6f8e71b2-1323-4554-b586-778809090dd4', '#IAD-086', '#10204', 'Leyla Kaya', 'Bosch Kahve', 'Beklentiyi Karşılamadı', 12499.00, 'Rejected', '2025-06-03 14:40:00+00'),
                ('6f8e71b2-1323-4554-b586-778809090dd5', '#IAD-085', '#10198', 'Ozan Çelik', 'Levi''s 501', 'Renk Farklı', 2499.00, 'Completed', '2025-06-02 16:00:00+00');";
                await cmd.ExecuteNonQueryAsync(cancellationToken);
            }
        }



        // 6. Seed Affiliates
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT COUNT(*) FROM admin_affiliates";
            var count = Convert.ToInt64(await cmd.ExecuteScalarAsync(cancellationToken));
            if (count == 0)
            {
                cmd.CommandText = @"
                INSERT INTO admin_affiliates (id, name, email, code, clicks, sales, conversion_rate, earnings, status) VALUES
                ('6f8e71b2-1323-4554-b586-778809090ff1', 'Berk Kaya', 'berk@blog.com', 'BERK20', 4821, 142, 8.00, 4280.00, 'Paid'),
                ('6f8e71b2-1323-4554-b586-778809090ff2', 'Sena Yıldız', 'sena@blog.com', 'SENA15', 2341, 87, 6.00, 2610.00, 'Pending'),
                ('6f8e71b2-1323-4554-b586-778809090ff3', 'Mert Toprak', 'mert@blog.com', 'MERT10', 1892, 54, 5.00, 1620.00, 'Pending'),
                ('6f8e71b2-1323-4554-b586-778809090ff4', 'Aslı Fidan', 'asli@blog.com', 'ASLI20', 987, 23, 8.00, 920.00, 'Paid');";
                await cmd.ExecuteNonQueryAsync(cancellationToken);
            }
        }

        // 7. Seed Notifications
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT COUNT(*) FROM admin_notifications";
            var count = Convert.ToInt64(await cmd.ExecuteScalarAsync(cancellationToken));
            if (count == 0)
            {
                cmd.CommandText = @"
                INSERT INTO admin_notifications (id, type, title, message, is_read, link, created_at_utc) VALUES
                ('6f8e71b2-1323-4554-b586-778809090911', 'order', 'Yeni sipariş #10234', 'Ahmet Yılmaz ₺1.240 sipariş verdi', false, '/admin/orders', (now() AT TIME ZONE 'utc' - interval '5 minutes')),
                ('6f8e71b2-1323-4554-b586-778809090912', 'stock', 'Pro-Power Blender stok kritik', 'Kritik stok seviyesinin altında (Son 3 adet)', false, '/admin/inventory', (now() AT TIME ZONE 'utc' - interval '28 minutes')),
                ('6f8e71b2-1323-4554-b586-778809090913', 'review', 'Emre Yıldız yeni yorum', 'Ultra-Blend 5000 ürününe 5 yıldızlı yorum yapıldı', false, '/admin/reviews', (now() AT TIME ZONE 'utc' - interval '1 hour')),
                ('6f8e71b2-1323-4554-b586-778809090914', 'return', 'İade #IAD-089', 'Burak Güneş Sony kulaklık için iade talebinde bulundu', true, '/admin/returns', (now() AT TIME ZONE 'utc' - interval '2 hours')),
                ('6f8e71b2-1323-4554-b586-778809090915', 'customer', 'Zeynep Arslan yeni üye', 'Zeynep Arslan sisteme yeni kayıt oldu.', true, '/admin/customers', (now() AT TIME ZONE 'utc' - interval '14 hours'));";
                await cmd.ExecuteNonQueryAsync(cancellationToken);
            }
        }
    }

    // --- Query Implementations ---

    public async Task<List<Dictionary<string, object>>> QuerySqlAsync(string sql, object? parameters = null, CancellationToken cancellationToken = default)
    {
        var result = new List<Dictionary<string, object>>();
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;

        if (parameters != null)
        {
            foreach (var prop in parameters.GetType().GetProperties())
            {
                cmd.Parameters.AddWithValue(prop.Name, prop.GetValue(parameters) ?? DBNull.Value);
            }
        }

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            var row = new Dictionary<string, object>();
            for (int i = 0; i < reader.FieldCount; i++)
            {
                row[reader.GetName(i)] = reader.IsDBNull(i) ? null! : reader.GetValue(i);
            }
            result.Add(row);
        }
        return result;
    }

    public async Task<int> ExecuteSqlAsync(string sql, object? parameters = null, CancellationToken cancellationToken = default)
    {
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;

        if (parameters != null)
        {
            foreach (var prop in parameters.GetType().GetProperties())
            {
                cmd.Parameters.AddWithValue(prop.Name, prop.GetValue(parameters) ?? DBNull.Value);
            }
        }

        return await cmd.ExecuteNonQueryAsync(cancellationToken);
    }
}
