// models/Payment.js
const mongoose = require('mongoose');

const PaymentSchema = new mongoose.Schema(
    {
        reservation: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Reservation',
            required: true
        },
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        amount: {
            type: Number,
            required: true,
            min: 0
        },
        method: {
            type: String,
            enum: ['qr', 'cash'],
            required: true
        },
        status: {
            type: String,
            enum: ['pending', 'completed', 'failed', 'cancelled', 'refund_required', 'refunded'],
            default: 'pending'
        },
        transactionId: {
            type: String,
            unique: true,
            sparse: true  // allows multiple nulls
        },

        // --- QR specific ---
        activeQr: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'QrCode',
            default: null
        },

        // --- Cash specific ---
        cashConfirmedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null
        },
        cashConfirmedAt: {
            type: Date,
            default: null
        },
        auditLog: [
            {
                changedBy : { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
                action    : { type: String },  // 'method_change' | 'cancel'
                oldMethod : { type: String },
                newMethod : { type: String },
                oldStatus : { type: String },
                newStatus : { type: String },
                timestamp : { type: Date, default: Date.now }
            }
        ]
    },
    {
        timestamps: true
    }
);

// Index for fast user payment history lookup
PaymentSchema.index({ user: 1, createdAt: -1 });
PaymentSchema.index({ reservation: 1 });

module.exports = mongoose.model('Payment', PaymentSchema);