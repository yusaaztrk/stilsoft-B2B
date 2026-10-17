using System.Collections.Concurrent;
using Npgsql;

namespace Asistan.Api.Infrastructure;

/// <summary>
/// Asistanın kendi veritabanını kurar (ilk kullanımda, firma başına bir kez).
///
/// Burada YALNIZ asistana ait veri durur: konuşma, mesaj, ham webhook kaydı. Cari, sipariş,
/// montaj ERP'de / ServiceOps'ta; kopyası tutulmaz (cari adı yalnız ekranda göstermek için
/// konuşmaya not edilir, kaynak yine ERP).
///
/// Şema açılışta değil İLK İSTEKTE kuruluyor: firma sayısı arttıkça açılışı uzatmasın ve
/// bir firmanın veritabanı sorunu diğerlerinin mesajını durdurmasın (ERP'nin açılış
/// süpürmesindeki "ilk hatada dur" tuzağına düşmemek için).
/// </summary>
public sealed class AsistanSchema
{
    private readonly TenantDb _db;
    private static readonly ConcurrentDictionary<string, bool> Prepared = new(StringComparer.OrdinalIgnoreCase);
    private static readonly SemaphoreSlim Gate = new(1, 1);

    public AsistanSchema(TenantDb db)
    {
        _db = db;
    }

    public async Task EnsureAsync(string tenantCode, CancellationToken ct = default)
    {
        var dbName = _db.AsistanDatabaseName(tenantCode);
        if (Prepared.ContainsKey(dbName)) return;

        await Gate.WaitAsync(ct);
        try
        {
            if (Prepared.ContainsKey(dbName)) return;
            await EnsureDatabaseAsync(dbName, ct);
            await EnsureTablesAsync(tenantCode, ct);
            Prepared[dbName] = true;
        }
        finally
        {
            Gate.Release();
        }
    }

    private async Task EnsureDatabaseAsync(string dbName, CancellationToken ct)
    {
        await using var conn = new NpgsqlConnection(_db.BuildConnectionString("postgres"));
        await conn.OpenAsync(ct);

        await using (var check = new NpgsqlCommand("SELECT COUNT(1) FROM pg_database WHERE datname = @db", conn))
        {
            check.Parameters.AddWithValue("db", dbName);
            if (Convert.ToInt32(await check.ExecuteScalarAsync(ct)) > 0) return;
        }

        // Ad parametre olamaz; AsistanDatabaseName yalnız [A-Z0-9_] üretir (Normalize + tire → alt çizgi).
        await using var create = new NpgsqlCommand($"CREATE DATABASE \"{dbName}\"", conn);
        await create.ExecuteNonQueryAsync(ct);
    }

