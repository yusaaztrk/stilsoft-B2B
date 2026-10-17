FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS base
WORKDIR /app
EXPOSE 8080
EXPOSE 8081

FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY ["src/EmailService.Api/EmailService.Api.csproj", "src/EmailService.Api/"]
COPY ["src/EmailService.Infrastructure/EmailService.Infrastructure.csproj", "src/EmailService.Infrastructure/"]
COPY ["src/EmailService.Application/EmailService.Application.csproj", "src/EmailService.Application/"]
COPY ["src/EmailService.Domain/EmailService.Domain.csproj", "src/EmailService.Domain/"]
RUN dotnet restore "src/EmailService.Api/EmailService.Api.csproj"
COPY . .
WORKDIR "/src/src/EmailService.Api"
RUN dotnet build "EmailService.Api.csproj" -c Release -o /app/build

FROM build AS publish
RUN dotnet publish "EmailService.Api.csproj" -c Release -o /app/publish /p:UseAppHost=false

FROM base AS final
WORKDIR /app
COPY --from=publish /app/publish .
ENTRYPOINT ["dotnet", "EmailService.Api.dll"]
