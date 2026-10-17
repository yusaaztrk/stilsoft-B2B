using B2B.Erp.Api.Features.VirtualPos.Core;
using Microsoft.Extensions.Caching.Memory;
using Xunit;

namespace B2B.Erp.Api.Tests;

public class TransientPaymentCardStoreTests
{
    private static MemoryTransientPaymentCardStore Build()
        => new(new MemoryCache(new MemoryCacheOptions { SizeLimit = 1000 }));

    private static TransientCardData Card() => new("4355084355084358", "12", "26");

    [Fact]
    public void Stored_card_can_be_consumed_once()
    {
        var store = Build();
        store.Store("ORDER-1", Card());

        var first = store.Consume("ORDER-1");

        Assert.NotNull(first);
        Assert.Equal("4355084355084358", first!.Pan);
    }

    // --- 20: one-time consume stops a duplicate callback re-authorizing -------------------

    [Fact]
    public void Second_consume_returns_nothing()
    {
        var store = Build();
        store.Store("ORDER-1", Card());

        store.Consume("ORDER-1");
        var second = store.Consume("ORDER-1");

        Assert.Null(second);
    }

    [Fact]
    public void Unknown_order_returns_nothing()
    {
        Assert.Null(Build().Consume("NEVER-STORED"));
    }

    [Fact]
    public void Remove_discards_the_card()
    {
        var store = Build();
        store.Store("ORDER-1", Card());

        store.Remove("ORDER-1");

        Assert.Null(store.Consume("ORDER-1"));
    }

    [Fact]
    public void Orders_are_isolated_from_each_other()
    {
        var store = Build();
        store.Store("ORDER-1", new TransientCardData("1111222233334444", "01", "27"));
        store.Store("ORDER-2", new TransientCardData("5555666677778888", "02", "28"));

        Assert.Equal("1111222233334444", store.Consume("ORDER-1")!.Pan);
        Assert.Equal("5555666677778888", store.Consume("ORDER-2")!.Pan);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Blank_order_id_is_ignored(string orderId)
    {
        var store = Build();
        store.Store(orderId, Card());

        Assert.Null(store.Consume(orderId));
    }

    // --- the store never carries CVV -------------------------------------------------------

    [Fact]
    public void Transient_card_has_no_cvv_field()
    {
        var properties = typeof(TransientCardData).GetProperties();

        Assert.DoesNotContain(properties, p =>
            p.Name.Contains("cvv", System.StringComparison.OrdinalIgnoreCase) ||
            p.Name.Contains("cvc", System.StringComparison.OrdinalIgnoreCase) ||
            p.Name.Contains("cv2", System.StringComparison.OrdinalIgnoreCase));
    }

    // --- 18: the persisted transaction has no PAN column -------------------------------------

    [Fact]
    public void Virtual_pos_transaction_entity_stores_no_full_pan_or_cvv()
    {
        var properties = typeof(B2B.Erp.Api.Entities.VirtualPosTransaction).GetProperties();

        foreach (var p in properties)
        {
            var name = p.Name;
            Assert.False(name.Equals("Pan", System.StringComparison.OrdinalIgnoreCase));
            Assert.False(name.Equals("CardNumber", System.StringComparison.OrdinalIgnoreCase));
            Assert.False(name.Contains("cvv", System.StringComparison.OrdinalIgnoreCase));
            Assert.False(name.Contains("cvc", System.StringComparison.OrdinalIgnoreCase));
        }
    }
}
