using System.Collections.Concurrent;

namespace Ecommerce.Api.Infrastructure;

public sealed class LiveActivityService
{
    public sealed class LiveEvent
    {
        public string EventType { get; set; } = "visit"; // visit, cart, checkout, search, logout
        public string Visitor { get; set; } = "";
        public string Detail { get; set; } = "";
        public string City { get; set; } = "İstanbul";
        public DateTime Time { get; set; } = DateTime.UtcNow;
    }

    private readonly ConcurrentQueue<LiveEvent> _events = new();
    private readonly ConcurrentDictionary<string, int> _pageHits = new();
    private readonly ConcurrentDictionary<string, int> _cityHits = new();

    public LiveActivityService()
    {
        // Pre-populate with realistic starting activities
        _events.Enqueue(new LiveEvent { EventType = "visit", Visitor = "Ziyaretçi #4821", Detail = "Samsung Galaxy S24 Ultra sayfasına girdi", City = "İstanbul", Time = DateTime.UtcNow.AddSeconds(-2) });
        _events.Enqueue(new LiveEvent { EventType = "cart", Visitor = "Ziyaretçi #4820", Detail = "Sepete ekledi: Nike Air Max 270", City = "Ankara", Time = DateTime.UtcNow.AddSeconds(-12) });
        _events.Enqueue(new LiveEvent { EventType = "checkout", Visitor = "Ziyaretçi #4819", Detail = "Ödeme tamamlandı: Sipariş #10234 (₺76.462)", City = "İstanbul", Time = DateTime.UtcNow.AddMinutes(-1) });
        _events.Enqueue(new LiveEvent { EventType = "visit", Visitor = "Ziyaretçi #4818", Detail = "Apple MacBook Pro M3 sayfasına girdi", City = "İzmir", Time = DateTime.UtcNow.AddMinutes(-1.5) });
        _events.Enqueue(new LiveEvent { EventType = "search", Visitor = "Ziyaretçi #4817", Detail = "\"bluetooth kulaklık\" aradı", City = "Bursa", Time = DateTime.UtcNow.AddMinutes(-2) });
        _events.Enqueue(new LiveEvent { EventType = "logout", Visitor = "Ziyaretçi #4816", Detail = "Siteden ayrıldı", City = "Ankara", Time = DateTime.UtcNow.AddMinutes(-2.5) });

        _pageHits["/urun/samsung-galaxy-s24"] = 34;
        _pageHits["/kategori/elektronik"] = 28;
        _pageHits["/urun/apple-macbook"] = 21;
        _pageHits["/"] = 19;
        _pageHits["/sepet"] = 12;

        _cityHits["İstanbul"] = 48;
        _cityHits["Ankara"] = 22;
        _cityHits["İzmir"] = 19;
        _cityHits["Bursa"] = 14;
        _cityHits["Diğer"] = 24;
    }

    public void AddEvent(string eventType, string visitor, string detail, string city)
    {
        var ev = new LiveEvent
        {
            EventType = eventType,
            Visitor = visitor,
            Detail = detail,
            City = city,
            Time = DateTime.UtcNow
        };

        _events.Enqueue(ev);

        // Keep last 100 events
        while (_events.Count > 100)
        {
            _events.TryDequeue(out _);
        }

        // Increment city counters
        _cityHits.AddOrUpdate(city, 1, (_, count) => count + 1);
    }

    public void TrackPageHit(string page)
    {
        _pageHits.AddOrUpdate(page, 1, (_, count) => count + 1);
    }

    public List<LiveEvent> GetRecentEvents()
    {
        return _events.Reverse().ToList();
    }

    public Dictionary<string, int> GetPopularPages()
    {
        return _pageHits.OrderByDescending(x => x.Value).Take(10).ToDictionary(x => x.Key, x => x.Value);
    }

    public Dictionary<string, int> GetGeographicDistribution()
    {
        return _cityHits.OrderByDescending(x => x.Value).ToDictionary(x => x.Key, x => x.Value);
    }
}
