const { createPayment, confirmPayment, failPayment } = require('../controllers/payments');
const Payment = require('../models/Payment');
const Reservation = require('../models/Reservation');

// Mock Mongoose Models
jest.mock('../models/Payment');
jest.mock('../models/Reservation');

describe('Payment Controller', () => {
    let req, res;

    beforeEach(() => {
        // Reset mocks before each test
        jest.clearAllMocks();

        // Mock Express Request and Response objects
        req = {
            body: {},
            params: {},
            user: { id: 'user123', role: 'user' }
        };

        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        };
    });

    describe('POST /payments (createPayment)', () => {
        it('should return 400 if reservationId or method are missing', async () => {
            req.body = { method: 'qr' }; // missing reservationId
            await createPayment(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({
                success: false,
                message: 'reservationId and method are required'
            });
        });

        it('should return 400 for an invalid payment method', async () => {
            req.body = { reservationId: 'res123', method: 'credit_card' };
            await createPayment(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({
                success: false,
                message: 'method must be "qr" or "cash"'
            });
        });

        it('should return 404 if reservation is not found', async () => {
            req.body = { reservationId: 'res123', method: 'qr' };
            
            // Mock Mongoose chaining
            Reservation.findById.mockReturnValue({
                populate: jest.fn().mockReturnValue({
                    populate: jest.fn().mockResolvedValue(null)
                })
            });

            await createPayment(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith({
                success: false,
                message: 'Reservation not found'
            });
        });

        it('should return 400 if reservation is already paid (not pending)', async () => {
            req.body = { reservationId: 'res123', method: 'qr' };
            
            Reservation.findById.mockReturnValue({
                populate: jest.fn().mockReturnValue({
                    populate: jest.fn().mockResolvedValue({
                        _id: 'res123',
                        user: 'user123',
                        status: 'success', // Already paid
                        room: { name: 'Room A', price: 100 },
                        timeSlots: [{}, {}]
                    })
                })
            });

            await createPayment(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: false,
                message: expect.stringContaining('Only pending reservations can be paid')
            }));
        });

        it('should return 400 if a duplicate payment already exists', async () => {
            req.body = { reservationId: 'res123', method: 'qr' };
            
            Reservation.findById.mockReturnValue({
                populate: jest.fn().mockReturnValue({
                    populate: jest.fn().mockResolvedValue({
                        _id: 'res123',
                        user: 'user123',
                        status: 'pending',
                        room: { name: 'Room A', price: 100 },
                        timeSlots: [{}, {}]
                    })
                })
            });

            // Mock existing payment found
            Payment.findOne.mockResolvedValue({ _id: 'pay123', status: 'pending' });

            await createPayment(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({
                success: false,
                message: 'A payment already exists for this reservation'
            });
        });

        it('should successfully create a pending payment record', async () => {
            req.body = { reservationId: 'res123', method: 'qr' };
            
            Reservation.findById.mockReturnValue({
                populate: jest.fn().mockReturnValue({
                    populate: jest.fn().mockResolvedValue({
                        _id: 'res123',
                        user: 'user123',
                        status: 'pending',
                        room: { name: 'Room A', price: 100 },
                        timeSlots: [{}, {}] // 2 slots * 100 = 200 total amount
                    })
                })
            });

            Payment.findOne.mockResolvedValue(null); // No duplicate
            Payment.create.mockResolvedValue({
                _id: 'pay123',
                method: 'qr',
                status: 'pending'
            });

            await createPayment(req, res);

            expect(Payment.create).toHaveBeenCalledWith(expect.objectContaining({
                reservation: 'res123',
                user: 'user123',
                amount: 200, 
                method: 'qr',
                status: 'pending'
            }));
            expect(res.status).toHaveBeenCalledWith(201);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                data: expect.any(Object)
            }));
        });
    });

    describe('PUT /payments/:id/confirm (Success Flow)', () => {
        it('should set payment to completed and reservation to success atomically', async () => {
            req.params.id = 'pay123';
            
            const mockSave = jest.fn();
            Payment.findById.mockResolvedValue({
                _id: 'pay123',
                status: 'pending',
                reservation: 'res123',
                save: mockSave
            });

            Reservation.findByIdAndUpdate.mockResolvedValue(true);

            await confirmPayment(req, res);

            expect(mockSave).toHaveBeenCalled();
            expect(Reservation.findByIdAndUpdate).toHaveBeenCalledWith('res123', { status: 'success' });
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                data: expect.objectContaining({
                    status: 'completed',
                    transactionId: expect.stringMatching(/^TXN-/)
                })
            }));
        });
    });

    describe('PUT /payments/:id/fail (Failure Flow)', () => {
        it('should set payment to failed and leave reservation untouched', async () => {
            req.params.id = 'pay123';
            
            const mockSave = jest.fn();
            Payment.findById.mockResolvedValue({
                _id: 'pay123',
                status: 'pending',
                save: mockSave
            });

            await failPayment(req, res);

            expect(mockSave).toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                message: expect.stringContaining('Reservation is still pending'),
                data: expect.objectContaining({ status: 'failed' })
            }));
        });
    });
});