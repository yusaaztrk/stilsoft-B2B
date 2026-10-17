using System;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Ecommerce.Api.Infrastructure;

public sealed class NullableGuidJsonConverter : JsonConverter<Guid?>
{
    public override Guid? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            return null;
        }

        if (reader.TokenType == JsonTokenType.String)
        {
            var str = reader.GetString();
            if (string.IsNullOrWhiteSpace(str))
            {
                return null;
            }

            if (Guid.TryParse(str, out var guid))
            {
                return guid;
            }
        }

        throw new JsonException($"Unable to convert \"{reader.GetString()}\" to Nullable<Guid>.");
    }

    public override void Write(Utf8JsonWriter writer, Guid? value, JsonSerializerOptions options)
    {
        if (value.HasValue)
        {
            writer.WriteStringValue(value.Value.ToString());
        }
        else
        {
            writer.WriteNullValue();
        }
    }
}