    private async Task EnsureTablesAsync(string tenantCode, CancellationToken ct)
    {
        await using var conn = new NpgsqlConnection(_db.AsistanConnectionString(tenantCode));
        await conn.OpenAsync(ct);

        await using var cmd = new NpgsqlCommand("""
            CREATE TABLE IF NOT EXISTS public.conversations (
              id                     bigserial PRIMARY KEY,
              channel                text NOT NULL DEFAULT 'whatsapp',
              phone_number_id        text NOT NULL,          -- firmanın WhatsApp numarası (Meta kimliği)
              wa_id                  text NOT NULL,          -- müşterinin numarası, ülke kodlu, yalnız rakam
              contact_name           text NULL,              -- WhatsApp profil adı (müşterinin kendi yazdığı)
              customer_code          text NULL,              -- ERP cari eşleşmesi (telefonla)
              customer_name          text NULL,
              customer_match_count   int NOT NULL DEFAULT 0, -- numara kaç cariye kayıtlı
              status                 text NOT NULL DEFAULT 'open',   -- open | closed
              unread_count           int NOT NULL DEFAULT 0,
              last_message_at        timestamptz NULL,
              last_message_preview   text NULL,
              last_message_direction text NULL,
              last_inbound_at        timestamptz NULL,       -- 24 saat penceresi buradan hesaplanır
              assigned_to            text NULL,
              created_at             timestamptz NOT NULL DEFAULT now(),
              updated_at             timestamptz NOT NULL DEFAULT now(),
              UNIQUE (phone_number_id, wa_id)
            );
            CREATE INDEX IF NOT EXISTS ix_conversations_last ON public.conversations (last_message_at DESC);

            CREATE TABLE IF NOT EXISTS public.messages (
              id               bigserial PRIMARY KEY,
              conversation_id  bigint NOT NULL REFERENCES public.conversations(id),
              wamid            text NULL,                    -- Meta mesaj kimliği; tekrar gelen webhook'u eler
              direction        text NOT NULL,                -- in | out
              msg_type         text NOT NULL,                -- text | image | document | audio | video | sticker | location | contacts | interactive | button | reaction | unsupported
              body             text NULL,                    -- metin ya da medya açıklaması
              media_id         text NULL,
              media_mime       text NULL,
              media_filename   text NULL,
              status           text NOT NULL,                -- in: received | out: queued, sent, delivered, read, failed
              error_text       text NULL,
              sent_by          text NULL,                    -- panelden gönderen kullanıcı; asistan için 'asistan'
              wa_timestamp     timestamptz NULL,             -- Meta'nın bildirdiği zaman
              created_at       timestamptz NOT NULL DEFAULT now(),
              updated_at       timestamptz NOT NULL DEFAULT now(),
              raw              jsonb NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS ux_messages_wamid ON public.messages (wamid) WHERE wamid IS NOT NULL;
            CREATE INDEX IF NOT EXISTS ix_messages_conversation ON public.messages (conversation_id, id);

            -- Ham webhook kaydı: "mesaj gelmedi" denince ilk bakılacak yer. 30 gün tutulur.
            CREATE TABLE IF NOT EXISTS public.webhook_events (
              id           bigserial PRIMARY KEY,
              received_at  timestamptz NOT NULL DEFAULT now(),
              payload      jsonb NOT NULL,
              error_text   text NULL
            );
            CREATE INDEX IF NOT EXISTS ix_webhook_events_received ON public.webhook_events (received_at);
            """, conn);
        await cmd.ExecuteNonQueryAsync(ct);

        await using var inbox = new NpgsqlCommand(InboxDdl, conn);
        await inbox.ExecuteNonQueryAsync(ct);

        await using var ai = new NpgsqlCommand(AiDdl, conn);
        await ai.ExecuteNonQueryAsync(ct);

        await using var tools = new NpgsqlCommand(ToolsDdl, conn);
        await tools.ExecuteNonQueryAsync(ct);

        await using var ops = new NpgsqlCommand(OpsDdl, conn);
        await ops.ExecuteNonQueryAsync(ct);
    }

