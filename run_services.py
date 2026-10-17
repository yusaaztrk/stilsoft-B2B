#!/usr/bin/env python3
import os
import sys
import subprocess
import time
import platform

# Enable ANSI colors in Windows CMD if applicable
if sys.platform == 'win32':
    try:
        import ctypes
        kernel32 = ctypes.windll.kernel32
        kernel32.SetConsoleMode(kernel32.GetStdHandle(-11), 7)
    except Exception:
        pass

# ANSI Colors
CLR_RESET = "\033[0m"
CLR_RED = "\033[91m"
CLR_GREEN = "\033[92m"
CLR_YELLOW = "\033[93m"
CLR_BLUE = "\033[94m"
CLR_CYAN = "\033[96m"
CLR_WHITE = "\033[97m"
CLR_BOLD = "\033[1m"

# Service configuration registry
SERVICES = {
    "backends": [
        {
            "name": "B2B ERP API (Main)",
            "path": "backend/B2B.Erp.Api",
            "cmd": "dotnet run",
            "port": 5200
        },
        {
            "name": "Ecommerce API",
            "path": "ecommerce-backend/Ecommerce.Api",
            "cmd": "dotnet run",
            "port": 5288
        },
        {
            "name": "Employee Service API",
            "path": "employee-service/Employee.Service.Api",
            "cmd": "dotnet run",
            # launchSettings.json ile ayni olmali; burada 5055 yaziyordu.
            "port": 5108
        },
        {
            "name": "Service Ops API",
            "path": "service-ops/service-ops-api",
            "cmd": "dotnet run",
            "port": 5137
        }
    ],
    "frontends": [
        {
            "name": "B2B ERP Frontend",
            "path": "frontend",
            "cmd": "npm run dev",
            "port": 5173
        },
        {
            "name": "Ecommerce Frontend",
            "path": "ecommerce-frontend",
            "cmd": "npm run dev",
            "port": 5180
        },
        {
            "name": "Employee Portal",
            "path": "employee-service/employee-portal",
            "cmd": "npm run dev",
            # vite.config.ts ile ayni olmali; 5176 Service Ops Frontend ile cakisiyordu.
            "port": 5175
        },
        {
            "name": "Service Ops Frontend",
            "path": "service-ops/service-ops-frontend",
            "cmd": "npm run dev",
            "port": 5176
        }
    ]
}

# List of currently running subprocesses: (name, Popen_object)
running_processes = []

def print_header(title):
    print(f"\n{CLR_BLUE}{'=' * 60}{CLR_RESET}")
    print(f"{CLR_CYAN}{CLR_BOLD}  {title}{CLR_RESET}")
    print(f"{CLR_BLUE}{'=' * 60}{CLR_RESET}")

def start_docker():
    print_header("1. Docker Infrastructure starting...")
    if not os.path.exists("docker-compose.yml"):
        print(f"{CLR_RED}[HATA] docker-compose.yml dosyası bulunamadı!{CLR_RESET}")
        return False
    
    try:
        print(f"{CLR_YELLOW}docker compose up -d çalıştırılıyor...{CLR_RESET}")
        # Run docker compose and wait for it
        res = subprocess.run(["docker", "compose", "up", "-d"], capture_output=True, text=True)
        if res.returncode == 0:
            print(f"{CLR_GREEN}[BAŞARILI] Docker servisleri (Veritabanları, Redis, Face-Service) başlatıldı!{CLR_RESET}")
            print(res.stdout)
            return True
        else:
            # Fallback to docker-compose legacy command
            print(f"{CLR_YELLOW}docker-compose (legacy) deneniyor...{CLR_RESET}")
            res_legacy = subprocess.run(["docker-compose", "up", "-d"], capture_output=True, text=True)
            if res_legacy.returncode == 0:
                print(f"{CLR_GREEN}[BAŞARILI] Docker servisleri (legacy) başlatıldı!{CLR_RESET}")
                return True
            else:
                print(f"{CLR_RED}[HATA] Docker başlatılamadı. Docker Desktop'ın açık olduğundan emin olun!{CLR_RESET}")
                print(res_legacy.stderr or res.stderr)
                return False
    except Exception as e:
        print(f"{CLR_RED}[HATA] Docker komutu çalıştırılamadı: {e}{CLR_RESET}")
        return False

