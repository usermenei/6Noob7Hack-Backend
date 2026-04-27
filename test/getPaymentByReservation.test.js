const { getPaymentByReservation, adminGetAllPayments } = require('../controllers/payments');

jest.mock('../models/Payment');
const Payment = require('../models/Payment');

// ─── helpers ──────────────────────────────────────────────────────────────────

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json   = jest.fn().mockReturnValue(res);
  return res;
};

const mockReq = (overrides = {}) => ({
  params: {},
  body:   {},
  user:   { id: 'user-abc', role: 'user' },
  ...overrides,
});

const makePayment = (extra = {}) => ({
  _id:         'payment-001',
  user:        { toString: () => 'user-abc' },
  reservation: 'reservation-001',
  method:      'qr',
  status:      'pending',
  amount:      500,
  ...extra,
});

beforeEach(() => jest.clearAllMocks());

// ─── getPaymentByReservation ──────────────────────────────────────────────────

describe('getPaymentByReservation controller', () => {

  // ── Happy path ───────────────────────────────────────────────────────────────

  test('✅ owner — returns 200 with payment data', async () => {
    const payment = makePayment();
    Payment.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(payment) });

    const req = mockReq({
      params: { reservationId: 'reservation-001' },
      user:   { id: 'user-abc', role: 'user' },
    });
    const res = mockRes();

    await getPaymentByReservation(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, data: payment })
    );
  });

  test('✅ admin — can access any reservation payment', async () => {
    const payment = makePayment({ user: { toString: () => 'other-user' } });
    Payment.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(payment) });

    const req = mockReq({
      params: { reservationId: 'reservation-001' },
      user:   { id: 'admin-id', role: 'admin' },
    });
    const res = mockRes();

    await getPaymentByReservation(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true })
    );
  });

  // ── Query ────────────────────────────────────────────────────────────────────

  test('✅ queries Payment.findOne ด้วย reservationId และ status pending/completed', async () => {
    const payment = makePayment();
    Payment.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(payment) });

    const req = mockReq({
      params: { reservationId: 'reservation-xyz' },
      user:   { id: 'user-abc', role: 'user' },
    });
    const res = mockRes();

    await getPaymentByReservation(req, res);

    expect(Payment.findOne).toHaveBeenCalledWith({
      reservation: 'reservation-xyz',
      status: { $in: ['pending', 'completed'] },
    });
  });

  // ── Not found ────────────────────────────────────────────────────────────────

  test('❌ payment ไม่มีใน DB — returns 404', async () => {
    Payment.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

    const req = mockReq({ params: { reservationId: 'reservation-001' } });
    const res = mockRes();

    await getPaymentByReservation(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: 'No payment found for this reservation' })
    );
  });

  test('❌ payment status เป็น cancelled — ไม่ถูก query มา → 404', async () => {
    // findOne จะคืน null เพราะ status ไม่อยู่ใน ['pending', 'completed']
    Payment.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

    const req = mockReq({ params: { reservationId: 'reservation-001' } });
    const res = mockRes();

    await getPaymentByReservation(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  // ── Authorization ─────────────────────────────────────────────────────────────

  test('❌ non-owner non-admin — returns 403 Not authorized', async () => {
    const payment = makePayment({ user: { toString: () => 'other-user' } });
    Payment.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(payment) });

    const req = mockReq({
      params: { reservationId: 'reservation-001' },
      user:   { id: 'user-abc', role: 'user' },
    });
    const res = mockRes();

    await getPaymentByReservation(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: 'Not authorized' })
    );
  });

  // ── Error handling ────────────────────────────────────────────────────────────

  test('❌ DB throws CastError — returns 400 Invalid ID format', async () => {
    Payment.findOne.mockReturnValue({
      lean: jest.fn().mockRejectedValue(Object.assign(new Error(), { name: 'CastError' })),
    });

    const req = mockReq({ params: { reservationId: 'bad-id' } });
    const res = mockRes();

    await getPaymentByReservation(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: 'Invalid ID format' })
    );
  });

  test('❌ DB throws generic error — returns 500 Server error', async () => {
    Payment.findOne.mockReturnValue({
      lean: jest.fn().mockRejectedValue(new Error('DB connection lost')),
    });

    const req = mockReq({ params: { reservationId: 'reservation-001' } });
    const res = mockRes();

    await getPaymentByReservation(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: 'Server error' })
    );
  });
});

// ─── adminGetAllPayments ──────────────────────────────────────────────────────

