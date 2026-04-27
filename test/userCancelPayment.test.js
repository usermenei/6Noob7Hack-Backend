const { deleteReservation } = require("../controllers/reservations");
const { userCancelPayment } = require("../controllers/payments");

jest.mock("../models/Reservation");
jest.mock("../models/TimeSlot");
jest.mock("../models/Payment");

const Reservation = require("../models/Reservation");
const TimeSlot = require("../models/TimeSlot");
const Payment = require("../models/Payment");

// ─── Helpers ─────────────────────────────────────────────────────────────────

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const mockReq = (overrides = {}) => ({
  body: {},
  query: {},
  params: { id: "id-123" },
  file: null,
  user: { id: "user-abc", role: "user" },
  ...overrides,
});

const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000);
const PAST = new Date(Date.now() - 60 * 60 * 1000);

const makeReservation = (extra = {}) => ({
  _id: "reservation-001",
  user: { toString: () => "user-abc" },
  timeSlots: [{ startTime: FUTURE }],
  status: "pending",
  save: jest.fn().mockResolvedValue(true),
  ...extra,
});

const makePayment = (extra = {}) => ({
  _id: "payment-001",
  user: { toString: () => "user-abc" },
  reservation: "reservation-001",
  status: "pending",
  save: jest.fn().mockResolvedValue(true),
  ...extra,
});

beforeEach(() => jest.clearAllMocks());

// ─── Controller: deleteReservation ───────────────────────────────────────────

describe("deleteReservation controller", () => {
  test("✅ unpaid pending — reservation & payment set to cancelled", async () => {
    const reservation = makeReservation();
    const payment = makePayment();
    Reservation.findById.mockResolvedValue(reservation);
    TimeSlot.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([{ startTime: FUTURE }]) });
    Payment.findOne.mockResolvedValue(payment);

    const req = mockReq({ params: { id: "reservation-001" } });
    const res = mockRes();
    await deleteReservation(req, res);

    expect(reservation.status).toBe("cancelled");
    expect(payment.status).toBe("cancelled");
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test("✅ paid cancel — payment set to refund_required", async () => {
    const reservation = makeReservation({ status: "success" });
    const payment = makePayment({ status: "completed" });
    Reservation.findById.mockResolvedValue(reservation);
    TimeSlot.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([{ startTime: FUTURE }]) });
    Payment.findOne.mockResolvedValue(payment);

    await deleteReservation(mockReq(), mockRes());

    expect(payment.status).toBe("refund_required");
  });

  test("❌ check-in time has passed — returns 400", async () => {
    const reservation = makeReservation();
    Reservation.findById.mockResolvedValue(reservation);
    TimeSlot.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([{ startTime: PAST }]) });

    const res = mockRes();
    await deleteReservation(mockReq(), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(reservation.save).not.toHaveBeenCalled();
  });

  test("❌ non-owner non-admin — returns 403", async () => {
    Reservation.findById.mockResolvedValue(makeReservation({ user: { toString: () => "other" } }));
    const res = mockRes();
    await deleteReservation(mockReq({ user: { id: "user-abc", role: "user" } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test("❌ reservation not found — returns 404", async () => {
    Reservation.findById.mockResolvedValue(null);
    const res = mockRes();
    await deleteReservation(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ─── Controller: userCancelPayment ───────────────────────────────────────────

describe("userCancelPayment controller", () => {
  const mockReservationPopulate = (result) =>
    Reservation.findById.mockReturnValue({
      populate: jest.fn().mockResolvedValue(result),
    });

  test("✅ pending → cancelled (happy path)", async () => {
    const payment = makePayment();
    const reservation = makeReservation();
    Payment.findById.mockResolvedValue(payment);
    mockReservationPopulate(reservation);

    const res = mockRes();
    await userCancelPayment(mockReq(), res);

    expect(payment.status).toBe("cancelled");
    expect(reservation.status).toBe("cancelled");
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test("✅ completed → refund_required", async () => {
    const payment = makePayment({ status: "completed" });
    const reservation = makeReservation();
    Payment.findById.mockResolvedValue(payment);
    mockReservationPopulate(reservation);

    const res = mockRes();
    await userCancelPayment(mockReq(), res);

    expect(payment.status).toBe("refund_required");
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test("❌ status อื่นๆ ที่ยกเลิกไม่ได้ (failed/cancelled) — returns 400", async () => {
    Payment.findById.mockResolvedValue(makePayment({ status: "failed" }));
    mockReservationPopulate(makeReservation());

    const res = mockRes();
    await userCancelPayment(mockReq(), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  test("❌ เลยเวลาเช็คอินแล้ว — returns 400", async () => {
    Payment.findById.mockResolvedValue(makePayment());
    mockReservationPopulate(makeReservation({ timeSlots: [{ startTime: PAST }] }));

    const res = mockRes();
    await userCancelPayment(mockReq(), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Cannot cancel after reservation time has passed" })
    );
  });

  test("❌ Invalid ID format (CastError) — returns 400", async () => {
    Payment.findById.mockRejectedValue(Object.assign(new Error(), { name: "CastError" }));
    const res = mockRes();
    await userCancelPayment(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Invalid ID format" }));
  });

  test("❌ Unexpected error — returns 500", async () => {
    Payment.findById.mockRejectedValue(new Error("DB Error"));
    const res = mockRes();
    await userCancelPayment(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
test("✅ reduce true branch — slot[1] earlier than slot[0], updates min", async () => {
  const payment = makePayment({ status: 'pending' });
  Payment.findById.mockResolvedValue(payment);

  const reservation = {
    _id: 'reservation-001',
    timeSlots: [
      { startTime: new Date('2099-01-01T10:00:00Z') }, // slot[0] → initial min (later)
      { startTime: new Date('2099-01-01T08:00:00Z') }, // slot[1] < min → true branch ✅
    ],
    status: 'confirmed',
    save: jest.fn().mockResolvedValue(true),
  };

  Reservation.findById.mockReturnValue({
    populate: jest.fn().mockResolvedValue(reservation),
  });

  payment.save = jest.fn().mockResolvedValue(true);

  const req = mockReq({ params: { id: 'payment-001' }, user: { id: 'user-abc' } });
  const res = mockRes();

  await userCancelPayment(req, res);

  // earliest = 08:00, still in future → cancellation proceeds
  expect(payment.status).toBe('cancelled');
  expect(res.status).toHaveBeenCalledWith(200);
});