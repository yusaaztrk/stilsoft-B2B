using System.Globalization;

namespace B2B.Erp.Api.Core.Helpers;

/// <summary>
/// <c>PriceGroups.Formula</c> ifadelerini hesaplar — ör. <c>REMOVE_KDV(F4*(1-DISCOUNT/100))</c>,
/// <c>F4-400</c>, <c>F4*0.88</c>.
///
/// <para>
/// <b>Neden var:</b> toplu fiyat atama yalnızca 1-6 kodlu grupları yazıyordu ve bunların hesabı
/// <c>BulkPricingController.DerivePrices</c> içine GÖMÜLÜYDÜ. Askeriye (7) gibi firmaya özel
/// gruplar hiç güncellenmiyor, eski değerinde kalıyordu.
/// </para>
///
/// <para>
/// <b>Neden sabit bir kural yazılmadı:</b> formül firmadan firmaya değişiyor. Veriden doğrulandı —
/// DEMO'da kod 7 = <c>F4-400</c>, 8 = <c>F4-600</c>, 9 = <c>REMOVE_KDV(...-300)</c>; KKTC ve
/// DEMOTEST'te ise 7 = <c>REMOVE_KDV(F4*(1-DISCOUNT/100))</c>. "7, Fiyat 3 ile aynıdır" demek
/// bir firmada doğru, diğerinde sessizce yanlış fiyat demekti.
/// </para>
///
/// <para>
/// Dilbilgisi, ekrandaki <c>evalPriceFormula</c> ile AYNI tutuldu (sayı, değişken, + - * /,
/// parantez, tek argümanlı fonksiyon). Biri değişirse diğeri de değişmeli; yoksa ürünü elle
/// düzenlemekle toplu güncellemek farklı fiyat üretir.
/// </para>
/// </summary>
public static class PriceFormulaEvaluator
{
    /// <summary>
    /// Formülü hesaplar. Formül boşsa, çözümlenemezse ya da sonuç geçersizse <c>null</c> döner —
    /// bozuk bir formül yüzünden fiyat sıfırlanmasın diye o grup ATLANIR.
    /// </summary>
    public static decimal? Evaluate(string? formula, decimal f4, decimal taxRate, decimal discountRate)
    {
        var expr = (formula ?? string.Empty).Trim();
        if (expr.Length == 0) return null;

        try
        {
            var parser = new Parser(expr, f4, taxRate, discountRate);
            var value = parser.ParseExpression();
            parser.ExpectEnd();

            // SIFIR VEYA NEGATİF SONUÇ YAZILMAZ. `F4-400` gibi sabit indirimli bir formül
            // ucuz üründe eksiye düşebiliyor; eksi fiyat yazmaktansa o grubu atlayıp eski
            // değerinde bırakmak doğru. Çağıran `null`'ı "bu gruba dokunma" diye okur.
            if (value <= 0m) return null;
            return value;
        }
        catch
        {
            return null;
        }
    }

    private sealed class Parser
    {
        private readonly string _s;
        private readonly decimal _f4;
        private readonly decimal _kdv;
        private readonly decimal _discount;
        private int _i;

        public Parser(string s, decimal f4, decimal taxRate, decimal discountRate)
        {
            _s = s;
            _f4 = decimal.Round(f4, 2, MidpointRounding.AwayFromZero);
            _kdv = taxRate;
            _discount = Math.Clamp(discountRate, 0m, 100m);
        }

        private void SkipWhitespace()
        {
            while (_i < _s.Length && char.IsWhiteSpace(_s[_i])) _i++;
        }

        private char Peek()
        {
            SkipWhitespace();
            return _i < _s.Length ? _s[_i] : '\0';
        }

        public void ExpectEnd()
        {
            if (Peek() != '\0') throw new FormatException("Formül sonu beklenirken fazladan girdi bulundu.");
        }

        public decimal ParseExpression()
        {
            var value = ParseTerm();
            while (true)
            {
                var c = Peek();
                if (c == '+') { _i++; value += ParseTerm(); }
                else if (c == '-') { _i++; value -= ParseTerm(); }
                else return value;
            }
        }

        private decimal ParseTerm()
        {
            var value = ParseUnary();
            while (true)
            {
                var c = Peek();
                if (c == '*') { _i++; value *= ParseUnary(); }
                else if (c == '/')
                {
                    _i++;
                    var divisor = ParseUnary();
                    // Sıfıra bölme formülün bozuk olduğunu gösterir; grubu atlatmak için hata.
                    if (divisor == 0m) throw new DivideByZeroException();
                    value /= divisor;
                }
                else return value;
            }
        }

        private decimal ParseUnary()
        {
            if (Peek() == '-') { _i++; return -ParseUnary(); }
            if (Peek() == '+') { _i++; return ParseUnary(); }
            return ParsePrimary();
        }

        private decimal ParsePrimary()
        {
            var c = Peek();

            if (c == '(')
            {
                _i++;
                var inner = ParseExpression();
                if (Peek() != ')') throw new FormatException("Kapanış parantezi yok.");
                _i++;
                return inner;
            }

            if (char.IsDigit(c) || c == '.')
            {
                var start = _i;
                while (_i < _s.Length && (char.IsDigit(_s[_i]) || _s[_i] == '.')) _i++;
                var text = _s[start.._i];
                // Formüller HER ZAMAN nokta ondalıklıdır; sunucunun yerel ayarı karışmasın.
                return decimal.Parse(text, CultureInfo.InvariantCulture);
            }

            if (char.IsLetter(c) || c == '_')
            {
                var start = _i;
                while (_i < _s.Length && (char.IsLetterOrDigit(_s[_i]) || _s[_i] == '_')) _i++;
                var name = _s[start.._i];

                if (Peek() == '(')
                {
                    _i++;
                    var arg = ParseExpression();
                    if (Peek() != ')') throw new FormatException("Fonksiyon parantezi kapanmadı.");
                    _i++;
                    return ApplyFunction(name, arg);
                }

                return ResolveVariable(name);
            }

            throw new FormatException($"Geçersiz karakter: {c}");
        }

        private decimal KdvDivisor()
        {
            var d = 1m + (_kdv / 100m);
            return d <= 0m ? 1m : d;
        }

        private decimal ApplyFunction(string name, decimal arg) => name.ToUpperInvariant() switch
        {
            "ADD_KDV" => arg * KdvDivisor(),
            "REMOVE_KDV" => arg / KdvDivisor(),
            _ => throw new FormatException($"Bilinmeyen fonksiyon: {name}")
        };

        private decimal ResolveVariable(string name) => name.ToUpperInvariant() switch
        {
            "F4" => _f4,
            "KDV" => _kdv,
            "DISCOUNT" => _discount,
            _ => throw new FormatException($"Bilinmeyen değişken: {name}")
        };
    }
}
