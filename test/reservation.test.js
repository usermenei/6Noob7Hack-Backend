const reservationsController = require('../controllers/reservations');

jest.mock('../models/Reservation', () => ({
  find: jest.fn(),
  findById: jest.fn(),
  findOne: jest.fn(),
  countDocuments: jest.fn(),
  create: jest.fn(),
  findByIdAndUpdate: jest.fn(),
}));
jest.mock('../models/Room', () => ({ findById: jest.fn() }));
jest.mock('../models/TimeSlot', () => ({ find: jest.fn() }));
jest.mock('../models/User', () => ({ findByIdAndUpdate: jest.fn() }));
jest.mock('../models/Payment', () => ({
  findOne: jest.fn(),
  find: jest.fn(),  // ✅ เพิ่ม find เพราะ getReservations ใช้ Payment.find()
}));

const Reservation = require('../models/Reservation');
const Room = require('../models/Room');
const TimeSlot = require('../models/TimeSlot');
const User = require('../models/User');
const Payment = require('../models/Payment');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function chainableResolve(value) {
  const chain = {
    populate: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(value),
  };
  return chain;
}

function timeslotFind(slots) {
  return { sort: jest.fn().mockResolvedValue(slots) };
}

beforeEach(() => {
  jest.clearAllMocks();
  // ✅ default mock Payment.find → ส่งคืน [] เสมอ (chainable)
  Payment.find.mockReturnValue({
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue([]),
  });
});

