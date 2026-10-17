using Npgsql;
using Shop.Api.Infrastructure;

namespace Shop.Api.Members;

/// <summary>
/// Mağazanın kendi veritabanını hazırlar.
///
/// Burada YALNIZCA mağazaya ait veri durur: üye hesabı, oturum, favori, vitrin içeriği.
/// Ürün, stok, fiyat, cari, sipariş ve fatura ERP'de; ikinci bir kopyası burada tutulmaz —
/// iki sahipli veri, er ya da geç birbirini tutmaz.
///
/// Şema açılışta kuruluyor: ServiceOps'ta da aynı desen var ve firma veritabanı eklemenin
/// elle adım gerektirmemesi, unutulan bir kurulum adımından iyi.
/// </summary>
public sealed class ShopSchema
{
    private readonly TenantResolver _tenant;
    private static readonly HashSet<string> Prepared = new(StringComparer.OrdinalIgnoreCase);
    private static readonly SemaphoreSlim Gate = new(1, 1);

    public ShopSchema(TenantResolver tenant)
    {
        _tenant = tenant;
    }

    public async Task EnsureAsync(CancellationToken ct = default)
    {
        var dbName = _tenant.ShopDatabaseName();
        if (Prepared.Contains(dbName)) return;

        await Gate.WaitAsync(ct);
        try
        {
            if (Prepared.Contains(dbName)) return;

            await EnsureDatabaseAsync(dbName, ct);
            await EnsureTablesAsync(ct);

            Prepared.Add(dbName);
        }
        finally
        {
            Gate.Release();
        }
    }

    private async Task EnsureDatabaseAsync(string dbName, CancellationToken ct)
    {
        await using var conn = new NpgsqlConnection(_tenant.BuildConnectionString("postgres"));
        await conn.OpenAsync(ct);

        await using (var check = new NpgsqlCommand("SELECT COUNT(1) FROM pg_database WHERE datname = @db", conn))
        {
            check.Parameters.AddWithValue("db", dbName);
            var exists = Convert.ToInt32(await check.ExecuteScalarAsync(ct)) > 0;
            if (exists) return;
        }

        // Veritabanı adı parametre olamaz; adı biz ürettiğimiz için (firma kodundan, harf/rakam
        // dışındakiler ayıklanarak) dışarıdan gelen bir metin değil.
        await using var create = new NpgsqlCommand($"CREATE DATABASE \"{dbName}\"", conn);
        await create.ExecuteNonQueryAsync(ct);
    }

