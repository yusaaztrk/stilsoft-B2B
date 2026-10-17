# -*- coding: utf-8 -*-
"""Asistan ROL / KAPSAM uçtan uca testi (2026-10-09, kullanıcı: "rollendirmeyi localde iyice test et").

Ne sınanır:
  - Programa GİRİŞ: B2B "Asistan (WhatsApp)" kutusu kapalı + süper olmayan rol → 403; süper yönetici rolü → girer.
  - Birim üyesi yalnız kendi biriminin konuşmalarını görür; başka birimin konuşmasına ADRESLE de erişemez (404),
    yazamaz, devredemez, not düşemez, önem veremez. Atanmamış kuyruğu göremez, oraya atamaz (403).
  - Devrettiği konuşma kapsamından çıkar (stillVisible=false, sonra 404).
  - "Hepsini gör": bütün birimler + atanmamış; Ayarlar'a GİREMEZ (yönetici değil).
  - Yönetici: Ayarlar, bekleme eşikleri (doğrulamalı), hazır cevap ekle/düzelt/sil; kendi yöneticiliğini kaldıramaz.
  - Pasife alınan kişi hiçbir şey görmez.
  - Önem derecesi (normal/önemli/ACİL), geciken sayacı, hazır cevap kullanım sayacı.

Çalıştırmadan önce: asistan-api :5160 Development (Ai:Provider "fake"), lokal Postgres (docker b2b-erp-db).
Test kendi geçici ERP kullanıcılarını (rol.test.*) açar ve sonunda SİLER; yalnız LOKAL veritabanına dokunur.
"""
import io, json, subprocess, sys, time, urllib.error, urllib.request

import jwt

BASE = "http://localhost:5160"
LOCAL = r"C:\Users\Admin\Desktop\B2B-ERP\asistan\Asistan.Api\appsettings.Local.json"
TENANT = "DEMO"
ERP_DB = "b2b_erp_tenant_DEMO"
AS_DB = "b2b_asistan_tenant_DEMO"
PREFIX = "90500777"

cfg = json.loads(io.open(LOCAL, encoding="utf-8-sig").read())
SECRET = cfg["AsistanJwt"]["SecretKey"]

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


def psql(db, sql):
    r = subprocess.run(["docker", "exec", "-i", "b2b-erp-db", "psql", "-U", "b2b", "-d", db, "-v", "ON_ERROR_STOP=1", "-q", "-At"],
                       input=sql.encode("utf-8"), capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.decode("utf-8", "replace"))
    return r.stdout.decode("utf-8").strip()


def token(user, ssa=False, role_id=None):
    claims = {"tenant": TENANT, "user": user, "ssa": "1" if ssa else "0", "iss": "asistan-api", "aud": "asistan-frontend",
              "exp": int(time.time()) + 3600, "iat": int(time.time())}
    if role_id is not None:
        claims["roleId"] = str(role_id)
    return jwt.encode(claims, SECRET, algorithm="HS256")


