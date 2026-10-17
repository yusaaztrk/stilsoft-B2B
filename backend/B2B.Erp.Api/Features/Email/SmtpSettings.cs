namespace B2B.Erp.Api.Features.Email;

public class SmtpSettings
{
    public string Host { get; set; } = "smtp.gmail.com";
    public int Port { get; set; } = 587;
    public bool EnableSsl { get; set; } = true;
    public string SenderEmail { get; set; } = "";
    public string SenderName { get; set; } = "B2B ERP Rapor Servisi";
    public string Username { get; set; } = "";
    public string Password { get; set; } = "";
}