    /*
      ÇOK KİŞİLİ GELEN KUTUSU (2026-10-08, kullanıcı kararları):
       - Tek WhatsApp hattını 15-20 personel kullanır; her konuşma bir BİRİME düşer.
       - Konuşma birime ORTAK düşer: üstlenme/kilit yok. Birimdeki herkes görür ve cevaplar;
         çakışmasın diye yalnız "şu an bakıyor" (conversation_viewers) ve son cevaplayan gösterilir.
       - Kişi ↔ birim eşlemesi ve "hepsini gör" yetkisi asistanın Ayarlar sayfasında; kişiler
         B2B kullanıcıları (ayrı şifre/kullanıcı listesi yok — agents yalnız asistan ayarlarıdır).
       - Bekleme: son gelen mesaj cevapsızsa awaiting_reply=true, waiting_since = cevapsız ilk mesaj.
    */
    private const string InboxDdl = """
        CREATE TABLE IF NOT EXISTS public.departments (
          id          serial PRIMARY KEY,
          code        text NOT NULL UNIQUE,
          name        text NOT NULL,
          sort_order  int NOT NULL DEFAULT 0,
          is_active   boolean NOT NULL DEFAULT true,
          created_at  timestamptz NOT NULL DEFAULT now()
        );
        INSERT INTO public.departments (code, name, sort_order) VALUES
          ('teknik_servis',  'Teknik Servis',  10),
          ('montaj',         'Montaj',         20),
          ('muhasebe',       'Muhasebe',       30),
          ('planlama',       'Planlama',       40),
          ('mudurluk',       'Müdüriyet',      50),
          ('yazilim',        'Yazılım',        60),
          ('kurumsal_satis', 'Kurumsal Satış', 70),
          ('magaza_satis',   'Mağaza Satış',   80)
        ON CONFLICT (code) DO NOTHING;

        -- Asistan ayarları kişi başına. user_name B2B kullanıcı adı, KÜÇÜK HARF (B2B'de harf duyarsız).
        CREATE TABLE IF NOT EXISTS public.agents (
          user_name    text PRIMARY KEY,
          display_name text NULL,
          can_see_all  boolean NOT NULL DEFAULT false,
          is_admin     boolean NOT NULL DEFAULT false,   -- Ayarlar sayfasını yönetebilir
          is_active    boolean NOT NULL DEFAULT true,
          created_at   timestamptz NOT NULL DEFAULT now(),
          updated_at   timestamptz NOT NULL DEFAULT now(),
          updated_by   text NULL
        );

        CREATE TABLE IF NOT EXISTS public.department_members (
          department_id int NOT NULL REFERENCES public.departments(id),
          user_name     text NOT NULL,
          created_at    timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (department_id, user_name)
        );

        -- Konuşma hareketleri: devir, önem, durum, iç not. "Kim ne yaptı" buradan okunur.
        CREATE TABLE IF NOT EXISTS public.conversation_events (
          id              bigserial PRIMARY KEY,
          conversation_id bigint NOT NULL REFERENCES public.conversations(id),
          kind            text NOT NULL,     -- routed | priority | status | note
          actor           text NOT NULL,
          data            jsonb NULL,
          created_at      timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS ix_conversation_events_conv ON public.conversation_events (conversation_id, id);

        -- "Şu an bakıyor": ekran açıkken birkaç saniyede bir yenilenir; 30 sn'den eskisi sayılmaz.
        CREATE TABLE IF NOT EXISTS public.conversation_viewers (
          conversation_id bigint NOT NULL,
          user_name       text NOT NULL,
          seen_at         timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (conversation_id, user_name)
        );

        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema = 'public' AND table_name = 'conversations' AND column_name = 'awaiting_reply') THEN
            ALTER TABLE public.conversations
              ADD COLUMN department_id  int NULL REFERENCES public.departments(id),
              ADD COLUMN priority       text NOT NULL DEFAULT 'normal',   -- normal | important
              ADD COLUMN awaiting_reply boolean NOT NULL DEFAULT false,
              ADD COLUMN waiting_since  timestamptz NULL,
              ADD COLUMN last_reply_by  text NULL,
              ADD COLUMN last_reply_at  timestamptz NULL,
              ADD COLUMN ai_summary     text NULL;
            -- YALNIZ kolonlar ilk eklendiğinde: son mesajı müşteriden olan açık konuşmalar cevap bekliyor.
            UPDATE public.conversations
               SET awaiting_reply = true, waiting_since = last_inbound_at
             WHERE status = 'open' AND last_message_direction = 'in';
          END IF;
        END $$;
        CREATE INDEX IF NOT EXISTS ix_conversations_department ON public.conversations (department_id);
        CREATE INDEX IF NOT EXISTS ix_conversations_waiting ON public.conversations (awaiting_reply, waiting_since);
        """;