    private async Task EnsureTablesAsync(CancellationToken ct)
    {
        await using var conn = new NpgsqlConnection(_tenant.ShopConnectionString());
        await conn.OpenAsync(ct);

        await using var cmd = new NpgsqlCommand("""
            CREATE TABLE IF NOT EXISTS public.members (
              id             uuid PRIMARY KEY,
              email          text NOT NULL,
              password_hash  text NOT NULL,
              full_name      text NOT NULL,
              phone          text NULL,
              customer_code  text NULL,
              is_active      boolean NOT NULL DEFAULT true,
              created_at     timestamptz NOT NULL,
              last_login_at  timestamptz NULL
            );

            CREATE UNIQUE INDEX IF NOT EXISTS ux_members_email ON public.members (lower(email));
            CREATE INDEX IF NOT EXISTS ix_members_customer_code ON public.members (customer_code);

            CREATE TABLE IF NOT EXISTS public.member_sessions (
              token       text PRIMARY KEY,
              member_id   uuid NOT NULL REFERENCES public.members (id) ON DELETE CASCADE,
              created_at  timestamptz NOT NULL,
              expires_at  timestamptz NOT NULL,
              user_agent  text NULL
            );

            CREATE INDEX IF NOT EXISTS ix_member_sessions_member ON public.member_sessions (member_id);

            -- Şifre sıfırlama talepleri için tek kullanımlık süreli token tablosu.
            CREATE TABLE IF NOT EXISTS public.password_reset_tokens (
              token       text PRIMARY KEY,
              member_id   uuid NOT NULL REFERENCES public.members (id) ON DELETE CASCADE,
              created_at  timestamptz NOT NULL DEFAULT now(),
              expires_at  timestamptz NOT NULL,
              used_at     timestamptz NULL
            );

            CREATE INDEX IF NOT EXISTS ix_password_reset_tokens_member ON public.password_reset_tokens (member_id);

            -- SMS DOĞRULAMA (kayıt telefonu + şifre sıfırlama).
            --
            -- NEDEN TABLO, RAM DEĞİL: ERP tarafındaki OTP bir `ConcurrentDictionary` içinde
            -- duruyor; süreç yeniden başladığında bekleyen bütün kodlar uçuyor ve ikinci bir
            -- kopya çalıştırıldığında kod bir örnekte üretilip diğerinde doğrulanamıyor.
            -- Mağazanın oturumu zaten veritabanında; doğrulama da orada durmalı.
            --
            -- KOD HASH'LENİR (`code_hash`), düz saklanmaz. Veritabanını okuyabilen biri
            -- bekleyen doğrulama kodlarını göremesin — şifrelerde uygulanan kuralın aynısı.
            --
            -- BİLET (`ticket`): kod doğrulandığında üretilen kısa ömürlü anahtar. "Telefonun
            -- sahibi olduğunu kanıtladın" ile "hesabı aç / şifreyi değiştir" ayrı adımlar;
            -- böylece kod yeni şifreyle birlikte taşınmıyor ve arayüz doğrulamayı ayrı
            -- gösterebiliyor. Tek kullanımlık: `ticket_used_at` damgalanır.
            CREATE TABLE IF NOT EXISTS public.sms_verifications (
              id                 uuid PRIMARY KEY,
              phone              text NOT NULL,
              purpose            text NOT NULL,
              code_hash          text NOT NULL,
              member_id          uuid NULL REFERENCES public.members (id) ON DELETE CASCADE,
              created_at         timestamptz NOT NULL DEFAULT now(),
              expires_at         timestamptz NOT NULL,
              attempts           integer NOT NULL DEFAULT 0,
              verified_at        timestamptz NULL,
              ticket             text NULL,
              ticket_expires_at  timestamptz NULL,
              ticket_used_at     timestamptz NULL,
              client_key         text NULL
            );

            CREATE INDEX IF NOT EXISTS ix_sms_verifications_phone
              ON public.sms_verifications (phone, purpose, created_at DESC);
            CREATE INDEX IF NOT EXISTS ix_sms_verifications_ticket
              ON public.sms_verifications (ticket);

            -- Telefonu doğrulanmış üye işareti. Var olan üyeler `false` başlar; SMS
            -- doğrulaması kapalıyken bu alan kimseyi engellemez (bkz. AccountController).
            ALTER TABLE public.members
              ADD COLUMN IF NOT EXISTS phone_verified boolean NOT NULL DEFAULT false;

            -- KULLANILMIYOR (2026-08-08 itibarıyla). Çok adresli teslimat düşünülerek açılmıştı
            -- ama akış tek adrese bağlandı: teslimat adresi carinin kartından okunuyor ve fatura
            -- da oraya kesiliyor. Tablo silinmedi çünkü çok adres ileride gerekebilir; ama
            -- HİÇBİR KOD BURAYA YAZMIYOR — dolu sanıp okuyan biri hep boş sonuç alır.
            CREATE TABLE IF NOT EXISTS public.member_addresses (
              id          uuid PRIMARY KEY,
              member_id   uuid NOT NULL REFERENCES public.members (id) ON DELETE CASCADE,
              title       text NOT NULL,
              full_name   text NOT NULL,
              phone       text NOT NULL,
              city        text NULL,
              district    text NULL,
              address     text NOT NULL,
              is_default  boolean NOT NULL DEFAULT false,
              created_at  timestamptz NOT NULL
            );

            CREATE INDEX IF NOT EXISTS ix_member_addresses_member ON public.member_addresses (member_id);

            -- Vitrin içeriği tek satır JSON: alanlar sık değişecek, her yeni alan için
            -- tablo değiştirmek gereksiz.
            CREATE TABLE IF NOT EXISTS public.storefront_settings (
              id          integer PRIMARY KEY,
              payload     text NOT NULL,
              updated_at  timestamptz NOT NULL,
              updated_by  text NULL
            );

            -- Yayın kuralına uyduğu hâlde bayiden elle kapatılan ürünler.
            CREATE TABLE IF NOT EXISTS public.hidden_products (
              stock_code  text PRIMARY KEY,
              hidden_at   timestamptz NOT NULL,
              hidden_by   text NULL
            );

            -- Sepet.
            --
            -- ERP'nin kendi sepet uçları BAYİ kullanıcısına bağlı (oturumdaki kullanıcı adı ve
            -- cari koddan çalışıyor); e-ticaret müşterisinin B2B kullanıcısı yok. O yüzden sepet
            -- burada duruyor. Kritik olan şu: satırda FİYAT TUTULMUYOR — yalnızca stok kodu ve
            -- adet. Fiyat her okumada ERP verisinden yeniden çözülüyor, böylece sepette bekleyen
            -- eski fiyatla sipariş verilmesi mümkün değil.
            CREATE TABLE IF NOT EXISTS public.cart_items (
              member_id   uuid NOT NULL REFERENCES public.members (id) ON DELETE CASCADE,
              stock_code  text NOT NULL,
              quantity    integer NOT NULL CHECK (quantity > 0),
              added_at    timestamptz NOT NULL,
              PRIMARY KEY (member_id, stock_code)
            );

            -- MONTAJ SEÇİMİ SEPET SATIRINDA DURUR.
            --
            -- Önceden montaj bedeli, ürün montajlıysa OTOMATİK ekleniyordu: müşteriye hiç
            -- sorulmuyor, montaj istemeyen de bedeli ödüyor, montaj ekibi istenmeyen bir
            -- randevu için yola çıkıyordu. B2B sipariş ekranında bu seçim baştan beri var
            -- ("Montaj istiyorum / istemiyorum"); vitrin aynı davranışa getirildi.
            --
            -- Varsayılan FALSE: seçilmeyen montaj için para alınmaz. Eski sepet satırları da
            -- bu yüzden montajsız sayılır — müşterinin onaylamadığı bir bedeli ona yazmaktansa
            -- montajı hiç açmamak doğru.
            ALTER TABLE public.cart_items
              ADD COLUMN IF NOT EXISTS wants_installation boolean NOT NULL DEFAULT false;

            -- Ödeme bekleyen sipariş.
            --
            -- Sipariş ödemeden ÖNCE ERP'de doğuyor (akış böyle kararlaştırıldı). Kullanıcı
            -- "sipariş ver"e iki kez basarsa ya da ödeme sayfasını yenilerse ikinci bir sipariş
            -- açılmamalı. Burada üyenin bekleyen siparişi ve sepetin o anki parmak izi tutuluyor:
            -- sepet aynıysa var olan sipariş geri veriliyor, yenisi açılmıyor.
            CREATE TABLE IF NOT EXISTS public.pending_orders (
              member_id         uuid PRIMARY KEY REFERENCES public.members (id) ON DELETE CASCADE,
              order_no          text NOT NULL,
              grand_total       numeric(18,2) NOT NULL,
              cart_fingerprint  text NOT NULL,
              created_at        timestamptz NOT NULL
            );

            -- Sipariş olay kaydı.
            --
            -- "Müşteri ödedim diyor, sistemde yok" tartışmasının tek dayanağı bu tablo. Sipariş
            -- ve tahsilatın kendisi ERP'de; burada tutulan şey MAĞAZADA NE OLDUĞU: hangi üye ne
            -- zaman sipariş açtı, ödemeyi kaç kez başlattı, sonuç sayfası ne gördü. ERP'nin
            -- kaydı "banka ne dedi"yi anlatıyor, bu tablo "müşteri ne yaptı"yı.
            --
            -- KART BİLGİSİ, ŞİFRE VE OTURUM ANAHTARI BURAYA YAZILMAZ. `detail` alanı yalnızca
            -- kullanıcıya da gösterilebilecek metinleri taşır.
            CREATE TABLE IF NOT EXISTS public.order_events (
              id          bigserial PRIMARY KEY,
              order_no    text NULL,
              member_id   uuid NULL,
              event       text NOT NULL,
              detail      text NULL,
              client_ip   text NULL,
              created_at  timestamptz NOT NULL DEFAULT now()
            );

            CREATE INDEX IF NOT EXISTS ix_order_events_order ON public.order_events (order_no, created_at);
            CREATE INDEX IF NOT EXISTS ix_order_events_member ON public.order_events (member_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS ix_order_events_created ON public.order_events (created_at DESC);

            -- Bayiden yönetilen içerik sayfaları.
            --
            -- Yasal sayfalar (mesafeli satış, KVKK, çerez) KOD İÇİNDE kalıyor: tablolu, bağlantılı
            -- ve firma bilgisini ayarlardan çeken yapıları var; serbest metne indirgenirse o yapı
            -- kaybolur. Bu tablo onların yerine değil, YANINA: "Hakkımızda", "Kampanya koşulları",
            -- "Sıkça sorulanlar" gibi bayinin kendi yazacağı sayfalar için.
            --
            -- Adres (slug) tekil ve DEĞİŞTİRİLEBİLİR; değiştirildiğinde eski adres 404 verir, o
            -- yüzden panelde uyarılıyor. Yayından kaldırılan sayfa silinmiyor, `is_published`
            -- ile gizleniyor: yanlışlıkla silinen bir metin geri getirilemez.
            CREATE TABLE IF NOT EXISTS public.content_pages (
              id            uuid PRIMARY KEY,
              slug          text NOT NULL,
              title         text NOT NULL,
              summary       text NULL,
              body          text NOT NULL,
              is_published  boolean NOT NULL DEFAULT false,
              show_in_footer boolean NOT NULL DEFAULT false,
              sort_order    integer NOT NULL DEFAULT 0,
              created_at    timestamptz NOT NULL DEFAULT now(),
              updated_at    timestamptz NOT NULL DEFAULT now(),
              updated_by    text NULL
            );

            CREATE UNIQUE INDEX IF NOT EXISTS ux_content_pages_slug ON public.content_pages (lower(slug));

            -- Bayiden yüklenen vitrin görselleri (banner vb.). Ürün fotoğrafları ERP'de kalır.
            CREATE TABLE IF NOT EXISTS public.storefront_media (
              file_name    text PRIMARY KEY,
              content_type text NOT NULL,
              bytes        bytea NOT NULL,
              uploaded_at  timestamptz NOT NULL,
              uploaded_by  text NULL
            );

            -- Vitrin ana sayfasındaki "Kataloglarımız" bölümü (2026-09-13). PDF'in kendisi
            -- storefront_media'da (file_name burada saklanır, dosya orada); yalnız başlık
            -- ve sıralama burada tutulur.
            CREATE TABLE IF NOT EXISTS public.ecommerce_catalogs (
              id              uuid PRIMARY KEY,
              title           text NOT NULL,
              file_name       text NOT NULL,
              cover_file_name text NULL,
              sort_order      integer NOT NULL DEFAULT 0,
              is_active       boolean NOT NULL DEFAULT true,
              created_at      timestamptz NOT NULL DEFAULT now(),
              updated_at      timestamptz NOT NULL DEFAULT now(),
              updated_by      text NULL
            );

            -- SEPET HATIRLATMA SMS'İ (2026-09-20). Sepete ürün atıp ödemeye gelmeyen üyeye, belli
            -- bir süre sonra bir kez SMS gider. Aynı sepet için ikinci SMS gitmez (parmak izi);
            -- sepet değişirse ve son SMS'in üstünden yeterince zaman geçtiyse yeniden gider.
            CREATE TABLE IF NOT EXISTS public.cart_reminders (
              member_id         uuid PRIMARY KEY REFERENCES public.members (id) ON DELETE CASCADE,
              cart_fingerprint  text NOT NULL,
              sent_at           timestamptz NOT NULL
            );

            -- ÜYELERE TOPLU SMS (2026-09-20). Panelden atılan kampanya SMS'lerinin kaydı: kim,
            -- ne zaman, hangi metni, kaç kişiye. "Bu SMS'i kim attı" sorusu ancak buradan
            -- cevaplanır; PostaGüvercini paneli metni değil yalnız sayıyı gösteriyor.
            CREATE TABLE IF NOT EXISTS public.marketing_sms_log (
              id           bigserial PRIMARY KEY,
              sent_at      timestamptz NOT NULL DEFAULT now(),
              sent_by      text NULL,
              message      text NOT NULL,
              recipients   integer NOT NULL,
              succeeded    integer NOT NULL DEFAULT 0,
              failed       integer NOT NULL DEFAULT 0,
              finished_at  timestamptz NULL
            );

            -- Üye SMS'lerden çıkabilmeli (kampanya SMS'i için; sipariş SMS'leri etkilenmez).
            ALTER TABLE public.members ADD COLUMN IF NOT EXISTS sms_opt_out boolean NOT NULL DEFAULT false;

            -- VİTRİN İÇİ ARAMA KAYDI (2026-09-20). Ziyaretçinin arama kutusuna ne yazdığı ve
            -- kaç sonuç çıktığı. Asıl değeri SONUÇ ÇIKMAYAN aramalar: o ürünün ya fotoğrafı
            -- yok (vitrin kuralı gereği listeye hiç girmiyor), ya stoğu yok, ya da adı
            -- müşterinin aradığı kelime değil. Hangi ürünü fotoğraflamak/stoklamak gerektiğini
            -- tahminle değil bu liste söylüyor.
            --
            -- Kişisel veri tutulmuyor: üye kimliği, IP, oturum yok — yalnız terim ve sayı.
            CREATE TABLE IF NOT EXISTS public.search_log (
              id            bigserial PRIMARY KEY,
              term          text NOT NULL,        -- karşılaştırma için sadeleştirilmiş hâli
              raw_term      text NOT NULL,        -- ziyaretçinin yazdığı hâli
              result_count  integer NOT NULL,
              searched_at   timestamptz NOT NULL DEFAULT now()
            );
            CREATE INDEX IF NOT EXISTS ix_search_log_term ON public.search_log (term);
            CREATE INDEX IF NOT EXISTS ix_search_log_time ON public.search_log (searched_at DESC);

            -- STOK BİLDİRİMİ / "GELİNCE HABER VER" (2026-09-20). Tükenen üründe müşteri
            -- "Stok için bize ulaşın" bağlantısıyla iletişim sayfasına gidiyor ve orada
            -- kayboluyordu. Artık telefonunu bırakıyor; stok gelince SMS gidiyor.
            --
            -- İkinci faydası talep sinyali: "bu ürünü 12 kişi bekliyor" satırı, neyin
            -- sipariş edilmesi gerektiğini tahmine gerek bırakmadan söylüyor.
            --
            -- Aynı numara aynı ürüne iki kez yazılmaz (benzersiz indeks); haber verildikten
            -- sonra satır DURUYOR (talep geçmişi), yeniden kayıt için notified_at temizlenir.
            CREATE TABLE IF NOT EXISTS public.stock_alerts (
              id          bigserial PRIMARY KEY,
              stock_code  varchar(50) NOT NULL,
              phone       varchar(30) NOT NULL,
              member_id   uuid NULL REFERENCES public.members (id) ON DELETE SET NULL,
              created_at  timestamptz NOT NULL DEFAULT now(),
              notified_at timestamptz NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS ux_stock_alerts_code_phone
              ON public.stock_alerts (stock_code, phone) WHERE notified_at IS NULL;
            CREATE INDEX IF NOT EXISTS ix_stock_alerts_pending
              ON public.stock_alerts (stock_code) WHERE notified_at IS NULL;

            -- "SİZİ ARAYALIM" TALEBİ (2026-09-21).
            --
            -- KKTC'de müşterinin büyük bölümü siparişi telefonda kapatıyor; siteyi katalog
            -- gibi kullanıp arıyor. Akşam 22:00'de bakan müşteri ise arayamıyor ve o ziyaret
            -- tamamen kayboluyordu — sepete de gitmiyor, WhatsApp'a da yazmıyor.
            --
            -- Burada müşteri adını ve numarasını bırakıyor, hangi üründe olduğunu sistem
            -- kendisi ekliyor. Panelde liste olarak duruyor; arayan personel "arandı" diyor.
            -- SMS'e ihtiyaç YOK: bu kayıt yalnız panelde görünüyor, yani PostaGüvercini
            -- bilgisi girilmemiş olsa bile ÇALIŞIR. Bugünkü durumda çalışan tek lead kanalı.
            --
            -- Kişisel veri: ad + telefon + isteğe bağlı not. Kapatılan kayıtlar siliniyor
            -- değil, done_at ile işaretleniyor (kim ne zaman aradı izi kalsın).
            CREATE TABLE IF NOT EXISTS public.callback_requests (
              id          bigserial PRIMARY KEY,
              name        varchar(120) NOT NULL,
              phone       varchar(30)  NOT NULL,
              stock_code  varchar(50)  NULL,
              product_name text        NULL,
              note        varchar(500) NULL,
              source      varchar(30)  NOT NULL DEFAULT 'urun',   -- urun | sepet | genel
              member_id   uuid NULL REFERENCES public.members (id) ON DELETE SET NULL,
              created_at  timestamptz NOT NULL DEFAULT now(),
              done_at     timestamptz NULL,
              done_note   varchar(500) NULL
            );
            CREATE INDEX IF NOT EXISTS ix_callback_pending
              ON public.callback_requests (created_at DESC) WHERE done_at IS NULL;

            -- ZİYARET HUNİSİ (2026-09-21).
            --
            -- SORU: "toplam kaç kişi girdi, kaç tanesi üye olmadan gezdi, nerede takıldı?"
            -- Bugün buna cevap verecek hiçbir veri yok: GA4 kimliği panelde boş, olsa bile
            -- oradaki veri bizim sipariş numaramızla eşleşmiyor.
            --
            -- BURADA TUTULAN: oturum başına bir satır/adım. Kişisel veri YOK — IP yok,
            -- tarayıcı parmak izi yok, e-posta yok. `session_id` tarayıcıda üretilen rastgele
            -- bir değer; üye girişi yapılmışsa `member_id` doluyor, yapılmamışsa NULL kalıyor
            -- ve o oturum "misafir" sayılıyor.
            --
            -- ADIMLAR SIRALI: giris < urun < sepet < odeme < siparis. Huni, her oturumun
            -- ULAŞTIĞI EN İLERİ adıma bakılarak çıkarılıyor; aynı oturumun aynı adımı
            -- tekrar tetiklemesi sayıyı şişirmiyor (benzersiz indeks).
            CREATE TABLE IF NOT EXISTS public.visit_events (
              id          bigserial PRIMARY KEY,
              session_id  varchar(40) NOT NULL,
              step        varchar(20) NOT NULL,     -- giris | urun | sepet | odeme | siparis
              member_id   uuid NULL REFERENCES public.members (id) ON DELETE SET NULL,
              path        varchar(300) NULL,
              created_at  timestamptz NOT NULL DEFAULT now()
            );
            CREATE UNIQUE INDEX IF NOT EXISTS ux_visit_session_step
              ON public.visit_events (session_id, step);
            CREATE INDEX IF NOT EXISTS ix_visit_time ON public.visit_events (created_at DESC);
            """, conn);

        await cmd.ExecuteNonQueryAsync(ct);
    }
}
