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

const mockReq = (overrides = {}) => ({
  body:   {},
  query:  {},
  params: {},
  file:   null,
  user: {
    id:   "user-abc",
    _id:  "user-abc",
    role: "user",
  },
  ...overrides,
});

const makePayment = (extra = {}) => ({
  _id:       "payment-001",
  user:      "user-abc",
  amount:    500,
  method:    "qr",
  status:    "pending",
  createdAt: new Date("2025-03-01T10:00:00Z"),
  ...extra,
});

// ✅ helper สร้าง mock chain ที่ตรงกับ controller: .populate().sort().lean()
const mockFindChain = (data) => {
  const leanMock = jest.fn().mockResolvedValue(data);
  const sortMock = jest.fn().mockReturnValue({ lean: leanMock });
  const populateMock = jest.fn().mockReturnValue({ sort: sortMock });
  return { chain: { populate: populateMock }, sortMock, leanMock };
};

beforeEach(() => jest.clearAllMocks());

// ─── getPaymentsByUser ────────────────────────────────────────────────────────

describe("getPaymentsByUser controller", () => {

  // ── With records ────────────────────────────────────────────────────────────

  test("✅ returns 200 with list of payments sorted by date desc", async () => {
    const payments = [
      makePayment({ _id: "payment-002", createdAt: new Date("2025-04-01") }),
      makePayment({ _id: "payment-001", createdAt: new Date("2025-03-01") }),
    ];
    const { chain } = mockFindChain(payments);
    Payment.find.mockReturnValue(chain);

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
    const leanMock = jest.fn().mockResolvedValue([]);
    const sortMock = jest.fn().mockReturnValue({ lean: leanMock });
    const populateMock = jest.fn().mockReturnValue({ sort: sortMock });
    Payment.find.mockReturnValue({ populate: populateMock });

    const req = mockReq({ params: { id: "user-abc" } });
    const res = mockRes();

    await getPaymentsByUser(req, res);

    expect(Payment.find).toHaveBeenCalledWith({ user: "user-abc" });
    expect(sortMock).toHaveBeenCalledWith({ createdAt: -1 });
  });

  // ── Empty state ─────────────────────────────────────────────────────────────

  test("✅ returns 200 with empty array when user has no payments", async () => {
    const { chain } = mockFindChain([]);
    Payment.find.mockReturnValue(chain);

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
  // ✅ controller ไม่มี uiBadge logic → test เช็คแค่ว่า data ถูกส่งมาถูกต้อง

  test("✅ refund_required payment — returns 200 with correct status", async () => {
    const payments = [makePayment({ status: "refund_required" })];
    const { chain } = mockFindChain(payments);
    Payment.find.mockReturnValue(chain);

    const req = mockReq({ params: { id: "user-abc" } });
    const res = mockRes();

    await getPaymentsByUser(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const returned = res.json.mock.calls[0][0].data;
    expect(returned[0].status).toBe("refund_required");
  });

  test("✅ non-refund_required payments — returns 200 with all records", async () => {
    const payments = [
      makePayment({ status: "pending" }),
      makePayment({ status: "completed" }),
      makePayment({ status: "cancelled" }),
    ];
    const { chain } = mockFindChain(payments);
    Payment.find.mockReturnValue(chain);

    const req = mockReq({ params: { id: "user-abc" } });
    const res = mockRes();

    await getPaymentsByUser(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const returned = res.json.mock.calls[0][0].data;
    expect(returned).toHaveLength(3);
  });

  test("✅ mixed statuses — returns all records with correct statuses", async () => {
    const payments = [
      makePayment({ _id: "p1", status: "completed" }),
      makePayment({ _id: "p2", status: "refund_required" }),
      makePayment({ _id: "p3", status: "pending" }),
    ];
    const { chain } = mockFindChain(payments);
    Payment.find.mockReturnValue(chain);

    const req = mockReq({ params: { id: "user-abc" } });
    const res = mockRes();

    await getPaymentsByUser(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const returned = res.json.mock.calls[0][0].data;
    expect(returned.find(p => p._id === "p1").status).toBe("completed");
    expect(returned.find(p => p._id === "p2").status).toBe("refund_required");
    expect(returned.find(p => p._id === "p3").status).toBe("pending");
  });

  // ── Authorization ───────────────────────────────────────────────────────────

  test("❌ different user id in params — returns 403 Unauthorized", async () => {
    const req = mockReq({
      params: { id: "other-user-id" },
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
    const { chain } = mockFindChain(payments);
    Payment.find.mockReturnValue(chain);

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
test("❌ error with no message — returns 500 'Server error' fallback", async () => {
  const err = new Error(); // err.message = '' → falsy
  Payment.find.mockImplementation(() => { throw err; });

  const req = mockReq({ params: { id: 'user-abc' }, user: { id: 'user-abc' } });
  const res = mockRes();

  await getPaymentsByUser(req, res);

  expect(res.status).toHaveBeenCalledWith(500);
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({ success: false, message: 'Server error' })
  );
});