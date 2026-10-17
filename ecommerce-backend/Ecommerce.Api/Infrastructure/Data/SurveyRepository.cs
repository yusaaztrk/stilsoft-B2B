using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;
using Npgsql;

namespace Ecommerce.Api.Infrastructure.Data;

public sealed class SurveyRepository
{
    private readonly string _connStr;

    public SurveyRepository(IConfiguration config)
    {
        _connStr = config.GetConnectionString("EcommerceDb") ?? string.Empty;
    }

    public async Task EnsureCreatedAsync(CancellationToken cancellationToken)
    {
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);
        
        await using var cmd1 = conn.CreateCommand();
        cmd1.CommandText = @"
CREATE TABLE IF NOT EXISTS survey_questions (
    id text PRIMARY KEY,
    text text NOT NULL,
    type text NOT NULL,
    order_no integer NOT NULL DEFAULT 0
);
";
        await cmd1.ExecuteNonQueryAsync(cancellationToken);

        await using var cmdMigration = conn.CreateCommand();
        cmdMigration.CommandText = "ALTER TABLE survey_questions ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false;";
        await cmdMigration.ExecuteNonQueryAsync(cancellationToken);

        await using var cmd2 = conn.CreateCommand();
        cmd2.CommandText = @"
CREATE TABLE IF NOT EXISTS survey_responses (
    id serial PRIMARY KEY,
    submitted_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
    name text NOT NULL,
    email text NOT NULL,
    phone text NOT NULL,
    answers_json text NOT NULL
);
";
        await cmd2.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<List<SurveyQuestion>> GetQuestionsAsync(CancellationToken cancellationToken)
    {
        var list = new List<SurveyQuestion>();
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT id, text, type, order_no, is_deleted FROM survey_questions WHERE is_deleted = false ORDER BY order_no ASC";
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            list.Add(new SurveyQuestion
            {
                Id = reader.GetString(0),
                Text = reader.GetString(1),
                Type = reader.GetString(2),
                OrderNo = reader.GetInt32(3),
                IsDeleted = reader.GetBoolean(4)
            });
        }
        return list;
    }

    public async Task<List<SurveyQuestion>> GetAllQuestionsAsync(CancellationToken cancellationToken)
    {
        var list = new List<SurveyQuestion>();
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT id, text, type, order_no, is_deleted FROM survey_questions ORDER BY order_no ASC";
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            list.Add(new SurveyQuestion
            {
                Id = reader.GetString(0),
                Text = reader.GetString(1),
                Type = reader.GetString(2),
                OrderNo = reader.GetInt32(3),
                IsDeleted = reader.GetBoolean(4)
            });
        }
        return list;
    }

    public async Task SaveQuestionsAsync(List<SurveyQuestion> questions, CancellationToken cancellationToken)
    {
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);
        await using var tx = await conn.BeginTransactionAsync(cancellationToken);

        try
        {
            var activeIds = new List<string>();
            foreach (var q in questions) activeIds.Add(q.Id);

            await using var deleteCmd = conn.CreateCommand();
            deleteCmd.Transaction = tx;
            if (activeIds.Count > 0)
            {
                deleteCmd.CommandText = "UPDATE survey_questions SET is_deleted = true WHERE NOT (id = ANY(@activeIds))";
                deleteCmd.Parameters.AddWithValue("activeIds", activeIds.ToArray());
            }
            else
            {
                deleteCmd.CommandText = "UPDATE survey_questions SET is_deleted = true";
            }
            await deleteCmd.ExecuteNonQueryAsync(cancellationToken);

            foreach (var q in questions)
            {
                await using var insertCmd = conn.CreateCommand();
                insertCmd.Transaction = tx;
                insertCmd.CommandText = @"
INSERT INTO survey_questions (id, text, type, order_no, is_deleted) 
VALUES (@id, @text, @type, @order_no, false)
ON CONFLICT (id) DO UPDATE SET text = EXCLUDED.text, type = EXCLUDED.type, order_no = EXCLUDED.order_no, is_deleted = false";
                insertCmd.Parameters.AddWithValue("id", q.Id);
                insertCmd.Parameters.AddWithValue("text", q.Text.Trim());
                insertCmd.Parameters.AddWithValue("type", q.Type.Trim());
                insertCmd.Parameters.AddWithValue("order_no", q.OrderNo);
                await insertCmd.ExecuteNonQueryAsync(cancellationToken);
            }

            await tx.CommitAsync(cancellationToken);
        }
        catch
        {
            await tx.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task<List<SurveyResponseDto>> GetResponsesAsync(CancellationToken cancellationToken)
    {
        var list = new List<SurveyResponseDto>();
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT id, submitted_at, name, email, phone, answers_json FROM survey_responses ORDER BY submitted_at DESC";
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            list.Add(new SurveyResponseDto
            {
                Id = reader.GetInt32(0),
                SubmittedAt = reader.GetDateTime(1),
                Name = reader.GetString(2),
                Email = reader.GetString(3),
                Phone = reader.GetString(4),
                AnswersJson = reader.GetString(5)
            });
        }
        return list;
    }

    public async Task SaveResponseAsync(SurveyResponseDto response, CancellationToken cancellationToken)
    {
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
INSERT INTO survey_responses (name, email, phone, answers_json, submitted_at)
VALUES (@name, @email, @phone, @answers_json, (now() AT TIME ZONE 'utc'))";
        cmd.Parameters.AddWithValue("name", response.Name.Trim());
        cmd.Parameters.AddWithValue("email", response.Email.Trim());
        cmd.Parameters.AddWithValue("phone", response.Phone.Trim());
        cmd.Parameters.AddWithValue("answers_json", response.AnswersJson);
        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }
}

public sealed class SurveyQuestion
{
    public string Id { get; set; } = "";
    public string Text { get; set; } = "";
    public string Type { get; set; } = ""; // "star" or "text"
    public int OrderNo { get; set; } = 0;
    public bool IsDeleted { get; set; } = false;
}

public sealed class SurveyResponseDto
{
    public int Id { get; set; }
    public DateTime SubmittedAt { get; set; }
    public string Name { get; set; } = "";
    public string Email { get; set; } = "";
    public string Phone { get; set; } = "";
    public string AnswersJson { get; set; } = "";
}
