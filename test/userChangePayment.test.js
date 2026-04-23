const { updatePaymentMethod } = require("../controllers/payments");

jest.mock("../models/Payment");
const Payment = require("../models/Payment");

// ─── helpers ─────────────────────────────────────────────────────────────────

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json   = jest.fn().mockReturnValue(res);
  return res;
};

const mockReq = (overrides = {}) => ({
  body:   {},
  query:  {},
  params: {},
  file:   null,
  user:   { id: "user-abc", role: "user" },
  ...overrides,
});

const makePayment = (extra = {}) => ({
  _id:             "payment-001",
  user:            { toString: () => "user-abc" },
  status:          "pending",
  method:          "cash",
  adminQrCode:     null,
  cashConfirmedBy: null,
  cashConfirmedAt: null,
  save:            jest.fn().mockResolvedValue(true),
  ...extra,
});

beforeEach(() => jest.clearAllMocks());

// ─── updatePaymentMethod (user) ───────────────────────────────────────────────

describe("updatePaymentMethod controller", () => {

  // ── Happy path ──────────────────────────────────────────────────────────────

  test("✅ pending → qr — method updated, status stays pending, returns 200", async () => {
    const payment = makePayment({ method: "cash" });
    Payment.findById.mockResolvedValue(payment);

    const req = mockReq({ params: { id: "payment-001" }, body: { method: "qr" } });
    const res = mockRes();

    await updatePaymentMethod(req, res);

    expect(payment.method).toBe("qr");
    expect(payment.status).toBe("pending");
    expect(payment.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, data: payment })
    );
  });

  test("✅ pending → cash — method updated, status stays pending, returns 200", async () => {
    const payment = makePayment({ method: "qr" });
    Payment.findById.mockResolvedValue(payment);

    const req = mockReq({ params: { id: "payment-001" }, body: { method: "cash" } });
    const res = mockRes();

    await updatePaymentMethod(req, res);

    expect(payment.method).toBe("cash");
    expect(payment.status).toBe("pending");
    expect(payment.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  // ── Side-effect: field cleanup on method switch ─────────────────────────────

  test("✅ switching to cash — clears adminQrCode (method !== 'qr')", async () => {
    const payment = makePayment({ method: "qr", adminQrCode: "qr-code-id" });
    Payment.findById.mockResolvedValue(payment);

    const req = mockReq({ params: { id: "payment-001" }, body: { method: "cash" } });
    const res = mockRes();

    await updatePaymentMethod(req, res);

    expect(payment.adminQrCode).toBeNull();
    expect(payment.save).toHaveBeenCalled();
  });

  test("✅ switching to qr — clears cashConfirmedBy and cashConfirmedAt (method !== 'cash')", async () => {
    const payment = makePayment({
      method:          "cash",
      cashConfirmedBy: "admin-id",
      cashConfirmedAt: new Date(),
    });
    Payment.findById.mockResolvedValue(payment);

    const req = mockReq({ params: { id: "payment-001" }, body: { method: "qr" } });
    const res = mockRes();

    await updatePaymentMethod(req, res);

    expect(payment.cashConfirmedBy).toBeUndefined();
    expect(payment.cashConfirmedAt).toBeUndefined();
    expect(payment.save).toHaveBeenCalled();
  });

  // ── Business rule: completed payment blocked (UI disable state) ─────────────

  test("❌ completed payment — returns 400 with exact message, save not called", async () => {
    const payment = makePayment({ status: "completed" });
    Payment.findById.mockResolvedValue(payment);

    const req = mockReq({ params: { id: "payment-001" }, body: { method: "qr" } });
    const res = mockRes();

    await updatePaymentMethod(req, res);

    expect(payment.save).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: "Payment already completed. Contact Admin to change.",
      })
    );
  });

  test("❌ non-pending (cancelled) — blocked with 400 'Only pending payments can change method'", async () => {
    const payment = makePayment({ status: "cancelled" });
    Payment.findById.mockResolvedValue(payment);

    const req = mockReq({ params: { id: "payment-001" }, body: { method: "qr" } });
    const res = mockRes();

    await updatePaymentMethod(req, res);

    expect(payment.save).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: "Only pending payments can change method",
      })
    );
  });

  // ── Authorization ───────────────────────────────────────────────────────────

  test("❌ non-owner non-admin — returns 403, save not called", async () => {
    const payment = makePayment({
      user: { toString: () => "other-user-id" },
    });
    Payment.findById.mockResolvedValue(payment);

    const req = mockReq({
      params: { id: "payment-001" },
      body:   { method: "qr" },
      user:   { id: "random-user-id", role: "user" },
    });
    const res = mockRes();

    await updatePaymentMethod(req, res);

    expect(payment.save).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: "Not authorized" })
    );
  });

  test("✅ admin can change method even if not the owner", async () => {
    const payment = makePayment({
      user: { toString: () => "other-user-id" },
    });
    Payment.findById.mockResolvedValue(payment);

    const req = mockReq({
      params: { id: "payment-001" },
      body:   { method: "qr" },
      user:   { id: "admin-id", role: "admin" },
    });
    const res = mockRes();

    await updatePaymentMethod(req, res);

    expect(payment.method).toBe("qr");
    expect(payment.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  // ── Edge cases ──────────────────────────────────────────────────────────────

  test("❌ payment not found — returns 404", async () => {
    Payment.findById.mockResolvedValue(null);

    const req = mockReq({ params: { id: "nonexistent-id" }, body: { method: "qr" } });
    const res = mockRes();

    await updatePaymentMethod(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: "Payment not found" })
    );
  });

  test("❌ invalid method value — returns 400", async () => {
    const payment = makePayment();
    Payment.findById.mockResolvedValue(payment);

    const req = mockReq({ params: { id: "payment-001" }, body: { method: "bitcoin" } });
    const res = mockRes();

    await updatePaymentMethod(req, res);

    expect(payment.save).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: 'method must be "qr" or "cash"',
      })
    );
  });

  test("❌ missing method in body — returns 400", async () => {
    const payment = makePayment();
    Payment.findById.mockResolvedValue(payment);

    const req = mockReq({ params: { id: "payment-001" }, body: {} });
    const res = mockRes();

    await updatePaymentMethod(req, res);

    expect(payment.save).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    );
  });
});