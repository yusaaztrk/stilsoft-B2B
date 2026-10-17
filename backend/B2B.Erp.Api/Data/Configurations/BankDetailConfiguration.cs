using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class BankDetailConfiguration : IEntityTypeConfiguration<BankDetail>
{
    public void Configure(EntityTypeBuilder<BankDetail> builder)
    {
        builder.ToTable("BankDetails");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedOnAdd();

        builder.Property(x => x.Name)
            .IsRequired()
            .HasColumnName("BANKA_ADI")
            .HasMaxLength(200);

        builder.Property(x => x.BankDetailCode)
            .IsRequired()
            .HasColumnName("BANK_DETAIL_CODE")
            .HasMaxLength(20);

        builder.Property(x => x.IsActive)
            .IsRequired()
            .HasDefaultValue(true);

        builder.HasIndex(x => x.BankDetailCode)
            .IsUnique();

        SeedData(builder);
    }

    private static void SeedData(EntityTypeBuilder<BankDetail> builder)
    {
        builder.HasData(
            new BankDetail { Id = 1, Name = "TCMB", BankDetailCode = "1", IsActive = true },
            new BankDetail { Id = 2, Name = "ETIBANK", BankDetailCode = "3", IsActive = true },
            new BankDetail { Id = 3, Name = "ILLER BANKASI", BankDetailCode = "4", IsActive = true },
            new BankDetail { Id = 4, Name = "T.C. ZİRAAT BANKASI A.Ş.", BankDetailCode = "10", IsActive = true },
            new BankDetail { Id = 5, Name = "HALK BANKASI", BankDetailCode = "12", IsActive = true },
            new BankDetail { Id = 6, Name = "SINAI KALKINMA BANKASI", BankDetailCode = "14", IsActive = true },
            new BankDetail { Id = 7, Name = "TÜRKİYE VAKIFLAR BANKASI T.A.O.", BankDetailCode = "15", IsActive = true },
            new BankDetail { Id = 8, Name = "EXIMBANK", BankDetailCode = "16", IsActive = true },
            new BankDetail { Id = 9, Name = "KALKINMA BANKASI", BankDetailCode = "17", IsActive = true },
            new BankDetail { Id = 10, Name = "BAYINDIRBANK A.S", BankDetailCode = "29", IsActive = true },
            new BankDetail { Id = 11, Name = "IKTISAT BANKASI", BankDetailCode = "30", IsActive = true },
            new BankDetail { Id = 12, Name = "TÜRK EKONOMI BANKASI A.S.", BankDetailCode = "32", IsActive = true },
            new BankDetail { Id = 13, Name = "AKBANK T.A.Ş.", BankDetailCode = "46", IsActive = true },
            new BankDetail { Id = 14, Name = "TARISBANK", BankDetailCode = "55", IsActive = true },
            new BankDetail { Id = 15, Name = "PAMUKBANK", BankDetailCode = "56", IsActive = true },
            new BankDetail { Id = 16, Name = "SINAI YATIRIM VE KREDI BANKASI", BankDetailCode = "58", IsActive = true },
            new BankDetail { Id = 17, Name = "SEKERBANK T.A.Ş.", BankDetailCode = "59", IsActive = true },
            new BankDetail { Id = 18, Name = "TURK TICARET BANKASI", BankDetailCode = "60", IsActive = true },
            new BankDetail { Id = 19, Name = "T. GARANTİ BANKASI A.Ş.", BankDetailCode = "62", IsActive = true },
            new BankDetail { Id = 20, Name = "IMAR BANKASI", BankDetailCode = "63", IsActive = true },
            new BankDetail { Id = 21, Name = "TÜRKİYE İŞ BANKASI A.Ş.", BankDetailCode = "64", IsActive = true },
            new BankDetail { Id = 22, Name = "YAPI VE KREDI BANKASI A.Ş.", BankDetailCode = "67", IsActive = true },
            new BankDetail { Id = 23, Name = "FORTIS BANK", BankDetailCode = "71", IsActive = true },
            new BankDetail { Id = 24, Name = "BANCO DI ROMA", BankDetailCode = "87", IsActive = true },
            new BankDetail { Id = 25, Name = "ABN AMRO BANK N.V.", BankDetailCode = "88", IsActive = true },
            new BankDetail { Id = 26, Name = "TÜRKİYE FİNANS BANKASI", BankDetailCode = "91", IsActive = true },
            new BankDetail { Id = 27, Name = "CITIBANK", BankDetailCode = "92", IsActive = true },
            new BankDetail { Id = 28, Name = "KOÇBANK A.S.", BankDetailCode = "93", IsActive = true },
            new BankDetail { Id = 29, Name = "TURKISH BANK", BankDetailCode = "96", IsActive = true },
            new BankDetail { Id = 30, Name = "CHASE MANHATTAN", BankDetailCode = "98", IsActive = true },
            new BankDetail { Id = 31, Name = "ING BANK A.Ş.", BankDetailCode = "99", IsActive = true },
            new BankDetail { Id = 32, Name = "ADABANK", BankDetailCode = "100", IsActive = true },
            new BankDetail { Id = 33, Name = "FIBABANK AS", BankDetailCode = "101", IsActive = true },
            new BankDetail { Id = 34, Name = "FİBABANKA A.Ş.", BankDetailCode = "103", IsActive = true },
            new BankDetail { Id = 35, Name = "WESTDEUTSCHE LANDESBANK", BankDetailCode = "106", IsActive = true },
            new BankDetail { Id = 36, Name = "BNP BANK", BankDetailCode = "107", IsActive = true },
            new BankDetail { Id = 37, Name = "MNG BANK A.S.", BankDetailCode = "108", IsActive = true },
            new BankDetail { Id = 38, Name = "ICBC BANK TURKEY", BankDetailCode = "109", IsActive = true },
            new BankDetail { Id = 39, Name = "CREDIT LYONNAIS", BankDetailCode = "110", IsActive = true },
            new BankDetail { Id = 40, Name = "FINANSBANK A.S.", BankDetailCode = "111", IsActive = true },
            new BankDetail { Id = 41, Name = "T.C.ZIRAAT BANKASI-EMLAK", BankDetailCode = "112", IsActive = true },
            new BankDetail { Id = 42, Name = "DEUTSCHE BANK AS", BankDetailCode = "115", IsActive = true },
            new BankDetail { Id = 43, Name = "YATIRIMBANK", BankDetailCode = "116", IsActive = true },
            new BankDetail { Id = 44, Name = "KIBRIS KREDI BANKASI LTD", BankDetailCode = "118", IsActive = true },
            new BankDetail { Id = 45, Name = "K.T.KOOP.MERKEZ BANKASI LTD.", BankDetailCode = "120", IsActive = true },
            new BankDetail { Id = 46, Name = "CREDIT AGRICOLE INDOSUEZ TURKBANK", BankDetailCode = "121", IsActive = true },
            new BankDetail { Id = 47, Name = "SOCIETE GENERAL", BankDetailCode = "122", IsActive = true },
            new BankDetail { Id = 48, Name = "HSBC BANK A.S.", BankDetailCode = "123", IsActive = true },
            new BankDetail { Id = 49, Name = "ALTERNATIF BANK A.Ş.", BankDetailCode = "124", IsActive = true },
            new BankDetail { Id = 50, Name = "BURGAN BANK A.Ş.", BankDetailCode = "125", IsActive = true },
            new BankDetail { Id = 51, Name = "TOPRAKBANK", BankDetailCode = "126", IsActive = true },
            new BankDetail { Id = 52, Name = "KENTBANK", BankDetailCode = "127", IsActive = true },
            new BankDetail { Id = 53, Name = "PARK YATIRIM", BankDetailCode = "128", IsActive = true },
            new BankDetail { Id = 54, Name = "TATBANK", BankDetailCode = "129", IsActive = true },
            new BankDetail { Id = 55, Name = "TAKASBANK", BankDetailCode = "132", IsActive = true },
            new BankDetail { Id = 56, Name = "ING BANK N.V.", BankDetailCode = "133", IsActive = true },
            new BankDetail { Id = 57, Name = "DENIZBANK A.S.", BankDetailCode = "134", IsActive = true },
            new BankDetail { Id = 58, Name = "ANADOLU BANK A.Ş.", BankDetailCode = "135", IsActive = true },
            new BankDetail { Id = 59, Name = "CREDİTWEST BANK LTD.", BankDetailCode = "136", IsActive = true },
            new BankDetail { Id = 60, Name = "RABOBANK NEDERLAND", BankDetailCode = "137", IsActive = true },
            new BankDetail { Id = 61, Name = "DILERBANK AS", BankDetailCode = "138", IsActive = true },
            new BankDetail { Id = 62, Name = "GSD YATIRM BANKASI A.S.", BankDetailCode = "139", IsActive = true },
            new BankDetail { Id = 63, Name = "CREDIT SUISSE FIRST BOSTON", BankDetailCode = "140", IsActive = true },
            new BankDetail { Id = 64, Name = "NUROL YATIRIM BANKASI AS", BankDetailCode = "141", IsActive = true },
            new BankDetail { Id = 65, Name = "TOPRAK YATIRIM BANKASI AS", BankDetailCode = "142", IsActive = true },
            new BankDetail { Id = 66, Name = "CALIK YATIRIM BANKASI AS", BankDetailCode = "143", IsActive = true },
            new BankDetail { Id = 67, Name = "ATLAS YATIRIM AS", BankDetailCode = "144", IsActive = true },
            new BankDetail { Id = 68, Name = "JP MORGAN GUARANTY", BankDetailCode = "145", IsActive = true },
            new BankDetail { Id = 69, Name = "ODEA BANK A.Ş.", BankDetailCode = "146", IsActive = true },
            new BankDetail { Id = 70, Name = "AL BARAKA TÜRK", BankDetailCode = "203", IsActive = true },
            new BankDetail { Id = 71, Name = "FAMILY FINANS KURUMU A.S.", BankDetailCode = "204", IsActive = true },
            new BankDetail { Id = 72, Name = "KUVEYT TURK EVKAF", BankDetailCode = "205", IsActive = true },
            new BankDetail { Id = 73, Name = "TÜRKİYE FİNANS KATILIM BANKASI A.Ş.", BankDetailCode = "206", IsActive = true },
            new BankDetail { Id = 74, Name = "IHLAS FINANS KURUMU", BankDetailCode = "207", IsActive = true },
            new BankDetail { Id = 75, Name = "ASYA FINANS KURUMU A.S.", BankDetailCode = "208", IsActive = true },
            new BankDetail { Id = 76, Name = "ZİRAAT KATILIM BANKASI", BankDetailCode = "209", IsActive = true },
            new BankDetail { Id = 77, Name = "VAKIF KATILIM BANKASI", BankDetailCode = "210", IsActive = true },
            new BankDetail { Id = 78, Name = "EMLAK KATILIM", BankDetailCode = "211", IsActive = true },
            new BankDetail { Id = 79, Name = "TÜRKİYE FİNANS KATILIM A.Ş.", BankDetailCode = "228", IsActive = true },
            new BankDetail { Id = 80, Name = "YONLENDIRICI MERKEZI", BankDetailCode = "997", IsActive = true },
            new BankDetail { Id = 81, Name = "EMKT MERKEZI", BankDetailCode = "998", IsActive = true },
            new BankDetail { Id = 82, Name = "-", BankDetailCode = "999", IsActive = true },
            new BankDetail { Id = 83, Name = "KOOPBANK", BankDetailCode = "KBR-0019", IsActive = true },
            new BankDetail { Id = 84, Name = "BANKMORE", BankDetailCode = "99999999", IsActive = true },
            new BankDetail { Id = 85, Name = "ALSANCAK KALKINMA KOOPERATIF", BankDetailCode = "ALSCK", IsActive = true },
            new BankDetail { Id = 86, Name = "HIGH RISE BANK", BankDetailCode = "HIGH-RISE", IsActive = true },
            new BankDetail { Id = 87, Name = "KIBRIS AKFINANS BANK", BankDetailCode = "KBR-0001", IsActive = true },
            new BankDetail { Id = 88, Name = "KIBRIS ALBANK", BankDetailCode = "KBR-0002", IsActive = true },
            new BankDetail { Id = 89, Name = "KIBRIS ASBANK", BankDetailCode = "KBR-0003", IsActive = true },
            new BankDetail { Id = 90, Name = "KIBRIS AYDINKOY KALKINMA KOOP.", BankDetailCode = "KBR-0004", IsActive = true },
            new BankDetail { Id = 91, Name = "KIBRIS BOSTANCI KALKINMA KOOP.", BankDetailCode = "KBR-0005", IsActive = true },
            new BankDetail { Id = 92, Name = "KIBRIS CAPITALBANK", BankDetailCode = "KBR-0006", IsActive = true },
            new BankDetail { Id = 93, Name = "KIBRIS CAYONU KALKINMA KOOP.", BankDetailCode = "KBR-0008", IsActive = true },
            new BankDetail { Id = 94, Name = "KIBRIS DIKMEN KALKINMA KOOP.", BankDetailCode = "KBR-0009", IsActive = true },
            new BankDetail { Id = 95, Name = "KIBRIS DOGANCI KOOPERATIF KREDI STI.", BankDetailCode = "KBR-0010", IsActive = true },
            new BankDetail { Id = 96, Name = "KIBRIS GUZELYURT KALKINMA KOOP.", BankDetailCode = "KBR-0012", IsActive = true },
            new BankDetail { Id = 97, Name = "İKTİSAT BANKASI", BankDetailCode = "KBR-0014", IsActive = true },
            new BankDetail { Id = 98, Name = "KIBRIS FAISAL ISLAM BANKASI", BankDetailCode = "KBR-0016", IsActive = true },
            new BankDetail { Id = 99, Name = "KIBRIS TURK OGRT. KOOP.", BankDetailCode = "KBR-0017", IsActive = true },
            new BankDetail { Id = 100, Name = "KIBRIS VAKIFLAR BANKASI", BankDetailCode = "KBR-0018", IsActive = true },
            new BankDetail { Id = 101, Name = "KIBRIS LAPTA KALKINMA KOOPERATIFI", BankDetailCode = "KBR-0020", IsActive = true },
            new BankDetail { Id = 102, Name = "KIBRIS LEFKOSA IKTISAT KOOPERATIFI", BankDetailCode = "KBR-0021", IsActive = true },
            new BankDetail { Id = 103, Name = "KIBRIS LIMASOL TURK KOOP.BANKASI", BankDetailCode = "KBR-0022", IsActive = true },
            new BankDetail { Id = 104, Name = "KIBRIS MAGUSA TURK KOOPERATIFI", BankDetailCode = "KBR-0023", IsActive = true },
            new BankDetail { Id = 105, Name = "KIBRIS MEHMETCIK KOOPERATIF KREDI", BankDetailCode = "KBR-0024", IsActive = true },
            new BankDetail { Id = 106, Name = "KIBRIS MEMURLAR KOOP.", BankDetailCode = "KBR-0025", IsActive = true },
            new BankDetail { Id = 107, Name = "KIBRIS MERKEZ BANKASI", BankDetailCode = "KBR-0026", IsActive = true },
            new BankDetail { Id = 108, Name = "KIBRIS MEZ KOOP LTD", BankDetailCode = "KBR-0027", IsActive = true },
            new BankDetail { Id = 109, Name = "KIBRIS NEAR EAST BANK", BankDetailCode = "KBR-0028", IsActive = true },
            new BankDetail { Id = 110, Name = "KIBRIS NOVABANK", BankDetailCode = "KBR-0029", IsActive = true },
            new BankDetail { Id = 111, Name = "KIBRIS OKAL KOOP", BankDetailCode = "KBR-0030", IsActive = true },
            new BankDetail { Id = 112, Name = "KIBRIS POLIS YARDIMLASMA KOOP.", BankDetailCode = "KBR-0031", IsActive = true },
            new BankDetail { Id = 113, Name = "KIBRIS SERDARLI KREDI KOOP.", BankDetailCode = "KBR-0032", IsActive = true },
            new BankDetail { Id = 114, Name = "KIBRIS SEKERBANK", BankDetailCode = "KBR-0033", IsActive = true },
            new BankDetail { Id = 115, Name = "KIBRIS TEB", BankDetailCode = "KBR-0034", IsActive = true },
            new BankDetail { Id = 116, Name = "KIBRIS TURK BANKASI", BankDetailCode = "KBR-0035", IsActive = true },
            new BankDetail { Id = 117, Name = "KIBRIS UNIVERSAL BANK", BankDetailCode = "KBR-0036", IsActive = true },
            new BankDetail { Id = 118, Name = "KIBRIS YENI ERENKOY KOOP.", BankDetailCode = "KBR-0037", IsActive = true }
        );
    }
}
