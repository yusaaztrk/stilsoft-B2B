using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Core.Services;

public static class ExcelEmployeeSeedService
{
    private static readonly (string FullName, string BankAccountNo, string CustomerNo)[] SeedRecords = new[]
    {
        ("MEHMET HAYRİ DEMİRCİ", "601625227", "176143"),
        ("MESUT DEMİR", "601625228", "176214"),
        ("MESUT KARAKUŞ", "601625076", "196071"),
        ("EŞREF DEMİR", "601625085", "196059"),
        ("ALİ YÜCETAŞ", "601625074", "196072"),
        ("JORA ALLABERDIYEV", "601625096", "196025"),
        ("SEYİT DENİZ AVŞAR", "601625079", "196067"),
        ("SHATLYK SERDAROV", "601625094", "165833"),
        ("GÜLER ÖZEN", "601625099", "196020"),
        ("SÜMEYY GÜLERYÜZ", "601625105", "75526"),
        ("OKAY LİMONCU", "601624111", "155555"),
        ("ESRA AÇIKSES AYDIN", "601608392", "195055"),
        ("ESRA ÖZGÜN", "601625101", "196019"),
        ("MEHMET ÖMER AŞKAROĞLU", "601625089", "196045"),
        ("TARIK DEMİR", "601625084", "196062"),
        ("ÖMER KAYNAR", "601625098", "196023"),
        ("MEHMET ALİ TUGAY", "601625107", "84516"),
        ("MELTEM TOZMAZ", "601625102", "196016"),
        ("MAHMUT ERLALE", "601625082", "196063"),
        ("UMYT BAYNAZAROV", "601625093", "196031"),
        ("MD EAMIN BISWAS", "601625081", "196064"),
        ("MD HABİBUR RHAMAN", "601625144", "195930"),
        ("MD NAHID ULLAH", "601625111", "195935"),
        ("MD ROYAL HYOSSAIN", "601625149", "195922"),
        ("MD SHOHEL RANA SHULAIMAN", "601625146", "195928"),
        ("NIL RATAN RAZBONGSHİ", "601625112", "195933"),
        ("HAN DEMİRCİ", "601625087", "196050"),
        ("MEHMET SARI", "601630911", "71205"),
        ("MUSA TOKTAY", "601625092", "196043"),
        ("PALVAN JORAYEV", "601625106", "196013"),
        ("YUSUP JORAYEV", "601625108", "196006"),
        ("EZGİ KOÇER BALÇINER", "601625078", "196069"),
        ("TUĞBA SİDAL", "601630910", "196173"),
        ("ZEHRA ASİ", "601625168", "144201"),
        ("CEM FENER", "601625086", "181411"),
        ("KARIM PARVAZ", "601625141", "195931"),
        ("MD RUMON HOSSAIN", "601625110", "195941"),
        ("SUBRATO RAJBONGSHI", "601582695", "193810")
    };

    private static string NormalizeName(string name)
    {
        return name
            .Replace("İ", "I")
            .Replace("ı", "i")
            .Replace("Ş", "S")
            .Replace("ş", "s")
            .Replace("Ğ", "G")
            .Replace("ğ", "g")
            .Replace("Ü", "U")
            .Replace("ü", "u")
            .Replace("Ö", "O")
            .Replace("ö", "o")
            .Replace("Ç", "C")
            .Replace("ç", "c")
            .ToUpperInvariant()
            .Trim();
    }

    public static async Task<int> SyncBankDetailsAsync(AppDbContext dbContext, CancellationToken cancellationToken = default)
    {
        var employees = await dbContext.Employees.ToListAsync(cancellationToken);
        int updated = 0;

        foreach (var seed in SeedRecords)
        {
            var targetNorm = NormalizeName(seed.FullName);
            var emp = employees.FirstOrDefault(e =>
            {
                var currentNorm = NormalizeName($"{e.FirstName} {e.LastName}".Trim());
                if (currentNorm == targetNorm) return true;
                if (currentNorm.Contains(targetNorm) || targetNorm.Contains(currentNorm)) return true;
                return false;
            });

            if (emp != null)
            {
                bool changed = false;
                if (emp.BankAccountNo != seed.BankAccountNo)
                {
                    emp.BankAccountNo = seed.BankAccountNo;
                    changed = true;
                }
                if (emp.CustomerNo != seed.CustomerNo)
                {
                    emp.CustomerNo = seed.CustomerNo;
                    changed = true;
                }
                if (string.IsNullOrWhiteSpace(emp.BankName))
                {
                    emp.BankName = "Near East Bank";
                    changed = true;
                }
                if (changed)
                {
                    updated++;
                }
            }
        }

        if (updated > 0)
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }

        return updated;
    }
}