def check_dotnet_ef():
    try:
        res = subprocess.run(["dotnet", "ef", "--version"], capture_output=True, text=True)
        return res.returncode == 0
    except Exception:
        return False

def run_migrations():
    print_header("2. Database Migrations (EF Core Update) running...")
    
    migrations = [
        {
            "name": "ERP - AppDbContext",
            "cmd": ["dotnet", "ef", "database", "update", "--context", "AppDbContext", "--project", "backend/B2B.Erp.Api", "--startup-project", "backend/B2B.Erp.Api"]
        },
        {
            "name": "ERP - MasterDbContext",
            "cmd": ["dotnet", "ef", "database", "update", "--context", "MasterDbContext", "--project", "backend/B2B.Erp.Api", "--startup-project", "backend/B2B.Erp.Api"]
        },
        {
            "name": "Service Ops - ApplicationDbContext",
            "cmd": ["dotnet", "ef", "database", "update", "--context", "ApplicationDbContext", "--project", "service-ops/service-ops-api/ServiceOps.Infrastructure", "--startup-project", "service-ops/service-ops-api"]
        }
    ]
    
    for mig in migrations:
        print(f"\n{CLR_YELLOW}{mig['name']} güncelleniyor...{CLR_RESET}")
        try:
            res = subprocess.run(mig["cmd"], capture_output=True, text=True)
            if res.returncode == 0:
                print(f"{CLR_GREEN}[BAŞARILI] {mig['name']} güncellendi!{CLR_RESET}")
            else:
                print(f"{CLR_YELLOW}[UYARI] {mig['name']} direkt güncellenemedi. Detay:{CLR_RESET}")
                print(res.stderr or res.stdout)
                if "ERP -" in mig["name"]:
                    print(f"{CLR_CYAN}[BİLGİ] Endişelenmeyin, backend projesi çalışırken otomatik migration uygulayacaktır.{CLR_RESET}")
        except Exception as e:
            print(f"{CLR_RED}[HATA] {mig['name']} güncellenirken hata oluştu: {e}{CLR_RESET}")

def restore_and_build():
    print_header("3. Restoring Dependencies & Building Projects...")
    
    # Restore and Build dotnet projects
    print(f"{CLR_YELLOW}Dotnet projeleri restore ve build ediliyor...{CLR_RESET}")
    try:
        res = subprocess.run(["dotnet", "build"], capture_output=True, text=True)
        if res.returncode == 0:
            print(f"{CLR_GREEN}[BAŞARILI] Dotnet projeleri başarıyla build edildi!{CLR_RESET}")
        else:
            print(f"{CLR_RED}[HATA] Dotnet build başarısız oldu!{CLR_RESET}")
            print(res.stderr or res.stdout)
    except Exception as e:
        print(f"{CLR_RED}[HATA] Dotnet build çalıştırılamadı: {e}{CLR_RESET}")

    # Install npm packages for frontends if node_modules doesn't exist
    for fe in SERVICES["frontends"]:
        fe_path = fe["path"]
        node_modules_path = os.path.join(fe_path, "node_modules")
        if not os.path.exists(node_modules_path):
            print(f"\n{CLR_YELLOW}{fe['name']} için npm install çalıştırılıyor (node_modules eksik)...{CLR_RESET}")
            try:
                # Run npm install
                res = subprocess.run(["npm", "install"], cwd=fe_path, shell=True)
                if res.returncode == 0:
                    print(f"{CLR_GREEN}[BAŞARILI] {fe['name']} bağımlılıkları yüklendi!{CLR_RESET}")
                else:
                    print(f"{CLR_RED}[HATA] {fe['name']} bağımlılık yükleme başarısız!{CLR_RESET}")
            except Exception as e:
                print(f"{CLR_RED}[HATA] {fe['name']} npm install çalıştırılamadı: {e}{CLR_RESET}")
        else:
            print(f"{CLR_GREEN}{fe['name']} bağımlılıkları zaten yüklü (node_modules mevcut).{CLR_RESET}")

