using System;
using System.Collections.Generic;

namespace Ecommerce.Api.Infrastructure.Data;

public sealed class StoreDesign
{
    public string BrandName { get; set; } = "Stilsoft KKTC";
    public string LogoUrl { get; set; } = "";
    public string PrimaryColor { get; set; } = "#df0000";
    public string AccentColor { get; set; } = "#121212";
    public string HeroTitle { get; set; } = "Mutfakta Profesyonel Stilsoft Dokunuşu";
    public string HeroSubtitle { get; set; } = "İleri teknoloji ve zarif tasarımın buluştuğu ürünlerle yaşam alanınızı dönüştürün.";
    public string HeroImageUrl { get; set; } = "";
    public string Announcement { get; set; } = "Kıbrıs genelinde hızlı teslimat! Stilsoft ile evinizi yenileyin.";
    public string AnnouncementHtml { get; set; } = "<p>Stilsoft Teknoloji Marketi Kıbrıs'ta Hizmetinizde! Özel indirimli ürünleri kaçırmayın.</p>";
    public string AnnouncementBgColor { get; set; } = "#D32F2F";
    public string AnnouncementTextColor { get; set; } = "#FFFFFF";
    public bool AnnouncementActive { get; set; } = true;
    public string AnnouncementLink { get; set; } = "";
    public string FooterText { get; set; } = "Kıbrıs'ta ev gereçlerinin güvenilir adresi.";

    // Banner layouts
    public string TopBannerUrl { get; set; } = "";
    public string TopBannerLink { get; set; } = "";
    public string MiddleBannerUrl { get; set; } = "";
    public string MiddleBannerLink { get; set; } = "";
    public string BottomBannerUrl { get; set; } = "";
    public string BottomBannerLink { get; set; } = "";

    // 4-Image Grid banner layout (1 top wide, 3 bottom vertical)
    public string Grid4WideUrl { get; set; } = "";
    public string Grid4WideLink { get; set; } = "";
    public string Grid4Vert1Url { get; set; } = "";
    public string Grid4Vert1Link { get; set; } = "";
    public string Grid4Vert2Url { get; set; } = "";
    public string Grid4Vert2Link { get; set; } = "";
    public string Grid4Vert3Url { get; set; } = "";
    public string Grid4Vert3Link { get; set; } = "";

    // Contact & Settings
    public string SitePhone { get; set; } = "+90 392 444 88 99";
    public string SiteEmail { get; set; } = "info@example.com";
    public string SiteAddress { get; set; } = "Lefkoşa, Kuzey Kıbrıs";
    public string SitePhoneDesc { get; set; } = "Hafta içi 09:00 - 18:00 saatleri arasında kesintisiz destek.";
    public string SiteServiceDesc { get; set; } = "Arıza kaydı ve parça talepleriniz için uzman birimimiz.";
    public string SiteEmailDesc { get; set; } = "Soru ve önerileriniz için e-posta gönderin.";
    public string SiteAddressDesc { get; set; } = "Merkez ofis ve mağaza adres bilgilerimiz.";
    public decimal CargoFee { get; set; } = 150;
    public decimal FreeShippingThreshold { get; set; } = 2000;
    public string Currency { get; set; } = "TL";
    public string SeoTitle { get; set; } = "Stilsoft KKTC | Mutfak ve Ev Aletleri";
    public string SeoDescription { get; set; } = "KKTC'de Stilsoft küçük ev aletleri, mutfak robotları, süpürgeler ve ev teknolojisi ürünleri.";
    public string PdfCatalogsTitle { get; set; } = "Stilsoft'un Renkli Dünyasına Açılan Kapılar";

    // Social Media Links
    public string FacebookUrl { get; set; } = "";
    public string InstagramUrl { get; set; } = "";
    public string TwitterUrl { get; set; } = "";
    public string YoutubeUrl { get; set; } = "";



    // Collections
    public List<MediaItem> MediaLibrary { get; set; } = new();
    public List<SliderItem> Sliders { get; set; } = new();
    public List<CampaignItem> Campaigns { get; set; } = new();
    public List<AnnouncementItem> Announcements { get; set; } = new();
}

public sealed class AnnouncementItem
{
    public string Id { get; set; } = "";
    public string ContentHtml { get; set; } = "";
    public string BgColor { get; set; } = "#D32F2F";
    public string TextColor { get; set; } = "#FFFFFF";
    public bool IsActive { get; set; } = true;
    public string Link { get; set; } = "";
    public int Order { get; set; } = 0;
}

public sealed class MediaItem
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Url { get; set; } = "";
    public string Type { get; set; } = "";
    public long Size { get; set; } = 0;
    public DateTime UploadedAt { get; set; } = DateTime.UtcNow;
    public string Folder { get; set; } = "";
}

public sealed class SliderItem
{
    public string Id { get; set; } = "";
    public string ImageUrl { get; set; } = "";
    public string Title { get; set; } = "";
    public string Subtitle { get; set; } = "";
    public string Link { get; set; } = "";
    public int Order { get; set; } = 0;
}

public sealed class CampaignItem
{
    public string Id { get; set; } = "";
    public string ImageUrl { get; set; } = "";
    public string Title { get; set; } = "";
    public string Link { get; set; } = "";
    public string ColSpan { get; set; } = "1"; // e.g. "1" or "2" for grid layouts
}

