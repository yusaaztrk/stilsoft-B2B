using System.Globalization;
using System.Text;

namespace B2B.Erp.Api.Data.Services;

public sealed class InvoicePrintPdfService
{
    private const double PageWidthPt = 612d;
    private const double PageHeightPt = 792d;
    private const double PointsPerMillimeter = 72d / 25.4d;
    private const double DefaultFontSizePt = 8d;

    private static readonly InvoicePrintTemplateConfig Template = new()
    {
        PageWidthMm = PageWidthPt / PointsPerMillimeter,
        PageHeightMm = PageHeightPt / PointsPerMillimeter,
        FontSizePt = DefaultFontSizePt,
        CustomerName = new(10.82d, 41.91d, 82d),
        InvoiceDate = new(175.11d, 72.09d, 22d),
        FirstProductDescription = new(14.21d, 113.34d, 118d),
        FirstLineTotal = new(188.79d, 113.34d, 10.16d),
        GrandTotal = new(188.05d, 256.37d, 10.16d),
        BaselineOffsetPt = 5.6d
    };

    public byte[] GeneratePrototype(InvoicePrintPrototypeModel model)
    {
        ArgumentNullException.ThrowIfNull(model);

        var fontBytes = TryReadCourierNewBold();
        var cidToGidMap = fontBytes is null ? null : TrueTypeCmapReader.BuildCidToGidMap(fontBytes);
        var content = BuildContent(model);

        var objects = new List<PdfObject>
        {
            new("<< /Type /Catalog /Pages 2 0 R >>"),
            new("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
            new("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 8 0 R >>"),
            new("<< /Type /Font /Subtype /Type0 /BaseFont /CourierNew-Bold /Encoding /Identity-H /DescendantFonts [5 0 R] /ToUnicode 7 0 R >>"),
            new(fontBytes is null || cidToGidMap is null
                ? "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /CourierNew-Bold /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 6 0 R /DW 600 /CIDToGIDMap /Identity >>"
                : "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /CourierNew-Bold /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 6 0 R /DW 600 /CIDToGIDMap 10 0 R >>"),
            new(fontBytes is null
                ? "<< /Type /FontDescriptor /FontName /CourierNew-Bold /Flags 33 /FontBBox [-113 -250 749 801] /ItalicAngle 0 /Ascent 833 /Descent -300 /CapHeight 571 /StemV 120 >>"
                : $"<< /Type /FontDescriptor /FontName /CourierNew-Bold /Flags 33 /FontBBox [-113 -250 749 801] /ItalicAngle 0 /Ascent 833 /Descent -300 /CapHeight 571 /StemV 120 /FontFile2 9 0 R >>"),
            new(BuildToUnicodeCMap(), isStream: true),
            new(content, isStream: true)
        };

        if (fontBytes is not null)
        {
            objects.Add(new(fontBytes));
        }

        if (cidToGidMap is not null)
        {
            objects.Add(new(cidToGidMap));
        }

        return WritePdf(objects);
    }

    private static string BuildContent(InvoicePrintPrototypeModel model)
    {
        var sb = new StringBuilder();
        DrawText(sb, Template.CustomerName, model.CustomerName);
        DrawText(sb, Template.InvoiceDate, model.InvoiceDate);
        DrawText(sb, Template.FirstProductDescription, model.FirstProductDescription);
        DrawText(sb, Template.FirstLineTotal, model.FirstLineTotal, alignRight: true);
        DrawText(sb, Template.GrandTotal, model.GrandTotal, alignRight: true);
        return sb.ToString();
    }

    private static void DrawText(StringBuilder sb, InvoicePrintFieldConfig field, string? value, bool alignRight = false)
    {
        var text = TruncateToWidth(value ?? string.Empty, field.WidthMm);
        var x = MmToPoint(field.Xmm);
        if (alignRight)
        {
            x += MmToPoint(field.WidthMm) - EstimateTextWidthPt(text);
        }

        var baselineY = TopMmToBaselinePoint(field.Ymm);

        sb.AppendLine("BT");
        sb.AppendFormat(CultureInfo.InvariantCulture, "/F1 {0:0.###} Tf\n", Template.FontSizePt);
        sb.AppendFormat(CultureInfo.InvariantCulture, "1 0 0 1 {0:0.###} {1:0.###} Tm\n", x, baselineY);
        sb.Append('<').Append(ToUtf16BeHex(text)).AppendLine("> Tj");
        sb.AppendLine("ET");
    }

    private static double MmToPoint(double mm) => mm * PointsPerMillimeter;

    private static double TopMmToBaselinePoint(double topMm)
    {
        var topPt = MmToPoint(topMm);
        return PageHeightPt - topPt - Template.BaselineOffsetPt;
    }

    private static double EstimateTextWidthPt(string text)
    {
        return text.Length * Template.FontSizePt * 0.6d;
    }

    private static string TruncateToWidth(string text, double widthMm)
    {
        text = NormalizeText(text);
        var maxChars = Math.Max(0, (int)Math.Floor(MmToPoint(widthMm) / (Template.FontSizePt * 0.6d)));
        return text.Length <= maxChars ? text : text[..maxChars];
    }

    private static string NormalizeText(string text)
    {
        return (text ?? string.Empty)
            .Replace("\r", " ")
            .Replace("\n", " ")
            .Trim();
    }

    private static string ToUtf16BeHex(string text)
    {
        var bytes = Encoding.BigEndianUnicode.GetBytes(text);
        return Convert.ToHexString(bytes);
    }

    private static byte[]? TryReadCourierNewBold()
    {
        if (!OperatingSystem.IsWindows())
        {
            return null;
        }

        var fontPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.Windows),
            "Fonts",
            "courbd.ttf");