def is_service_running(name):
    for n, _ in running_processes:
        if n == name:
            return True
    return False

def launch_service(service):
    if is_service_running(service["name"]):
        print(f"{CLR_YELLOW}[BİLGİ] {service['name']} zaten çalışıyor!{CLR_RESET}")
        return True
    
    print(f"{CLR_YELLOW}{service['name']} başlatılıyor...{CLR_RESET}")
    
    try:
        if sys.platform == 'win32':
            # Create a separate cmd console window for this service
            # /k keeps the window open after exit so the developer can see crash/error logs.
            cmd_string = f'title {service["name"]} && {service["cmd"]}'
            p = subprocess.Popen(
                ["cmd.exe", "/k", cmd_string],
                cwd=service["path"],
                creationflags=subprocess.CREATE_NEW_CONSOLE,
                shell=True
            )
        else:
            # Unix fallback: run in background (will merge logs, but keeps it running)
            p = subprocess.Popen(
                service["cmd"].split(),
                cwd=service["path"],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            )
            
        running_processes.append((service["name"], p))
        print(f"{CLR_GREEN}[BAŞARILI] {service['name']} yeni cmd penceresinde başlatıldı (PID: {p.pid}).{CLR_RESET}")
        return True
    except Exception as e:
        print(f"{CLR_RED}[HATA] {service['name']} başlatılamadı: {e}{CLR_RESET}")
        return False

def start_backends():
    print_header("4. Backend microservices starting...")
    success = True
    for service in SERVICES["backends"]:
        if not launch_service(service):
            success = False
        time.sleep(1) # Give a small gap between service launches
    return success

def start_frontends():
    print_header("5. Frontend portals starting...")
    success = True
    for service in SERVICES["frontends"]:
        if not launch_service(service):
            success = False
        time.sleep(1)
    return success

def stop_all_services():
    global running_processes
    if not running_processes:
        print(f"{CLR_YELLOW}\nÇalışan aktif servis bulunmuyor.{CLR_RESET}")
        return
        
    print_header("Stopping All Active Services...")
    for name, proc in list(running_processes):
        print(f"{CLR_YELLOW}{name} (PID: {proc.pid}) durduruluyor...{CLR_RESET}")
        try:
            if sys.platform == 'win32':
                # taskkill /F /T kills the process tree (cmd.exe and all its dotnet/node child processes)
                subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)], capture_output=True)
            else:
                proc.terminate()
                proc.wait(timeout=2)
            print(f"{CLR_GREEN}[DURDURULDU] {name}{CLR_RESET}")
        except Exception as e:
            print(f"{CLR_RED}[HATA] {name} durdurulurken hata oluştu: {e}{CLR_RESET}")
            
    running_processes = []
    print(f"{CLR_GREEN}Tüm servisler durduruldu ve portlar serbest bırakıldı!{CLR_RESET}")

def print_status():
    print(f"\n{CLR_CYAN}{'='*25} SERVİS DURUMU {'='*25}{CLR_RESET}")
    
    # 1. Docker Status
    try:
        docker_res = subprocess.run(["docker", "ps", "--format", "{{.Names}}"], capture_output=True, text=True)
        containers = [c.strip() for c in docker_res.stdout.split('\n') if c.strip()]
        if containers:
            print(f"Docker Altyapısı: {CLR_GREEN}ÇALIŞIYOR ({len(containers)} Konteyner){CLR_RESET}")
            for c in containers:
                print(f"  - {c}")
        else:
            print(f"Docker Altyapısı: {CLR_RED}DURDURULDU / ÇALIŞMIYOR{CLR_RESET}")
    except Exception:
        print(f"Docker Altyapısı: {CLR_YELLOW}DURUM ALINAMADI (Docker kurulu mu?){CLR_RESET}")
        
    print("-" * 65)
    
    # 2. Backends Status
    print("Backend Mikroservisler:")
    for service in SERVICES["backends"]:
        status = f"{CLR_GREEN}ÇALIŞIYOR{CLR_RESET}" if is_service_running(service["name"]) else f"{CLR_RED}DURDURULDU{CLR_RESET}"
        print(f"  - {service['name']:<25}: {status}")
        
    print("-" * 65)
    
    # 3. Frontends Status
    print("Frontend Arayüzler:")
    for service in SERVICES["frontends"]:
        status = f"{CLR_GREEN}ÇALIŞIYOR{CLR_RESET}" if is_service_running(service["name"]) else f"{CLR_RED}DURDURULDU{CLR_RESET}"
        print(f"  - {service['name']:<25}: {status}")
        
    print(f"{CLR_CYAN}{'='*65}{CLR_RESET}")

