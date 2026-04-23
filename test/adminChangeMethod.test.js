const {
  updatePaymentMethod,
} = require("../controllers/payments"); // adjust path if needed

jest.mock("../models/Payment"); // adjust to your actual model filename
const Payment = require("../models/Payment");

// ─── helpers ─────────────────────────────────────────────────────────────────

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json   = jest.fn().mockReturnValue(res);
  return res;
};

// user.id matches payment.user so authorization passes by default
const mockReq = (overrides = {}) => ({
  body:   {},
  query:  {},
  params: {},
  file:   null,
  user:   { id: "admin-user-id", role: "admin" },
  ...overrides,
});

// factory for a pending payment — owner matches req.user.id
const makePendingPayment = (extra = {}) => ({
  _id:    "payment-001",
  user:   { toString: () => "admin-user-id" }, // matches mockReq user.id
  status: "pending",
  method: "cash",
  adminQrCode: null,
  cashConfirmedBy: undefined,
  cashConfirmedAt: undefined,
  save:   jest.fn().mockResolvedValue(true),
  ...extra,
});

beforeEach(() => jest.clearAllMocks());

// ─── updatePaymentMethod ──────────────────────────────────────────────────────

describe("updatePaymentMethod controller", () => {

  // ── Happy path ──────────────────────────────────────────────────────────────

  test("✅ pending payment — admin changes method to qr, returns 200", async () => {
    const mockPayment = makePendingPayment({ method: "cash" });
    Payment.findById.mockResolvedValue(mockPayment);

    const req = mockReq({
      params: { id: "payment-001" },
      body:   { method: "qr" },
    });
    const res = mockRes();

    await updatePaymentMethod(req, res);

    expect(mockPayment.method).toBe("qr");
    expect(mockPayment.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true })
    );
  });

  test("✅ pending payment — admin changes method to cash, returns 200", async () => {
    const mockPayment = makePendingPayment({ method: "qr" });
    Payment.findById.mockResolvedValue(mockPayment);

    const req = mockReq({
      params: { id: "payment-001" },
      body:   { method: "cash" },
    });
    const res = mockRes();

    await updatePaymentMethod(req, res);

    expect(mockPayment.method).toBe("cash");
    expect(mockPayment.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true })
    );
  });

  // ── Switching to QR clears cash fields ─────────────────────────────────────

  test("✅ switching to qr — clears cashConfirmedBy and cashConfirmedAt", async () => {
    const mockPayment = makePendingPayment({
      method: "cash",
      cashConfirmedBy: "someone",
      cashConfirmedAt: new Date(),
    });
    Payment.findById.mockResolvedValue(mockPayment);

    const req = mockReq({
      params: { id: "payment-001" },
      body:   { method: "qr" },
    });
    const res = mockRes();

    await updatePaymentMethod(req, res);

    expect(mockPayment.cashConfirmedBy).toBeUndefined();
    expect(mockPayment.cashConfirmedAt).toBeUndefined();
    expect(mockPayment.save).toHaveBeenCalled();
  });

  // ── Switching to cash clears QR fields ─────────────────────────────────────

  test("✅ switching to cash — clears adminQrCode", async () => {
    const mockPayment = makePendingPayment({
      method: "qr",
      adminQrCode: "some-qr-id",
    });
    Payment.findById.mockResolvedValue(mockPayment);

    const req = mockReq({
      params: { id: "payment-001" },
      body:   { method: "cash" },
    });
    const res = mockRes();

    await updatePaymentMethod(req, res);

    expect(mockPayment.adminQrCode).toBeNull();
    expect(mockPayment.save).toHaveBeenCalled();
  });

  // ── Business rule: block completed ─────────────────────────────────────────

  test("❌ completed payment — returns 400 and blocks save", async () => {
    const mockPayment = makePendingPayment({ status: "completed" });
    Payment.findById.mockResolvedValue(mockPayment);

    const req = mockReq({
      params: { id: "payment-001" },
      body:   { method: "qr" },
    });
    const res = mockRes();

    await updatePaymentMethod(req, res);

    expect(mockPayment.save).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: "Payment already completed. Contact Admin to change.",
      })
    );
  });

  // ── Business rule: block non-pending ───────────────────────────────────────

  test("❌ non-pending payment (e.g. cancelled) — returns 400 and blocks save", async () => {
    const mockPayment = makePendingPayment({ status: "cancelled" });
    Payment.findById.mockResolvedValue(mockPayment);

    const req = mockReq({
      params: { id: "payment-001" },
      body:   { method: "qr" },
    });
    const res = mockRes();

    await updatePaymentMethod(req, res);

    expect(mockPayment.save).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    );
  });

  // ── Authorization ───────────────────────────────────────────────────────────

  test("❌ non-owner non-admin user — returns 403", async () => {
    const mockPayment = makePendingPayment({
      user: { toString: () => "other-user-id" }, // different user
    });
    Payment.findById.mockResolvedValue(mockPayment);

    const req = mockReq({
      params: { id: "payment-001" },
      body:   { method: "qr" },
      user:   { id: "random-user-id", role: "user" }, // not admin, not owner
    });
    const res = mockRes();

    await updatePaymentMethod(req, res);

    expect(mockPayment.save).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: "Not authorized" })
    );
  });

  // ── Edge cases ──────────────────────────────────────────────────────────────

  test("❌ payment not found — returns 404", async () => {
    Payment.findById.mockResolvedValue(null);

    const req = mockReq({
      params: { id: "nonexistent-id" },
      body:   { method: "qr" },
    });
    const res = mockRes();

    await updatePaymentMethod(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: "Payment not found" })
    );
  });

  test("❌ missing method in body — returns 400", async () => {
    const mockPayment = makePendingPayment();
    Payment.findById.mockResolvedValue(mockPayment);

    const req = mockReq({
      params: { id: "payment-001" },
      body:   {},
    });
    const res = mockRes();

    await updatePaymentMethod(req, res);

    expect(mockPayment.save).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    );
  });

  test("❌ invalid method value — returns 400", async () => {
    const mockPayment = makePendingPayment();
    Payment.findById.mockResolvedValue(mockPayment);

    const req = mockReq({
      params: { id: "payment-001" },
      body:   { method: "bitcoin" }, // not in ['qr', 'cash']
    });
    const res = mockRes();

    await updatePaymentMethod(req, res);

    expect(mockPayment.save).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: 'method must be "qr" or "cash"',
      })
    );
  });

  // ── Response shape (UI update) ──────────────────────────────────────────────

  test("✅ response includes full updated payment for UI to reflect", async () => {
    const mockPayment = makePendingPayment({ method: "cash" });
    Payment.findById.mockResolvedValue(mockPayment);

    const req = mockReq({
      params: { id: "payment-001" },
      body:   { method: "qr" },
    });
    const res = mockRes();

    await updatePaymentMethod(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ method: "qr" }),
      })
    );
  });
});