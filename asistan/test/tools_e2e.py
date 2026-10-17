# -*- coding: utf-8 -*-
"""Asistan 3. aşama (ERP/Servis araçları) uçtan uca denemesi — sahte sınıflandırıcıyla.

Çalıştırmadan önce lokal ayakta olmalı:
  - asistan-api :5160 (Development, Ai:Provider boş = fake), Tools anahtarları appsettings.Local.json'da
  - erp-api :5200 (Asistan:InternalApiKey appsettings.Local.json'da)
  - serviceops-api :5137 (Asistan:InternalApiKey appsettings.Development.json'da)

Yerel veri (DEMO): 120-01-000001 DUMIKA telefonu 5253215123; servis kayıtları 5338000000 numaralı.
Konuşmalar sonda cleanup.sql ile silinir (deneme numaraları 90500000… ve aşağıdaki iki gerçek numara).

  python -I -X utf8 tools_e2e.py
"""
import io, json, sys, time, urllib.request, urllib.error
import jwt  # PyJWT

BASE = "http://localhost:5160"
ROOT = r"C:\Users\Admin\Desktop\B2B-ERP"
cfg = json.loads(io.open(ROOT + r"\asistan\Asistan.Api\appsettings.Local.json", encoding="utf-8-sig").read())
TOKEN = jwt.encode({"tenant": "DEMO", "user": "asistan.deneme", "ssa": "1", "iss": "asistan-api", "aud": "asistan-frontend",
                    "exp": int(time.time()) + 3600, "iat": int(time.time())}, cfg["AsistanJwt"]["SecretKey"], algorithm="HS256")

CARI_TEL = "905253215123"      # 120-01-000001 DUMIKA
SERVIS_TEL = "905338000000"    # servis/montaj kayıtları bu numarada, cari yok
YABANCI_TEL = "905000000091"   # hiçbir şeyle eşleşmez

ok, fail = 0, []


def check(name, cond, extra=""):
    global ok
    if cond:
        ok += 1
        print("  [+] " + name)
    else:
        fail.append(name + (" — " + str(extra)[:300] if extra != "" else ""))
        print("  [X] " + name + (" — " + str(extra)[:300] if extra != "" else ""))


def call(path, method="GET", body=None, anon=False):
    req = urllib.request.Request(BASE + path, method=method)
    if not anon:
        req.add_header("Authorization", "Bearer " + TOKEN)
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, data, timeout=60) as r:
            raw = r.read().decode("utf-8")
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw


def inbound(phone, text):
    st, _ = call("/dev/whatsapp/inbound", "POST", {"from": phone, "name": "Araç Deneme", "text": text}, anon=True)
    assert st == 200, st


def conv_of(phone):
    st, d = call("/api/panel/conversations?pageSize=200&folder=all&q=" + phone)
    return next((c for c in d["items"] if c["waId"] == phone), None)


def wait_draft(conv_id, after_id=0, timeout=40):
    end = time.time() + timeout
    while time.time() < end:
        st, d = call("/api/panel/conversations/%d/messages" % conv_id)
        if d.get("draft") and d["draft"]["id"] > after_id:
            return d["conversation"], d["draft"]
        if d["conversation"]["ai"].get("error"):
            return d["conversation"], None
        time.sleep(1.5)
    return None, None


def tools_of(draft):
    return {t["name"]: t for t in (draft or {}).get("toolCalls") or []}


def discard(conv_id, draft):
    if draft:
        call("/api/panel/conversations/%d/drafts/%d/discard" % (conv_id, draft["id"]), "POST")


print("== 0) ayarlar: araçlar hazır ve açık")
st, s = call("/api/panel/settings")
check("ayarlar 200", st == 200, st)
tools = s["ai"].get("tools") or {}
check("ERP bağlantısı hazır", tools.get("erp") is True, tools)
check("Servis bağlantısı hazır", tools.get("serviceOps") is True, tools)
check("dört araç tanımlı", sorted(tools.get("names", [])) == sorted(["cari_bakiye", "siparisler", "faturalar", "servis_montaj_kayitlari"]), tools.get("names"))
call("/api/panel/settings/ai", "PUT", {"enabled": True, "autoRoute": True, "toolsEnabled": True, "instructions": "", "initiativeTopics": ""})
st, s = call("/api/panel/settings")
check("araçlar açık okundu", s["ai"]["toolsEnabled"] is True, s["ai"]["toolsEnabled"])