    /*
      YAPAY ZEKÂ — 2. AŞAMA (2026-10-08, kullanıcı kararları):
       - Asistan her yeni mesajı okur: birime yönlendirir (yalnız konuşma ATANMAMIŞSA), gerekirse
         "önemli" işaretler, kısa özet yazar ve bir CEVAP TASLAĞI hazırlar.
       - Taslak müşteriye KENDİLİĞİNDEN GİTMEZ: personel "onayla ve gönder", "düzenle" ya da "yok say" der.
       - İnisiyatif konuları (iskonto, pazarlık, iade, ödeme sözü…) asistan karara bağlamaz;
         "insan cevaplamalı" işaretler.
       - Birim açıklaması (ai_description) asistanın hangi mesajı nereye atacağını öğrendiği yer;
         Ayarlar'dan değiştirilir. Varsayılanlar yalnız BOŞKEN yazılır (elle yazılanı ezmez).
    */
    private const string AiDdl = """
        ALTER TABLE public.departments ADD COLUMN IF NOT EXISTS ai_description text NULL;
        UPDATE public.departments d SET ai_description = v.descr
          FROM (VALUES
            ('teknik_servis',  'Arızalı, çalışmayan, ses yapan ürünler; garanti kapsamında tamir; servis kaydı ve teknisyen ziyareti; yedek parça sorusu.'),
            ('montaj',         'Satın alınan ürünün kurulumu/montajı: montaj randevusu, montaj ekibinin gelişi, kurulumla ilgili sorunlar.'),
            ('muhasebe',       'Fatura, cari bakiye, ekstre, ödeme, havale/EFT, taksit, borç-alacak soruları.'),
            ('planlama',       'Siparişin ve teslimatın durumu: ürün ne zaman gelir, ne zaman teslim edilir, kargo/sevkiyat nerede.'),
            ('mudurluk',       'Şikâyet, memnuniyetsizlik, yönetimle görüşme isteği, diğer birimlerde çözülemeyen konular.'),
            ('yazilim',        'Web sitesi, online sipariş, üyelik, şifre, B2B paneline giriş gibi teknik/yazılım sorunları.'),
            ('kurumsal_satis', 'Firma/kurum adına toplu alım, bayi ve kurumsal fiyat teklifi, ihale, proje satışı.'),
            ('magaza_satis',   'Bireysel müşterinin ürün, fiyat, stok, model önerisi, kampanya soruları; mağazadan satın alma.')
          ) AS v(code, descr)
         WHERE d.code = v.code AND d.ai_description IS NULL;

        ALTER TABLE public.conversations
          ADD COLUMN IF NOT EXISTS ai_topic            text NULL,
          ADD COLUMN IF NOT EXISTS ai_needs_human      boolean NOT NULL DEFAULT false,
          ADD COLUMN IF NOT EXISTS ai_reason           text NULL,
          ADD COLUMN IF NOT EXISTS ai_last_message_id  bigint NULL,     -- asistanın en son okuduğu gelen mesaj
          ADD COLUMN IF NOT EXISTS ai_error            text NULL,
          ADD COLUMN IF NOT EXISTS ai_updated_at       timestamptz NULL;

        -- Cevap taslakları. Konuşma başına en fazla bir 'pending' olur; yenisi gelince eskisi 'superseded'.
        -- Sonuçlar: sent (aynen gönderildi) | edited (düzeltilip gönderildi) | discarded (yok sayıldı) |
        -- superseded (yeni mesajla eskidi ya da personel kendisi yazdı). Ölçüm buradan: asistan ne kadar işe yarıyor.
        CREATE TABLE IF NOT EXISTS public.ai_drafts (
          id                   bigserial PRIMARY KEY,
          conversation_id      bigint NOT NULL REFERENCES public.conversations(id),
          based_on_message_id  bigint NULL,
          body                 text NOT NULL,
          status               text NOT NULL DEFAULT 'pending',
          needs_human          boolean NOT NULL DEFAULT false,
          topic                text NULL,
          reason               text NULL,
          department_code      text NULL,
          model                text NULL,
          input_tokens         int NULL,
          output_tokens        int NULL,
          created_at           timestamptz NOT NULL DEFAULT now(),
          decided_by           text NULL,
          decided_at           timestamptz NULL,
          sent_message_id      bigint NULL
        );
        CREATE INDEX IF NOT EXISTS ix_ai_drafts_conv ON public.ai_drafts (conversation_id, id);
        CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_drafts_pending ON public.ai_drafts (conversation_id) WHERE status = 'pending';

        ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS ai_draft_id bigint NULL;  -- taslaktan gönderildiyse

        -- Firma geneli asistan ayarı (tek satır).
        CREATE TABLE IF NOT EXISTS public.assistant_settings (
          id                 int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
          ai_enabled         boolean NOT NULL DEFAULT true,
          auto_route         boolean NOT NULL DEFAULT true,
          instructions       text NULL,     -- firmaya özel talimat (üslup, çalışma saatleri, adres…)
          initiative_topics  text NULL,     -- asistanın karara bağlamayacağı konular, satır satır
          updated_at         timestamptz NOT NULL DEFAULT now(),
          updated_by         text NULL
        );
        INSERT INTO public.assistant_settings (id, initiative_topics) VALUES (1,
          E'İskonto / indirim isteği\nFiyat pazarlığı\nİade ve değişim talebi\nÖdeme sözü, vade ya da taksit talebi\nTazminat ve şikâyet sonucunda verilecek karar\nTeslim tarihi taahhüdü')
        ON CONFLICT (id) DO NOTHING;
        """;