        return File.Exists(fontPath) ? File.ReadAllBytes(fontPath) : null;
    }

    private static string BuildToUnicodeCMap()
    {
        return """
/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Adobe-Identity-UCS def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
1 beginbfrange
<0000> <FFFF> <0000>
endbfrange
endcmap
CMapName currentdict /CMap defineresource pop
end
end
""";
    }

    private static byte[] WritePdf(IReadOnlyList<PdfObject> objects)
    {
        using var ms = new MemoryStream();
        WriteAscii(ms, "%PDF-1.4\n%\u00E2\u00E3\u00CF\u00D3\n");

        var offsets = new long[objects.Count + 1];
        for (var i = 0; i < objects.Count; i++)
        {
            offsets[i + 1] = ms.Position;
            WriteAscii(ms, $"{i + 1} 0 obj\n");
            objects[i].WriteTo(ms);
            WriteAscii(ms, "\nendobj\n");
        }

        var xrefOffset = ms.Position;
        WriteAscii(ms, $"xref\n0 {objects.Count + 1}\n");
        WriteAscii(ms, "0000000000 65535 f \n");
        for (var i = 1; i < offsets.Length; i++)
        {
            WriteAscii(ms, $"{offsets[i]:D10} 00000 n \n");
        }

        WriteAscii(ms, $"trailer\n<< /Size {objects.Count + 1} /Root 1 0 R >>\nstartxref\n{xrefOffset}\n%%EOF");
        return ms.ToArray();
    }

    private static void WriteAscii(Stream stream, string value)
    {
        var bytes = Encoding.ASCII.GetBytes(value);
        stream.Write(bytes, 0, bytes.Length);
    }

    private sealed class PdfObject
    {
        private readonly string? _text;
        private readonly byte[]? _bytes;
        private readonly bool _isStream;

        public PdfObject(string text, bool isStream = false)
        {
            _text = text;
            _isStream = isStream;
        }

        public PdfObject(byte[] bytes)
        {
            _bytes = bytes;
            _isStream = true;
        }

        public void WriteTo(Stream stream)
        {
            if (!_isStream)
            {
                WriteAscii(stream, _text ?? string.Empty);
                return;
            }

            var payload = _bytes ?? Encoding.ASCII.GetBytes(_text ?? string.Empty);
            WriteAscii(stream, $"<< /Length {payload.Length} >>\nstream\n");
            stream.Write(payload, 0, payload.Length);
            WriteAscii(stream, "\nendstream");
        }
    }

    private static class TrueTypeCmapReader
    {
        public static byte[]? BuildCidToGidMap(byte[] fontBytes)
        {
            var cmapOffset = FindTable(fontBytes, "cmap");
            if (cmapOffset < 0) return null;

            var subtableOffset = FindFormat4Subtable(fontBytes, cmapOffset);
            if (subtableOffset < 0) return null;

            var glyphs = ReadFormat4Glyphs(fontBytes, subtableOffset);
            var map = new byte[65536 * 2];
            for (var cid = 0; cid < glyphs.Length; cid++)
            {
                var gid = glyphs[cid];
                map[cid * 2] = (byte)(gid >> 8);
                map[(cid * 2) + 1] = (byte)(gid & 0xff);
            }

            return map;
        }

        private static int FindTable(byte[] data, string tag)
        {
            if (data.Length < 12) return -1;

            var tableCount = ReadUInt16(data, 4);
            for (var i = 0; i < tableCount; i++)
            {
                var record = 12 + (i * 16);
                if (record + 16 > data.Length) return -1;

                var currentTag = Encoding.ASCII.GetString(data, record, 4);
                if (!string.Equals(currentTag, tag, StringComparison.Ordinal)) continue;

                var offset = ReadUInt32(data, record + 8);
                return offset <= int.MaxValue ? (int)offset : -1;
            }

            return -1;
        }

        private static int FindFormat4Subtable(byte[] data, int cmapOffset)
        {
            if (cmapOffset + 4 > data.Length) return -1;

            var subtableCount = ReadUInt16(data, cmapOffset + 2);
            var fallback = -1;
            for (var i = 0; i < subtableCount; i++)
            {
                var record = cmapOffset + 4 + (i * 8);
                if (record + 8 > data.Length) return -1;

                var platformId = ReadUInt16(data, record);
                var encodingId = ReadUInt16(data, record + 2);
                var relativeOffset = ReadUInt32(data, record + 4);
                if (relativeOffset > int.MaxValue) continue;

                var subtableOffset = cmapOffset + (int)relativeOffset;
                if (subtableOffset + 2 > data.Length) continue;
                if (ReadUInt16(data, subtableOffset) != 4) continue;

                fallback = subtableOffset;
                if (platformId == 3 && (encodingId == 1 || encodingId == 0))
                {
                    return subtableOffset;
                }
            }

            return fallback;
        }

        private static ushort[] ReadFormat4Glyphs(byte[] data, int offset)
        {
            var glyphs = new ushort[65536];
            if (offset + 14 > data.Length) return glyphs;

            var length = ReadUInt16(data, offset + 2);
            var end = Math.Min(data.Length, offset + length);
            var segCount = ReadUInt16(data, offset + 6) / 2;

            var endCodeOffset = offset + 14;
            var startCodeOffset = endCodeOffset + (segCount * 2) + 2;
            var idDeltaOffset = startCodeOffset + (segCount * 2);
            var idRangeOffsetOffset = idDeltaOffset + (segCount * 2);

            if (idRangeOffsetOffset + (segCount * 2) > end) return glyphs;

            for (var i = 0; i < segCount; i++)
            {
                var endCode = ReadUInt16(data, endCodeOffset + (i * 2));
                var startCode = ReadUInt16(data, startCodeOffset + (i * 2));
                var idDelta = ReadInt16(data, idDeltaOffset + (i * 2));
                var idRangeOffsetPosition = idRangeOffsetOffset + (i * 2);
                var idRangeOffset = ReadUInt16(data, idRangeOffsetPosition);

                if (startCode == 0xffff && endCode == 0xffff) continue;

                for (var code = startCode; code <= endCode; code++)
                {
                    ushort glyphId;
                    if (idRangeOffset == 0)
                    {
                        glyphId = (ushort)((code + idDelta) & 0xffff);
                    }
                    else
                    {
                        var glyphOffset = idRangeOffsetPosition + idRangeOffset + ((code - startCode) * 2);
                        if (glyphOffset + 2 > end) continue;

                        var rawGlyphId = ReadUInt16(data, glyphOffset);
                        glyphId = rawGlyphId == 0
                            ? (ushort)0
                            : (ushort)((rawGlyphId + idDelta) & 0xffff);
                    }

                    glyphs[code] = glyphId;
                }
            }

            return glyphs;
        }

        private static ushort ReadUInt16(byte[] data, int offset)
        {
            return (ushort)((data[offset] << 8) | data[offset + 1]);
        }

        private static short ReadInt16(byte[] data, int offset)
        {
            return unchecked((short)ReadUInt16(data, offset));
        }

        private static uint ReadUInt32(byte[] data, int offset)
        {
            return ((uint)data[offset] << 24)
                | ((uint)data[offset + 1] << 16)
                | ((uint)data[offset + 2] << 8)
                | data[offset + 3];
        }
    }
}

public sealed class InvoicePrintPrototypeModel
{
    public string CustomerName { get; init; } = string.Empty;
    public string InvoiceDate { get; init; } = string.Empty;
    public string FirstProductDescription { get; init; } = string.Empty;
    public string FirstLineTotal { get; init; } = string.Empty;
    public string GrandTotal { get; init; } = string.Empty;
}

public sealed class InvoicePrintTemplateConfig
{
    public double PageWidthMm { get; init; }
    public double PageHeightMm { get; init; }
    public double FontSizePt { get; init; }
    public double BaselineOffsetPt { get; init; }
    public InvoicePrintFieldConfig CustomerName { get; init; } = new(0, 0, 0);
    public InvoicePrintFieldConfig InvoiceDate { get; init; } = new(0, 0, 0);
    public InvoicePrintFieldConfig FirstProductDescription { get; init; } = new(0, 0, 0);
    public InvoicePrintFieldConfig FirstLineTotal { get; init; } = new(0, 0, 0);
    public InvoicePrintFieldConfig GrandTotal { get; init; } = new(0, 0, 0);
}

public readonly record struct InvoicePrintFieldConfig(double Xmm, double Ymm, double WidthMm);
