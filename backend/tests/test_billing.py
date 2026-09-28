"""Billing & invoicing: numbers-to-words, GST maths, invoices, quotations, payments, clients, products."""
import pytest

from app.routers.billing import amount_to_words_inr

INTRA = {"name": "Local Client", "state": "Gujarat", "state_code": "24", "gstin": "24ABCDE1234F1Z5"}
INTER = {"name": "Mumbai Client", "state": "Maharashtra", "state_code": "27"}


@pytest.mark.parametrize("amount, words", [
    (1, "One Rupee Only"),
    (118, "One Hundred Eighteen Rupees Only"),
    (1180, "One Thousand One Hundred Eighty Rupees Only"),
    (123456.5, "One Lakh Twenty Three Thousand Four Hundred Fifty Six Rupees and Fifty Paise Only"),
    (10000000, "One Crore Rupees Only"),
    (0.99, "Ninety Nine Paise Only"),
])
def test_amount_in_words(amount, words):
    """Every non-zero amount used to crash (undefined variable), so no invoice could be created."""
    assert amount_to_words_inr(amount) == words


def invoice(api, auth, **over):
    body = {"branch_key": "ahmedabad_y", "client": INTRA,
            "items": [{"name": "Advisory", "quantity": 1, "unit_price": 1000, "gst_rate": 18}]}
    body.update(over)
    return api.post("/api/billing/invoices", headers=auth, json=body)


def test_create_invoice_intra_state(client, auth):
    r = invoice(client, auth)
    assert r.status_code == 201, r.text
    inv = r.json()["invoice"]
    assert inv["cgst_amount"] == 90 and inv["sgst_amount"] == 90 and inv["igst_amount"] == 0
    assert inv["grand_total"] == 1180
    assert inv["amount_in_words"] == "One Thousand One Hundred Eighty Rupees Only"
    assert inv["invoice_number"].startswith("Inv")


def test_each_line_uses_its_own_gst_rate(client, auth):
    items = [{"name": "Books", "quantity": 1, "unit_price": 1000, "gst_rate": 5},
             {"name": "Service", "quantity": 2, "unit_price": 500, "gst_rate": 18}]
    inv = invoice(client, auth, client=INTER, items=items).json()["invoice"]
    assert inv["igst_amount"] == 50 + 180  # not 18% of 2000
    assert inv["igst_rate"] == "mixed"
    assert client.get(f"/api/billing/invoices/{inv['id']}/pdf", headers=auth).status_code == 200


def test_invoice_without_gst_stays_without_gst_when_edited(client, auth):
    inv = invoice(client, auth, apply_gst=False).json()["invoice"]
    assert inv["grand_total"] == 1000
    r = client.put(f"/api/billing/invoices/{inv['id']}", headers=auth, json={"notes": "edited"})
    assert r.status_code == 200 and r.json()["invoice"]["grand_total"] == 1000


@pytest.mark.parametrize("over", [
    {"items": []},
    {"items": [{"name": "X", "quantity": 0, "unit_price": 10}]},
    {"items": [{"name": "X", "quantity": 1, "unit_price": -10}]},
    {"items": [{"name": "X", "quantity": 1, "unit_price": 10, "discount": 50}]},
    {"items": [{"name": "X", "quantity": 1, "unit_price": 10, "gst_rate": 17}]},
    {"items": [{"name": "", "quantity": 1, "unit_price": 10}]},
    {"client": {}},
    {"client": {"name": "Bad GST", "gstin": "NOTAGSTIN"}},
    {"invoice_date": "31/12/2026"},
    {"invoice_date": "2026-10-10", "due_date": "2026-10-01"},
    {"paid_amount": 5000},
    {"branch_key": "atlantis"},
    {"invoice_type": "receipt"},
])
def test_invoice_validation(client, auth, over):
    assert invoice(client, auth, **over).status_code == 422, over


def test_duplicate_invoice_number_rejected(client, auth):
    inv = invoice(client, auth).json()["invoice"]
    assert invoice(client, auth, invoice_number=inv["invoice_number"]).status_code == 409


def test_client_names_with_markup_render_in_pdf(client, auth):
    inv = invoice(client, auth, client={**INTER, "name": "A<B & Sons"},
                  items=[{"name": "<b>bold", "description": "x < y", "quantity": 1, "unit_price": 10}]).json()["invoice"]
    r = client.get(f"/api/billing/invoices/{inv['id']}/pdf", headers=auth, params={"download": "true"})
    assert r.status_code == 200 and r.content.startswith(b"%PDF")
    assert 'filename="' in r.headers["content-disposition"]


def test_payments(client, auth):
    inv = invoice(client, auth).json()["invoice"]
    pay = lambda amount: client.post("/api/billing/payments", headers=auth, json={"invoice_id": inv["id"], "amount": amount})
    assert pay(0).status_code == 422
    assert pay(-5).status_code == 422
    assert pay(2000).status_code == 422  # more than the 1180 due
    assert pay(180).status_code == 201
    got = client.get(f"/api/billing/invoices/{inv['id']}", headers=auth).json()["invoice"]
    assert got["status"] == "partially_paid" and got["balance_amount"] == 1000
    assert pay(1000).status_code == 201
    got = client.get(f"/api/billing/invoices/{inv['id']}", headers=auth).json()["invoice"]
    assert got["status"] == "paid" and got["balance_amount"] == 0
    assert pay(1).status_code == 422
    # An invoice with payments can't be deleted.
    assert client.delete(f"/api/billing/invoices/{inv['id']}", headers=auth).status_code == 409
    assert client.delete("/api/billing/invoices/nope", headers=auth).status_code == 404


