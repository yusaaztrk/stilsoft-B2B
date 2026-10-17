namespace B2B.Erp.Api.Entities;

public class User : AuditableEntity
{
    public int Id { get; set; }
    public string Username { get; set; } = string.Empty;
    public string Password { get; set; } = string.Empty;
    public string Mail { get; set; } = string.Empty;
    public string? FirmaCode { get; set; }
    public string? Gsm { get; set; }
    public string Unvan { get; set; } = string.Empty;
    /// <summary>
    /// Customer scope, as a comma-separated list of customer codes.
    ///
    /// '*' (or empty) means every customer. Otherwise the account is limited to the listed
    /// customers and their branches. It held a single code until multi-select was added; a
    /// one-code value is still exactly that, so every existing reader keeps working — use
    /// <c>CustomerScope.Parse</c> rather than reading this string directly.
    /// </summary>
    public string? Carikodu { get; set; }

    /// <summary>
    /// Teknisyenin kendi cari kodu (TEK-00001 / TECH-2026-003 gibi). Yalnızca ServiceOps
    /// teknisyen hesaplarında dolu.
    ///
    /// <see cref="Carikodu"/> ile karıştırılmamalı: orası bu hesabın hangi carilerin kayıtlarını
    /// GÖREBİLDİĞİ, burası hesabın kendisinin hangi cari OLDUĞU. İkisi bir süre aynı sütunda
    /// tutuldu ve alan "TECH-2026-003,*" gibi okunamaz hale geldi — kapsamı okuyan taraf
    /// teknisyenin kendi kodunu da süzülecek bir cari sanıyordu.
    /// </summary>
    public string? ServiceOpsCariKodu { get; set; }

    /// <summary>Which salesman this account *is*. Set on salesman accounts.</summary>
    public string? SalesmanCode { get; set; }
    public int? DefaultWarehouseCode { get; set; }
    public int? DefaultCashAccountId { get; set; }
    public int? DefaultBankAccountId { get; set; }
    public decimal? DiscountRate { get; set; }

    /// <summary>
    /// Marks the salesman that customers themselves quote through. The customer-facing offer
    /// screen is shared by every cari, so it must not expose the internal salesman list —
    /// only the salesmen flagged here appear there, and the customer never sees who else
    /// exists. Meaningful only on a salesman (plasiyer) account; ignored on any other role.
    /// </summary>
    public bool IsCariPlasiyeri { get; set; } = false;

    public bool IsActive { get; set; } = true;
    public bool ServiceOpsAccess { get; set; } = false;

    /// <summary>
    /// Lets this ERP user sign in to the employee portal (employee-service) as a MANAGER.
    /// Unlike <see cref="ServiceOpsAccess"/> there is deliberately NO super-admin bypass:
    /// nobody gets in until this box is ticked, so the portal starts closed to everyone.
    /// The user needs no <c>Employees</c> row; employee records are created inside the portal.
    /// </summary>
    public bool EmployeeAccess { get; set; } = false;

    /// <summary>
    /// WhatsApp Asistanı programına (asistan.&lt;alan&gt;) giriş — kullanıcı bazında (2026-10-08,
    /// kullanıcı kararı: "rol yetkisi değil, Kullanıcılar sayfasında Servise giriş gibi").
    /// <see cref="ServiceOpsAccess"/> gibi süper yönetici rolü kutudan bağımsız girer.
    /// </summary>
    public bool AsistanAccess { get; set; } = false;

    /// <summary>
    /// Cari ekstrede görebileceği cari tipleri, virgüllü (bayi, altbayi, musteri, magaza, tedarikci, diger).
    /// null = kısıtlama yok. Bkz. <see cref="B2B.Erp.Api.Core.Helpers.CariEkstreKapsami"/> (2026-10-11).
    /// </summary>
    public string? CariEkstreTipleri { get; set; }
    public DateTime? UpdatedAt { get; set; }
    public DateTime? LastLoginAt { get; set; }

    public int RoleId { get; set; }
    public Role Role { get; set; } = null!;

    public ICollection<UserWarehouse> UserWarehouses { get; set; } = new List<UserWarehouse>();
    public ICollection<UserCashAccount> UserCashAccounts { get; set; } = new List<UserCashAccount>();
    public ICollection<UserBankAccount> UserBankAccounts { get; set; } = new List<UserBankAccount>();

    public ICollection<RefreshToken> RefreshTokens { get; set; } = new List<RefreshToken>();
}