    /*
      3. AŞAMA (2026-10-08): asistan müşterinin kendi ERP/Servis kayıtlarına bakabilir (bakiye, sipariş,
      fatura, servis/montaj). Ayarlar'dan kapatılabilir. Taslağın hangi kayıtlara bakılarak yazıldığı
      taslakla birlikte saklanır — personel "bunu nereden buldu" sorusunun cevabını görsün.
    */
    private const string ToolsDdl = """
        ALTER TABLE public.assistant_settings ADD COLUMN IF NOT EXISTS tools_enabled boolean NOT NULL DEFAULT true;
        ALTER TABLE public.ai_drafts ADD COLUMN IF NOT EXISTS tool_calls jsonb NULL;   -- [{name, query, ok, summary, ms}]
        """;

    /*
      OPERASYON (2026-10-09, kullanıcı isteği):
       - Bekleme uyarısı: cevapsız konuşma "uyarı" (varsayılan 5 dk) sonra sarı, "gecikme" (varsayılan
         15 dk) sonra KIRMIZI ve yanıp söner; gecikenler listenin üstünde ayrıca sayılır. Süreler Ayarlar'dan.
       - Önem derecesi üç seviye: normal | important (Önemli) | urgent (Acil). Kolon zaten metin;
         yeni değer için DDL gerekmiyor. Asistan yalnız normal→önemli yapar, Acil'i yalnız personel verir.
       - Hazır cevaplar: sık yazılan cevaplar; birime özel ya da (department_id NULL) herkese.
    */
    private const string OpsDdl = """
        ALTER TABLE public.assistant_settings
          ADD COLUMN IF NOT EXISTS warn_minutes int NOT NULL DEFAULT 5,
          ADD COLUMN IF NOT EXISTS late_minutes int NOT NULL DEFAULT 15;

        CREATE TABLE IF NOT EXISTS public.quick_replies (
          id            serial PRIMARY KEY,
          department_id int NULL REFERENCES public.departments(id),   -- NULL = bütün birimler
          title         text NOT NULL,
          body          text NOT NULL,
          sort_order    int NOT NULL DEFAULT 0,
          is_active     boolean NOT NULL DEFAULT true,
          use_count     int NOT NULL DEFAULT 0,
          created_by    text NULL,
          created_at    timestamptz NOT NULL DEFAULT now(),
          updated_at    timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS ix_quick_replies_dep ON public.quick_replies (department_id, sort_order);
        """;
}