def main_menu():
    while True:
        os.system('cls' if os.name == 'nt' else 'clear')
        print(f"\n{CLR_BLUE}{CLR_BOLD}" + "┌" + "─"*58 + "┐")
        print("│" + " "*14 + "B2B ERP MULTI-SERVICE LAUNCHER" + " "*14 + "│")
        print("└" + "─"*58 + "┘" + CLR_RESET)
        
        print_status()
        
        print(f"\n{CLR_CYAN}Menü Seçenekleri:{CLR_RESET}")
        print(f"  {CLR_GREEN}[1]{CLR_RESET} Docker Altyapısını Başlat (Veritabanları & Redis)")
        print(f"  {CLR_GREEN}[2]{CLR_RESET} Bağımlılıkları Yükle & Build Et (npm install & dotnet build)")
        print(f"  {CLR_GREEN}[3]{CLR_RESET} Veritabanı Migration'larını Çalıştır (dotnet ef update)")
        print(f"  {CLR_GREEN}[4]{CLR_RESET} Sadece Backend Mikroservislerini Çalıştır")
        print(f"  {CLR_GREEN}[5]{CLR_RESET} Sadece Frontend Arayüzlerini Çalıştır")
        print(f"  {CLR_BLUE}{CLR_BOLD}[6] HER ŞEYİ BAŞLAT (Docker -> Build -> Migration -> Servisler){CLR_RESET}")
        print(f"  {CLR_RED}[7] Çalışan Tüm Servisleri Durdur / Kapat{CLR_RESET}")
        print(f"  {CLR_WHITE}[0] Çıkış & Temizlik{CLR_RESET}")
        
        try:
            choice = input(f"\n{CLR_BOLD}Seçiminiz: {CLR_RESET}").strip()
        except KeyboardInterrupt:
            choice = '0'
            
        if choice == '1':
            start_docker()
            input("\nDevam etmek için Enter'a basın...")
        elif choice == '2':
            restore_and_build()
            input("\nDevam etmek için Enter'a basın...")
        elif choice == '3':
            run_migrations()
            input("\nDevam etmek için Enter'a basın...")
        elif choice == '4':
            start_backends()
            input("\nDevam etmek için Enter'a basın...")
        elif choice == '5':
            start_frontends()
            input("\nDevam etmek için Enter'a basın...")
        elif choice == '6':
            # 1. Start Docker
            if start_docker():
                print(f"\n{CLR_YELLOW}Veritabanlarının hazır olması için 5 saniye bekleniyor...{CLR_RESET}")
                time.sleep(5)
                # 2. Build and install dependencies
                restore_and_build()
                # 3. Run migrations
                run_migrations()
                # 4. Start backends
                start_backends()
                time.sleep(2)
                # 5. Start frontends
                start_frontends()
            input("\nHer şey başlatıldı! Devam etmek için Enter'a basın...")
        elif choice == '7':
            stop_all_services()
            input("\nDevam etmek için Enter'a basın...")
        elif choice == '0':
            stop_all_services()
            print(f"\n{CLR_GREEN}Görüşmek üzere! Çıkış yapılıyor...{CLR_RESET}\n")
            sys.exit(0)
        else:
            print(f"{CLR_RED}Geçersiz seçim! Lütfen menüdeki rakamlardan birini girin.{CLR_RESET}")
            time.sleep(1.5)

if __name__ == "__main__":
    # If the user runs the script, make sure they are in the directory containing run_services.py
    script_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(script_dir)
    main_menu()
