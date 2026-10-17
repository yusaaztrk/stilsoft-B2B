using System;

namespace B2B.Erp.Api.Entities;

public sealed class UserActivityLog
{
    public int Id { get; set; }
    public string Username { get; set; } = string.Empty;
    public string UserDisplayName { get; set; } = string.Empty;
    public string ModuleKey { get; set; } = string.Empty;
    public string PageKey { get; set; } = string.Empty;
    public string ActionType { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string? RecordId { get; set; }

    /// <summary>
    /// İşlemin TETİKLEDİKLERİ — JSON: <c>{"effects":["…","…"]}</c>.
    ///
    /// <para>
    /// Kayıt satırı bugüne kadar yalnız "ne yapıldığını" söylüyordu ("Satış Faturası silindi").
    /// Oysa tek bir kullanıcı işlemi arkasında stok hareketini, cari ekstre satırını, montaj
    /// kaydını da değiştiriyor; "faturayı sildim, stok geri döndü mü?" sorusunun cevabı
    /// kayıtta hiç yoktu. Aynı <c>SaveChanges</c> içinde değişen ikincil kayıtlar burada
    /// insan diliyle özetlenir.
    /// </para>
    /// </summary>
    public string? DetailsJson { get; set; }

    /// <summary>
    /// Aynı kullanıcı işleminden doğan bütün satırların ORTAK kimliği.
    ///
    /// <para>
    /// Bir <c>SaveChanges</c> birden çok ana kayıt üretebiliyor (fatura + cari + kasa). Bu
    /// kimlik olmadan ekranda üç ayrı işlem gibi görünüyorlardı; artık aynı işlemin parçası
    /// oldukları belli.
    /// </para>
    /// </summary>
    public Guid? CorrelationId { get; set; }

    public string CreateUser { get; set; } = string.Empty;
    public DateTime CreateTime { get; set; } = DateTime.UtcNow;
}
