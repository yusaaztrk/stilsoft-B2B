using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using EmailService.Application.Abstractions;
using Microsoft.Extensions.Configuration;

namespace EmailService.Infrastructure.Encryption;

public class AesEncryptionService : IEncryptionService
{
    private readonly byte[] _key;

    public AesEncryptionService(IConfiguration configuration)
    {
        string secret = configuration["Encryption:SecretKey"] ?? "ERP_EmailService_Fallback_Secret_Key_32_Bytes_Long!";
        
        using var sha256 = SHA256.Create();
        _key = sha256.ComputeHash(Encoding.UTF8.GetBytes(secret));
    }

    public string Encrypt(string plainText)
    {
        if (string.IsNullOrEmpty(plainText)) return plainText;

        using var aes = Aes.Create();
        aes.Key = _key;
        aes.GenerateIV();
        var iv = aes.IV;

        using var encryptor = aes.CreateEncryptor(aes.Key, aes.IV);
        using var ms = new MemoryStream();
        
        // Write dynamic IV to the beginning of the stream
        ms.Write(iv, 0, iv.Length);

        using (var cs = new CryptoStream(ms, encryptor, CryptoStreamMode.Write))
        using (var sw = new StreamWriter(cs))
        {
            sw.Write(plainText);
        }

        return Convert.ToBase64String(ms.ToArray());
    }

    public string Decrypt(string cipherText)
    {
        if (string.IsNullOrEmpty(cipherText)) return cipherText;

        byte[] fullCipher = Convert.FromBase64String(cipherText);

        using var aes = Aes.Create();
        aes.Key = _key;

        var ivSize = aes.BlockSize / 8;
        if (fullCipher.Length < ivSize)
            throw new InvalidOperationException("Invalid ciphertext. Size is smaller than IV block size.");

        var iv = new byte[ivSize];
        var cipher = new byte[fullCipher.Length - ivSize];

        Buffer.BlockCopy(fullCipher, 0, iv, 0, ivSize);
        Buffer.BlockCopy(fullCipher, ivSize, cipher, 0, cipher.Length);

        aes.IV = iv;

        using var decryptor = aes.CreateDecryptor(aes.Key, aes.IV);
        using var ms = new MemoryStream(cipher);
        using var cs = new CryptoStream(ms, decryptor, CryptoStreamMode.Read);
        using var sr = new StreamReader(cs);

        return sr.ReadToEnd();
    }
}
