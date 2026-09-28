import pytest

from tests.conftest import ADMIN_EMAIL, ADMIN_PASSWORD, login, otp_for


@pytest.fixture(scope="module")
def make_user(client, auth):
    def _make(email: str, role: str = "hr", password: str = "Passw0rd!x"):
        r = client.post("/api/users", headers=auth, json={"username": email.split("@")[0], "email": email,
                                                         "role": role, "password": password})
        assert r.status_code == 201, r.text
        return r.json()
    return _make


def test_wrong_password_and_unknown_email_look_identical(client):
    a = client.post("/api/auth/login", json={"email": ADMIN_EMAIL, "password": "nope"})
    b = client.post("/api/auth/login", json={"email": "ghost@rexera-test.com", "password": "nope"})
    assert a.status_code == b.status_code == 401
    assert a.json() == b.json()


def test_malformed_login_rejected(client):
    assert client.post("/api/auth/login", json={"email": "not-an-email", "password": "x"}).status_code == 422
    assert client.post("/api/auth/login", json={"email": {"$ne": ""}, "password": "x"}).status_code == 422


def test_verify_2fa_requires_password_step_token(client, store):
    r = client.post("/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    code = otp_for(store, ADMIN_EMAIL, "login_2fa")
    # Correct code but no / forged temp token: must not sign in.
    assert client.post("/api/auth/verify-2fa", json={"email": ADMIN_EMAIL, "otp": code}).status_code == 400
    assert client.post("/api/auth/verify-2fa", json={"email": ADMIN_EMAIL, "otp": code,
                                                     "temp_token": "forged"}).status_code == 400
    ok = client.post("/api/auth/verify-2fa", json={"email": ADMIN_EMAIL, "otp": code,
                                                   "temp_token": r.json()["temp_token"]})
    assert ok.status_code == 200 and ok.json()["access_token"]
    # Single use
    again = client.post("/api/auth/verify-2fa", json={"email": ADMIN_EMAIL, "otp": code,
                                                      "temp_token": r.json()["temp_token"]})
    assert again.status_code == 400


def test_temp_token_is_bound_to_its_email(client, store, make_user):
    make_user("bound@rexera-test.com")
    mine = client.post("/api/auth/login", json={"email": "bound@rexera-test.com", "password": "Passw0rd!x"}).json()
    client.post("/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    admin_code = otp_for(store, ADMIN_EMAIL, "login_2fa")
    r = client.post("/api/auth/verify-2fa", json={"email": ADMIN_EMAIL, "otp": admin_code,
                                                  "temp_token": mine["temp_token"]})
    assert r.status_code == 400


def test_resend_requires_password_step_token(client):
    assert client.post("/api/auth/resend-2fa-otp", json={"email": ADMIN_EMAIL}).status_code == 401
    step1 = client.post("/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}).json()
    r = client.post("/api/auth/resend-2fa-otp", json={"email": ADMIN_EMAIL, "temp_token": step1["temp_token"]})
    assert r.status_code == 200


def test_public_otp_endpoint_cannot_issue_admin_codes(client):
    for purpose in ("login_2fa", "password_reset"):
        r = client.post("/api/otp/send", json={"email": ADMIN_EMAIL, "purpose": purpose})
        assert r.status_code == 400, purpose
        r = client.post("/api/otp/verify", json={"email": ADMIN_EMAIL, "otp": "123456", "purpose": purpose})
        assert r.status_code == 400, purpose


def test_public_otp_send_verify_and_replay(client, store):
    email = "cand.otp@rexera-test.com"
    assert client.post("/api/otp/send", json={"email": email, "purpose": "onboarding"}).status_code == 200
    code = otp_for(store, email, "onboarding")
    assert client.post("/api/otp/verify", json={"email": email, "otp": code, "purpose": "onboarding"}).status_code == 200
    assert client.post("/api/otp/verify", json={"email": email, "otp": code, "purpose": "onboarding"}).status_code == 400


def test_otp_is_burned_after_repeated_wrong_guesses(client, store):
    email = "guess@rexera-test.com"
    client.post("/api/otp/send", json={"email": email, "purpose": "onboarding"})
    code = otp_for(store, email, "onboarding")
    wrong = "000000" if code != "000000" else "111111"
    for _ in range(5):
        assert client.post("/api/otp/verify", json={"email": email, "otp": wrong, "purpose": "onboarding"}).status_code == 400
    # Even the right code no longer works: the guesser has to request a new one.
    assert client.post("/api/otp/verify", json={"email": email, "otp": code, "purpose": "onboarding"}).status_code == 400


def test_otp_send_is_rate_limited(client):
    email = "flood@rexera-test.com"
    codes = [client.post("/api/otp/send", json={"email": email, "purpose": "onboarding"}).status_code for _ in range(8)]
    assert codes[:5] == [200] * 5
    assert 429 in codes[5:]


def test_account_locks_after_repeated_wrong_passwords(client, store, make_user):
    make_user("locked@rexera-test.com")
    codes = [client.post("/api/auth/login", json={"email": "locked@rexera-test.com", "password": "bad"}).status_code
             for _ in range(5)]
    assert codes == [401] * 5
    # Locked now, even with the right password.
    r = client.post("/api/auth/login", json={"email": "locked@rexera-test.com", "password": "Passw0rd!x"})
    assert r.status_code == 429


def test_forgot_password_never_returns_code_and_does_not_enumerate(client, store):
    known = client.post("/api/auth/forgot-password", json={"email": ADMIN_EMAIL})
    unknown = client.post("/api/auth/forgot-password", json={"email": "ghost@rexera-test.com"})
    assert known.status_code == unknown.status_code == 200
    assert known.json() == unknown.json()
    assert known.json()["debug_otp"] is None


def test_password_reset_flow(client, store, make_user):
    make_user("reset@rexera-test.com", password="OldPassw0rd!")
    old_session = login(client, store, "reset@rexera-test.com", "OldPassw0rd!")
    import time
    time.sleep(1.1)  # tokens carry whole-second iat
    client.post("/api/auth/forgot-password", json={"email": "reset@rexera-test.com"})
    code = otp_for(store, "reset@rexera-test.com", "password_reset")
    assert client.post("/api/auth/reset-password", json={"email": "reset@rexera-test.com", "otp": "000000" if code != "000000" else "111111",
                                                         "new_password": "NewPassw0rd!"}).status_code == 400
    assert client.post("/api/auth/reset-password", json={"email": "reset@rexera-test.com", "otp": code,
                                                         "new_password": "short"}).status_code == 422
    assert client.post("/api/auth/reset-password", json={"email": "reset@rexera-test.com", "otp": code,
                                                         "new_password": "NewPassw0rd!"}).status_code == 200
    assert client.post("/api/auth/login", json={"email": "reset@rexera-test.com", "password": "OldPassw0rd!"}).status_code == 401
    login(client, store, "reset@rexera-test.com", "NewPassw0rd!")
    # Sessions opened before the reset are signed out.
    assert client.get("/api/auth/me", headers=old_session).status_code == 401


def test_protected_routes_need_a_valid_token(client):
    assert client.get("/api/employees").status_code == 401
    assert client.get("/api/employees", headers={"Authorization": "Bearer forged.token.value"}).status_code == 401


def test_logout_revokes_token(client, store, make_user):
    make_user("bye@rexera-test.com")
    headers = login(client, store, "bye@rexera-test.com", "Passw0rd!x")
    assert client.get("/api/auth/me", headers=headers).status_code == 200
    import time
    time.sleep(1.1)  # tokens carry whole-second iat
    assert client.post("/api/auth/logout", headers=headers).status_code == 200
    assert client.get("/api/auth/me", headers=headers).status_code == 401


def test_deactivated_account_is_rejected(client, store, auth, make_user):
    u = make_user("gone@rexera-test.com")
    headers = login(client, store, "gone@rexera-test.com", "Passw0rd!x")
    assert client.patch(f"/api/users/{u['id']}", headers=auth, json={"is_active": False}).status_code == 200
    assert client.get("/api/auth/me", headers=headers).status_code == 401
    assert client.post("/api/auth/login", json={"email": "gone@rexera-test.com", "password": "Passw0rd!x"}).status_code == 401
