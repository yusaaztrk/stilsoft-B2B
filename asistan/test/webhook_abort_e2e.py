# -*- coding: utf-8 -*-
"""İLK MESAJ KAYBI denemesi (2026-10-11).
Canlıdaki durum taklit edilir: ERP yavaş (Customers tablosu 8 sn kilitli) + Meta bağlantıyı 1 sn'de keser.
Beklenen: mesaj YİNE kaydedilir, cari eşleşmesi 5 sn'de bırakılır. Önce test/cleanup.sql çalıştırın.
İmza appsettings.Local.json'daki AppSecret ile atılır (değer ekrana basılmaz)."""
import hashlib, hmac, io, json, socket, subprocess, threading, time, uuid

HOST, PORT = "127.0.0.1", 5160
ASISTAN_DB, ERP_DB = "b2b_asistan_tenant_DEMO", "b2b_erp_tenant_DEMO"
CFG = json.load(io.open(r"C:\Users\Admin\Desktop\B2B-ERP\asistan\Asistan.Api\appsettings.Local.json", encoding="utf-8-sig"))
SECRET = CFG["WhatsApp"]["AppSecret"].encode()
PNID = next(iter(CFG["WhatsApp"]["Numbers"]))
ok, fail = 0, []

def check(n, c, e=""):
    global ok
    if c: ok += 1; print("  [+] " + n)
    else: fail.append(n); print("  [X] " + n + (" — " + str(e) if e else ""))

def psql(db, sql):
    r = subprocess.run(["docker", "exec", "-i", "b2b-erp-db", "psql", "-U", "b2b", "-d", db, "-At", "-c", sql], capture_output=True, text=True)
    return r.stdout.strip()

def payload(wa, wamid, text):
    return json.dumps({"object": "whatsapp_business_account", "entry": [{"id": "WABA.DEV", "changes": [{"field": "messages", "value": {
        "messaging_product": "whatsapp", "metadata": {"display_phone_number": "905330000000", "phone_number_id": PNID},
        "contacts": [{"profile": {"name": "Kopan Bağlantı"}, "wa_id": wa}],
        "messages": [{"from": wa, "id": wamid, "timestamp": str(int(time.time())), "type": "text", "text": {"body": text}}]}}]}]}).encode()

def send_and_hang_up(body, after):
    sig = "sha256=" + hmac.new(SECRET, body, hashlib.sha256).hexdigest()
    s = socket.create_connection((HOST, PORT))
    s.sendall(("POST /webhook/whatsapp HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\n"
               "X-Hub-Signature-256: %s\r\nContent-Length: %d\r\n\r\n" % (sig, len(body))).encode() + body)
    time.sleep(after)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, b"\x01\x00\x00\x00\x00\x00\x00\x00")  # RST — sert kesme
    s.close()

def locker(seconds, ready):
    p = subprocess.Popen(["docker", "exec", "-i", "b2b-erp-db", "psql", "-U", "b2b", "-d", ERP_DB, "-q"], stdin=subprocess.PIPE, text=True)
    p.stdin.write('BEGIN; LOCK TABLE public."Customers" IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(%d); COMMIT;\n' % seconds)
    p.stdin.close(); ready.set(); p.wait()

print("== 1) ERP kilitli (8 sn) + Meta 1 sn'de bağlantıyı kesiyor, YENİ konuşma")
wa = "90500000" + str(int(time.time()))[-4:]
wamid = "wamid.ABORT." + uuid.uuid4().hex
ready = threading.Event()
t = threading.Thread(target=locker, args=(8, ready)); t.start(); ready.wait(); time.sleep(1.0)
t0 = time.time()
send_and_hang_up(payload(wa, wamid, "ilk mesaj — bağlantı kopacak"), 1.0)
saved = ""
for _ in range(30):
    saved = psql(ASISTAN_DB, "SELECT count(*) FROM public.messages WHERE wamid = '%s'" % wamid)
    if saved == "1": break
    time.sleep(0.5)
el = time.time() - t0
check("bağlantı koptuğu hâlde mesaj kaydedildi", saved == "1", saved)
check("ERP beklenmedi: kayıt ~5 sn içinde (kilit 8 sn)", el < 7.5, "%.1f sn" % el)
conv = psql(ASISTAN_DB, "SELECT count(*) FROM public.conversations WHERE wa_id = '%s'" % wa)
check("konuşma açıldı", conv == "1", conv)
t.join()

print("== 2) Meta aynı mesajı yeniden yollarsa çift kayıt olmaz")
send_and_hang_up(payload(wa, wamid, "ilk mesaj — bağlantı kopacak"), 2.0)
time.sleep(1.0)
check("wamid tekil", psql(ASISTAN_DB, "SELECT count(*) FROM public.messages WHERE wamid = '%s'" % wamid) == "1")

print("== 3) ERP normal, bağlantı gövde gider gitmez kesiliyor (0.2 sn)")
wa2 = "90500000" + str(int(time.time()) + 5000)[-4:]
w2 = "wamid.ABORT." + uuid.uuid4().hex
send_and_hang_up(payload(wa2, w2, "ikinci deneme"), 0.2)
r = ""
for _ in range(20):
    r = psql(ASISTAN_DB, "SELECT count(*) FROM public.messages WHERE wamid = '%s'" % w2)
    if r == "1": break
    time.sleep(0.5)
check("anında kesilen bağlantıda da kaydedildi", r == "1", r)

print()
print("SONUC: %d gecti, %d kaldi" % (ok, len(fail)))
for f in fail: print("  KALAN: " + f)
