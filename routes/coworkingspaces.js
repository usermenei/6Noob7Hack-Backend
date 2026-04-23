const express = require('express');
const router = express.Router();

const {
  getCoworkingspaces,
  getCoworkingspace,
  createCoworkingspace,
  updateCoworkingspace,
  deleteCoworkingspace,
  updateCoworkingspacePhoto
} = require('../controllers/coworkingspaces');

const { getQrCode } = require('../controllers/payments');

const { getRoomsByCoworking, getRoomByCoworking } = require('../controllers/rooms');

const { protect, authorize } = require('../middleware/auth');

router.route('/')
  .get(getCoworkingspaces)
  .post(protect, authorize('admin'), createCoworkingspace);

router.route('/:id')
  .get(getCoworkingspace)
  .put(protect, authorize('admin'), updateCoworkingspace)
  .delete(protect, authorize('admin'), deleteCoworkingspace);

router.route('/:id/photo')
  .put(protect, authorize('admin'), updateCoworkingspacePhoto);

router.get('/:coworkingId/rooms', getRoomsByCoworking);
router.get('/:coworkingId/rooms/:roomId', getRoomByCoworking);

router.get('/:coworkingId/qr-code', protect, getQrCode);

module.exports = router;