print("== 1) cari numarası: bakiye + sipariş + fatura")
inbound(CARI_TEL, "Merhaba bakiyem ne kadar? Son siparişim ne oldu, faturamı da gönderir misiniz?")
c = conv_of(CARI_TEL)
check("konuşma açıldı", c is not None)
conv, d = wait_draft(c["id"])
check("taslak geldi", d is not None, conv and conv["ai"])
t = tools_of(d)
check("bakiye aracı çağrıldı ve başarılı", t.get("cari_bakiye", {}).get("ok") is True, t.get("cari_bakiye"))
check("bakiye özeti TL içeriyor", "TL" in t.get("cari_bakiye", {}).get("summary", ""), t.get("cari_bakiye"))
check("sipariş aracı kayıt buldu", t.get("siparisler", {}).get("summary", "").endswith("sipariş") and t["siparisler"]["ok"], t.get("siparisler"))
check("fatura aracı kayıt buldu", t.get("faturalar", {}).get("summary", "").endswith("fatura") and t["faturalar"]["ok"], t.get("faturalar"))
check("taslakta kayıt bilgisi var (DUMIKA)", "DUMIKA" in (d or {}).get("body", ""), (d or {}).get("body", "")[:200])
check("servis aracı bu mesajda çağrılmadı", "servis_montaj_kayitlari" not in t, list(t))
discard(c["id"], d)

print("== 2) servis numarası: montaj durumu (cari yok, telefonla eşleşir)")
inbound(SERVIS_TEL, "Montaj ne zaman yapılacak?")
c2 = conv_of(SERVIS_TEL)
conv2, d2 = wait_draft(c2["id"])
t2 = tools_of(d2)
check("servis aracı çağrıldı", "servis_montaj_kayitlari" in t2, list(t2))
check("servis kayıtları bulundu", t2.get("servis_montaj_kayitlari", {}).get("summary", "").endswith("kayıt"), t2.get("servis_montaj_kayitlari"))
check("taslakta montaj numarası var", "MNT-" in (d2 or {}).get("body", ""), (d2 or {}).get("body", "")[:300])
check("montaj durumu kalemden türetilmiş (Gerçekleşti)", "Gerçekleşti" in (d2 or {}).get("body", ""), (d2 or {}).get("body", "")[:300])
discard(c2["id"], d2)

print("== 3) servis numarası bakiye sorarsa: cari eşleşmedi")
st, msgs = call("/api/panel/conversations/%d/messages" % c2["id"])
last_draft = 0
inbound(SERVIS_TEL, "Bakiyem ne kadar?")
conv3, d3 = wait_draft(c2["id"], last_draft)
t3 = tools_of(d3)
check("bakiye aracı 'Cari eşleşmedi' dedi", t3.get("cari_bakiye", {}).get("summary") == "Cari eşleşmedi", t3.get("cari_bakiye"))
check("başkasının bakiyesi sızmadı", "DUMIKA" not in (d3 or {}).get("body", ""), (d3 or {}).get("body", "")[:200])
discard(c2["id"], d3)

print("== 4) kapsam: yabancı numara başkasının kayıt numarasını yazarsa sonuç yok")
inbound(YABANCI_TEL, "MNT-0000006 numaralı montajım ne oldu? servis kaydım")
c4 = conv_of(YABANCI_TEL)
conv4, d4 = wait_draft(c4["id"])
t4 = tools_of(d4)
check("servis aracı çağrıldı (kayıt no ile)", t4.get("servis_montaj_kayitlari", {}).get("query") == "MNT-0000006", t4.get("servis_montaj_kayitlari"))
check("yabancı numaraya kayıt dönmedi", t4.get("servis_montaj_kayitlari", {}).get("summary") == "kayıt bulunamadı", t4.get("servis_montaj_kayitlari"))
check("taslakta başkasının kaydı yok", "MONTAJ TEST" not in (d4 or {}).get("body", ""), (d4 or {}).get("body", "")[:300])
discard(c4["id"], d4)

print("== 5) araçlar kapalıyken çağrılmaz")
call("/api/panel/settings/ai", "PUT", {"enabled": True, "autoRoute": True, "toolsEnabled": False, "instructions": "", "initiativeTopics": ""})
st, before = call("/api/panel/conversations/%d/messages" % c["id"])
inbound(CARI_TEL, "Bakiyem ne kadar acaba?")
conv5, d5 = wait_draft(c["id"])
check("taslak yine geldi", d5 is not None)
check("araç çağrısı yok", not (d5 or {}).get("toolCalls"), (d5 or {}).get("toolCalls"))
discard(c["id"], d5)
call("/api/panel/settings/ai", "PUT", {"enabled": True, "autoRoute": True, "toolsEnabled": True, "instructions": "", "initiativeTopics": ""})

print()
print("SONUC: %d gecti, %d kaldi" % (ok, len(fail)))
for f in fail:
    print("  KALAN: " + f)
sys.exit(1 if fail else 0)
