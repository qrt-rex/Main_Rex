"""Joining tokens and the public onboarding portal."""
import itertools

import pytest

from tests.conftest import otp_for

_seq = itertools.count(1)


def new_token(client, auth, email=None):
    n = next(_seq)
    email = email or f"joiner{n}@rexera-test.com"
    cand = client.post("/api/candidates", json={"candidate_name": f"Joiner {n}", "position_applied": "BDM",
                                                "contact_number": "9812300000", "email": email}).json()
    r = client.post("/api/joining/generate-token", headers=auth, json={
        "candidate_id": cand["candidate_id"], "full_name": f"Joiner {n}", "email": email,
        "department": "SALES", "designation": "BDM"})
    assert r.status_code == 200, r.text
    return r.json()["token"], email, cand["candidate_id"]


def onboarding_body(token, email, **over):
    body = {
        "token": token, "full_name": "Joiner Person", "parent_name": "Parent", "date_of_birth": "1998-05-04",
        "gender": "Female", "marital_status": "Single", "blood_group": "O+", "mobile_number": "9812300001",
        "email": email, "permanent_address": "Addr 1", "correspondence_address": "Addr 1",
        "aadhaar_number": "1234 5678 9012", "pan_number": "abcde1234f", "emergency_contact_name": "EC",
        "emergency_contact_number": "9812300002", "emergency_contact_relation": "Mother",
        "bank_name": "SBI", "account_no": "123456789", "ifsc_code": "SBIN0001234",
        "agreement": {"accepted": True, "signature_name": "Joiner Person"},
    }
    body.update(over)
    return body


def verify(client, store, token, email):
    assert client.post("/api/joining/validate-token", json={"token": token}).json()["valid"] is True
    code = otp_for(store, email, "onboarding")
    r = client.post("/api/joining/verify-token-otp", json={"token": token, "otp": code})
    assert r.status_code == 200, r.text


def test_generate_token_requires_auth(client):
    assert client.post("/api/joining/generate-token", json={"full_name": "x", "email": "x@rexera-test.com"}).status_code == 401


def test_invalid_token_reports_invalid(client):
    r = client.post("/api/joining/validate-token", json={"token": "REX-NOPE00"})
    assert r.status_code == 200 and r.json()["valid"] is False


def test_submit_without_otp_verification_is_refused(client, auth):
    token, email, _ = new_token(client, auth)
    r = client.post("/api/joining/submit-onboarding", json=onboarding_body(token, email))
    assert r.status_code == 403


def test_submit_without_accepting_agreement_is_refused(client, auth, store):
    token, email, _ = new_token(client, auth)
    verify(client, store, token, email)
    body = onboarding_body(token, email, agreement={"accepted": False, "signature_name": "Joiner Person"})
    assert client.post("/api/joining/submit-onboarding", json=body).status_code == 422
    body = onboarding_body(token, email, agreement={"accepted": True, "signature_name": "  "})
    assert client.post("/api/joining/submit-onboarding", json=body).status_code == 422


def test_otp_is_checked_against_the_invited_email(client, auth, store):
    token, email, _ = new_token(client, auth)
    client.post("/api/joining/validate-token", json={"token": token})
    # A code for some other mailbox must not unlock this token.
    client.post("/api/otp/send", json={"email": "attacker@rexera-test.com", "purpose": "onboarding"})
    other_code = otp_for(store, "attacker@rexera-test.com", "onboarding")
    r = client.post("/api/joining/verify-token-otp",
                    json={"token": token, "otp": other_code, "email": "attacker@rexera-test.com"})
    assert r.status_code == 400


def test_full_onboarding_flow(client, auth, store):
    token, email, cand_id = new_token(client, auth)
    verify(client, store, token, email)
    body = onboarding_body(token, email)
    body["email"] = "someone.else@rexera-test.com"
    r = client.post("/api/joining/submit-onboarding", json=body)
    assert r.status_code == 200, r.text
    code = r.json()["employee_code"]
    emp = client.get("/api/employees", headers=auth, params={"search": code}).json()["employees"][0]
    assert emp["email"] == email  # the invitation's email wins
    assert client.get(f"/api/candidates/{cand_id}", headers=auth).json()["status"] == "Joined"
    # Single use
    assert client.post("/api/joining/submit-onboarding", json=onboarding_body(token, email)).status_code == 400
    assert client.post("/api/joining/validate-token", json={"token": token}).json()["valid"] is False


@pytest.mark.parametrize("override", [{"aadhaar_number": "1234"}, {"pan_number": "ABC"}, {"ifsc_code": "XX"},
                                      {"mobile_number": "12"}, {"date_of_birth": "04/05/1998"}])
def test_onboarding_field_validation(client, auth, store, override):
    token, email, _ = new_token(client, auth)
    verify(client, store, token, email)
    assert client.post("/api/joining/submit-onboarding", json=onboarding_body(token, email, **override)).status_code == 422


def test_failed_employee_creation_does_not_burn_the_token(client, auth, store):
    email = "already.employee@rexera-test.com"
    client.post("/api/employees", headers=auth, json={
        "full_name": "Already", "email": email, "mobile_number": "9812399999", "department": "SALES",
        "designation": "BDM", "date_of_joining": "2026-01-01", "base_salary": 1000})
    token, _, _ = new_token(client, auth, email=email)
    verify(client, store, token, email)
    r = client.post("/api/joining/submit-onboarding", json=onboarding_body(token, email))
    assert r.status_code == 409
    assert client.post("/api/joining/validate-token", json={"token": token}).json()["valid"] is True


def test_legacy_query_string_verification_still_works(client, auth, store):
    token, email, _ = new_token(client, auth)
    client.post("/api/joining/validate-token", json={"token": token})
    code = otp_for(store, email, "onboarding")
    r = client.post(f"/api/joining/verify-token-otp?token={token}&email={email}&otp={code}")
    assert r.status_code == 200
