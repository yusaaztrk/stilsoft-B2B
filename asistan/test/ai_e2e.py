# -*- coding: utf-8 -*-
"""Asistan 2. asama (yapay zeka taslagi) uctan uca denemesi — sahte siniflandirici ile.

Calistirmadan once: asistan-api :5160 Development'ta ayakta olmali (Ai:Provider bos = fake).
Test numaralari 9050000xxxxx ile baslar; sonunda DB'den silinir.
"""
import io, json, time, sys, uuid, datetime, urllib.request, urllib.error
import jwt  # PyJWT

BASE = "http://localhost:5160"
LOCAL = r"C:\Users\Admin\Desktop\B2B-ERP\asistan\Asistan.Api\appsettings.Local.json"
PREFIX = "90500000"

cfg = json.loads(io.open(LOCAL, encoding="utf-8-sig").read())
SECRET = cfg["AsistanJwt"]["SecretKey"]

TOKEN = jwt.encode(
    {
        "tenant": "DEMO", "user": "asistan.deneme", "ssa": "1",
        "iss": "asistan-api", "aud": "asistan-frontend",
        "exp": int(time.time()) + 3600, "iat": int(time.time()),
    },
    SECRET, algorithm="HS256")

ok = 0
fail = []


def check(name, cond, extra=""):
    global ok
    if cond:
        ok += 1
        print("  [+] " + name)
    else:
        fail.append(name + ((" — " + str(extra)) if extra else ""))
        print("  [X] " + name + ((" — " + str(extra)) if extra else ""))


def call(path, method="GET", body=None, anon=False):
    req = urllib.request.Request(BASE + path, method=method)
    if not anon:
        req.add_header("Authorization", "Bearer " + TOKEN)
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, data, timeout=30) as r:
            raw = r.read().decode("utf-8")
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw


def inbound(phone, text, name="Deneme"):
    st, _ = call("/dev/whatsapp/inbound", "POST", {"from": phone, "name": name, "text": text}, anon=True)
    assert st == 200, st
    return st


def find_conv(phone):
    st, d = call("/api/panel/conversations?pageSize=200&folder=all&q=" + phone)
    assert st == 200, (st, d)
    for c in d["items"]:
        if c["waId"] == phone:
            return c
    return None


def wait_draft(conv_id, timeout=25, want=True):
    """Taslak gelene (ya da gelmedigine) kadar bekler; (conversation, draft) doner."""
    end = time.time() + timeout
    last = (None, None)
    while time.time() < end:
        st, d = call("/api/panel/conversations/%d/messages" % conv_id)
        assert st == 200, (st, d)
        last = (d["conversation"], d["draft"])
        if want and d["draft"]:
            return last
        if not want and time.time() > end - timeout + 12:
            return last
        time.sleep(1.5)
    return last


def wait_error(conv_id, timeout=25):
    end = time.time() + timeout
    conv = None
    while time.time() < end:
        st, d = call("/api/panel/conversations/%d/messages" % conv_id)
        conv = d["conversation"]
        if conv["ai"].get("error"):
            return conv
        time.sleep(1.5)
    return conv


print("== 0) durum ve ayarlar")
st, status = call("/api/panel/status")
check("status 200", st == 200, st)
check("saglayici fake", status.get("aiProvider") == "fake", status.get("aiProvider"))

st, s = call("/api/panel/settings")
check("ayarlar 200 + ai blogu", st == 200 and "ai" in s, st)
check("ayarlarda model var", bool(s["ai"].get("model")), s["ai"] if st == 200 else "")
dep_codes = {d["code"]: d for d in s["departments"]}
check("birimler tanimli (teknik_servis)", "teknik_servis" in dep_codes, list(dep_codes)[:3])

st, _ = call("/api/panel/settings/ai", "PUT", {
    "enabled": True, "autoRoute": True,
    "instructions": "Musteriye siz diye hitap et. Fiyat sozu verme.",
    "initiativeTopics": "iskonto\nindirim"})
check("ai ayari kaydedildi", st == 200, st)
st, s = call("/api/panel/settings")
check("ai acik olarak geri okundu", s["ai"]["enabled"] and s["ai"]["autoRoute"], s["ai"])
check("talimat geri okundu", s["ai"]["instructions"].startswith("Musteriye siz"), s["ai"]["instructions"])

print("== 1) musteri yaziyor -> taslak + ozet + otomatik yonlendirme")
p1 = PREFIX + "0001"
inbound(p1, "Merhaba klimam arıza yaptı, sürekli ses yapıyor")
c = find_conv(p1)
check("konusma acildi", c is not None, p1)
conv, draft = wait_draft(c["id"])
check("taslak geldi", bool(draft), conv["ai"])
check("taslak metni dolu", bool(draft and draft["body"].strip()), draft)
check("ozet yazildi", bool(conv["ai"]["summary"]), conv["ai"])
check("konu yazildi", bool(conv["ai"]["topic"]), conv["ai"])
check("insan gerekli degil", draft and draft["needsHuman"] is False, draft)
check("otomatik Teknik Servis'e dustu", conv["departmentName"] == dep_codes["teknik_servis"]["name"], conv["departmentName"])
check("hata yok", not conv["ai"].get("error"), conv["ai"].get("error"))

