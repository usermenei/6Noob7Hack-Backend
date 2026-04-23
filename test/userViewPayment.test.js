const { getPaymentsByUser } = require("../controllers/payments");

jest.mock("../models/Payment");
const Payment = require("../models/Payment");

// ─── helpers ─────────────────────────────────────────────────────────────────

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json   = jest.fn().mockReturnValue(res);
  return res;
};

// req.user mirrors what protect() attaches: full User doc with .id (string virtual) and ._id (ObjectId-like)
const mockReq = (overrides = {}) => ({
  body:   {},
  query:  {},
  params: {},
  file:   null,
  user: {
    id:   "user-abc",          // string virtual  (req.user.id)
    _id:  "user-abc",          // ObjectId-like   (req.user._id)
    role: "user",
  },
  ...overrides,
});

// factory — one payment record as .lean() would return it
const makePayment = (extra = {}) => ({
  _id:       "payment-001",
  user:      "user-abc",
  amount:    500,
  method:    "qr",
  status:    "pending",
  createdAt: new Date("2025-03-01T10:00:00Z"),
  ...extra,
});

beforeEach(() => jest.clearAllMocks());

// ─── getPaymentsByUser ────────────────────────────────────────────────────────

describe("getPaymentsByUser controller", () => {

  // ── With records ────────────────────────────────────────────────────────────

  test("✅ returns 200 with list of payments sorted by date desc", async () => {
    const payments = [
      makePayment({ _id: "payment-002", createdAt: new Date("2025-04-01") }),
      makePayment({ _id: "payment-001", createdAt: new Date("2025-03-01") }),
    ];
    Payment.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(payments) }),
    });

    const req = mockReq({ params: { id: "user-abc" } });
    const res = mockRes();

    await getPaymentsByUser(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        count:   2,
        data:    payments,
      })
    );
  });

  test("✅ queries Payment with correct userId and sorts by createdAt desc", async () => {
    const sortMock = jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
    Payment.find.mockReturnValue({ sort: sortMock });

    const req = mockReq({ params: { id: "user-abc" } });
    const res = mockRes();

    await getPaymentsByUser(req, res);

    expect(Payment.find).toHaveBeenCalledWith({ user: "user-abc" });
    expect(sortMock).toHaveBeenCalledWith({ createdAt: -1 });
  });

  // ── Empty state ─────────────────────────────────────────────────────────────

  test("✅ returns 200 with empty array when user has no payments", async () => {
    Payment.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
    });

    const req = mockReq({ params: { id: "user-abc" } });
    const res = mockRes();

    await getPaymentsByUser(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        count:   0,
        data:    [],
      })
    );
  });

  // ── Business rule: refund_required badge ────────────────────────────────────

  test("✅ refund_required payment — decorated with orange badge and 'Contact Admin' tooltip", async () => {
    const payments = [makePayment({ status: "refund_required" })];
    Payment.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(payments) }),
    });

    const req = mockReq({ params: { id: "user-abc" } });
    const res = mockRes();

    await getPaymentsByUser(req, res);

    const returned = res.json.mock.calls[0][0].data;
    expect(returned[0].uiBadge).toEqual({ color: "orange", tooltip: "Contact Admin" });
  });

  test("✅ non-refund_required payments — no uiBadge attached", async () => {
    const payments = [
      makePayment({ status: "pending" }),
      makePayment({ status: "completed" }),
      makePayment({ status: "cancelled" }),
    ];
    Payment.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(payments) }),
    });

    const req = mockReq({ params: { id: "user-abc" } });
    const res = mockRes();

    await getPaymentsByUser(req, res);

    const returned = res.json.mock.calls[0][0].data;
    returned.forEach(p => expect(p.uiBadge).toBeUndefined());
  });

  test("✅ mixed statuses — only refund_required records get the badge", async () => {
    const payments = [
      makePayment({ _id: "p1", status: "completed" }),
      makePayment({ _id: "p2", status: "refund_required" }),
      makePayment({ _id: "p3", status: "pending" }),
    ];
    Payment.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(payments) }),
    });

    const req = mockReq({ params: { id: "user-abc" } });
    const res = mockRes();

    await getPaymentsByUser(req, res);

    const returned = res.json.mock.calls[0][0].data;
    expect(returned.find(p => p._id === "p1").uiBadge).toBeUndefined();
    expect(returned.find(p => p._id === "p2").uiBadge).toEqual({ color: "orange", tooltip: "Contact Admin" });
    expect(returned.find(p => p._id === "p3").uiBadge).toBeUndefined();
  });

  // ── Authorization ───────────────────────────────────────────────────────────

  test("❌ different user id in params — returns 403 Unauthorized", async () => {
    const req = mockReq({
      params: { id: "other-user-id" },   // does not match req.user.id = "user-abc"
      user:   { id: "user-abc", _id: "user-abc", role: "user" },
    });
    const res = mockRes();

    await getPaymentsByUser(req, res);

    expect(Payment.find).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: "Unauthorized" })
    );
  });

  test("❌ no req.user (unauthenticated) — returns 403", async () => {
    const req = mockReq({ params: { id: "user-abc" }, user: null });
    const res = mockRes();

    await getPaymentsByUser(req, res);

    expect(Payment.find).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    );
  });

  // ── Detail view ─────────────────────────────────────────────────────────────

  test("✅ each record includes key fields needed for history detail view", async () => {
    const payments = [
      makePayment({
        _id:    "payment-001",
        amount: 300,
        method: "cash",
        status: "completed",
        createdAt: new Date("2025-05-01"),
      }),
    ];
    Payment.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(payments) }),
    });

    const req = mockReq({ params: { id: "user-abc" } });
    const res = mockRes();

    await getPaymentsByUser(req, res);

    const record = res.json.mock.calls[0][0].data[0];
    expect(record).toMatchObject({
      _id:    "payment-001",
      amount: 300,
      method: "cash",
      status: "completed",
    });
  });
});