describe('handleError (via getReservations)', () => {
  test('handles duplicate key error (code 11000)', async () => {
    Reservation.find.mockImplementation(() => { throw { code: 11000 }; });
    const res = mockRes();
    await reservationsController.getReservations({ user: { role: 'admin' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Duplicate field value entered.' }));
  });

  test('handles ValidationError', async () => {
    Reservation.find.mockImplementation(() => { throw { name: 'ValidationError', message: 'bad input' }; });
    const res = mockRes();
    await reservationsController.getReservations({ user: { role: 'admin' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'bad input' }));
  });

  test('handles CastError', async () => {
    Reservation.find.mockImplementation(() => { throw { name: 'CastError' }; });
    const res = mockRes();
    await reservationsController.getReservations({ user: { role: 'admin' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Invalid ID format' }));
  });

  test('handles generic server error', async () => {
    Reservation.find.mockImplementation(() => { throw new Error('boom'); });
    const res = mockRes();
    await reservationsController.getReservations({ user: { role: 'admin' } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Server error' }));
  });
});

describe('getReservations', () => {
  test('admin sees all reservations', async () => {
    const data = [{ _id: '1' }, { _id: '2' }];
    Reservation.find.mockReturnValue(chainableResolve(data));
    // ✅ Payment.find คืน [] เพื่อ enriched map จะใส่ paymentMethod: null
    Payment.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    });

    const req = { user: { role: 'admin' } };
    const res = mockRes();
    await reservationsController.getReservations(req, res);

    expect(Reservation.find).toHaveBeenCalledWith({});
    expect(res.status).toHaveBeenCalledWith(200);
    // ✅ data จะถูก enrich → เช็ค count และ success แทน data ตรงๆ
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, count: 2 }));
  });

  test('non-admin sees only their own reservations', async () => {
    const data = [{ _id: '3' }];
    Reservation.find.mockReturnValue(chainableResolve(data));
    Payment.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    });

    const req = { user: { role: 'user', id: 'u1' } };
    const res = mockRes();
    await reservationsController.getReservations(req, res);

    expect(Reservation.find).toHaveBeenCalledWith({ user: 'u1' });
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('getReservations — paymentMap enrichment', () => {
  // helper สร้าง payment mock ที่มี reservation field เป็น object ที่ toString() ได้
  function makePayment(reservationId, extra = {}) {
    return {
      reservation: { toString: () => reservationId },
      method: 'qr',
      status: 'completed',
      _id: `pay-${reservationId}`,
      ...extra,
    };
  }

  function setupReservations(reservations) {
    Reservation.find.mockReturnValue(chainableResolve(reservations));
  }

  function setupPayments(payments) {
    Payment.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(payments),
    });
  }

  test('reservation ที่มี payment → enriched ด้วย paymentMethod, paymentStatus, paymentId', async () => {
    const reservations = [{ _id: { toString: () => 'res-1' } }];
    const payments = [makePayment('res-1', { method: 'qr', status: 'completed', _id: 'pay-1' })];

    setupReservations(reservations);
    setupPayments(payments);

    const req = { user: { role: 'admin' } };
    const res = mockRes();
    await reservationsController.getReservations(req, res);

    const enriched = res.json.mock.calls[0][0].data[0];
    expect(enriched.paymentMethod).toBe('qr');
    expect(enriched.paymentStatus).toBe('completed');
    expect(enriched.paymentId).toBe('pay-1');
  });

  test('reservation ที่ไม่มี payment → paymentMethod, paymentStatus, paymentId เป็น null', async () => {
    const reservations = [{ _id: { toString: () => 'res-no-pay' } }];

    setupReservations(reservations);
    setupPayments([]); // ไม่มี payment เลย

    const req = { user: { role: 'admin' } };
    const res = mockRes();
    await reservationsController.getReservations(req, res);

    const enriched = res.json.mock.calls[0][0].data[0];
    expect(enriched.paymentMethod).toBeNull();
    expect(enriched.paymentStatus).toBeNull();
    expect(enriched.paymentId).toBeNull();
  });

  test('หลาย reservation — แต่ละอันได้ payment ของตัวเองถูกต้อง (ไม่ปนกัน)', async () => {
    const reservations = [
      { _id: { toString: () => 'res-A' } },
      { _id: { toString: () => 'res-B' } },
      { _id: { toString: () => 'res-C' } },
    ];
    const payments = [
      makePayment('res-A', { method: 'cash', status: 'pending', _id: 'pay-A' }),
      makePayment('res-C', { method: 'qr',   status: 'completed', _id: 'pay-C' }),
      // res-B ไม่มี payment
    ];

    setupReservations(reservations);
    setupPayments(payments);

    const req = { user: { role: 'admin' } };
    const res = mockRes();
    await reservationsController.getReservations(req, res);

    const data = res.json.mock.calls[0][0].data;
    const resA = data.find(r => r._id.toString() === 'res-A');
    const resB = data.find(r => r._id.toString() === 'res-B');
    const resC = data.find(r => r._id.toString() === 'res-C');

    expect(resA.paymentMethod).toBe('cash');
    expect(resA.paymentStatus).toBe('pending');
    expect(resA.paymentId).toBe('pay-A');

    expect(resB.paymentMethod).toBeNull();
    expect(resB.paymentStatus).toBeNull();
    expect(resB.paymentId).toBeNull();

    expect(resC.paymentMethod).toBe('qr');
    expect(resC.paymentStatus).toBe('completed');
    expect(resC.paymentId).toBe('pay-C');
  });

  test('Payment.find ถูกเรียกด้วย reservationIds ที่ถูกต้อง', async () => {
    const reservations = [
      { _id: { toString: () => 'res-X' } },
      { _id: { toString: () => 'res-Y' } },
    ];

    setupReservations(reservations);
    setupPayments([]);

    const req = { user: { role: 'admin' } };
    const res = mockRes();
    await reservationsController.getReservations(req, res);

    expect(Payment.find).toHaveBeenCalledWith({
      reservation: { $in: reservations.map(r => r._id) },
    });
  });

  test('count ใน response ตรงกับจำนวน reservation จริง (ไม่นับ payment)', async () => {
    const reservations = [
      { _id: { toString: () => 'res-1' } },
      { _id: { toString: () => 'res-2' } },
      { _id: { toString: () => 'res-3' } },
    ];

    setupReservations(reservations);
    setupPayments([makePayment('res-1')]); // มีแค่ 1 payment แต่ count ต้องเป็น 3

    const req = { user: { role: 'admin' } };
    const res = mockRes();
    await reservationsController.getReservations(req, res);

    expect(res.json.mock.calls[0][0].count).toBe(3);
  });
});

describe('getReservation', () => {
  test('404 when reservation not found', async () => {
    Reservation.findById.mockReturnValue(chainableResolve(null));
    const req = { params: { id: 'r1' }, user: { id: 'u1', role: 'user' } };
    const res = mockRes();
    await reservationsController.getReservation(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Reservation not found' }));
  });

  test('403 when not owner and not admin', async () => {
    const reservation = { user: { _id: { toString: () => 'other' } } };
    Reservation.findById.mockReturnValue(chainableResolve(reservation));
    const req = { params: { id: 'r2' }, user: { id: 'u1', role: 'user' } };
    const res = mockRes();
    await reservationsController.getReservation(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Not authorized' }));
  });

  test('200 when owner accesses their reservation', async () => {
    const reservation = { user: { _id: { toString: () => 'u1' } } };
    Reservation.findById.mockReturnValue(chainableResolve(reservation));
    const req = { params: { id: 'r3' }, user: { id: 'u1', role: 'user' } };
    const res = mockRes();
    await reservationsController.getReservation(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, data: reservation }));
  });

  test('200 when admin accesses any reservation', async () => {
    const reservation = { user: { _id: { toString: () => 'someone-else' } } };
    Reservation.findById.mockReturnValue(chainableResolve(reservation));
    const req = { params: { id: 'r4' }, user: { id: 'admin1', role: 'admin' } };
    const res = mockRes();
    await reservationsController.getReservation(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('500 on unexpected error', async () => {
    Reservation.findById.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      lean: jest.fn().mockRejectedValue(new Error('db fail')),
    });
    const req = { params: { id: 'r1' }, user: { id: 'u1', role: 'user' } };
    const res = mockRes();
    await reservationsController.getReservation(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('addReservation', () => {
  test('400 when timeSlotIds missing', async () => {
    const req = { body: {}, user: { id: 'u1' } };
    const res = mockRes();
    await reservationsController.addReservation(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'timeSlotIds must be a non-empty array' }));
  });

  test('400 when timeSlotIds is not an array', async () => {
    const req = { body: { timeSlotIds: 'not-array' }, user: { id: 'u1' } };
    const res = mockRes();
    await reservationsController.addReservation(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('400 when timeSlotIds is empty array', async () => {
    const req = { body: { timeSlotIds: [] }, user: { id: 'u1' } };
    const res = mockRes();
    await reservationsController.addReservation(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('404 when some time slots not found', async () => {
    TimeSlot.find.mockReturnValue(timeslotFind([]));
    const req = { body: { timeSlotIds: ['a', 'b'] }, user: { id: 'u1' } };
    const res = mockRes();
    await reservationsController.addReservation(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Some time slots not found' }));
  });

  test('400 when slots belong to different rooms', async () => {
    const slots = [
      { room: { toString: () => 'r1' }, endTime: '2024-01-01T09:00:00Z' },
      { room: { toString: () => 'r2' }, startTime: '2024-01-01T09:00:00Z' },
    ];
    TimeSlot.find.mockReturnValue(timeslotFind(slots));
    const req = { body: { timeSlotIds: ['1', '2'] }, user: { id: 'u1' } };
    const res = mockRes();
    await reservationsController.addReservation(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'All slots must belong to same room' }));
  });

  test('400 when one or more slots already booked', async () => {
    const slots = [{ room: { toString: () => 'r1' }, startTime: '2024-01-01T08:00:00Z', endTime: '2024-01-01T09:00:00Z' }];
    TimeSlot.find.mockReturnValue(timeslotFind(slots));
    Reservation.findOne.mockResolvedValue({ _id: 'existing' });
    const req = { body: { timeSlotIds: ['1'] }, user: { id: 'u1' } };
    const res = mockRes();
    await reservationsController.addReservation(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'One or more slots already booked' }));
  });

  test('400 when user exceeds 3 active reservations', async () => {
    const slots = [{ room: { toString: () => 'r1' }, startTime: '2024-01-01T08:00:00Z', endTime: '2024-01-01T09:00:00Z' }];
    TimeSlot.find.mockReturnValue(timeslotFind(slots));
    Reservation.findOne.mockResolvedValue(null);
    Reservation.countDocuments.mockResolvedValue(3);
    const req = { body: { timeSlotIds: ['1'] }, user: { id: 'u1' } };
    const res = mockRes();
    await reservationsController.addReservation(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Max 3 active reservations' }));
  });

  test('201 on successful reservation creation', async () => {
    const slots = [{ room: { toString: () => 'r1' }, startTime: '2024-01-01T08:00:00Z', endTime: '2024-01-01T09:00:00Z' }];
    TimeSlot.find.mockReturnValue(timeslotFind(slots));
    Reservation.findOne.mockResolvedValue(null);
    Reservation.countDocuments.mockResolvedValue(0);
    Room.findById.mockResolvedValue({ name: 'Room A', price: 100, capacity: 5 });
    Reservation.create.mockResolvedValue({ _id: 'new-res' });
    const req = { body: { timeSlotIds: ['1'] }, user: { id: 'u1' } };
    const res = mockRes();
    await reservationsController.addReservation(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('500 on unexpected error', async () => {
    TimeSlot.find.mockReturnValue({ sort: jest.fn().mockRejectedValue(new Error('db fail')) });
    const req = { body: { timeSlotIds: ['1'] }, user: { id: 'u1' } };
    const res = mockRes();
    await reservationsController.addReservation(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('updateReservation', () => {
  test('404 when reservation not found', async () => {
    Reservation.findById.mockResolvedValue(null);
    const req = { params: { id: 'x' }, user: { id: 'u1', role: 'user' }, body: {} };
    const res = mockRes();
    await reservationsController.updateReservation(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('403 when not owner and not admin', async () => {
    const reservation = { _id: 'r', user: { toString: () => 'other' }, status: 'pending' };
    Reservation.findById.mockResolvedValue(reservation);
    const req = { params: { id: 'r' }, user: { id: 'u1', role: 'user' }, body: { timeSlotIds: ['1'] } };
    const res = mockRes();
    await reservationsController.updateReservation(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('400 when reservation status is not pending', async () => {
    const reservation = { _id: 'r', user: { toString: () => 'u1' }, status: 'success' };
    Reservation.findById.mockResolvedValue(reservation);
    const req = { params: { id: 'r' }, user: { id: 'u1', role: 'user' }, body: { timeSlotIds: ['1'] } };
    const res = mockRes();
    await reservationsController.updateReservation(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Only pending can update' }));
  });

  test('400 when timeSlotIds missing in body', async () => {
    const reservation = { _id: 'r', user: { toString: () => 'u1' }, status: 'pending' };
    Reservation.findById.mockResolvedValue(reservation);
    const req = { params: { id: 'r' }, user: { id: 'u1', role: 'user' }, body: {} };
    const res = mockRes();
    await reservationsController.updateReservation(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'timeSlotIds required' }));
  });

  test('400 when requested slot already booked', async () => {
    const reservation = { _id: 'r', user: { toString: () => 'u1' }, status: 'pending' };
    Reservation.findById.mockResolvedValue(reservation);
    Reservation.findOne.mockResolvedValue({ _id: 'other-res' });
    const req = { params: { id: 'r' }, user: { id: 'u1', role: 'user' }, body: { timeSlotIds: ['1'] } };
    const res = mockRes();
    await reservationsController.updateReservation(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Slot already booked' }));
  });

  test('200 on successful update by owner', async () => {
    const reservation = { _id: 'r', user: { toString: () => 'u1' }, status: 'pending', save: jest.fn().mockResolvedValue(true) };
    Reservation.findById.mockResolvedValue(reservation);
    Reservation.findOne.mockResolvedValue(null);
    const req = { params: { id: 'r' }, user: { id: 'u1', role: 'user' }, body: { timeSlotIds: ['1', '2'] } };
    const res = mockRes();
    await reservationsController.updateReservation(req, res);
    expect(reservation.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('200 when admin updates any reservation', async () => {
    const reservation = { _id: 'r', user: { toString: () => 'other' }, status: 'pending', save: jest.fn().mockResolvedValue(true) };
    Reservation.findById.mockResolvedValue(reservation);
    Reservation.findOne.mockResolvedValue(null);
    const req = { params: { id: 'r' }, user: { id: 'admin1', role: 'admin' }, body: { timeSlotIds: ['1'] } };
    const res = mockRes();
    await reservationsController.updateReservation(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('500 on unexpected error', async () => {
    Reservation.findById.mockRejectedValue(new Error('db fail'));
    const req = { params: { id: 'r' }, user: { id: 'u1', role: 'user' }, body: {} };
    const res = mockRes();
    await reservationsController.updateReservation(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('deleteReservation', () => {
  test('404 when reservation not found', async () => {
    Reservation.findById.mockResolvedValue(null);
    const req = { params: { id: 'x' }, user: { id: 'u1', role: 'user' } };
    const res = mockRes();
    await reservationsController.deleteReservation(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Reservation not found' }));
  });

  test('403 when not owner and not admin', async () => {
    const reservation = { user: { toString: () => 'other' } };
    Reservation.findById.mockResolvedValue(reservation);
    const req = { params: { id: 'r' }, user: { id: 'u1', role: 'user' } };
    const res = mockRes();
    await reservationsController.deleteReservation(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Not authorized' }));
  });

  test('200 on successful cancellation by owner', async () => {
    const reservation = { _id: 'res-1', user: { toString: () => 'u1' }, status: 'pending', timeSlots: [], save: jest.fn().mockResolvedValue(true) };
    Reservation.findById.mockResolvedValue(reservation);
    TimeSlot.find.mockReturnValue(timeslotFind([]));
    Payment.findOne.mockResolvedValue(null);

    const req = { params: { id: 'r' }, user: { id: 'u1', role: 'user' } };
    const res = mockRes();
    await reservationsController.deleteReservation(req, res);

    expect(reservation.status).toBe('cancelled');
    expect(reservation.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, message: 'Reservation cancelled' }));
  });

  test('200 when admin cancels any reservation', async () => {
    const reservation = { _id: 'res-2', user: { toString: () => 'other' }, status: 'pending', timeSlots: [], save: jest.fn().mockResolvedValue(true) };
    Reservation.findById.mockResolvedValue(reservation);
    TimeSlot.find.mockReturnValue(timeslotFind([]));
    Payment.findOne.mockResolvedValue(null);

    const req = { params: { id: 'r' }, user: { id: 'admin1', role: 'admin' } };
    const res = mockRes();
    await reservationsController.deleteReservation(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('500 on unexpected error', async () => {
    Reservation.findById.mockRejectedValue(new Error('db fail'));
    const req = { params: { id: 'r' }, user: { id: 'u1', role: 'user' } };
    const res = mockRes();
    await reservationsController.deleteReservation(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('confirmReservation', () => {
  test('403 when not admin', async () => {
    const req = { params: { id: 'r' }, user: { role: 'user', id: 'u1' } };
    const res = mockRes();
    await reservationsController.confirmReservation(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Admin only' }));
  });

  test('404 when reservation not found', async () => {
    Reservation.findById.mockResolvedValue(null);
    const req = { params: { id: 'r' }, user: { role: 'admin' } };
    const res = mockRes();
    await reservationsController.confirmReservation(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Reservation not found' }));
  });

  test('200 on successful confirm', async () => {
    const reservation = { user: 'u1', status: 'pending', save: jest.fn().mockResolvedValue(true) };
    Reservation.findById.mockResolvedValue(reservation);
    User.findByIdAndUpdate.mockResolvedValue({});
    const req = { params: { id: 'r' }, user: { role: 'admin' } };
    const res = mockRes();
    await reservationsController.confirmReservation(req, res);
    expect(reservation.status).toBe('success');
    expect(reservation.save).toHaveBeenCalled();
    expect(User.findByIdAndUpdate).toHaveBeenCalledWith('u1', { $inc: { numberOfEntries: 1 } });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, message: 'Reservation confirmed' }));
  });

  test('500 on unexpected error', async () => {
    Reservation.findById.mockRejectedValue(new Error('db fail'));
    const req = { params: { id: 'r' }, user: { role: 'admin' } };
    const res = mockRes();
    await reservationsController.confirmReservation(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('updateReservation, deleteReservation, confirmReservation', () => {
  test('updateReservation: 200 on success', async () => {
    const resv = { _id: 'r1', user: 'u1', status: 'pending', save: jest.fn() };
    Reservation.findById.mockResolvedValue(resv);
    Reservation.findOne.mockResolvedValue(null);

    const req = { params: { id: 'r1' }, body: { timeSlotIds: ['ts2'] }, user: { id: 'u1' } };
    const res = mockRes();
    await reservationsController.updateReservation(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('confirmReservation: 200 and increments user entries', async () => {
    const resv = { _id: 'r1', user: 'u1', save: jest.fn() };
    Reservation.findById.mockResolvedValue(resv);
    User.findByIdAndUpdate.mockResolvedValue({});

    const req = { params: { id: 'r1' }, user: { role: 'admin' } };
    const res = mockRes();
    await reservationsController.confirmReservation(req, res);

    expect(User.findByIdAndUpdate).toHaveBeenCalledWith('u1', { $inc: { numberOfEntries: 1 } });
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('handleError branch coverage', () => {
  test('handles error without code or name (fallback to 500)', async () => {
    Reservation.find.mockImplementation(() => {
      const err = new Error('Generic');
      delete err.stack;
      throw err;
    });
    const res = mockRes();
    await reservationsController.getReservations({ user: { role: 'admin' } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Server error' }));
  });
});

describe('addReservation deep branch coverage', () => {
  test('Line 158: 400 when timeSlotIds is not an array', async () => {
    const req = { body: { timeSlotIds: "not-an-array" }, user: { id: 'u1' } };
    const res = mockRes();
    await reservationsController.addReservation(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('updateReservation admin branch', () => {
  test('Line 245: Admin can update even if not owner', async () => {
    const reservation = {
      _id: 'r1',
      user: 'other-user-id',
      status: 'pending',
      save: jest.fn().mockResolvedValue(true)
    };
    Reservation.findById.mockResolvedValue(reservation);
    Reservation.findOne.mockResolvedValue(null);

    const req = {
      params: { id: 'r1' },
      user: { id: 'admin-id', role: 'admin' },
      body: { timeSlotIds: ['tsnew'] }
    };
    const res = mockRes();
    await reservationsController.updateReservation(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(reservation.save).toHaveBeenCalled();
  });
});

describe('confirmReservation error branches', () => {
  test('Line 345: 403 when user is NOT admin', async () => {
    const req = { user: { role: 'user' }, params: { id: 'r1' } };
    const res = mockRes();
    await reservationsController.confirmReservation(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Admin only' }));
  });
});

describe('permanentlyDeleteReservation', () => {
  test('200 Success: should delete reservation if user is the owner', async () => {
    const mockResv = {
      user: { toString: () => 'user123' },
      deleteOne: jest.fn().mockResolvedValue(true)
    };
    Reservation.findById.mockResolvedValue(mockResv);

    const req = {
      params: { id: 'res1' },
      user: { id: 'user123', role: 'user' }
    };
    const res = mockRes();

    await reservationsController.permanentlyDeleteReservation(req, res);

    expect(mockResv.deleteOne).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: "Reservation permanently deleted"
    }));
  });

  test('200 Success: should delete if requester is admin (even if not owner)', async () => {
    const mockResv = {
      user: { toString: () => 'other_user' },
      deleteOne: jest.fn().mockResolvedValue(true)
    };
    Reservation.findById.mockResolvedValue(mockResv);

    const req = {
      params: { id: 'res1' },
      user: { id: 'admin123', role: 'admin' }
    };
    const res = mockRes();

    await reservationsController.permanentlyDeleteReservation(req, res);

    expect(mockResv.deleteOne).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('404 Not Found: should return 404 if reservation does not exist', async () => {
    Reservation.findById.mockResolvedValue(null);

    const req = { params: { id: 'invalid_id' }, user: {} };
    const res = mockRes();

    await reservationsController.permanentlyDeleteReservation(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: "Reservation not found"
    }));
  });

  test('403 Forbidden: should return 403 if user is not owner and not admin', async () => {
    const mockResv = {
      user: { toString: () => 'owner_id' }
    };
    Reservation.findById.mockResolvedValue(mockResv);

    const req = {
      params: { id: 'res1' },
      user: { id: 'attacker_id', role: 'user' }
    };
    const res = mockRes();

    await reservationsController.permanentlyDeleteReservation(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: "Not authorized"
    }));
  });

  test('500 Error: should trigger handleError on database failure', async () => {
    Reservation.findById.mockImplementation(() => {
      throw new Error('DB connection lost');
    });

    const req = { params: { id: 'res1' }, user: {} };
    const res = mockRes();

    await reservationsController.permanentlyDeleteReservation(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});