def call(tok, path, method="GET", body=None):
    req = urllib.request.Request(BASE + path, method=method, data=None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8"))
    req.add_header("Content-Type", "application/json; charset=utf-8")
    if tok:
        req.add_header("Authorization", "Bearer " + tok)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read().decode("utf-8")
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(raw) if raw else None
        except ValueError:
            return e.code, raw


USERS = {
    # kullanıcı: (rol id, AsistanAccess)
    "rol.test.servis": (11, True),     # ServisPersonel, yalnız Teknik Servis
    "rol.test.hepsi": (7, True),       # Muhasebe rolü ama asistanda "hepsini gör"
    "rol.test.yonetici": (7, True),    # asistanda yönetici, birimi Muhasebe
    "rol.test.yetkisiz": (8, False),   # Bayi, kutu kapalı → giremez
    "rol.test.superrol": (1, False),   # SuperAdmin rolü: kutu kapalı olsa da girer
}


def cleanup():
    names = ",".join("'" + u + "'" for u in USERS)
    psql(ERP_DB, f'DELETE FROM "Users" WHERE lower("Username") IN ({names});')
    psql(AS_DB, f"""
        BEGIN;
        CREATE TEMP TABLE t AS SELECT id FROM public.conversations WHERE wa_id LIKE '{PREFIX}%';
        DELETE FROM public.conversation_events WHERE conversation_id IN (SELECT id FROM t);
        DELETE FROM public.conversation_viewers WHERE conversation_id IN (SELECT id FROM t);
        UPDATE public.ai_drafts SET sent_message_id = NULL WHERE conversation_id IN (SELECT id FROM t);
        DELETE FROM public.messages WHERE conversation_id IN (SELECT id FROM t);
        DELETE FROM public.ai_drafts WHERE conversation_id IN (SELECT id FROM t);
        DELETE FROM public.conversations WHERE id IN (SELECT id FROM t);
        DELETE FROM public.department_members WHERE user_name IN ({names});
        DELETE FROM public.agents WHERE user_name IN ({names});
        DELETE FROM public.quick_replies WHERE title LIKE 'ROLTEST%';
        COMMIT;""")


def inbound(phone, text):
    st, d = call(None, "/dev/whatsapp/inbound", "POST", {"From": phone, "Name": "Rol Test", "Text": text})
    assert st == 200, (st, d)


def conv_id(tok, phone):
    st, d = call(tok, "/api/panel/conversations?pageSize=200&folder=all&q=" + phone)
    return d["items"][0]["id"] if st == 200 and d["items"] else None


# ------------------------------------------------------------------ kurulum
print("== kurulum")
# Asistan şeması ilk istekte kurulur (yeni tablolar dahil); temizlikten önce bir istek at.
call(token("asistan.deneme", ssa=True), "/api/panel/status")
cleanup()
values = ",".join(
    f"('{u}', 'rol-test-girissiz', '{u}@rol.test', 'Rol Test {u}', true, {rid}, 'roltest', now(), {'true' if acc else 'false'})"
    for u, (rid, acc) in USERS.items())
psql(ERP_DB, f'INSERT INTO "Users" ("Username","Password","Mail","Unvan","IsActive","RoleId","CreateUser","CreateTime","AsistanAccess") VALUES {values};')

SSA = token("asistan.deneme", ssa=True)
st, s = call(SSA, "/api/panel/summary")
deps = {d["name"]: d["id"] for d in s["allDepartments"]}
TS, MUH, KUR = deps["Teknik Servis"], deps["Muhasebe"], deps["Kurumsal Satış"]
st, orig = call(SSA, "/api/panel/settings")
ORIG_SLA = orig["sla"]

call(SSA, "/api/panel/settings/agents/rol.test.servis", "PUT", {"canSeeAll": False, "isAdmin": False, "isActive": True, "departmentIds": [TS]})
call(SSA, "/api/panel/settings/agents/rol.test.hepsi", "PUT", {"canSeeAll": True, "isAdmin": False, "isActive": True, "departmentIds": []})
call(SSA, "/api/panel/settings/agents/rol.test.yonetici", "PUT", {"canSeeAll": False, "isAdmin": True, "isActive": True, "departmentIds": [MUH]})

pA, pB, pC, pD = PREFIX + "0001", PREFIX + "0002", PREFIX + "0003", PREFIX + "0004"
for p, t in [(pA, "rol testi A"), (pB, "rol testi B"), (pC, "rol testi C"), (pD, "rol testi D")]:
    inbound(p, t)
time.sleep(1)
A, B, C, D = (conv_id(SSA, p) for p in (pA, pB, pC, pD))
call(SSA, f"/api/panel/conversations/{A}/route", "POST", {"departmentId": TS})
call(SSA, f"/api/panel/conversations/{B}/route", "POST", {"departmentId": MUH})
call(SSA, f"/api/panel/conversations/{D}/route", "POST", {"departmentId": KUR})
print(f"  konuşmalar: A={A} (Teknik), B={B} (Muhasebe), C={C} (atanmamış), D={D} (Kurumsal)")

SERVIS = token("rol.test.servis", role_id=11)
HEPSI = token("rol.test.hepsi", role_id=7)
YON = token("rol.test.yonetici", role_id=7)
YETKISIZ = token("rol.test.yetkisiz", role_id=8)
SUPER = token("rol.test.superrol", role_id=1)

try:
    # -------------------------------------------------------------- giriş
    print("== 1) programa giriş")
    st, _ = call(YETKISIZ, "/api/panel/status")
    check("kutusu kapalı Bayi → 403", st == 403, st)
    st, d = call(SUPER, "/api/panel/status")
    check("SuperAdmin rolü kutu kapalı olsa da girer", st == 200, st)
    check("SuperAdmin rolü yönetici ve hepsini görür", st == 200 and d["isAdmin"] and d["canSeeAll"], d)
    st, _ = call(None, "/api/panel/status")
    check("token'sız → 401", st == 401, st)
    st, _ = call(token("rol.test.servis", role_id=11).replace("a", "b", 1)[:-3] + "xyz", "/api/panel/status")
    check("bozuk token → 401", st == 401, st)

    # -------------------------------------------------------------- birim üyesi
    print("== 2) birim üyesi (yalnız Teknik Servis)")
    st, d = call(SERVIS, "/api/panel/status")
    check("durum: yönetici değil, hepsini görmez, birimi Teknik", st == 200 and not d["isAdmin"] and not d["canSeeAll"] and d["departmentIds"] == [TS], d)
    st, d = call(SERVIS, "/api/panel/conversations?pageSize=200&folder=all")
    ids = [x["id"] for x in d["items"]]
    check("listede kendi biriminin konuşması var", A in ids, ids)
    check("listede başka birimin konuşması YOK", B not in ids and D not in ids, ids)
    check("listede atanmamış konuşma YOK", C not in ids, ids)
    st, d = call(SERVIS, "/api/panel/conversations?folder=unassigned")
    check("atanmamış klasörü boş", st == 200 and d["items"] == [], d)
    st, d = call(SERVIS, "/api/panel/summary")
    check("özette yalnız kendi birimi", [x["id"] for x in d["departments"]] == [TS], d["departments"])
    check("özette atanmamış sayısı 0", d["folders"]["unassigned"] == 0, d["folders"])
    check("devir menüsünde bütün birimler var", len(d["allDepartments"]) >= 8, len(d["allDepartments"]))

    for name, method, path, body in [
        ("başka birimin konuşması (GET)", "GET", f"/api/panel/conversations/{B}", None),
        ("başka birimin mesajları", "GET", f"/api/panel/conversations/{B}/messages", None),
        ("başka birime mesaj gönderme", "POST", f"/api/panel/conversations/{B}/messages", {"text": "sızma"}),
        ("başka birime iç not", "POST", f"/api/panel/conversations/{B}/notes", {"text": "sızma"}),
        ("başka birimin önemi", "POST", f"/api/panel/conversations/{B}/priority", {"priority": "urgent"}),
        ("başka birimi devretme", "POST", f"/api/panel/conversations/{B}/route", {"departmentId": TS}),
        ("başka birimi kapatma", "POST", f"/api/panel/conversations/{B}/status", {"status": "closed"}),
        ("atanmamışı okuma", "GET", f"/api/panel/conversations/{C}/messages", None),
        ("başka birimde asistanı yeniden çalıştırma", "POST", f"/api/panel/conversations/{B}/ai/retry", None),
    ]:
        st, _ = call(SERVIS, path, method, body)
        check(f"{name} → 404", st == 404, st)
    st, d = call(SSA, f"/api/panel/conversations/{B}/messages")
    check("sızma denemeleri B'ye mesaj/not bırakmadı", st == 200 and not any("sızma" in (m.get("body") or "") for m in d["messages"])
          and not any(e["kind"] == "note" for e in d["events"]), d.get("events"))

    st, _ = call(SERVIS, f"/api/panel/conversations/{A}/route", "POST", {"departmentId": None})
    check("atanmamışa gönderme → 403 (hepsini görmüyor)", st == 403, st)
    st, _ = call(SERVIS, f"/api/panel/conversations/{A}/notes", "POST", {"text": "kendi birimimde not"})
    check("kendi biriminde iç not → 200", st == 200, st)
    st, _ = call(SERVIS, f"/api/panel/conversations/{A}/priority", "POST", {"priority": "urgent"})
    check("kendi biriminde ACİL işaretleme → 200", st == 200, st)

    for name, method, path, body in [
        ("Ayarlar", "GET", "/api/panel/settings", None),
        ("bekleme eşiği", "PUT", "/api/panel/settings/sla", {"warnMinutes": 1, "lateMinutes": 2}),
        ("hazır cevap ekleme", "POST", "/api/panel/settings/quick-replies", {"title": "ROLTEST x", "body": "x"}),
        ("kişi ayarı", "PUT", "/api/panel/settings/agents/rol.test.servis", {"canSeeAll": True, "isAdmin": True, "isActive": True, "departmentIds": [TS]}),
        ("B2B kullanıcı arama", "GET", "/api/panel/settings/b2b-users?q=ro", None),
    ]:
        st, _ = call(SERVIS, path, method, body)
        check(f"üye {name} → 403", st == 403, st)
    st, d = call(SERVIS, "/api/panel/quick-replies")
    check("hazır cevapları okuyabilir", st == 200 and isinstance(d, list), st)

    st, d = call(SERVIS, f"/api/panel/conversations/{A}/route", "POST", {"departmentId": MUH})
    check("kendi konuşmasını Muhasebe'ye devreder", st == 200 and d["stillVisible"] is False, d)
    st, _ = call(SERVIS, f"/api/panel/conversations/{A}")
    check("devrettiği konuşma artık 404", st == 404, st)

    # -------------------------------------------------------------- hepsini gör
    print("== 3) hepsini gör (yönetici değil)")
    st, d = call(HEPSI, "/api/panel/conversations?pageSize=200&folder=all")
    ids = [x["id"] for x in d["items"]]
    check("bütün birimler + atanmamış görünür", all(x in ids for x in (A, B, C, D)), ids)
    st, d = call(HEPSI, "/api/panel/conversations?folder=unassigned&pageSize=200")
    check("atanmamış klasöründe C var", C in [x["id"] for x in d["items"]], d)
    st, _ = call(HEPSI, "/api/panel/settings")
    check("Ayarlar → 403 (yönetici değil)", st == 403, st)
    st, d = call(HEPSI, f"/api/panel/conversations/{D}/route", "POST", {"departmentId": None})
    check("atanmamışa gönderebilir, yine görür", st == 200 and d["stillVisible"] is True, d)
    call(SSA, f"/api/panel/conversations/{D}/route", "POST", {"departmentId": KUR})

    # -------------------------------------------------------------- yönetici
    print("== 4) yönetici (asistan Ayarlar'ında işaretli)")
    st, d = call(YON, "/api/panel/status")
    check("yönetici → hepsini de görür", st == 200 and d["isAdmin"] and d["canSeeAll"], d)
    st, d = call(YON, "/api/panel/settings")
    check("Ayarlar açılır, bekleme eşikleri döner", st == 200 and "sla" in d and "quickReplies" in d, st)
    st, _ = call(YON, "/api/panel/settings/sla", "PUT", {"warnMinutes": 20, "lateMinutes": 10})
    check("sarı ≥ kırmızı → 400", st == 400, st)
    st, _ = call(YON, "/api/panel/settings/sla", "PUT", {"warnMinutes": 0, "lateMinutes": 10})
    check("0 dk → 400", st == 400, st)
    st, _ = call(YON, "/api/panel/settings/sla", "PUT", {"warnMinutes": 3, "lateMinutes": 10})
    check("geçerli eşik → 200", st == 200, st)
    st, d = call(SERVIS, "/api/panel/status")
    check("yeni eşik herkese yansır", d["sla"] == {"warnMinutes": 3, "lateMinutes": 10}, d.get("sla"))

    st, d = call(YON, "/api/panel/settings/quick-replies", "POST", {"departmentId": TS, "title": "ROLTEST Servis", "body": "Merhaba {musteri}, servis kaydınız açıldı."})
    q_ts = d["id"] if st == 200 else None
    check("birime özel hazır cevap eklendi", st == 200 and q_ts, d)
    st, d = call(YON, "/api/panel/settings/quick-replies", "POST", {"departmentId": None, "title": "ROLTEST Genel", "body": "Teşekkürler."})
    q_gen = d["id"] if st == 200 else None
    check("genel hazır cevap eklendi", st == 200 and q_gen, d)
    st, _ = call(YON, "/api/panel/settings/quick-replies", "POST", {"departmentId": 999999, "title": "ROLTEST yok", "body": "x"})
    check("olmayan birim → 400", st == 400, st)
    st, _ = call(YON, "/api/panel/settings/quick-replies", "POST", {"title": "", "body": "x"})
    check("boş başlık → 400", st == 400, st)
    st, d = call(SERVIS, "/api/panel/quick-replies")
    titles = [x["title"] for x in d]
    check("personel ikisini de görür (süzme ekranda)", "ROLTEST Servis" in titles and "ROLTEST Genel" in titles, titles)
    call(SERVIS, f"/api/panel/quick-replies/{q_ts}/used", "POST")
    call(SERVIS, f"/api/panel/quick-replies/{q_ts}/used", "POST")
    st, d = call(YON, "/api/panel/settings")
    row = [x for x in d["quickReplies"] if x["id"] == q_ts]
    check("kullanım sayacı 2", row and row[0]["useCount"] == 2, row)
    st, _ = call(YON, f"/api/panel/settings/quick-replies/{q_gen}", "PUT", {"departmentId": None, "title": "ROLTEST Genel", "body": "Teşekkürler.", "sortOrder": 0, "isActive": False})
    st2, d = call(SERVIS, "/api/panel/quick-replies")
    check("pasif hazır cevap ekranda görünmez", st == 200 and "ROLTEST Genel" not in [x["title"] for x in d], [x["title"] for x in d])
    st, _ = call(YON, f"/api/panel/settings/quick-replies/{q_gen}", "DELETE")
    check("hazır cevap silindi", st == 200, st)
    st, _ = call(YON, f"/api/panel/settings/quick-replies/{q_gen}", "DELETE")
    check("ikinci silme → 404", st == 404, st)
    st, _ = call(YON, "/api/panel/settings/agents/rol.test.yonetici", "PUT", {"canSeeAll": False, "isAdmin": False, "isActive": True, "departmentIds": [MUH]})
    check("kendi yöneticiliğini kaldıramaz → 400", st == 400, st)

    # -------------------------------------------------------------- önem + gecikme
    print("== 5) önem derecesi ve gecikme")
    st, _ = call(SSA, f"/api/panel/conversations/{B}/priority", "POST", {"priority": "kritik"})
    check("geçersiz önem → 400", st == 400, st)
    call(SSA, f"/api/panel/conversations/{B}/priority", "POST", {"priority": "important"})
    call(SSA, f"/api/panel/conversations/{D}/priority", "POST", {"priority": "urgent"})
    st, d = call(SSA, "/api/panel/conversations?folder=important&pageSize=200")
    imp = [x["id"] for x in d["items"]]
    check("Önemli klasörü acil + önemli içerir", D in imp and B in imp, imp)
    check("Önemli klasöründe acil önde", imp.index(D) < imp.index(B) if D in imp and B in imp else False, imp)
    psql(AS_DB, f"UPDATE public.conversations SET waiting_since = now() - interval '25 minutes' WHERE wa_id = '{pB}';")
    st, d = call(SSA, "/api/panel/summary")
    check("geciken sayacı ≥ 1 (eşik 10 dk)", d["folders"].get("late", 0) >= 1, d["folders"])
    mrow = [x for x in d["departments"] if x["id"] == MUH]
    check("Muhasebe biriminde geciken ≥ 1", mrow and mrow[0].get("late", 0) >= 1, mrow)
    check("acil sayacı ≥ 1", d["folders"].get("urgent", 0) >= 1, d["folders"])
    st, d = call(SSA, f"/api/panel/conversations?folder=waiting&departmentId={KUR}")
    check("cevap bekleyen sıralaması: acil üstte", d["items"] and d["items"][0]["id"] == D, [(x["id"], x["priority"]) for x in d["items"]])
    st, d = call(SSA, f"/api/panel/conversations?folder=open&departmentId={MUH}&pageSize=200")
    check("birim görünümü (open) çalışır", st == 200 and B in [x["id"] for x in d["items"]], st)

    # -------------------------------------------------------------- pasif kişi
    print("== 6) pasife alınan kişi")
    call(SSA, "/api/panel/settings/agents/rol.test.servis", "PUT", {"canSeeAll": False, "isAdmin": False, "isActive": False, "departmentIds": [TS]})
    st, d = call(SERVIS, "/api/panel/conversations?folder=all&pageSize=200")
    check("pasif kişi hiçbir konuşma görmez", st == 200 and d["items"] == [], d)
    st, d = call(SERVIS, "/api/panel/status")
    check("pasif kişinin birimi yok", st == 200 and d["departmentIds"] == [], d)
finally:
    print("== temizlik")
    call(SSA, "/api/panel/settings/sla", "PUT", ORIG_SLA)
    cleanup()
    left = psql(ERP_DB, "SELECT count(*) FROM \"Users\" WHERE lower(\"Username\") LIKE 'rol.test.%';")
    check("deneme kullanıcıları silindi", left == "0", left)

print()
print("SONUC: %d gecti, %d kaldi" % (ok, len(fail)))
for f in fail:
    print("  KALAN: " + f)
sys.exit(1 if fail else 0)
