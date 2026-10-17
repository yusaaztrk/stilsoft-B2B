using System;

namespace B2B.Erp.Api.Entities;

/// <summary>
/// Binds a POS collection account to the current account its daily balance is swept into,
/// and states when that sweep runs.
///
/// The link between a virtual POS provider and its collection account already existed, but
/// only as a naming convention (<c>VirtualPosDefinitions.NethesCode</c> matching
/// <c>BankAccountDefinitions.AccountCode</c>) with no screen behind it. Stating it as data
/// makes it configurable and lets an account that receives manually entered physical POS
/// slips participate too — the sweep works on the account, not on the collection channel.
/// </summary>
public sealed class PosAccountSetting : AuditableEntity
{
    public int Id { get; set; }

    /// <summary>The POS collection account (AccountType 14).</summary>
    public int PosBankAccountDefinitionId { get; set; }
    public BankAccountDefinition PosBankAccountDefinition { get; set; } = null!;

    /// <summary>
    /// The current account the daily balance is swept into. Null while the account has been
    /// declared a POS account but its destination has not been chosen yet — the sweep skips
    /// those rather than guessing a target.
    /// </summary>
    public int? TargetBankAccountDefinitionId { get; set; }
    public BankAccountDefinition? TargetBankAccountDefinition { get; set; }

    /// <summary>
    /// Virtual POS bank code whose collections land here, or null for an account that only
    /// receives manual entries. Matches <c>VirtualPosDefinition.BankCode</c>.
    /// </summary>
    public int? VirtualPosBankCode { get; set; }

    /// <summary>
    /// Local time of day the sweep runs. The run always settles the previous calendar day,
    /// whatever this value is: the boundary is the date, not the clock. A collection taken at
    /// 00:30 already carries the new day's date, so it waits for the next run instead of
    /// racing a sweep that is closing the day before it.
    /// </summary>
    public TimeSpan TransferTime { get; set; } = new(1, 0, 0);

    public bool IsAutoTransferEnabled { get; set; } = true;

    public bool IsActive { get; set; } = true;
}

/// <summary>
/// One day's sweep of a POS account into its current account.
///
/// The money movement itself is written as an ordinary pair of bank transactions, so every
/// existing balance query and report keeps working without knowing this feature exists. This
/// record only remembers that the pair belongs to a sweep, which day it settles, and which
/// movements it covered.
/// </summary>
public sealed class PosAccountTransfer : AuditableEntity
{
    public int Id { get; set; }

    public int PosBankAccountDefinitionId { get; set; }
    public BankAccountDefinition PosBankAccountDefinition { get; set; } = null!;

    public int TargetBankAccountDefinitionId { get; set; }
    public BankAccountDefinition TargetBankAccountDefinition { get; set; } = null!;

    /// <summary>The calendar day whose collections this settles — not when it ran.</summary>
    public DateTime TransferDate { get; set; }

    public decimal Amount { get; set; }

    /// <summary>
    /// The outgoing and incoming bank movements this sweep created. Nullable because a user
    /// may delete either from the bank screens: this feature deliberately does not lock or
    /// repair those rows, and a dangling id must not stop the sweep record from being read
    /// or removed.
    /// </summary>
    public int? OutBankAccountTransactionId { get; set; }

    public int? InBankAccountTransactionId { get; set; }

    /// <summary>True when a scheduled run produced it, false when a person did.</summary>
    public bool IsAutomatic { get; set; }
}

/// <summary>
/// Marks one bank movement as settled by one sweep.
///
/// Carrying the state here rather than inferring it from the absence of a row keeps the
/// existing <c>BankAccountTransactions</c> table untouched — it is written by the personnel
/// service as well, so a column added for this feature would have to be added in two places.
/// A movement with no row here is simply not settled yet, and is what the screen shows in
/// red so it can be added to the day it belongs to.
/// </summary>
public sealed class PosAccountTransferItem : AuditableEntity
{
    public int Id { get; set; }

    public int PosAccountTransferId { get; set; }
    public PosAccountTransfer PosAccountTransfer { get; set; } = null!;

    public int BankAccountTransactionId { get; set; }

    /// <summary>
    /// The movement's amount at the moment it was settled. Kept so a sweep total can be
    /// explained after the fact even if the movement is later edited or removed — the sweep
    /// is never silently rewritten behind the user's back.
    /// </summary>
    public decimal Amount { get; set; }

    /// <summary>
    /// True when the movement was added after the day's sweep had already run — a backdated
    /// slip found later. Only for display; the money effect is identical.
    /// </summary>
    public bool IsLateAddition { get; set; }
}