describe('adminGetAllPayments controller', () => {

  // helper สร้าง mock chain ที่ตรงกับ controller: .populate().populate().sort().lean()
  const mockFindChain = (data) => {
    const leanMock    = jest.fn().mockResolvedValue(data);
    const sortMock    = jest.fn().mockReturnValue({ lean: leanMock });
    const populate2   = jest.fn().mockReturnValue({ sort: sortMock });
    const populate1   = jest.fn().mockReturnValue({ populate: populate2 });
    return { chain: { populate: populate1 }, sortMock, populate1, populate2 };
  };

  // ── Happy path ───────────────────────────────────────────────────────────────

  test('✅ returns 200 with all payments', async () => {
    const payments = [
      { _id: 'p1', method: 'qr',   status: 'completed' },
      { _id: 'p2', method: 'cash', status: 'pending'   },
    ];
    const { chain } = mockFindChain(payments);
    Payment.find.mockReturnValue(chain);

    const req = mockReq({ user: { id: 'admin-id', role: 'admin' } });
    const res = mockRes();

    await adminGetAllPayments(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, data: payments })
    );
  });

  test('✅ returns 200 with empty array when no payments exist', async () => {
    const { chain } = mockFindChain([]);
    Payment.find.mockReturnValue(chain);

    const req = mockReq({ user: { id: 'admin-id', role: 'admin' } });
    const res = mockRes();

    await adminGetAllPayments(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, data: [] })
    );
  });

  // ── Query ────────────────────────────────────────────────────────────────────

  test('✅ Payment.find ถูกเรียกด้วย {} (ดึงทุก payment)', async () => {
    const { chain } = mockFindChain([]);
    Payment.find.mockReturnValue(chain);

    const req = mockReq({ user: { id: 'admin-id', role: 'admin' } });
    const res = mockRes();

    await adminGetAllPayments(req, res);

    expect(Payment.find).toHaveBeenCalledWith({});
  });

  test('✅ sort ด้วย updatedAt: -1 (ล่าสุดขึ้นก่อน)', async () => {
    const { chain, sortMock } = mockFindChain([]);
    Payment.find.mockReturnValue(chain);

    const req = mockReq({ user: { id: 'admin-id', role: 'admin' } });
    const res = mockRes();

    await adminGetAllPayments(req, res);

    expect(sortMock).toHaveBeenCalledWith({ updatedAt: -1 });
  });

  test('✅ populate reservation ด้วย path ที่ถูกต้อง', async () => {
    const { chain, populate1 } = mockFindChain([]);
    Payment.find.mockReturnValue(chain);

    const req = mockReq({ user: { id: 'admin-id', role: 'admin' } });
    const res = mockRes();

    await adminGetAllPayments(req, res);

    expect(populate1).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'reservation' })
    );
  });

  test('✅ populate user ด้วย name และ email', async () => {
    const { chain, populate2 } = mockFindChain([]);
    Payment.find.mockReturnValue(chain);

    const req = mockReq({ user: { id: 'admin-id', role: 'admin' } });
    const res = mockRes();

    await adminGetAllPayments(req, res);

    expect(populate2).toHaveBeenCalledWith('user', 'name email');
  });

  // ── Data shape ───────────────────────────────────────────────────────────────

  test('✅ data มีครบทุก payment ที่ DB ส่งมา ไม่มีการ filter', async () => {
    const payments = [
      { _id: 'p1', status: 'pending'         },
      { _id: 'p2', status: 'completed'       },
      { _id: 'p3', status: 'cancelled'       },
      { _id: 'p4', status: 'refund_required' },
      { _id: 'p5', status: 'failed'          },
    ];
    const { chain } = mockFindChain(payments);
    Payment.find.mockReturnValue(chain);

    const req = mockReq({ user: { id: 'admin-id', role: 'admin' } });
    const res = mockRes();

    await adminGetAllPayments(req, res);

    const returned = res.json.mock.calls[0][0].data;
    expect(returned).toHaveLength(5);
    expect(returned.map(p => p._id)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
  });

  // ── Error handling ────────────────────────────────────────────────────────────

  test('❌ DB throws CastError — returns 400', async () => {
    Payment.find.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      sort:     jest.fn().mockReturnThis(),
      lean:     jest.fn().mockRejectedValue(Object.assign(new Error(), { name: 'CastError' })),
    });

    const req = mockReq({ user: { id: 'admin-id', role: 'admin' } });
    const res = mockRes();

    await adminGetAllPayments(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: 'Invalid ID format' })
    );
  });

  test('❌ DB throws generic error — returns 500', async () => {
    Payment.find.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      sort:     jest.fn().mockReturnThis(),
      lean:     jest.fn().mockRejectedValue(new Error('DB connection lost')),
    });

    const req = mockReq({ user: { id: 'admin-id', role: 'admin' } });
    const res = mockRes();

    await adminGetAllPayments(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: 'Server error' })
    );
  });
});