def test_invoice_list_search_and_paging(client, auth):
    invoice(client, auth, client={**INTER, "name": "Searchable Widgets Ltd"})
    r = client.get("/api/billing/invoices", headers=auth, params={"search": "searchable widgets"})
    assert r.status_code == 200 and r.json()["total"] == 1  # dotted client.name + case-insensitive
    r = client.get("/api/billing/invoices", headers=auth, params={"limit": 1, "page": 2})
    assert len(r.json()["items"]) == 1 and r.json()["total"] >= 2
    assert client.get("/api/billing/invoices", headers=auth, params={"search": "(("}).status_code == 200


def test_quotation_lifecycle(client, auth):
    body = {"client": INTRA, "items": [{"name": "Audit", "quantity": 1, "unit_price": 10000, "gst_rate": 18}]}
    q = client.post("/api/billing/quotations", headers=auth, json=body)
    assert q.status_code == 201, q.text
    qid = q.json()["quotation"]["id"]
    # Editing refreshes the tax breakdown along with the total.
    r = client.put(f"/api/billing/quotations/{qid}", headers=auth,
                   json={"items": [{"name": "Audit", "quantity": 2, "unit_price": 10000, "gst_rate": 18}]})
    qt = r.json()["quotation"]
    assert qt["grand_total"] == 23600 and qt["cgst_amount"] == 1800
    conv = client.post(f"/api/billing/quotations/{qid}/convert", headers=auth)
    assert conv.status_code == 200, conv.text
    assert conv.json()["invoice"]["grand_total"] == 23600
    assert client.post(f"/api/billing/quotations/{qid}/convert", headers=auth).status_code == 409
    assert client.put(f"/api/billing/quotations/{qid}", headers=auth, json={"notes": "x"}).status_code == 409
    assert client.get(f"/api/billing/quotations/{qid}/pdf", headers=auth).status_code == 200
    assert client.post("/api/billing/quotations", headers=auth, json={**body, "status": "weird"}).status_code == 422


def test_clients_crud_and_no_reseeding_on_search(client, auth):
    client.get("/api/billing/clients", headers=auth)  # may seed starter clients once
    before = len(client.get("/api/billing/clients", headers=auth).json()["items"])
    for _ in range(3):
        assert client.get("/api/billing/clients", headers=auth, params={"search": "no-such-client"}).json()["items"] == []
    assert len(client.get("/api/billing/clients", headers=auth).json()["items"]) == before
    r = client.post("/api/billing/clients", headers=auth, json={"name": "New Co", "gstin": "27aaacz1234a1z9"})
    assert r.status_code == 201 and r.json()["client"]["state_code"] == "27"
    cid = r.json()["client"]["id"]
    assert client.post("/api/billing/clients", headers=auth, json={"name": ""}).status_code == 422
    assert client.post("/api/billing/clients", headers=auth, json={"name": "X", "email": "bad"}).status_code == 422
    upd = client.put(f"/api/billing/clients/{cid}", headers=auth, json={"phone": "999", "id": "hijack", "_id": "hijack"})
    assert upd.status_code == 200 and upd.json()["client"]["id"] == cid
    assert client.get(f"/api/billing/clients/{cid}", headers=auth).status_code == 200
    assert client.put("/api/billing/clients/nope", headers=auth, json={"name": "x"}).status_code == 404
    assert client.delete(f"/api/billing/clients/{cid}", headers=auth).status_code == 200
    assert client.delete(f"/api/billing/clients/{cid}", headers=auth).status_code == 404


def test_products(client, auth):
    assert client.post("/api/billing/products", headers=auth, json={"name": "Bad", "unit_price": -1}).status_code == 422
    assert client.post("/api/billing/products", headers=auth, json={"name": "Bad", "default_gst_rate": 7}).status_code == 422
    r = client.post("/api/billing/products", headers=auth, json={"name": "Consult", "unit_price": 500, "default_gst_rate": 12})
    assert r.status_code == 201
    pid = r.json()["product"]["id"]
    assert client.put(f"/api/billing/products/{pid}", headers=auth, json={"unit_price": 600}).json()["product"]["unit_price"] == 600
    assert client.delete(f"/api/billing/products/{pid}", headers=auth).status_code == 200


def test_reports_and_metrics(client, auth):
    invoice(client, auth, invoice_type="proforma")
    m = client.get("/api/billing/dashboard/metrics", headers=auth).json()["metrics"]
    assert m["invoices_count"] >= 1
    aging = client.get("/api/billing/reports/aging", headers=auth).json()
    assert aging["total_overdue"] <= aging["total_outstanding"]
    assert client.get("/api/billing/reports/gstr1", headers=auth).status_code == 200
    assert client.get("/api/billing/invoices/next-number", headers=auth).status_code == 200


def test_billing_needs_permission(client, store, auth):
    from tests.conftest import login
    client.post("/api/users", headers=auth, json={"username": "legal1", "email": "legal1@rexera-test.com",
                                                  "role": "legal", "password": "Passw0rd!x"})
    legal = login(client, store, "legal1@rexera-test.com", "Passw0rd!x")
    assert client.get("/api/billing/invoices", headers=legal).status_code == 403