print("== 2) duzeltilerek gonderim + ikinci gonderim 409")
edited = "Merhaba, servis ekibimiz en kisa surede donus yapacak. (duzeltildi)"
st, d = call("/api/panel/conversations/%d/drafts/%d/send" % (c["id"], draft["id"]), "POST", {"text": edited})
check("taslak gonderildi 200", st == 200, (st, d))
check("gonderilen metin duzeltilmis metin", st == 200 and d["item"]["body"] == edited, d)
check("mesaj taslaktan isaretli", st == 200 and d["item"]["fromDraft"] is True, d)
st2, d2 = call("/api/panel/conversations/%d/drafts/%d/send" % (c["id"], draft["id"]), "POST", {"text": "tekrar"})
check("ayni taslak ikinci kez 409", st2 == 409 and d2.get("code") == "DRAFT_NOT_PENDING", (st2, d2))
st3, d3 = call("/api/panel/conversations/%d/messages" % c["id"])
check("gonderimden sonra bekleyen taslak yok", d3["draft"] is None, d3["draft"])
check("cevaplandi: bekleme bitti", d3["conversation"]["awaitingReply"] is False, d3["conversation"]["awaitingReply"])

print("== 3) inisiyatif konusu -> insan gerekli, sonra sil")
p2 = PREFIX + "0002"
inbound(p2, "Bu urunde iskonto yapar misiniz?")
c2 = find_conv(p2)
conv2, draft2 = wait_draft(c2["id"])
check("iskonto taslagi geldi", bool(draft2), conv2["ai"])
check("insan karari gerekli damgasi", draft2 and draft2["needsHuman"] is True, draft2)
st, _ = call("/api/panel/conversations/%d/drafts/%d/discard" % (c2["id"], draft2["id"]), "POST")
check("taslak silindi", st == 200, st)
st, d = call("/api/panel/conversations/%d/messages" % c2["id"])
check("silinen taslak artik gelmiyor", d["draft"] is None, d["draft"])
st, _ = call("/api/panel/conversations/%d/drafts/%d/discard" % (c2["id"], draft2["id"]), "POST")
check("ikinci silme 409", st == 409, st)

print("== 4) yeniden dene -> yeni taslak")
st, _ = call("/api/panel/conversations/%d/ai/retry" % c2["id"], "POST")
check("yeniden dene 202", st == 202, st)
conv2b, draft2b = wait_draft(c2["id"])
check("yeni taslak uretildi", bool(draft2b) and draft2b["id"] != draft2["id"], draft2b)

print("== 5) asistan hata verirse ekranda gorunur")
p3 = PREFIX + "0003"
inbound(p3, "[yz-hata] deneme")
c3 = find_conv(p3)
conv3 = wait_error(c3["id"])
check("hata metni konusmaya yazildi", bool(conv3["ai"].get("error")), conv3["ai"])
st, d = call("/api/panel/conversations/%d/messages" % c3["id"])
check("hatada taslak yok", d["draft"] is None, d["draft"])

print("== 6) otomatik yonlendirme kapaliyken birim degismez")
call("/api/panel/settings/ai", "PUT", {"enabled": True, "autoRoute": False, "instructions": "", "initiativeTopics": "iskonto"})
p4 = PREFIX + "0004"
inbound(p4, "Faturami gonderebilir misiniz, bakiyem nedir?")
c4 = find_conv(p4)
conv4, draft4 = wait_draft(c4["id"])
check("taslak yine geldi", bool(draft4), conv4["ai"])
check("birim atanmamis kaldi", conv4["departmentId"] is None, conv4["departmentName"])
check("konu yine yazildi", bool(conv4["ai"]["topic"]), conv4["ai"])

print("== 7) asistan kapaliyken taslak uretilmez")
call("/api/panel/settings/ai", "PUT", {"enabled": False, "autoRoute": False, "instructions": "", "initiativeTopics": ""})
p5 = PREFIX + "0005"
inbound(p5, "Klimam ariza yapti")
c5 = find_conv(p5)
conv5, draft5 = wait_draft(c5["id"], timeout=16, want=False)
check("kapaliyken taslak yok", draft5 is None, draft5)
check("kapaliyken ozet de yok", not conv5["ai"].get("summary"), conv5["ai"])
st, d = call("/api/panel/conversations/%d/ai/retry" % c5["id"], "POST")
check("kapaliyken yeniden dene 409", st == 409 and d.get("code") == "AI_DISABLED", (st, d))

# ayarlari denemeden onceki makul hale getir
call("/api/panel/settings/ai", "PUT", {"enabled": True, "autoRoute": True, "instructions": "", "initiativeTopics": ""})

print("== 8) 30 gunluk taslak sayaci")
st, s = call("/api/panel/settings")
stats = s["ai"]["draftStats30d"]
check("sayacta 'edited' var", stats.get("edited", 0) >= 1, stats)
check("sayacta 'discarded' var", stats.get("discarded", 0) >= 1, stats)

print()
print("SONUC: %d gecti, %d kaldi" % (ok, len(fail)))
for f in fail:
    print("  KALAN: " + f)
sys.exit(1 if fail else 0)
